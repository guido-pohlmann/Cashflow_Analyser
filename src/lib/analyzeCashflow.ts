import { z } from "zod";

import { RESOLVER_MODEL, getAnthropicClient } from "./anthropicClient";
import { LlmFailedError, LlmInvalidOutputError, NoCashflowDataError } from "./errors";
import type { EulerCashflow } from "./eulerPool";
import { Confidence, CashflowResult, Verdict } from "./schema";

const TOOL_NAME = "report_interpretation";

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    verdict: {
      type: "string",
      enum: ["positive", "neutral", "negative"],
    },
    interpretation: {
      type: "string",
      minLength: 30,
      maxLength: 1200,
      description: "2–5 Sätze, Deutsch, nüchtern, keine Anlageberatung.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      maxItems: 10,
    },
  },
  required: ["verdict", "interpretation", "confidence", "warnings"],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "Du bist ein erfahrener Finanzanalyst. Du erhältst strukturierte Cashflow-Daten eines Unternehmens aus einer Finanzdatenbank und gibst per Tool-Call `report_interpretation` eine prägnante Bewertung auf Deutsch zurück.\n\n" +
  "Regeln:\n" +
  "1. `verdict`: positive = operativer CF deutlich positiv UND Free-CF ≥ 0; negative = operativer CF negativ ODER Free-CF deutlich negativ; neutral = sonst.\n" +
  "2. `interpretation`: 2–5 Sätze, Deutsch, nüchtern, keine Anlageberatung, keine Kauf-/Verkaufsempfehlung. Beziehe dich auf die konkreten Zahlen.\n" +
  "3. `confidence`: high = alle Cashflows vorhanden und plausibel; medium = 1–2 fehlen oder Periode unbekannt; low = keine oder nur fragmentarische Daten.\n" +
  "4. `warnings`: Hinweise auf Datenlücken oder Besonderheiten. Leer wenn keine.\n\n" +
  "Antworte NUR über den Tool-Call `report_interpretation`. Keine Prosa.";

const InterpretationOutput = z.object({
  verdict: Verdict,
  interpretation: z.string().min(30).max(1200),
  confidence: Confidence,
  warnings: z.array(z.string()).max(10),
});

const UNIT_LABEL: Record<string, string> = {
  billion: "Mrd.",
  million: "Mio.",
  thousand: "Tsd.",
  absolute: "",
};

interface AnthropicBlock {
  type: string;
  name?: string;
  input?: unknown;
}

function formatUserMessage(cashflow: EulerCashflow): string {
  const unit = UNIT_LABEL[cashflow.unit] ?? "";
  const fmt = (v: number | null) =>
    v === null ? "n/a" : `${v.toFixed(2)}${unit ? " " + unit : ""}`;

  return (
    `Cashflow-Daten für ${cashflow.company ?? cashflow.ticker} (${cashflow.ticker})` +
    (cashflow.period ? `, ${cashflow.period}` : "") +
    (cashflow.currency ? `, ${cashflow.currency}` : "") +
    ":\n\n" +
    `- Operativer Cashflow:     ${fmt(cashflow.operating)}\n` +
    `- Investitions-Cashflow:   ${fmt(cashflow.investing)}\n` +
    `- Finanzierungs-Cashflow:  ${fmt(cashflow.financing)}\n` +
    `- Freier Cashflow:         ${fmt(cashflow.freeCashflow)}`
  );
}

async function callClaude(userContent: string): Promise<unknown> {
  const client = getAnthropicClient();
  let response: { content: AnthropicBlock[] };
  try {
    response = (await client.messages.create({
      model: RESOLVER_MODEL,
      max_tokens: 512,
      system: [
        {
          type: "text" as const,
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: "Gibt Bewertung und Interpretation der Cashflow-Daten zurück.",
          cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "tool" as const, name: TOOL_NAME },
      messages: [{ role: "user", content: userContent }],
    })) as unknown as { content: AnthropicBlock[] };
  } catch (e) {
    throw new LlmFailedError(
      e instanceof Error ? e.message : "Anthropic API call failed",
    );
  }

  const toolUse = response.content.find(
    (b) => b.type === "tool_use" && b.name === TOOL_NAME,
  );
  if (!toolUse?.input) {
    throw new LlmFailedError("Antwort enthält keinen report_interpretation-Block.");
  }
  return toolUse.input;
}

export async function generateInterpretation(
  cashflow: EulerCashflow,
  meta: { requestedQuery: string; sourceResolved: boolean },
): Promise<CashflowResult> {
  const allNull =
    cashflow.operating === null &&
    cashflow.investing === null &&
    cashflow.financing === null &&
    cashflow.freeCashflow === null;

  if (allNull) {
    throw new NoCashflowDataError(
      "Eulerpool lieferte keine Cashflow-Zahlen für dieses Unternehmen.",
    );
  }

  const userContent = formatUserMessage(cashflow);

  let raw = await callClaude(userContent);
  let parsed = InterpretationOutput.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const retryContent =
      `${userContent}\n\nHinweis: Vorheriger Versuch hatte Schema-Fehler: ${issues}. Bitte report_interpretation erneut aufrufen.`;
    try {
      raw = await callClaude(retryContent);
    } catch {
      throw new LlmInvalidOutputError(
        "Schema-Validierung fehlgeschlagen, Retry-Call konnte nicht ausgeführt werden.",
      );
    }
    parsed = InterpretationOutput.safeParse(raw);
    if (!parsed.success) {
      throw new LlmInvalidOutputError(
        `Schema-Validierung zweimal fehlgeschlagen: ${parsed.error.issues[0]?.message ?? "unbekannt"}.`,
      );
    }
  }

  const { verdict, interpretation, confidence, warnings } = parsed.data;

  return CashflowResult.parse({
    company: cashflow.company ?? cashflow.ticker,
    period: cashflow.period,
    currency: cashflow.currency,
    figures: {
      operating: cashflow.operating,
      investing: cashflow.investing,
      financing: cashflow.financing,
      freeCashflow: cashflow.freeCashflow,
      unit: cashflow.unit,
    },
    verdict,
    interpretation,
    confidence,
    warnings,
    sourceUrl: null,
    requestedQuery: meta.requestedQuery,
    sourceResolved: meta.sourceResolved,
    analyzedAt: new Date().toISOString(),
  });
}
