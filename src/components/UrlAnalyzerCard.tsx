"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiErrorCode, CashflowResult } from "@/lib/schema";
import { ErrorMessage } from "./ErrorMessage";
import { LoadingState } from "./LoadingState";
import { ResultCard } from "./ResultCard";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: CashflowResult }
  | { kind: "error"; code: ApiErrorCode };

const CLIENT_TIMEOUT_MS = 35_000;

interface ApiErrorBody {
  error?: { code?: ApiErrorCode; message?: string };
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function UrlAnalyzerCard() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [url, setUrl] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSubmittedUrl = useRef<string | null>(null);

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
    setUrl("");
    setInlineError(null);
    lastSubmittedUrl.current = null;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function analyze(submittedUrl: string) {
    setStatus({ kind: "loading" });
    lastSubmittedUrl.current = submittedUrl;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CLIENT_TIMEOUT_MS);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: submittedUrl }),
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
      setStatus({ kind: "error", code });
    } catch (e: unknown) {
      clearTimeout(timer);
      if (e instanceof DOMException && e.name === "AbortError") {
        setStatus({ kind: "error", code: "FETCH_TIMEOUT" });
        return;
      }
      setStatus({ kind: "error", code: "INTERNAL" });
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInlineError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setInlineError("Bitte gib eine URL ein.");
      return;
    }
    if (!isValidHttpUrl(trimmed)) {
      setInlineError("Bitte gib eine gültige http(s)-URL ein.");
      return;
    }
    void analyze(trimmed);
  }

  function handleRetry() {
    if (lastSubmittedUrl.current) void analyze(lastSubmittedUrl.current);
  }

  if (status.kind === "loading") {
    return (
      <div aria-busy="true" aria-live="polite">
        <LoadingState />
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
          onRetry={handleRetry}
          onReset={reset}
        />
      </div>
    );
  }

  return (
    <section
      aria-label="URL-Analyse"
      className="w-full max-w-xl rounded-2xl border border-accent-deep/30 bg-bg-deep/70 p-6 shadow-[var(--shadow-glow)] backdrop-blur-xl"
    >
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={handleSubmit}
        noValidate
      >
        <label htmlFor="url-input" className="sr-only">
          Unternehmens-URL
        </label>
        <input
          ref={inputRef}
          id="url-input"
          type="url"
          name="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://investor.example.com/..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={inlineError !== null}
          aria-describedby={inlineError ? "url-error" : undefined}
          className="flex-1 rounded-xl border border-accent-deep/40 bg-bg/60 px-4 py-3 text-base text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-xl bg-accent px-5 py-3 text-base font-semibold text-bg transition-colors hover:bg-accent-deep focus:outline-none"
        >
          Analysieren
        </button>
      </form>
      {inlineError && (
        <p
          id="url-error"
          role="alert"
          className="mt-3 text-sm text-verdict-negative"
        >
          {inlineError}
        </p>
      )}
      <p className="mt-3 text-xs text-fg-muted">
        Keine Speicherung. Keine Anlageberatung.
      </p>
    </section>
  );
}
