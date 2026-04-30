import { describe, it, expect } from "vitest";
import {
  BlockedTargetError,
  CashflowError,
  ContentTooShortError,
  FetchFailedError,
  FetchTimeoutError,
  InvalidUrlError,
  LlmFailedError,
  LlmInvalidOutputError,
  NoCashflowDataError,
  NoSourceFoundError,
  PdfParsingFailedError,
  RateLimitedError,
  mapError,
} from "@/lib/errors";
import type { ApiErrorCode } from "@/lib/schema";

const cases: Array<{
  name: string;
  err: CashflowError;
  status: number;
  code: ApiErrorCode;
}> = [
  { name: "InvalidUrl",     err: new InvalidUrlError("bad"),         status: 400, code: "INVALID_URL" },
  { name: "BlockedTarget",  err: new BlockedTargetError("private"),  status: 400, code: "BLOCKED_TARGET" },
  { name: "FetchTimeout",   err: new FetchTimeoutError("slow"),      status: 504, code: "FETCH_TIMEOUT" },
  { name: "FetchFailed",    err: new FetchFailedError("502"),        status: 502, code: "FETCH_FAILED" },
  { name: "ContentTooShort",err: new ContentTooShortError("short"),  status: 422, code: "CONTENT_TOO_SHORT" },
  { name: "NoCashflowData", err: new NoCashflowDataError("none"),    status: 422, code: "NO_CASHFLOW_DATA" },
  { name: "LlmFailed",      err: new LlmFailedError("500"),          status: 503, code: "LLM_FAILED" },
  { name: "LlmInvalidOut",  err: new LlmInvalidOutputError("schema"),status: 502, code: "LLM_INVALID_OUTPUT" },
  { name: "RateLimited",    err: new RateLimitedError("too many"),   status: 429, code: "RATE_LIMITED" },
  { name: "PdfParsingFailed", err: new PdfParsingFailedError("broken"), status: 422, code: "PDF_PARSING_FAILED" },
  { name: "NoSourceFound", err: new NoSourceFoundError("nope"), status: 422, code: "NO_SOURCE_FOUND" },
];

describe("mapError", () => {
  it.each(cases)("maps $name to $status with code $code", async ({ err, status, code }) => {
    const res = mapError(err);
    expect(res.status).toBe(status);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe(code);
    expect(body.error.message).toBe(err.message);
  });

  it("maps unknown thrown value to 500 INTERNAL", async () => {
    const res = mapError(new Error("boom"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL");
  });

  it("also maps non-Error throwables to 500 INTERNAL", async () => {
    const res = mapError("oops");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL");
  });

  it("merges error context fields when provided", async () => {
    const res = mapError(new FetchFailedError("502"), {
      attemptedUrl: "https://example.com/q4.pdf",
      requestedQuery: "BYD",
      sourceResolved: true,
    });
    const body = (await res.json()) as {
      error: {
        code: string;
        attemptedUrl?: string;
        requestedQuery?: string;
        sourceResolved?: boolean;
      };
    };
    expect(body.error.attemptedUrl).toBe("https://example.com/q4.pdf");
    expect(body.error.requestedQuery).toBe("BYD");
    expect(body.error.sourceResolved).toBe(true);
  });

  it("omits empty context fields", async () => {
    const res = mapError(new FetchFailedError("502"), {
      attemptedUrl: null,
      requestedQuery: null,
    });
    const body = (await res.json()) as {
      error: Record<string, unknown>;
    };
    expect(body.error).not.toHaveProperty("attemptedUrl");
    expect(body.error).not.toHaveProperty("requestedQuery");
    expect(body.error).not.toHaveProperty("sourceResolved");
  });

  it("merges context on the catch-all (non-CashflowError) branch", async () => {
    const res = mapError(new Error("boom"), {
      attemptedUrl: "https://example.com/x",
      sourceResolved: false,
    });
    const body = (await res.json()) as {
      error: { code: string; attemptedUrl?: string; sourceResolved?: boolean };
    };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.attemptedUrl).toBe("https://example.com/x");
    expect(body.error.sourceResolved).toBe(false);
  });
});

describe("CashflowError subclasses set name + code", () => {
  it("InvalidUrlError exposes code INVALID_URL", () => {
    const e = new InvalidUrlError();
    expect(e.code).toBe("INVALID_URL");
    expect(e.name).toBe("InvalidUrlError");
  });

  it("BlockedTargetError exposes code BLOCKED_TARGET", () => {
    expect(new BlockedTargetError().code).toBe("BLOCKED_TARGET");
  });

  it("RateLimitedError exposes code RATE_LIMITED", () => {
    expect(new RateLimitedError().code).toBe("RATE_LIMITED");
  });

  it("PdfParsingFailedError exposes code PDF_PARSING_FAILED", () => {
    expect(new PdfParsingFailedError().code).toBe("PDF_PARSING_FAILED");
  });

  it("NoSourceFoundError exposes code NO_SOURCE_FOUND", () => {
    expect(new NoSourceFoundError().code).toBe("NO_SOURCE_FOUND");
  });
});
