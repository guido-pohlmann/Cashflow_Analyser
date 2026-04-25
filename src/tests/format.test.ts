import { describe, it, expect } from "vitest";
import { formatFigure, formatAnalyzedAt } from "@/lib/format";

describe("formatFigure", () => {
  it("returns em-dash for null", () => {
    expect(formatFigure(null, "billion", "USD")).toBe("—");
  });

  it("formats positive million in de-DE with suffix", () => {
    const out = formatFigure(1234.5, "million", "EUR");
    expect(out).toContain("1.234,5");
    expect(out).toContain("Mio.");
    expect(out).toContain("EUR");
  });

  it("preserves negative sign", () => {
    const out = formatFigure(-3.4, "billion", "USD");
    expect(out).toMatch(/-3,4/);
    expect(out).toContain("Mrd.");
  });

  it("omits scale suffix for absolute unit", () => {
    const out = formatFigure(100, "absolute", null);
    expect(out).not.toMatch(/Tsd|Mio|Mrd/);
  });

  it("handles missing currency gracefully", () => {
    const out = formatFigure(50, "thousand", null);
    expect(out).toContain("50,0");
    expect(out).toContain("Tsd.");
  });
});

describe("formatAnalyzedAt", () => {
  it("formats ISO datetime in de-DE locale", () => {
    const out = formatAnalyzedAt("2026-04-25T12:30:00.000Z");
    expect(out).toMatch(/2026/);
  });

  it("falls back to raw string on invalid input", () => {
    expect(formatAnalyzedAt("not-a-date")).toBe("not-a-date");
  });
});
