import { analyzeCashflow } from "@/lib/analyzeCashflow";
import { cacheGet, cachePut } from "@/lib/cache";
import {
  ContentTooShortError,
  InvalidUrlError,
  RateLimitedError,
  mapError,
} from "@/lib/errors";
import { extractText } from "@/lib/extractText";
import { extractTextFromPdf } from "@/lib/extractTextPdf";
import { fetchPage } from "@/lib/fetchPage";
import { getClientIp } from "@/lib/getClientIp";
import { checkRateLimit } from "@/lib/rateLimit";
import { AnalyzeRequest, type CashflowResult } from "@/lib/schema";
import { sha256 } from "@/lib/sha256";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 30 * 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const ip = getClientIp(req);

    const raw = (await req.json().catch(() => ({}))) as unknown;
    const parsed = AnalyzeRequest.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidUrlError(
        parsed.error.issues[0]?.message ?? "Ungültige URL.",
      );
    }
    const { url } = parsed.data;

    const limited = await checkRateLimit(ip);
    if (limited.blocked) {
      throw new RateLimitedError(
        "Zu viele Anfragen. Bitte in einer Stunde erneut versuchen.",
      );
    }

    const cacheKey = `cf:${sha256(url)}`;
    const cached = await cacheGet<CashflowResult>(cacheKey);
    if (cached) {
      return Response.json(cached, { headers: { "x-cache": "hit" } });
    }

    const page = await fetchPage(url);
    const extracted =
      page.mediaType === "application/pdf"
        ? await extractTextFromPdf(page.bodyBytes)
        : extractText(page.bodyHtml, page.finalUrl);
    if (extracted.charCount < 500) {
      throw new ContentTooShortError(
        "Auf der Seite wurden keine auswertbaren Inhalte gefunden.",
      );
    }

    const result = await analyzeCashflow({
      text: extracted.text,
      sourceUrl: page.finalUrl,
      sourceMediaType: page.mediaType,
    });

    await cachePut(cacheKey, result, CACHE_TTL_SECONDS);

    return Response.json(result, { headers: { "x-cache": "miss" } });
  } catch (error) {
    return mapError(error);
  }
}
