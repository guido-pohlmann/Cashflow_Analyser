import { describe, it, expect } from "vitest";
import { getClientIp } from "@/lib/getClientIp";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://x.example/", { headers });
}

describe("getClientIp", () => {
  it("returns first IP from x-forwarded-for", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4" }))).toBe(
      "1.2.3.4",
    );
  });

  it("strips proxy chain — picks the leftmost entry", () => {
    expect(
      getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12" })),
    ).toBe("1.2.3.4");
  });

  it("trims whitespace around the IP", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "  1.2.3.4  ,5.6.7.8" }))).toBe(
      "1.2.3.4",
    );
  });

  it("falls back to x-real-ip when x-forwarded-for missing", () => {
    expect(getClientIp(reqWith({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
  });

  it('returns "unknown" when no header present', () => {
    expect(getClientIp(reqWith({}))).toBe("unknown");
  });

  it('returns "unknown" when x-forwarded-for is empty/whitespace only', () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "   " }))).toBe("unknown");
  });
});
