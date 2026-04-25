import { describe, it, expect } from "vitest";
import { CashflowUnit, Verdict, ApiErrorCode } from "@/lib/schema";

describe("schema sanity", () => {
  it("CashflowUnit enum parses canonical values", () => {
    expect(CashflowUnit.parse("million")).toBe("million");
    expect(() => CashflowUnit.parse("trillion")).toThrow();
  });

  it("Verdict enum has the three traffic-light values", () => {
    expect(Verdict.options).toEqual(["positive", "neutral", "negative"]);
  });

  it("ApiErrorCode covers all spec §5 codes", () => {
    expect(ApiErrorCode.options).toContain("BLOCKED_TARGET");
    expect(ApiErrorCode.options).toContain("RATE_LIMITED");
    expect(ApiErrorCode.options.length).toBe(10);
  });
});
