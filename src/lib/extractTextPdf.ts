import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { PdfParsingFailedError } from "./errors";
import type { Extracted } from "./extractText";

const MAX_CHARS = 30_000;
const SMART_CHARS = 15_000;

const CASHFLOW_KW = [
  "cash flow", "cashflow", "operating activities", "investing activities",
  "financing activities", "free cash", "net cash",
  "kapitalflussrechnung", "operativer cashflow",
];

function hasCashflowContent(text: string): boolean {
  const lower = text.toLowerCase();
  return CASHFLOW_KW.some((kw) => lower.includes(kw));
}

export async function extractTextFromPdf(
  bytes: Uint8Array,
): Promise<Extracted> {
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (e) {
    throw new PdfParsingFailedError(
      e instanceof Error ? e.message : "PDF konnte nicht geöffnet werden.",
    );
  }

  let pages: string[];
  try {
    const result = await extractText(pdf, { mergePages: false });
    pages = result.text;
  } catch (e) {
    throw new PdfParsingFailedError(
      e instanceof Error ? e.message : "PDF-Textextraktion fehlgeschlagen.",
    );
  }

  let title: string | null = null;
  try {
    const meta = await getMeta(pdf);
    const rawTitle = (meta.info?.["Title"] as string | undefined)?.trim();
    if (rawTitle) title = rawTitle;
  } catch {
    // Metadaten sind optional — Title bleibt null.
  }

  const sections: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const pageText = (pages[i] ?? "").replace(/\s+/g, " ").trim();
    if (!pageText) continue;
    sections.push(`--- Seite ${i + 1} ---\n${pageText}`);
  }

  // Smart page selection: first page + all cashflow pages; fallback to all
  const cfPageIndices = sections.reduce<number[]>((acc, s, i) => {
    if (hasCashflowContent(s)) acc.push(i);
    return acc;
  }, []);

  let text: string;
  let cap: number;
  if (cfPageIndices.length > 0) {
    const selected = [...new Set([0, ...cfPageIndices])].sort(
      (a, b) => a - b,
    );
    text = selected.map((i) => sections[i]).join("\n\n");
    cap = SMART_CHARS;
  } else {
    text = sections.join("\n\n");
    cap = MAX_CHARS;
  }
  if (text.length > cap) text = text.slice(0, cap);

  if (!title) {
    const firstNonEmpty = pages.find((p) => p.trim().length > 0) ?? "";
    const firstLine =
      firstNonEmpty
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? "";
    title = firstLine.length > 0 && firstLine.length <= 200 ? firstLine : null;
  }

  return {
    title,
    text,
    charCount: text.length,
  };
}
