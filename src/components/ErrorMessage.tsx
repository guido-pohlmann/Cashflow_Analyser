import type { ApiErrorCode } from "@/lib/schema";

const COPY: Record<ApiErrorCode, string> = {
  INVALID_URL: "Bitte gib eine gültige http(s)-URL ein.",
  BLOCKED_TARGET: "Diese URL ist nicht erlaubt.",
  FETCH_TIMEOUT: "Die Seite konnte nicht geladen werden (Timeout).",
  FETCH_FAILED: "Die Seite konnte nicht geladen werden.",
  CONTENT_TOO_SHORT:
    "Auf der Seite wurden keine auswertbaren Inhalte gefunden.",
  NO_CASHFLOW_DATA:
    "Auf dieser Seite konnten keine Cashflow-Zahlen identifiziert werden. Versuche eine Seite mit Quartals- oder Jahresbericht.",
  LLM_FAILED:
    "Der Analyse-Service ist gerade überlastet. Bitte in einem Moment erneut versuchen.",
  LLM_INVALID_OUTPUT:
    "Der Analyse-Service ist gerade überlastet. Bitte in einem Moment erneut versuchen.",
  RATE_LIMITED: "Zu viele Anfragen. Bitte in einer Stunde erneut versuchen.",
  PDF_PARSING_FAILED:
    "Das PDF konnte nicht ausgewertet werden (beschädigt oder enthält nur Bilder). Versuche eine HTML-Quelle oder ein anderes PDF.",
  NO_SOURCE_FOUND:
    "Zu dieser Eingabe wurde keine Cashflow-Quelle gefunden. Versuche einen präziseren Firmennamen, ein Tickersymbol oder eine direkte URL.",
  INTERNAL: "Unerwarteter Fehler. Bitte erneut versuchen.",
};

const RETRIABLE: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  "FETCH_TIMEOUT",
  "FETCH_FAILED",
  "LLM_FAILED",
  "LLM_INVALID_OUTPUT",
  "INTERNAL",
]);

interface ErrorMessageProps {
  code: ApiErrorCode;
  onRetry: () => void;
  onReset: () => void;
}

export function ErrorMessage({ code, onRetry, onReset }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      data-error-code={code}
      className="w-full max-w-xl rounded-2xl border border-verdict-negative/40 bg-verdict-negative/10 p-6 backdrop-blur-xl"
    >
      <p className="text-base text-fg">{COPY[code]}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {RETRIABLE.has(code) && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent-deep"
          >
            Erneut versuchen
          </button>
        )}
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-fg-muted/40 px-4 py-2 text-sm font-medium text-fg hover:border-accent"
        >
          Neue URL
        </button>
      </div>
    </div>
  );
}
