import { formatAnalyzedAt } from "@/lib/format";
import type { AnalyzeResponse, KgvResult } from "@/lib/schema";
import { FigureCell } from "./FigureCell";
import { VerdictBadge } from "./VerdictBadge";

interface ResultCardProps {
  data: AnalyzeResponse;
  onReset: () => void;
}

function formatKgv(v: number): string {
  return v < 100 ? v.toFixed(1) : v.toFixed(0);
}

function KgvSection({ kgv }: { kgv: KgvResult }) {
  const hasData =
    kgv.currentKgv !== null ||
    kgv.stockPrice !== null;
  if (!hasData) return null;

  return (
    <section className="mt-4 rounded-lg border border-accent-deep/20 bg-bg/40 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Bewertung
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-fg-muted">KGV aktuell</span>
          <span className="text-lg font-semibold text-fg">
            {kgv.currentKgv !== null ? formatKgv(kgv.currentKgv) : "—"}
          </span>
          {kgv.period && (
            <span className="text-xs text-fg-muted">{kgv.period}</span>
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-fg-muted">KGV Vorjahr</span>
          <span className="text-lg font-semibold text-fg">
            {kgv.previousKgv !== null ? formatKgv(kgv.previousKgv) : "—"}
          </span>
        </div>
        {kgv.stockPrice !== null && (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-fg-muted">Kurs</span>
            <span className="text-lg font-semibold text-fg">
              {kgv.stockPrice.toFixed(2)}
              {kgv.currency ? ` ${kgv.currency}` : ""}
            </span>
            {kgv.exchange && (
              <span className="text-xs text-fg-muted">{kgv.exchange}</span>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        Stand: {formatAnalyzedAt(kgv.fetchedAt)} · Kein Anlagehinweis.
      </p>
    </section>
  );
}

export function ResultCard({ data, onReset }: ResultCardProps) {
  const unit = data.figures.unit;
  return (
    <article
      data-testid="result-card"
      style={{ animation: "var(--animate-fade-up)" }}
      className="w-full max-w-2xl rounded-2xl border border-accent-deep/30 bg-bg-deep/80 p-6 shadow-[var(--shadow-glow)] backdrop-blur-xl"
    >
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold text-fg sm:text-2xl">
            {data.company ?? "Unbekanntes Unternehmen"}
          </h2>
          <p className="text-sm text-fg-muted">
            {data.period ?? "Periode unklar"}
            {data.currency ? ` · ${data.currency}` : ""}
          </p>
        </div>
        <VerdictBadge verdict={data.verdict} />
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FigureCell
          label="Operativer Cashflow"
          value={data.figures.operating}
          unit={unit}
          currency={data.currency}
        />
        <FigureCell
          label="Investitions-Cashflow"
          value={data.figures.investing}
          unit={unit}
          currency={data.currency}
        />
        <FigureCell
          label="Finanzierungs-Cashflow"
          value={data.figures.financing}
          unit={unit}
          currency={data.currency}
        />
        <FigureCell
          label="Free Cashflow"
          value={data.figures.freeCashflow}
          unit={unit}
          currency={data.currency}
        />
      </div>

      {data.kgv && <KgvSection kgv={data.kgv} />}

      <p className="mt-6 text-base leading-relaxed text-fg">
        {data.interpretation}
      </p>

      {data.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg border border-verdict-neutral/30 bg-verdict-neutral/10 p-3 text-sm text-fg-muted">
          {data.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <footer className="mt-6 flex flex-col gap-3 border-t border-accent-deep/20 pt-4 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={data.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Quell-URL ${data.sourceUrl} (öffnet in neuem Tab)`}
              className="break-all text-accent hover:text-accent-deep"
            >
              {data.sourceUrl}
            </a>
            {data.sourceResolved && (
              <span
                data-testid="source-resolved-badge"
                className="rounded-full border border-accent-deep/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent"
              >
                automatisch ermittelt
              </span>
            )}
          </div>
          <span>
            Analysiert am {formatAnalyzedAt(data.analyzedAt)} · Confidence:{" "}
            {data.confidence}
          </span>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-accent-deep/40 px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-accent hover:text-accent"
        >
          Neue Analyse
        </button>
      </footer>

      <p className="mt-4 text-center text-xs text-fg-muted">
        Automatisch generiert, kann Fehler enthalten.{" "}
        <strong>Keine Anlageberatung.</strong>
      </p>
    </article>
  );
}
