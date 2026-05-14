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
  it("returns ticker and companyName from wrapped { count, results } response", async () => {
    mockFetch({ count: 1, results: [{ ticker: "AAPL", name: "Apple Inc." }] });
    const result = await resolveCompany("Apple");
    expect(result.ticker).toBe("AAPL");
    expect(result.companyName).toBe("Apple Inc.");
  });

  it("also accepts plain array response", async () => {
    mockFetch([{ ticker: "AAPL", name: "Apple Inc." }]);
    const result = await resolveCompany("Apple");
    expect(result.ticker).toBe("AAPL");
  });

  it("prefers exact ticker match over first result", async () => {
    mockFetch({
      count: 2,
      results: [
        { ticker: "SAPG", name: "SAP Group Holdings" },
        { ticker: "SAP", name: "SAP SE" },
      ],
    });
    const result = await resolveCompany("SAP");
    expect(result.ticker).toBe("SAP");
    expect(result.companyName).toBe("SAP SE");
  });

  it("falls back to first result when no exact ticker match", async () => {
    mockFetch({
      count: 2,
      results: [
        { ticker: "AAPL", name: "Apple Inc." },
        { ticker: "AAPLX", name: "Apple Fund" },
      ],
    });
    const result = await resolveCompany("Apple");
    expect(result.ticker).toBe("AAPL");
  });

  it("throws EulerPoolNotFoundError when search returns empty results", async () => {
    mockFetch({ count: 0, results: [] });
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
      jsonResponse({ count: 1, results: [{ ticker: "TSLA", name: "Tesla Inc." }] }),
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

// Matches the real Eulerpool XBRL-tagged line-item format.
// freeCashflow = operating − capex = 118 254 − 9 447 = 108 807 (Mrd. USD)
const APPLE_ITEMS = [
  { tag: "NetCashProvidedByUsedInOperatingActivities", val: "118254000000.0000", fiscal_year: 2024, fiscal_period: "FY", unit: "USD" },
  { tag: "NetCashProvidedByUsedInInvestingActivities", val: "-21977000000.0000", fiscal_year: 2024, fiscal_period: "FY", unit: "USD" },
  { tag: "NetCashProvidedByUsedInFinancingActivities", val: "-110776000000.0000", fiscal_year: 2024, fiscal_period: "FY", unit: "USD" },
  { tag: "PaymentsToAcquirePropertyPlantAndEquipment", val: "9447000000.0000",  fiscal_year: 2024, fiscal_period: "FY", unit: "USD" },
];

describe("fetchCashflow", () => {
  it("normalizes large absolute values to billion unit", async () => {
    mockFetch(APPLE_ITEMS);
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

  it("picks most recent fiscal year when multiple years are present", async () => {
    mockFetch([
      ...APPLE_ITEMS,
      { tag: "NetCashProvidedByUsedInOperatingActivities", val: "100000000000", fiscal_year: 2023, fiscal_period: "FY", unit: "USD" },
    ]);
    const result = await fetchCashflow("AAPL");
    expect(result.period).toBe("FY2024");
    expect(result.operating).toBeCloseTo(118.254, 1);
  });

  it("uses million unit for mid-size figures", async () => {
    mockFetch([
      { tag: "NetCashProvidedByUsedInOperatingActivities", val: "450000000", fiscal_year: 2024, fiscal_period: "FY", unit: "EUR" },
      { tag: "NetCashProvidedByUsedInInvestingActivities", val: "-120000000", fiscal_year: 2024, fiscal_period: "FY", unit: "EUR" },
      { tag: "NetCashProvidedByUsedInFinancingActivities", val: "-200000000", fiscal_year: 2024, fiscal_period: "FY", unit: "EUR" },
      { tag: "PaymentsToAcquirePropertyPlantAndEquipment", val: "80000000",  fiscal_year: 2024, fiscal_period: "FY", unit: "EUR" },
    ]);
    const result = await fetchCashflow("SMCO");
    expect(result.unit).toBe("million");
    expect(result.operating).toBeCloseTo(450, 0);
    expect(result.currency).toBe("EUR");
  });

  it("handles missing cashflow tags gracefully", async () => {
    mockFetch([{ tag: "SomeOtherTag", val: "0", fiscal_year: 2024, fiscal_period: "FY", unit: "USD" }]);
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

  it("throws EulerPoolError when response is not a parseable array", async () => {
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
    const mockFn = vi.fn().mockResolvedValue(jsonResponse(APPLE_ITEMS));
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
    mockFetch({ pe_ratio: 28.5, price: 189.84, currency: "USD" });
    const result = await fetchKgvEulerpool("AAPL");
    expect(result).not.toBeNull();
    expect(result!.currentKgv).toBe(28.5);
    expect(result!.stockPrice).toBe(189.84);
    expect(result!.currency).toBe("USD");
    expect(result!.previousKgv).toBeNull();
    expect(result!.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("also accepts camelCase peRatio fallback", async () => {
    mockFetch({ peRatio: 22.0, price: 50.0, currency: "HKD" });
    const result = await fetchKgvEulerpool("BYD");
    expect(result).not.toBeNull();
    expect(result!.currentKgv).toBe(22.0);
  });

  it("returns result with null currentKgv when pe_ratio is absent", async () => {
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
      .mockResolvedValue(jsonResponse({ pe_ratio: 22.0, price: 50.0, currency: "HKD" }));
    vi.stubGlobal("fetch", mockFn);
    await fetchKgvEulerpool("BYD");
    await fetchKgvEulerpool("BYD");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
