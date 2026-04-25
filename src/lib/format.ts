import type { CashflowUnit } from "./schema";

const SCALE_SUFFIX: Record<CashflowUnit, string> = {
  thousand: "Tsd.",
  million: "Mio.",
  billion: "Mrd.",
  absolute: "",
};

export function formatFigure(
  value: number | null,
  unit: CashflowUnit,
  currency: string | null,
): string {
  if (value === null || Number.isNaN(value)) return "—";

  const formatter = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
    signDisplay: "auto",
  });

  return [formatter.format(value), SCALE_SUFFIX[unit], currency ?? ""]
    .filter(Boolean)
    .join(" ");
}

export function formatAnalyzedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
