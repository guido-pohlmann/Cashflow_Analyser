import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { PdfParsingFailedError } from "./errors";
import type { Extracted } from "./extractText";

const MAX_CHARS = 30_000;

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

  let text = sections.join("\n\n");
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

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
