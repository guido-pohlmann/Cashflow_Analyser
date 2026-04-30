import { z } from "zod";

export const CashflowUnit = z.enum([
  "thousand",
  "million",
  "billion",
  "absolute",
]);
export type CashflowUnit = z.infer<typeof CashflowUnit>;

export const Verdict = z.enum(["positive", "neutral", "negative"]);
export type Verdict = z.infer<typeof Verdict>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const CashflowFigures = z.object({
  operating: z.number().nullable(),
  investing: z.number().nullable(),
  financing: z.number().nullable(),
  freeCashflow: z.number().nullable(),
  unit: CashflowUnit,
});
export type CashflowFigures = z.infer<typeof CashflowFigures>;

export const SourceMediaType = z.enum(["text/html", "application/pdf"]);
export type SourceMediaType = z.infer<typeof SourceMediaType>;

export const CashflowResult = z.object({
  company: z.string().nullable(),
  period: z.string().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Currency must be ISO-4217 code")
    .nullable(),
  figures: CashflowFigures,
  verdict: Verdict,
  interpretation: z.string().min(30).max(1200),
  confidence: Confidence,
  sourceUrl: z.url(),
  sourceMediaType: SourceMediaType,
  requestedQuery: z.string(),
  sourceResolved: z.boolean(),
  analyzedAt: z.iso.datetime(),
  warnings: z.array(z.string()).max(10),
});
export type CashflowResult = z.infer<typeof CashflowResult>;

export const AnalyzeRequest = z.object({
  query: z.string().trim().min(2).max(200),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;

export const ApiErrorCode = z.enum([
  "INVALID_URL",
  "FETCH_FAILED",
  "FETCH_TIMEOUT",
  "BLOCKED_TARGET",
  "CONTENT_TOO_SHORT",
  "NO_CASHFLOW_DATA",
  "LLM_FAILED",
  "LLM_INVALID_OUTPUT",
  "RATE_LIMITED",
  "PDF_PARSING_FAILED",
  "NO_SOURCE_FOUND",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
