import clsx from "clsx";
import { formatFigure } from "@/lib/format";
import type { CashflowUnit } from "@/lib/schema";

interface FigureCellProps {
  label: string;
  value: number | null;
  unit: CashflowUnit;
  currency: string | null;
}

export function FigureCell({ label, value, unit, currency }: FigureCellProps) {
  const isNegative = typeof value === "number" && value < 0;
  return (
    <div className="rounded-xl border border-accent-deep/20 bg-bg/60 p-4">
      <div className="text-xs uppercase tracking-wide text-fg-muted">
        {label}
      </div>
      <div
        data-negative={isNegative ? "true" : "false"}
        className={clsx(
          "tabular mt-2 font-display text-2xl sm:text-3xl",
          isNegative ? "text-verdict-negative" : "text-fg",
        )}
      >
        {formatFigure(value, unit, currency)}
      </div>
    </div>
  );
}
