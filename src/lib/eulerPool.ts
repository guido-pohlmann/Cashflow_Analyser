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

// --- API response shapes (snake_case as returned by Eulerpool /api/1) ---

const SearchHit = z
  .object({
    ticker: z.string(),
    name: z.string(),
    isin: z.string().nullish(),
  })
  .passthrough();

// Supports both snake_case (actual API) and camelCase (tests / fallback).
const CashflowRecord = z
  .object({
    operating_cash_flow: z.number().nullish(),
    investing_cash_flow: z.number().nullish(),
    financing_cash_flow: z.number().nullish(),
    free_cash_flow: z.number().nullish(),
    // camelCase fallback
    operatingCashFlow: z.number().nullish(),
    investingCashFlow: z.number().nullish(),
    financingCashFlow: z.number().nullish(),
    freeCashFlow: z.number().nullish(),
    // period variants
    period: z.string().nullish(),
    fiscal_period: z.string().nullish(),
    fiscal_year: z.number().nullish(),
    currency: z.string().nullish(),
  })
  .passthrough();

const RatiosRecord = z
  .object({
    pe_ratio: z.number().nullish(),
    peRatio: z.number().nullish(), // camelCase fallback
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
  const parsed = z.array(SearchHit).safeParse(raw);
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
  const cacheKey = `ep:cf:v1:${sha256(ticker)}`;
  const cached = await cacheGet<EulerCashflow>(cacheKey);
  if (cached) return cached;

  const raw = await eulerFetch(
    `/fundamentals/financials/${encodeURIComponent(ticker)}/cash-flow?fiscal_period=FY`,
  );

  // Tolerate array, { data: [...] } envelope, or single object.
  const records = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>).data)
      ? (raw as Record<string, unknown>).data
      : [raw];

  const parsed = z.array(CashflowRecord).safeParse(records);
  if (!parsed.success || parsed.data.length === 0) {
    throw new EulerPoolError(
      `Unerwartete Cashflow-Antwortstruktur für Ticker ${ticker}`,
    );
  }

  const rec = parsed.data[0];
  // snake_case (actual API) takes precedence over camelCase fallback.
  const rawOp  = rec.operating_cash_flow  ?? rec.operatingCashFlow  ?? null;
  const rawInv  = rec.investing_cash_flow  ?? rec.investingCashFlow  ?? null;
  const rawFin  = rec.financing_cash_flow  ?? rec.financingCashFlow  ?? null;
  const rawFree = rec.free_cash_flow       ?? rec.freeCashFlow       ?? null;
  const period  =
    rec.period ??
    rec.fiscal_period ??
    (rec.fiscal_year != null ? `FY${rec.fiscal_year}` : null) ??
    null;

  const { unit, factor } = normalizeUnit([rawOp, rawInv, rawFin, rawFree]);

  const result: EulerCashflow = {
    ticker,
    company: null,
    period,
    currency: rec.currency ?? null,
    operating:    rawOp  !== null ? rawOp  / factor : null,
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
