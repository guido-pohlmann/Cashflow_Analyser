import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { extractText } from "@/lib/extractText";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  resolve(__dirname, "fixtures/nvidia-q4-press.html"),
  "utf-8",
);

describe("extractText", () => {
  it("extracts main article text from press release", () => {
    const out = extractText(FIXTURE, "https://example.com/q4");
    expect(out.text).toMatch(/Cash flow from operating activities/i);
    expect(out.charCount).toBeGreaterThan(200);
  });

  it("appends tables under a marker", () => {
    const out = extractText(FIXTURE, "https://example.com/q4");
    expect(out.text).toMatch(/Tabellen/);
    expect(out.text).toMatch(/16,626/);
    expect(out.text).toMatch(/15,549/);
  });

  it("captures the title", () => {
    const out = extractText(FIXTURE, "https://example.com/q4");
    expect(out.title).toMatch(/nvidia/i);
  });

  it("caps text at 30k chars", () => {
    const big = "<p>" + "lorem ipsum ".repeat(5000) + "</p>";
    const out = extractText(`<html><body>${big}</body></html>`, "https://x.test");
    expect(out.charCount).toBeLessThanOrEqual(30_000);
  });
});
