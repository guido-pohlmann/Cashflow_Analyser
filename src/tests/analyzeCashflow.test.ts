import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@/lib/anthropicClient", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
  DEFAULT_MODEL: "claude-sonnet-4-6",
  RESOLVER_MODEL: "claude-haiku-4-5-20251001",
}));

import { generateInterpretation } from "@/lib/analyzeCashflow";
import { LlmInvalidOutputError, NoCashflowDataError } from "@/lib/errors";
import type { EulerCashflow } from "@/lib/eulerPool";

const CASHFLOW: EulerCashflow = {
  ticker: "AAPL",
  company: "Apple Inc.",
  period: "FY2024",
  currency: "USD",
  operating: 118.25,
  investing: -21.98,
  financing: -110.78,
  freeCashflow: 108.81,
  unit: "billion",
};

const META = { requestedQuery: "Apple", sourceResolved: true };

const VALID_OUTPUT = {
  verdict: "positive",
  interpretation:
    "Der operative Cashflow ist mit 118,25 Mrd. USD deutlich positiv. Der freie Cashflow von 108,81 Mrd. USD bestätigt die starke Liquiditätslage.",
  confidence: "high",
  warnings: [],
};

function toolUseResponse(input: unknown) {
  return {
    content: [{ type: "tool_use", id: "tu_1", name: "report_interpretation", input }],
  };
}

describe("generateInterpretation", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("happy path: assembles CashflowResult from Eulerpool data + Claude output", async () => {
    mockCreate.mockResolvedValueOnce(toolUseResponse(VALID_OUTPUT));
    const result = await generateInterpretation(CASHFLOW, META);

    expect(result.company).toBe("Apple Inc.");
    expect(result.period).toBe("FY2024");
    expect(result.currency).toBe("USD");
    expect(result.figures.operating).toBe(118.25);
    expect(result.figures.unit).toBe("billion");
    expect(result.verdict).toBe("positive");
    expect(result.confidence).toBe("high");
    expect(result.sourceUrl).toBeNull();
    expect(result.requestedQuery).toBe("Apple");
    expect(result.sourceResolved).toBe(true);
    expect(result.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("uses ticker as company fallback when company is null", async () => {
    mockCreate.mockResolvedValueOnce(toolUseResponse(VALID_OUTPUT));
    const result = await generateInterpretation(
      { ...CASHFLOW, company: null },
      META,
    );
    expect(result.company).toBe("AAPL");
  });

  it("throws NoCashflowDataError when all figures are null (no Claude call)", async () => {
    await expect(
      generateInterpretation(
        { ...CASHFLOW, operating: null, investing: null, financing: null, freeCashflow: null },
        META,
      ),
    ).rejects.toBeInstanceOf(NoCashflowDataError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("schema fail then retry succeeds", async () => {
    const tooShort = { ...VALID_OUTPUT, interpretation: "kurz" };
    mockCreate.mockResolvedValueOnce(toolUseResponse(tooShort));
    mockCreate.mockResolvedValueOnce(toolUseResponse(VALID_OUTPUT));

    const result = await generateInterpretation(CASHFLOW, META);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe("high");
  });

  it("two consecutive schema fails throw LlmInvalidOutputError", async () => {
    const tooShort = { ...VALID_OUTPUT, interpretation: "x" };
    mockCreate.mockResolvedValueOnce(toolUseResponse(tooShort));
    mockCreate.mockResolvedValueOnce(toolUseResponse(tooShort));

    await expect(generateInterpretation(CASHFLOW, META)).rejects.toBeInstanceOf(
      LlmInvalidOutputError,
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws LlmFailedError when SDK throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network error"));
    const { LlmFailedError } = await import("@/lib/errors");
    await expect(generateInterpretation(CASHFLOW, META)).rejects.toBeInstanceOf(
      LlmFailedError,
    );
  });
});
