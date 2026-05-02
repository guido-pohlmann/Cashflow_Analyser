import { analyzeCashflow } from "@/lib/analyzeCashflow";
import { cacheGet, cachePut } from "@/lib/cache";
import {
  BlockedTargetError,
  ContentTooShortError,
  FetchFailedError,
  FetchTimeoutError,
  InvalidUrlError,
  PdfParsingFailedError,
  RateLimitedError,
  mapError,
} from "@/lib/errors";
import { extractText } from "@/lib/extractText";
import { extractTextFromPdf } from "@/lib/extractTextPdf";
import { fetchKgv } from "@/lib/fetchKgv";
import { fetchPage } from "@/lib/fetchPage";
import { getClientIp } from "@/lib/getClientIp";
import { checkRateLimit } from "@/lib/rateLimit";
import { resolveSource } from "@/lib/resolveSource";
import { AnalyzeRequest, type CashflowResult } from "@/lib/schema";
import { sha256 } from "@/lib/sha256";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const URL_RE = /^https?:\/\//i;

export async function POST(req: Request): Promise<Response> {
  let requestedQuery: string | null = null;
  let attemptedUrl: string | null = null;
  let sourceResolved = false;

  try {
    const ip = getClientIp(req);

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = AnalyzeRequest.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidUrlError(
        parsed.error.issues[0]?.message ?? "Ungültige Eingabe.",
      );
    }
    const { query } = parsed.data;
    requestedQuery = query;

    const limited = await checkRateLimit(ip);
    if (limited.blocked) {
      throw new RateLimitedError(
        "Zu viele Anfragen. Bitte in einer Stunde erneut versuchen.",
      );
    }

    if (URL_RE.test(query)) {
      attemptedUrl = query;
      sourceResolved = false;
    } else {
      const resolved = await resolveSource(query);
      attemptedUrl = resolved.url;
      sourceResolved = true;
    }

    const cacheKey = `cf:v2:${sha256(attemptedUrl)}`;
    const cached = await cacheGet<CashflowResult>(cacheKey);

    let cashflowResult: CashflowResult;
    if (cached) {
      cashflowResult = { ...cached, requestedQuery: query, sourceResolved };
    } else {
      cashflowResult = await fetchAndAnalyze(
        attemptedUrl,
        query,
        sourceResolved,
      );
      await cachePut(cacheKey, cashflowResult, CACHE_TTL_SECONDS);
    }

    // KGV: 24h cached separately — stock price needs daily refresh
    const identifier = cashflowResult.company ?? query;
    const kgv = await fetchKgv(identifier);

    return Response.json(
      { ...cashflowResult, kgv },
      { headers: { "x-cache": cached ? "hit" : "miss" } },
    );
  } catch (error) {
    return mapError(error, { requestedQuery, attemptedUrl, sourceResolved });
  }
}

async function fetchAndAnalyze(
  url: string,
  requestedQuery: string,
  sourceResolved: boolean,
): Promise<CashflowResult> {
  // Primary path: fetch page directly (no AI token cost for document retrieval)
  try {
    const page = await fetchPage(url);
    const extracted =
      page.mediaType === "application/pdf"
        ? await extractTextFromPdf(page.bodyBytes)
        : extractText(page.bodyHtml, page.finalUrl);

    if (extracted.charCount < 200) {
      throw new ContentTooShortError(
        "Zu wenig Inhalt auf der Seite gefunden.",
      );
    }

    return await analyzeCashflow({
      text: extracted.text,
      sourceUrl: page.finalUrl,
      sourceMediaType: page.mediaType,
      requestedQuery,
      sourceResolved,
    });
  } catch (e) {
    // Fallback: let Claude fetch via web_search (handles WAF/timeout/blocked sites)
    if (
      e instanceof FetchTimeoutError ||
      e instanceof FetchFailedError ||
      e instanceof BlockedTargetError ||
      e instanceof PdfParsingFailedError ||
      e instanceof ContentTooShortError
    ) {
      return await analyzeCashflow({ sourceUrl: url, requestedQuery, sourceResolved });
    }
    throw e;
  }
}
