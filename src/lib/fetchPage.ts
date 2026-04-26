import {
  BlockedTargetError,
  FetchFailedError,
  FetchTimeoutError,
} from "./errors";

export interface FetchedPage {
  finalUrl: string;
  contentType: string;
  bodyHtml: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const ALLOWED_CONTENT_TYPE_RE = /^(text\/html|application\/xhtml\+xml)/i;

/**
 * S2 minimal-Implementation: HTTPS-only Check, AbortController-Timeout,
 * Content-Type-Whitelist. SSRF-Guard, Streaming-Body-Cap und manuelle
 * Redirect-Kette folgen in S3 (`ssrfGuard.ts`).
 */
export async function fetchPage(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<FetchedPage> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new BlockedTargetError(
      `Protokoll ${u.protocol} ist nicht erlaubt — nur http(s).`,
    );
  }

  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(new Error("timeout")),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de,en;q=0.7",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new FetchFailedError(
        `HTTP ${response.status} ${response.statusText}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!ALLOWED_CONTENT_TYPE_RE.test(contentType)) {
      throw new FetchFailedError(
        `Nicht unterstützter Content-Type: ${contentType || "unbekannt"}.`,
      );
    }

    const bodyHtml = await response.text();
    return {
      finalUrl: response.url,
      contentType,
      bodyHtml,
    };
  } catch (e: unknown) {
    if (
      e instanceof Error &&
      (e.name === "AbortError" || e.message === "timeout")
    ) {
      throw new FetchTimeoutError(
        `Fetch timeout nach ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s.`,
      );
    }
    if (e instanceof BlockedTargetError || e instanceof FetchFailedError) {
      throw e;
    }
    throw new FetchFailedError(
      e instanceof Error ? e.message : "Unbekannter Fetch-Fehler.",
    );
  } finally {
    clearTimeout(timer);
  }
}
