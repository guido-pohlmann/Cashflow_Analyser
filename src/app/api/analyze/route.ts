import { analyzeCashflow } from "@/lib/analyzeCashflow";
import { cacheGet, cachePut } from "@/lib/cache";
import {
  InvalidUrlError,
  RateLimitedError,
  mapError,
} from "@/lib/errors";
import { fetchKgv } from "@/lib/fetchKgv";
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
      cashflowResult = await analyzeCashflow({
        sourceUrl: attemptedUrl,
        requestedQuery: query,
        sourceResolved,
      });
      await cachePut(cacheKey, cashflowResult, CACHE_TTL_SECONDS);
    }

    // KGV always fetched fresh (stock price changes daily); never cached
    const identifier = cashflowResult.company ?? query;
    const kgv = await fetchKgv(identifier);

    const headers: Record<string, string> = { "x-cache": cached ? "hit" : "miss" };
    return Response.json({ ...cashflowResult, kgv }, { headers });
  } catch (error) {
    return mapError(error, { requestedQuery, attemptedUrl, sourceResolved });
  }
}
