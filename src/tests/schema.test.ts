import { describe, it, expect } from "vitest";
import {
  AnalyzeRequest,
  ApiError,
  ApiErrorCode,
  CashflowFigures,
  CashflowResult,
  Confidence,
  Verdict,
} from "@/lib/schema";

const validResult = {
  company: "Acme Corp",
  period: "Q4 FY25",
  currency: "USD",
  figures: {
    operating: 12.3,
    investing: -4.5,
    financing: -2.1,
    freeCashflow: 7.8,
    unit: "billion",
  },
  verdict: "positive",
  interpretation:
    "Der operative Cashflow zeigt eine deutlich positive Entwicklung. Investitionen wurden überwiegend aus eigener Kraft finanziert.",
  confidence: "high",
  sourceUrl: "https://investor.example.com/q4",
  requestedQuery: "ACME",
  sourceResolved: true,
  analyzedAt: "2026-04-25T12:00:00.000Z",
  warnings: [],
} as const;

describe("CashflowResult", () => {
  it("accepts a fully populated valid result", () => {
    const out = CashflowResult.safeParse(validResult);
    expect(out.success).toBe(true);
  });

  it("accepts null for company / period / currency / figures", () => {
    const out = CashflowResult.safeParse({
      ...validResult,
      company: null,
      period: null,
      currency: null,
      figures: { ...validResult.figures, operating: null, freeCashflow: null },
    });
    expect(out.success).toBe(true);
  });

  it("rejects lowercase currency", () => {
    const out = CashflowResult.safeParse({ ...validResult, currency: "usd" });
    expect(out.success).toBe(false);
  });

  it("rejects 4-letter currency", () => {
    const out = CashflowResult.safeParse({ ...validResult, currency: "USDX" });
    expect(out.success).toBe(false);
  });

  it("rejects interpretation shorter than 30 chars", () => {
    const out = CashflowResult.safeParse({ ...validResult, interpretation: "kurz." });
    expect(out.success).toBe(false);
  });

  it("rejects interpretation longer than 1200 chars", () => {
    const out = CashflowResult.safeParse({
      ...validResult,
      interpretation: "x".repeat(1201),
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown verdict value", () => {
    const out = CashflowResult.safeParse({ ...validResult, verdict: "bullish" });
    expect(out.success).toBe(false);
  });

  it("rejects unknown unit value", () => {
    const out = CashflowResult.safeParse({
      ...validResult,
      figures: { ...validResult.figures, unit: "trillion" },
    });
    expect(out.success).toBe(false);
  });

  it("rejects non-URL sourceUrl", () => {
    const out = CashflowResult.safeParse({ ...validResult, sourceUrl: "not-a-url" });
    expect(out.success).toBe(false);
  });

  it("rejects non-ISO analyzedAt", () => {
    const out = CashflowResult.safeParse({ ...validResult, analyzedAt: "yesterday" });
    expect(out.success).toBe(false);
  });

  it("rejects more than 10 warnings", () => {
    const out = CashflowResult.safeParse({
      ...validResult,
      warnings: Array.from({ length: 11 }, (_, i) => `w${i}`),
    });
    expect(out.success).toBe(false);
  });
});

describe("CashflowFigures", () => {
  it("requires unit", () => {
    const out = CashflowFigures.safeParse({
      operating: 1,
      investing: 1,
      financing: 1,
      freeCashflow: null,
    });
    expect(out.success).toBe(false);
  });

  it("accepts all numbers null with unit set", () => {
    const out = CashflowFigures.safeParse({
      operating: null,
      investing: null,
      financing: null,
      freeCashflow: null,
      unit: "absolute",
    });
    expect(out.success).toBe(true);
  });
});

describe("Verdict / Confidence enums", () => {
  it.each(["positive", "neutral", "negative"] as const)(
    "Verdict accepts %s",
    (v) => {
      expect(Verdict.safeParse(v).success).toBe(true);
    },
  );

  it.each(["high", "medium", "low"] as const)("Confidence accepts %s", (c) => {
    expect(Confidence.safeParse(c).success).toBe(true);
  });
});

describe("AnalyzeRequest", () => {
  it("accepts a company name", () => {
    expect(AnalyzeRequest.safeParse({ query: "BYD" }).success).toBe(true);
  });

  it("accepts a ticker symbol", () => {
    expect(AnalyzeRequest.safeParse({ query: "1211.HK" }).success).toBe(true);
  });

  it("accepts a full https URL", () => {
    expect(
      AnalyzeRequest.safeParse({ query: "https://example.com/page" }).success,
    ).toBe(true);
  });

  it("rejects strings shorter than 2 chars after trim", () => {
    expect(AnalyzeRequest.safeParse({ query: " " }).success).toBe(false);
    expect(AnalyzeRequest.safeParse({ query: "x" }).success).toBe(false);
  });

  it("rejects strings longer than 200 chars", () => {
    expect(
      AnalyzeRequest.safeParse({ query: "a".repeat(201) }).success,
    ).toBe(false);
  });

  it("rejects missing query field", () => {
    expect(AnalyzeRequest.safeParse({}).success).toBe(false);
  });
});

describe("ApiErrorCode", () => {
  it.each([
    "INVALID_URL",
    "FETCH_FAILED",
    "FETCH_TIMEOUT",
    "BLOCKED_TARGET",
    "CONTENT_TOO_SHORT",
    "NO_CASHFLOW_DATA",
    "LLM_FAILED",
    "LLM_INVALID_OUTPUT",
    "RATE_LIMITED",
    "PDF_PARSING_FAILED",
    "NO_SOURCE_FOUND",
    "INTERNAL",
  ] as const)("accepts %s", (code) => {
    expect(ApiErrorCode.safeParse(code).success).toBe(true);
  });

  it("rejects unknown code", () => {
    expect(ApiErrorCode.safeParse("UNKNOWN").success).toBe(false);
  });
});

describe("ApiError", () => {
  it("accepts a minimal envelope without context fields", () => {
    expect(
      ApiError.safeParse({ error: { code: "FETCH_FAILED", message: "x" } })
        .success,
    ).toBe(true);
  });

  it("accepts a full envelope with attemptedUrl + requestedQuery + sourceResolved", () => {
    const out = ApiError.safeParse({
      error: {
        code: "FETCH_FAILED",
        message: "x",
        attemptedUrl: "https://example.com/q4.pdf",
        requestedQuery: "BYD",
        sourceResolved: true,
      },
    });
    expect(out.success).toBe(true);
  });

  it("rejects malformed attemptedUrl", () => {
    expect(
      ApiError.safeParse({
        error: {
          code: "FETCH_FAILED",
          message: "x",
          attemptedUrl: "not-a-url",
        },
      }).success,
    ).toBe(false);
  });
});

describe("sourceUrl", () => {
  it("accepts null sourceUrl", () => {
    const out = CashflowResult.safeParse({ ...validResult, sourceUrl: null });
    expect(out.success).toBe(true);
  });

  it("rejects non-URL strings", () => {
    const out = CashflowResult.safeParse({ ...validResult, sourceUrl: "not-a-url" });
    expect(out.success).toBe(false);
  });
});
