import { generateInterpretation } from "@/lib/analyzeCashflow";
import { cacheGet, cachePut } from "@/lib/cache";
import { InvalidUrlError, RateLimitedError, mapError } from "@/lib/errors";
import {
  fetchCashflow,
  fetchKgvEulerpool,
  resolveCompany,
} from "@/lib/eulerPool";
import { getClientIp } from "@/lib/getClientIp";
import { checkRateLimit } from "@/lib/rateLimit";
import { AnalyzeRequest, type CashflowResult } from "@/lib/schema";
import { sha256 } from "@/lib/sha256";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 24 * 60 * 60;

export async function POST(req: Request): Promise<Response> {
  let requestedQuery: string | null = null;

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

    const { ticker, companyName } = await resolveCompany(query);

    const cacheKey = `cf:v3:${sha256(ticker)}`;
    const cached = await cacheGet<CashflowResult>(cacheKey);

    let cashflowResult: CashflowResult;
    if (cached) {
      cashflowResult = { ...cached, requestedQuery: query };
    } else {
      const cashflow = await fetchCashflow(ticker);
      const cashflowWithName = {
        ...cashflow,
        company: cashflow.company ?? companyName,
      };
      cashflowResult = await generateInterpretation(cashflowWithName, {
        requestedQuery: query,
        sourceResolved: true,
      });
      await cachePut(cacheKey, cashflowResult, CACHE_TTL_SECONDS);
    }

    const kgv = await fetchKgvEulerpool(ticker);

    return Response.json(
      { ...cashflowResult, kgv },
      { headers: { "x-cache": cached ? "hit" : "miss" } },
    );
  } catch (error) {
    return mapError(error, { requestedQuery, sourceResolved: true });
  }
}
