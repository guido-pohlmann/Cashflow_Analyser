import type { ApiErrorCode } from "./schema";

export class CashflowError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "CashflowError";
    this.code = code;
  }
}

export class InvalidUrlError extends CashflowError {
  constructor(message = "Invalid URL") {
    super("INVALID_URL", message);
    this.name = "InvalidUrlError";
  }
}

export class BlockedTargetError extends CashflowError {
  constructor(message = "URL is blocked") {
    super("BLOCKED_TARGET", message);
    this.name = "BlockedTargetError";
  }
}

export class FetchTimeoutError extends CashflowError {
  constructor(message = "Fetch timed out") {
    super("FETCH_TIMEOUT", message);
    this.name = "FetchTimeoutError";
  }
}

export class FetchFailedError extends CashflowError {
  constructor(message = "Failed to fetch page") {
    super("FETCH_FAILED", message);
    this.name = "FetchFailedError";
  }
}

export class ContentTooShortError extends CashflowError {
  constructor(message = "Extracted content too short") {
    super("CONTENT_TOO_SHORT", message);
    this.name = "ContentTooShortError";
  }
}

export class NoCashflowDataError extends CashflowError {
  constructor(message = "No cashflow data identified") {
    super("NO_CASHFLOW_DATA", message);
    this.name = "NoCashflowDataError";
  }
}

export class LlmFailedError extends CashflowError {
  constructor(message = "LLM call failed") {
    super("LLM_FAILED", message);
    this.name = "LlmFailedError";
  }
}

export class LlmInvalidOutputError extends CashflowError {
  constructor(message = "LLM output failed schema validation") {
    super("LLM_INVALID_OUTPUT", message);
    this.name = "LlmInvalidOutputError";
  }
}

export class RateLimitedError extends CashflowError {
  constructor(message = "Rate limit exceeded") {
    super("RATE_LIMITED", message);
    this.name = "RateLimitedError";
  }
}

export class PdfParsingFailedError extends CashflowError {
  constructor(message = "PDF parsing failed") {
    super("PDF_PARSING_FAILED", message);
    this.name = "PdfParsingFailedError";
  }
}

export class NoSourceFoundError extends CashflowError {
  constructor(message = "No source URL could be resolved for the query") {
    super("NO_SOURCE_FOUND", message);
    this.name = "NoSourceFoundError";
  }
}

export class EulerPoolNotFoundError extends CashflowError {
  constructor(message = "Unternehmen nicht in Eulerpool gefunden") {
    super("EULERPOOL_NOT_FOUND", message);
    this.name = "EulerPoolNotFoundError";
  }
}

export class EulerPoolError extends CashflowError {
  constructor(message = "Eulerpool API-Fehler") {
    super("EULERPOOL_ERROR", message);
    this.name = "EulerPoolError";
  }
}

const HTTP_STATUS: Record<ApiErrorCode, number> = {
  INVALID_URL: 400,
  BLOCKED_TARGET: 400,
  FETCH_TIMEOUT: 504,
  FETCH_FAILED: 502,
  CONTENT_TOO_SHORT: 422,
  NO_CASHFLOW_DATA: 422,
  LLM_FAILED: 503,
  LLM_INVALID_OUTPUT: 502,
  RATE_LIMITED: 429,
  PDF_PARSING_FAILED: 422,
  NO_SOURCE_FOUND: 422,
  EULERPOOL_NOT_FOUND: 422,
  EULERPOOL_ERROR: 502,
  INTERNAL: 500,
};

export interface ErrorContext {
  requestedQuery?: string | null;
  attemptedUrl?: string | null;
  sourceResolved?: boolean;
}

function buildErrorEnvelope(
  code: ApiErrorCode,
  message: string,
  context?: ErrorContext,
): Record<string, unknown> {
  const error: Record<string, unknown> = { code, message };
  if (context?.attemptedUrl) error.attemptedUrl = context.attemptedUrl;
  if (context?.requestedQuery) error.requestedQuery = context.requestedQuery;
  if (typeof context?.sourceResolved === "boolean") {
    error.sourceResolved = context.sourceResolved;
  }
  return { error };
}

export function mapError(error: unknown, context?: ErrorContext): Response {
  if (error instanceof CashflowError) {
    return Response.json(
      buildErrorEnvelope(error.code, error.message, context),
      { status: HTTP_STATUS[error.code] },
    );
  }
  return Response.json(
    buildErrorEnvelope("INTERNAL", "Unerwarteter Fehler.", context),
    { status: 500 },
  );
}
