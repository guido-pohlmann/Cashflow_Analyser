import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface Extracted {
  title: string | null;
  text: string;
  charCount: number;
}

const MAX_CHARS = 30_000;

function serializeTables(doc: Document): string[] {
  const out: string[] = [];
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const rows: string[] = [];
    for (const tr of Array.from(table.querySelectorAll("tr"))) {
      const cells: string[] = [];
      for (const cell of Array.from(tr.querySelectorAll("th, td"))) {
        cells.push((cell.textContent ?? "").trim().replace(/\s+/g, " "));
      }
      if (cells.length > 0) rows.push(cells.join(" | "));
    }
    if (rows.length > 0) out.push(rows.join("\n"));
  }
  return out;
}

export function extractText(html: string, baseUrl: string): Extracted {
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  // Tabellen vor Readability extrahieren — Readability kann sie verwerfen.
  const tables = serializeTables(doc);

  const docTitle = doc.title?.trim() || null;

  // Readability mutiert das Dokument; danach nicht mehr verwenden.
  const reader = new Readability(doc);
  const article = reader.parse();

  const articleTitle = article?.title?.trim() || null;
  const articleText = (article?.textContent ?? "").trim().replace(/\s+/g, " ");

  const tableSection =
    tables.length > 0 ? "\n\n--- Tabellen ---\n" + tables.join("\n\n") : "";

  let text = articleText + tableSection;
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

  return {
    title: articleTitle ?? docTitle,
    text,
    charCount: text.length,
  };
}
