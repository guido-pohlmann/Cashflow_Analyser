"use client";

export function UrlAnalyzerCard() {
  return (
    <section
      aria-label="URL-Analyse"
      className="w-full max-w-xl rounded-2xl border border-accent-deep/30 bg-bg-deep/70 p-6 shadow-glow backdrop-blur-xl"
    >
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => e.preventDefault()}
      >
        <label htmlFor="url-input" className="sr-only">
          Unternehmens-URL
        </label>
        <input
          id="url-input"
          type="url"
          name="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://investor.example.com/..."
          required
          className="flex-1 rounded-xl border border-accent-deep/40 bg-bg/60 px-4 py-3 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled
          className="rounded-xl bg-accent px-5 py-3 text-base font-semibold text-bg transition-colors hover:bg-accent-deep focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          Analysieren
        </button>
      </form>
      <p className="mt-3 text-xs text-fg-muted">
        S0-Stub — Logik folgt in S1. Keine Anlageberatung. Keine Speicherung.
      </p>
    </section>
  );
}
