import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetMemoryCache } from "@/lib/cache";

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@/lib/anthropicClient", () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
  RESOLVER_MODEL: "claude-haiku-4-5-20251001",
}));

import { fetchKgv } from "@/lib/fetchKgv";

function kgvResponse(input: object) {
  return {
    content: [
      { type: "tool_use", id: "tu_1", name: "report_kgv", input },
    ],
  };
}

describe("fetchKgv", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _resetMemoryCache();
  });

  it("returns KgvResult on valid tool_use", async () => {
    mockCreate.mockResolvedValueOnce(
      kgvResponse({
        currentKgv: 22.5,
        previousKgv: 18.3,
        stockPrice: 43.12,
        currency: "HKD",
        exchange: "HKEX",
        period: "TTM",
      }),
    );
    const result = await fetchKgv("Xiaomi");
    expect(result).not.toBeNull();
    expect(result!.currentKgv).toBe(22.5);
    expect(result!.currency).toBe("HKD");
    expect(result!.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns null when all values are null (no data found)", async () => {
    mockCreate.mockResolvedValueOnce(
      kgvResponse({
        currentKgv: null,
        previousKgv: null,
        stockPrice: null,
        currency: null,
        exchange: null,
        period: null,
      }),
    );
    const result = await fetchKgv("UnknownCorp");
    expect(result).not.toBeNull();
    expect(result!.currentKgv).toBeNull();
  });

  it("returns null when SDK throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network error"));
    const result = await fetchKgv("anything");
    expect(result).toBeNull();
  });

  it("returns null when no tool_use block in response", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "no tool call" }],
    });
    const result = await fetchKgv("anything");
    expect(result).toBeNull();
  });
});
