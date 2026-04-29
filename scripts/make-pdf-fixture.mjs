// One-off: erzeugt src/tests/fixtures/cashflow-sample.pdf.
// Wird nicht von Vitest oder vom Build aufgerufen, nur lokal manuell.
// pdf-lib ist nicht in package.json gepinnt; bei Bedarf `npm i --no-save pdf-lib`.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  __dirname,
  "..",
  "src",
  "tests",
  "fixtures",
  "cashflow-sample.pdf",
);

const PAGE_1 = [
  "ACME Corporation Q4 2025 Earnings Press Release",
  "",
  "Cash flow from operating activities for the fourth quarter of fiscal 2025",
  "totaled USD 16,626 million, compared to USD 15,549 million in the prior",
  "quarter. Cash used in investing activities was USD 4,200 million.",
  "Cash used in financing activities was USD 8,150 million.",
  "Free cash flow for the quarter was USD 12,426 million.",
];

const PAGE_2 = [
  "Notes to the cash flow statement.",
  "",
  "Operating cash flow reflects strong demand for the Hopper and Blackwell",
  "platforms. Investing outflows are primarily capital expenditures and",
  "strategic investments. Financing outflows reflect share repurchases and",
  "dividends paid during the quarter.",
];

async function main() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("ACME Q4 2025 Cashflow Sample");
  pdf.setAuthor("Cashflow Analyzer Test Fixture");

  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const lines of [PAGE_1, PAGE_2]) {
    const page = pdf.addPage([595, 842]); // A4
    let y = 800;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 11, font });
      y -= 18;
    }
  }

  const bytes = await pdf.save();
  await writeFile(OUT, bytes);
  console.log(`wrote ${OUT} (${bytes.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
