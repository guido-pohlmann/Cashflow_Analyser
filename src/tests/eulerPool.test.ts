import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetMemoryCache } from "@/lib/cache";
import { EulerPoolError, EulerPoolNotFoundError } from "@/lib/errors";
import {
  fetchCashflow,
  fetchKgvEulerpool,
  resolveCompany,
} from "@/lib/eulerPool";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body, status)));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  _resetMemoryCache();
  process.env.EULERPOOL_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.EULERPOOL_API_KEY;
});

// ---------------------------------------------------------------------------
// resolveCompany
// ---------------------------------------------------------------------------

describe("resolveCompany", () => {
  it("returns ticker and companyName from search results", async () => {
    mockFetch([{ ticker: "AAPL", name: "Apple Inc." }]);
    const result = await resolveCompany("Apple");
    expect(result.ticker).toBe("AAPL");
    expect(result.companyName).toBe("Apple Inc.");
  });

  it("prefers exact ticker match over first result", async () => {
    mockFetch([
      { ticker: "SAPG", name: "SAP Group Holdings" },
      { ticker: "SAP", name: "SAP SE" },
    ]);
    const result = await resolveCompany("SAP");
    expect(result.ticker).toBe("SAP");
    expect(result.companyName).toBe("SAP SE");
  });

  it("falls back to first result when no exact ticker match", async () => {
    mockFetch([
      { ticker: "AAPL", name: "Apple Inc." },
      { ticker: "AAPLX", name: "Apple Fund" },
    ]);
    const result = await resolveCompany("Apple");
    expect(result.ticker).toBe("AAPL");
  });

  it("throws EulerPoolNotFoundError when search returns empty array", async () => {
    mockFetch([]);
    await expect(resolveCompany("NonExistentCorp")).rejects.toBeInstanceOf(
      EulerPoolNotFoundError,
    );
  });

  it("throws EulerPoolNotFoundError on 404", async () => {
    mockFetch({ message: "not found" }, 404);
    await expect(resolveCompany("SomeCorp")).rejects.toBeInstanceOf(
      EulerPoolNotFoundError,
    );
  });

  it("throws EulerPoolError on 5xx", async () => {
    mockFetch({ message: "server error" }, 500);
    await expect(resolveCompany("Apple")).rejects.toBeInstanceOf(EulerPoolError);
  });

  it("uses cache on second call", async () => {
    const mockFn = vi.fn().mockResolvedValue(
      jsonResponse([{ ticker: "TSLA", name: "Tesla Inc." }]),
    );
    vi.stubGlobal("fetch", mockFn);
    await resolveCompany("Tesla");
    await resolveCompany("Tesla");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("throws EulerPoolError when API key is missing", async () => {
    delete process.env.EULERPOOL_API_KEY;
    await expect(resolveCompany("Apple")).rejects.toBeInstanceOf(EulerPoolError);
  });
});

// ---------------------------------------------------------------------------
// fetchCashflow
// ---------------------------------------------------------------------------

const APPLE_RECORD = {
  operatingCashFlow: 118_254_000_000,
  investingCashFlow: -21_977_000_000,
  financingCashFlow: -110_776_000_000,
  freeCashFlow: 108_807_000_000,
  period: "FY2024",
  currency: "USD",
};

describe("fetchCashflow", () => {
  it("normalizes large absolute values to billion unit", async () => {
    mockFetch([APPLE_RECORD]);
    const result = await fetchCashflow("AAPL");
    expect(result.unit).toBe("billion");
    expect(result.operating).toBeCloseTo(118.254, 1);
    expect(result.investing).toBeCloseTo(-21.977, 1);
    expect(result.financing).toBeCloseTo(-110.776, 1);
    expect(result.freeCashflow).toBeCloseTo(108.807, 1);
    expect(result.period).toBe("FY2024");
    expect(result.currency).toBe("USD");
    expect(result.ticker).toBe("AAPL");
  });

  it("handles { data: [...] } response envelope", async () => {
    mockFetch({ data: [APPLE_RECORD] });
    const result = await fetchCashflow("AAPL");
    expect(result.unit).toBe("billion");
    expect(result.operating).toBeCloseTo(118.254, 1);
  });

  it("uses million unit for mid-size figures", async () => {
    mockFetch([
      {
        operatingCashFlow: 450_000_000,
        investingCashFlow: -120_000_000,
        financingCashFlow: -200_000_000,
        freeCashFlow: 330_000_000,
        period: "FY2024",
        currency: "EUR",
      },
    ]);
    const result = await fetchCashflow("SMCO");
    expect(result.unit).toBe("million");
    expect(result.operating).toBeCloseTo(450, 0);
    expect(result.currency).toBe("EUR");
  });

  it("handles null cashflow fields gracefully", async () => {
    mockFetch([{ period: "FY2024", currency: "USD" }]);
    const result = await fetchCashflow("AAPL");
    expect(result.operating).toBeNull();
    expect(result.freeCashflow).toBeNull();
    expect(result.unit).toBe("absolute");
  });

  it("throws EulerPoolNotFoundError on 404", async () => {
    mockFetch({ message: "not found" }, 404);
    await expect(fetchCashflow("UNKNOWN")).rejects.toBeInstanceOf(
      EulerPoolNotFoundError,
    );
  });

  it("throws EulerPoolError when response is not parseable as records", async () => {
    // A raw JSON string fails z.array(CashflowRecord) validation.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('"unexpected string"', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(fetchCashflow("AAPL")).rejects.toBeInstanceOf(EulerPoolError);
  });

  it("uses cache on second call", async () => {
    const mockFn = vi.fn().mockResolvedValue(jsonResponse([APPLE_RECORD]));
    vi.stubGlobal("fetch", mockFn);
    await fetchCashflow("AAPL");
    await fetchCashflow("AAPL");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// fetchKgvEulerpool
// ---------------------------------------------------------------------------

describe("fetchKgvEulerpool", () => {
  it("returns KgvResult on valid ratios response", async () => {
    mockFetch({ peRatio: 28.5, price: 189.84, currency: "USD" });
    const result = await fetchKgvEulerpool("AAPL");
    expect(result).not.toBeNull();
    expect(result!.currentKgv).toBe(28.5);
    expect(result!.stockPrice).toBe(189.84);
    expect(result!.currency).toBe("USD");
    expect(result!.previousKgv).toBeNull();
    expect(result!.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns result with null currentKgv when peRatio is absent", async () => {
    mockFetch({ price: 100, currency: "EUR" });
    const result = await fetchKgvEulerpool("SAP");
    expect(result).not.toBeNull();
    expect(result!.currentKgv).toBeNull();
    expect(result!.stockPrice).toBe(100);
  });

  it("returns null on 5xx error (non-blocking)", async () => {
    mockFetch({ message: "server error" }, 500);
    const result = await fetchKgvEulerpool("AAPL");
    expect(result).toBeNull();
  });

  it("returns null on 404 (non-blocking)", async () => {
    mockFetch({ message: "not found" }, 404);
    const result = await fetchKgvEulerpool("AAPL");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws (non-blocking)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await fetchKgvEulerpool("AAPL");
    expect(result).toBeNull();
  });

  it("uses cache on second call", async () => {
    const mockFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ peRatio: 22.0, price: 50.0, currency: "HKD" }));
    vi.stubGlobal("fetch", mockFn);
    await fetchKgvEulerpool("BYD");
    await fetchKgvEulerpool("BYD");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
