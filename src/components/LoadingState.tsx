interface LoadingStateProps {
  phase?: "url" | "search-and-analyze";
}

const COPY: Record<NonNullable<LoadingStateProps["phase"]>, string> = {
  url: "Analyse läuft …",
  "search-and-analyze": "Suche aktuelle Quelle und analysiere …",
};

export function LoadingState({ phase = "url" }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-label={COPY[phase]}
      className="w-full max-w-2xl rounded-2xl border border-accent-deep/20 bg-bg-deep/60 p-6 backdrop-blur-xl"
    >
      <p className="mb-4 text-sm text-fg-muted">{COPY[phase]}</p>
      <div className="flex animate-pulse flex-col gap-4">
        <div className="h-6 w-1/2 rounded bg-fg-muted/20" />
        <div className="h-4 w-1/3 rounded bg-fg-muted/15" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-20 rounded-xl bg-fg-muted/10" />
          <div className="h-20 rounded-xl bg-fg-muted/10" />
          <div className="h-20 rounded-xl bg-fg-muted/10" />
          <div className="h-20 rounded-xl bg-fg-muted/10" />
        </div>
        <div className="h-4 rounded bg-fg-muted/15" />
        <div className="h-4 w-2/3 rounded bg-fg-muted/15" />
      </div>
    </div>
  );
}
