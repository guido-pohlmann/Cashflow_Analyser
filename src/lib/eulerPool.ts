import { z } from "zod";

import { cacheGet, cachePut } from "./cache";
import {
  EulerPoolError,
  EulerPoolNotFoundError,
  RateLimitedError,
} from "./errors";
import { CashflowUnit, KgvResult } from "./schema";
import { sha256 } from "./sha256";

const BASE_URL = "https://api.eulerpool.com/api/1";
const CACHE_TTL = 24 * 60 * 60;

// Intermediate type produced by Eulerpool; consumed by generateInterpretation.
export const EulerCashflow = z.object({
  ticker: z.string(),
  company: z.string().nullable(),
  period: z.string().nullable(),
  currency: z.string().nullable(),
  operating: z.number().nullable(),
  investing: z.number().nullable(),
  financing: z.number().nullable(),
  freeCashflow: z.number().nullable(),
  unit: CashflowUnit,
});
export type EulerCashflow = z.infer<typeof EulerCashflow>;

// --- Internal helpers ---

function buildUrl(path: string): string {
  const key = process.env.EULERPOOL_API_KEY;
  if (!key) throw new EulerPoolError("EULERPOOL_API_KEY nicht konfiguriert");
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${sep}token=${encodeURIComponent(key)}`;
}

async function eulerFetch(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    if (e instanceof EulerPoolError) throw e;
    const name = e instanceof Error ? e.name : "";
    throw new EulerPoolError(
      name === "TimeoutError"
        ? "Eulerpool API Timeout"
        : "Eulerpool API nicht erreichbar",
    );
  }
  if (res.status === 404) throw new EulerPoolNotFoundError();
  if (res.status === 429) throw new RateLimitedError("Eulerpool Rate-Limit erreicht");
  if (!res.ok) throw new EulerPoolError(`Eulerpool API-Fehler: HTTP ${res.status}`);
  return res.json();
}

// Scales raw absolute figures to a human-readable unit.
function normalizeUnit(values: (number | null)[]): { unit: CashflowUnit; factor: number } {
  const max = Math.max(
    0,
    ...values.filter((v): v is number => v !== null).map(Math.abs),
  );
  if (max >= 1e9) return { unit: "billion", factor: 1e9 };
  if (max >= 1e6) return { unit: "million", factor: 1e6 };
  if (max >= 1e3) return { unit: "thousand", factor: 1e3 };
  return { unit: "absolute", factor: 1 };
}

// --- API response shapes ---

const SearchHit = z
  .object({
    ticker: z.string(),
    name: z.string(),
    isin: z.string().nullish(),
  })
  .passthrough();

// Each fiscal year contains multiple tagged line items (XBRL taxonomy).
// val is returned as a decimal string, e.g. "111482000000.0000".
const CashflowLineItem = z
  .object({
    tag: z.string(),
    val: z.union([z.string(), z.number()]),
    fiscal_year: z.number(),
    fiscal_period: z.string().nullish(),
    unit: z.string().nullish(), // currency code, e.g. "USD"
  })
  .passthrough();

const RatiosRecord = z
  .object({
    pe_ratio: z.number().nullish(),
    peRatio: z.number().nullish(), // camelCase fallback for test mocks
    price: z.number().nullish(),
    current_price: z.number().nullish(),
    currency: z.string().nullish(),
  })
  .passthrough();

// --- Public API ---

export async function resolveCompany(
  query: string,
): Promise<{ ticker: string; companyName: string }> {
  const cacheKey = `ep:ticker:v1:${sha256(query.trim().toLowerCase())}`;
  const cached = await cacheGet<{ ticker: string; companyName: string }>(cacheKey);
  if (cached) return cached;

  const raw = await eulerFetch(`/equity/search?q=${encodeURIComponent(query.trim())}`);

  // API returns { count, results: [...] }; tolerate plain array for tests.
  const rawArray = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>).results)
      ? (raw as Record<string, unknown>).results
      : [];

  const parsed = z.array(SearchHit).safeParse(rawArray);
  if (!parsed.success || parsed.data.length === 0) {
    throw new EulerPoolNotFoundError(`Kein Unternehmen gefunden für: ${query}`);
  }

  // Prefer exact ticker match (case-insensitive), fall back to first result.
  const upperQuery = query.trim().toUpperCase();
  const hit =
    parsed.data.find((r) => r.ticker.toUpperCase() === upperQuery) ??
    parsed.data[0];

  const result = { ticker: hit.ticker, companyName: hit.name };
  await cachePut(cacheKey, result, CACHE_TTL);
  return result;
}

export async function fetchCashflow(ticker: string): Promise<EulerCashflow> {
  // v2: reflects XBRL-tagged line-item parsing (v1 used flat record format).
  const cacheKey = `ep:cf:v2:${sha256(ticker)}`;
  const cached = await cacheGet<EulerCashflow>(cacheKey);
  if (cached) return cached;

  const raw = await eulerFetch(
    `/fundamentals/financials/${encodeURIComponent(ticker)}/cash-flow?fiscal_period=FY`,
  );

  const records = Array.isArray(raw) ? raw : [];
  const parsed = z.array(CashflowLineItem).safeParse(records);
  if (!parsed.success || parsed.data.length === 0) {
    throw new EulerPoolError(
      `Unerwartete Cashflow-Antwortstruktur für Ticker ${ticker}`,
    );
  }

  // Pick the most recent fiscal year available.
  const maxYear = Math.max(...parsed.data.map((r) => r.fiscal_year));
  const yearItems = parsed.data.filter((r) => r.fiscal_year === maxYear);

  const findVal = (tag: string): number | null => {
    const item = yearItems.find((r) => r.tag === tag);
    if (!item) return null;
    const n = typeof item.val === "number" ? item.val : parseFloat(item.val as string);
    return isNaN(n) ? null : n;
  };

  const rawOp  = findVal("NetCashProvidedByUsedInOperatingActivities");
  const rawInv = findVal("NetCashProvidedByUsedInInvestingActivities");
  const rawFin = findVal("NetCashProvidedByUsedInFinancingActivities");
  const capex  = findVal("PaymentsToAcquirePropertyPlantAndEquipment");
  // FreeCashFlow = Operating − CapEx (not a direct field in this endpoint).
  const rawFree = rawOp !== null && capex !== null ? rawOp - capex : null;

  const sample  = yearItems[0];
  const period  = sample ? `${sample.fiscal_period ?? "FY"}${maxYear}` : null;
  const currency = sample?.unit ?? null;

  const { unit, factor } = normalizeUnit([rawOp, rawInv, rawFin, rawFree]);

  const result: EulerCashflow = {
    ticker,
    company: null,
    period,
    currency,
    operating:    rawOp   !== null ? rawOp   / factor : null,
    investing:    rawInv  !== null ? rawInv  / factor : null,
    financing:    rawFin  !== null ? rawFin  / factor : null,
    freeCashflow: rawFree !== null ? rawFree / factor : null,
    unit,
  };

  await cachePut(cacheKey, result, CACHE_TTL);
  return result;
}

// Non-blocking: returns null on any error (same contract as old fetchKgv).
export async function fetchKgvEulerpool(ticker: string): Promise<KgvResult | null> {
  const cacheKey = `ep:kgv:v1:${sha256(ticker)}`;
  const cached = await cacheGet<KgvResult>(cacheKey);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(
      `/fundamentals/financials/${encodeURIComponent(ticker)}/ratios`,
    );
    const parsed = RatiosRecord.safeParse(raw);
    if (!parsed.success) return null;

    const result: KgvResult = {
      currentKgv:  parsed.data.pe_ratio ?? parsed.data.peRatio ?? null,
      previousKgv: null,
      stockPrice:  parsed.data.price ?? parsed.data.current_price ?? null,
      currency:    parsed.data.currency ?? null,
      exchange:    null,
      period:      null,
      fetchedAt:   new Date().toISOString(),
    };

    await cachePut(cacheKey, result, CACHE_TTL);
    return result;
  } catch {
    return null;
  }
}
