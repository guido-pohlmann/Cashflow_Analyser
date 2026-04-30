"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiErrorCode, CashflowResult } from "@/lib/schema";
import { ErrorMessage } from "./ErrorMessage";
import { LoadingState } from "./LoadingState";
import { ResultCard } from "./ResultCard";

type LoadingPhase = "url" | "search-and-analyze";

interface ErrorContext {
  attemptedUrl?: string | null;
  requestedQuery?: string | null;
  sourceResolved?: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading"; phase: LoadingPhase }
  | { kind: "success"; data: CashflowResult }
  | ({ kind: "error"; code: ApiErrorCode } & ErrorContext);

const CLIENT_TIMEOUT_MS = 60_000;

interface ApiErrorBody {
  error?: {
    code?: ApiErrorCode;
    message?: string;
    attemptedUrl?: string | null;
    requestedQuery?: string | null;
    sourceResolved?: boolean;
  };
}

const URL_RE = /^https?:\/\//i;

export function UrlAnalyzerCard() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [query, setQuery] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSubmittedQuery = useRef<string | null>(null);

  useEffect(() => {
    if (status.kind !== "success" && status.kind !== "error") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [status.kind]);

  function reset() {
    setStatus({ kind: "idle" });
    setQuery("");
    setInlineError(null);
    lastSubmittedQuery.current = null;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function analyze(submittedQuery: string) {
    const phase: LoadingPhase = URL_RE.test(submittedQuery)
      ? "url"
      : "search-and-analyze";
    setStatus({ kind: "loading", phase });
    lastSubmittedQuery.current = submittedQuery;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: submittedQuery }),
        signal: ac.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const data = (await response.json()) as CashflowResult;
        setStatus({ kind: "success", data });
        return;
      }

      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      const code: ApiErrorCode = body?.error?.code ?? "INTERNAL";
      setStatus({
        kind: "error",
        code,
        attemptedUrl: body?.error?.attemptedUrl ?? null,
        requestedQuery: body?.error?.requestedQuery ?? submittedQuery,
        sourceResolved: body?.error?.sourceResolved ?? undefined,
      });
    } catch (e: unknown) {
      clearTimeout(timer);
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus({
          kind: "error",
          code: "FETCH_TIMEOUT",
          requestedQuery: submittedQuery,
        });
        return;
      }
      setStatus({
        kind: "error",
        code: "INTERNAL",
        requestedQuery: submittedQuery,
      });
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInlineError(null);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setInlineError("Bitte gib einen Firmennamen, Ticker oder eine URL ein.");
      return;
    }
    void analyze(trimmed);
  }

  function handleRetry() {
    if (lastSubmittedQuery.current) void analyze(lastSubmittedQuery.current);
  }

  if (status.kind === "loading") {
    return (
      <div aria-busy="true" aria-live="polite">
        <LoadingState phase={status.phase} />
      </div>
    );
  }
  if (status.kind === "success") {
    return (
      <div aria-live="polite">
        <ResultCard data={status.data} onReset={reset} />
      </div>
    );
  }
  if (status.kind === "error") {
    return (
      <div aria-live="polite">
        <ErrorMessage
          code={status.code}
          attemptedUrl={status.attemptedUrl}
          requestedQuery={status.requestedQuery}
          sourceResolved={status.sourceResolved}
          onRetry={handleRetry}
          onReset={reset}
        />
      </div>
    );
  }

  return (
    <section
      aria-label="Cashflow-Analyse"
      className="w-full max-w-xl rounded-2xl border border-accent-deep/30 bg-bg-deep/70 p-6 shadow-[var(--shadow-glow)] backdrop-blur-xl"
    >
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={handleSubmit}
        noValidate
      >
        <label htmlFor="query-input" className="sr-only">
          Firmenname, Ticker oder URL
        </label>
        <input
          ref={inputRef}
          id="query-input"
          type="text"
          name="query"
          autoComplete="off"
          placeholder="BYD, Nvidia, AAPL, 1211.HK …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-invalid={inlineError !== null}
          aria-describedby={
            inlineError ? "query-error" : "query-helper"
          }
          className="flex-1 rounded-xl border border-accent-deep/40 bg-bg/60 px-4 py-3 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-xl bg-accent px-5 py-3 text-base font-semibold text-bg transition-colors hover:bg-accent-deep focus:outline-none"
        >
          Analysieren
        </button>
      </form>
      {inlineError ? (
        <p
          id="query-error"
          role="alert"
          className="mt-3 text-sm text-verdict-negative"
        >
          {inlineError}
        </p>
      ) : (
        <p id="query-helper" className="mt-3 text-xs text-fg-muted">
          Firmenname, Tickersymbol oder direkte URL.
        </p>
      )}
      <p className="mt-3 text-xs text-fg-muted">
        Keine Speicherung. Keine Anlageberatung.
      </p>
    </section>
  );
}
