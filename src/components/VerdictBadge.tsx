import clsx from "clsx";
import type { Verdict } from "@/lib/schema";

const COPY: Record<Verdict, string> = {
  positive: "Positiv",
  neutral: "Neutral",
  negative: "Negativ",
};

const STYLES: Record<Verdict, string> = {
  positive:
    "bg-verdict-positive/15 text-verdict-positive border-verdict-positive/40",
  neutral:
    "bg-verdict-neutral/15 text-verdict-neutral border-verdict-neutral/40",
  negative:
    "bg-verdict-negative/15 text-verdict-negative border-verdict-negative/40",
};

interface VerdictBadgeProps {
  verdict: Verdict;
}

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
  return (
    <span
      data-verdict={verdict}
      className={clsx(
        "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium",
        STYLES[verdict],
      )}
    >
      {COPY[verdict]}
    </span>
  );
}
