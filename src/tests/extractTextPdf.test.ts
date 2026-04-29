// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { extractTextFromPdf } from "@/lib/extractTextPdf";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  resolve(__dirname, "fixtures/cashflow-sample.pdf"),
);
const FIXTURE_BYTES = new Uint8Array(
  FIXTURE.buffer,
  FIXTURE.byteOffset,
  FIXTURE.byteLength,
);

function freshBytes(): Uint8Array {
  // unpdf transferiert den Buffer; pro Test eine Kopie reichen.
  return new Uint8Array(FIXTURE_BYTES);
}

describe("extractTextFromPdf", () => {
  it("extracts cashflow figures from PDF text", async () => {
    const out = await extractTextFromPdf(freshBytes());
    expect(out.text).toMatch(/Cash flow from operating activities/i);
    expect(out.text).toMatch(/16,626/);
    expect(out.text).toMatch(/15,549/);
    expect(out.charCount).toBeGreaterThan(200);
  });

  it("inserts page markers between pages", async () => {
    const out = await extractTextFromPdf(freshBytes());
    expect(out.text).toMatch(/--- Seite 1 ---/);
    expect(out.text).toMatch(/--- Seite 2 ---/);
  });

  it("extracts title from PDF metadata", async () => {
    const out = await extractTextFromPdf(freshBytes());
    expect(out.title).toBe("ACME Q4 2025 Cashflow Sample");
  });

  it("rejects malformed PDF bytes with PdfParsingFailedError", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(extractTextFromPdf(garbage)).rejects.toMatchObject({
      code: "PDF_PARSING_FAILED",
    });
  });
});
