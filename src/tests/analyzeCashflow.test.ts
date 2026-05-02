import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@/lib/anthropicClient", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
  DEFAULT_MODEL: "claude-sonnet-4-6",
  RESOLVER_MODEL: "claude-haiku-4-5-20251001",
}));

import { analyzeCashflow } from "@/lib/analyzeCashflow";
import {
  LlmInvalidOutputError,
  NoCashflowDataError,
} from "@/lib/errors";

const VALID_INPUT = {
  company: "ACME Corp",
  period: "Q4 FY25",
  currency: "USD",
  figures: {
    operating: 15.2,
    investing: -3.4,
    financing: -1.8,
    freeCashflow: 11.8,
    unit: "billion",
  },
  verdict: "positive",
  interpretation:
    "Der operative Cashflow ist mit 15,2 Mrd. USD deutlich positiv und übersteigt die Investitions- und Finanzierungsabflüsse, was zu einem starken freien Cashflow von 11,8 Mrd. USD führt.",
  confidence: "high",
  warnings: [],
};

function toolUseResponse(input: unknown) {
  return {
    content: [
      {
        type: "tool_use",
        id: "tu_1",
        name: "report_cashflow",
        input,
      },
    ],
  };
}

describe("analyzeCashflow", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("happy path: valid tool_use → CashflowResult", async () => {
    mockCreate.mockResolvedValueOnce(toolUseResponse(VALID_INPUT));
    const result = await analyzeCashflow({
      sourceUrl: "https://example.com/q4",
      requestedQuery: "ACME",
      sourceResolved: true,
    });
    expect(result.company).toBe("ACME Corp");
    expect(result.figures.operating).toBe(15.2);
    expect(result.sourceUrl).toBe("https://example.com/q4");
    expect(result.sourceMediaType).toBe("text/html");
    expect(result.requestedQuery).toBe("ACME");
    expect(result.sourceResolved).toBe(true);
    expect(result.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("PDF URL → sourceMediaType application/pdf", async () => {
    mockCreate.mockResolvedValueOnce(toolUseResponse(VALID_INPUT));
    const result = await analyzeCashflow({
      sourceUrl: "https://example.com/report.pdf",
      requestedQuery: "ACME",
      sourceResolved: false,
    });
    expect(result.sourceMediaType).toBe("application/pdf");
  });

  it("schema fail then retry succeeds", async () => {
    const tooShort = { ...VALID_INPUT, interpretation: "kurz" }; // <30 chars
    mockCreate.mockResolvedValueOnce(toolUseResponse(tooShort));
    mockCreate.mockResolvedValueOnce(toolUseResponse(VALID_INPUT));
    const result = await analyzeCashflow({
      sourceUrl: "https://example.com",
      requestedQuery: "https://example.com",
      sourceResolved: false,
    });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.confidence).toBe("high");
  });

  it("two consecutive schema fails throw LlmInvalidOutputError", async () => {
    const tooShort = { ...VALID_INPUT, interpretation: "x" };
    mockCreate.mockResolvedValueOnce(toolUseResponse(tooShort));
    mockCreate.mockResolvedValueOnce(toolUseResponse(tooShort));
    await expect(
      analyzeCashflow({
        sourceUrl: "https://example.com",
        requestedQuery: "https://example.com",
        sourceResolved: false,
      }),
    ).rejects.toThrow(LlmInvalidOutputError);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("all figures null + non-high confidence → NoCashflowDataError", async () => {
    const noData = {
      ...VALID_INPUT,
      figures: {
        operating: null,
        investing: null,
        financing: null,
        freeCashflow: null,
        unit: "absolute",
      },
      verdict: "neutral",
      confidence: "low",
      warnings: ["Seite enthält keine Finanzkennzahlen."],
    };
    mockCreate.mockResolvedValueOnce(toolUseResponse(noData));
    await expect(
      analyzeCashflow({
        sourceUrl: "https://example.com",
        requestedQuery: "https://example.com",
        sourceResolved: false,
      }),
    ).rejects.toThrow(NoCashflowDataError);
  });

  it("all figures null but high confidence is allowed (no throw)", async () => {
    const allNullHigh = {
      ...VALID_INPUT,
      figures: {
        operating: null,
        investing: null,
        financing: null,
        freeCashflow: null,
        unit: "absolute",
      },
      confidence: "high",
    };
    mockCreate.mockResolvedValueOnce(toolUseResponse(allNullHigh));
    const result = await analyzeCashflow({
      sourceUrl: "https://example.com",
      requestedQuery: "https://example.com",
      sourceResolved: false,
    });
    expect(result.confidence).toBe("high");
  });
});
