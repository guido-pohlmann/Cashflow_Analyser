import {
  BlockedTargetError,
  FetchFailedError,
  FetchTimeoutError,
} from "./errors";
import { resolveAndCheck } from "./ssrfGuard";

export type FetchedPage =
  | {
      mediaType: "text/html";
      finalUrl: string;
      contentType: string;
      bodyHtml: string;
    }
  | {
      mediaType: "application/pdf";
      finalUrl: string;
      contentType: string;
      bodyBytes: Uint8Array;
    };

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BYTES_HTML = 5_000_000;
const MAX_BYTES_PDF = 10_000_000;
const MAX_REDIRECTS = 5;
// SEC EDGAR fair-access policy verlangt eine identifizierbare User-Agent
// (Format: "Name Email"). Diese UA erfüllt das und wird auf den meisten
// öffentlichen Quellen (HKEXnews, IR-PDFs) ebenfalls akzeptiert.
const USER_AGENT =
  "CashflowAnalyzer/1.0 (+https://cashflow-analyser.vercel.app; guido.pohlmann@googlemail.com)";

const HTML_CONTENT_TYPE_RE = /^(text\/html|application\/xhtml\+xml)/i;
const PDF_CONTENT_TYPE_RE = /^application\/pdf\b/i;
const CHARSET_RE = /charset=([^;]+)/i;

function parseCharset(contentType: string): string {
  const m = CHARSET_RE.exec(contentType);
  if (!m) return "utf-8";
  return m[1]!.trim().replace(/^["']|["']$/g, "").toLowerCase() || "utf-8";
}

async function readBodyCapped(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  cap: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > cap) {
      await reader.cancel();
      throw new FetchFailedError(
        `Antwort überschreitet Größenlimit (${cap} Bytes).`,
      );
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return buf;
}

export async function fetchPage(
  rawUrl: string,
  opts: {
    timeoutMs?: number;
    maxBytesHtml?: number;
    maxBytesPdf?: number;
  } = {},
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytesHtml = opts.maxBytesHtml ?? MAX_BYTES_HTML;
  const maxBytesPdf = opts.maxBytesPdf ?? MAX_BYTES_PDF;

  const initial = new URL(rawUrl);
  if (initial.protocol !== "http:" && initial.protocol !== "https:") {
    throw new BlockedTargetError(
      `Protokoll ${initial.protocol} ist nicht erlaubt — nur http(s).`,
    );
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("timeout")), timeoutMs);

  try {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(currentUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new BlockedTargetError(
          `Redirect-Protokoll ${u.protocol} ist nicht erlaubt.`,
        );
      }
      await resolveAndCheck(currentUrl);

      const response = await fetch(currentUrl, {
        method: "GET",
        signal: ac.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/pdf;q=0.95,*/*;q=0.8",
          "Accept-Language": "de,en;q=0.7",
        },
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        const loc = response.headers.get("location");
        if (!loc) {
          throw new FetchFailedError(
            `Redirect ${response.status} ohne Location-Header.`,
          );
        }
        if (hop === MAX_REDIRECTS) {
          throw new FetchFailedError(
            `Zu viele Redirects (>${MAX_REDIRECTS}).`,
          );
        }
        currentUrl = new URL(loc, currentUrl).toString();
        await response.body?.cancel().catch(() => undefined);
        continue;
      }

      if (!response.ok) {
        throw new FetchFailedError(
          `HTTP ${response.status} ${response.statusText}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      const isHtml = HTML_CONTENT_TYPE_RE.test(contentType);
      const isPdf = PDF_CONTENT_TYPE_RE.test(contentType);
      if (!isHtml && !isPdf) {
        throw new FetchFailedError(
          `Nicht unterstützter Content-Type: ${contentType || "unbekannt"}.`,
        );
      }

      if (!response.body) {
        throw new FetchFailedError("Antwort hat keinen Body.");
      }

      const cap = isPdf ? maxBytesPdf : maxBytesHtml;
      const buf = await readBodyCapped(response.body.getReader(), cap);
      const finalUrl = response.url || currentUrl;

      if (isPdf) {
        return {
          mediaType: "application/pdf",
          finalUrl,
          contentType,
          bodyBytes: buf,
        };
      }

      const charset = parseCharset(contentType);
      let bodyHtml: string;
      try {
        bodyHtml = new TextDecoder(charset, { fatal: false }).decode(buf);
      } catch {
        bodyHtml = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      }

      return {
        mediaType: "text/html",
        finalUrl,
        contentType,
        bodyHtml,
      };
    }

    throw new FetchFailedError(`Zu viele Redirects (>${MAX_REDIRECTS}).`);
  } catch (e: unknown) {
    if (
      e instanceof Error &&
      (e.name === "AbortError" || e.message === "timeout")
    ) {
      throw new FetchTimeoutError(
        `Fetch timeout nach ${timeoutMs / 1000}s.`,
      );
    }
    if (
      e instanceof BlockedTargetError ||
      e instanceof FetchFailedError ||
      e instanceof FetchTimeoutError
    ) {
      throw e;
    }
    throw new FetchFailedError(
      e instanceof Error ? e.message : "Unbekannter Fetch-Fehler.",
    );
  } finally {
    clearTimeout(timer);
  }
}
