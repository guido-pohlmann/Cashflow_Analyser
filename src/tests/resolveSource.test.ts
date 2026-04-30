import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@/lib/anthropicClient", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
  DEFAULT_MODEL: "claude-sonnet-4-6",
}));

import { resolveSource } from "@/lib/resolveSource";
import { NoSourceFoundError } from "@/lib/errors";
import { _resetMemoryCache } from "@/lib/cache";

function reportSourceResponse(input: {
  url: string;
  companyHint: string | null;
  reason: string;
}) {
  return {
    content: [
      {
        type: "tool_use",
        id: "tu_1",
        name: "report_source",
        input,
      },
    ],
  };
}

describe("resolveSource", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetMemoryCache();
  });

  it("happy path: extracts URL from report_source tool_use", async () => {
    mockCreate.mockResolvedValueOnce(
      reportSourceResponse({
        url: "https://www.hkexnews.hk/listedco/listconews/sehk/x.pdf",
        companyHint: "BYD Company Limited",
        reason: "Aktuellste HKEXnews-Pflichtveröffentlichung.",
      }),
    );

    const out = await resolveSource("BYD");
    expect(out.url).toMatch(/^https:\/\/www\.hkexnews\.hk\//);
    expect(out.companyHint).toBe("BYD Company Limited");
    expect(out.reason).toMatch(/HKEXnews/);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("cache: second call with normalized-equal query skips SDK", async () => {
    mockCreate.mockResolvedValueOnce(
      reportSourceResponse({
        url: "https://example.com/byd-q1.pdf",
        companyHint: "BYD",
        reason: "x",
      }),
    );
    await resolveSource("BYD");
    await resolveSource("byd"); // gleiche normalisierte Form
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects when tool_use missing → NoSourceFoundError", async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: "no" }] });
    await expect(resolveSource("asdfzzz")).rejects.toThrow(NoSourceFoundError);
  });

  it("rejects when URL not http(s) → NoSourceFoundError", async () => {
    mockCreate.mockResolvedValueOnce(
      reportSourceResponse({
        url: "ftp://x.example.com/y",
        companyHint: null,
        reason: "no good source",
      }),
    );
    await expect(resolveSource("xyz")).rejects.toThrow(NoSourceFoundError);
  });

  it("wraps SDK errors as NoSourceFoundError", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network down"));
    await expect(resolveSource("anything")).rejects.toThrow(
      NoSourceFoundError,
    );
  });
});
