import { DEFAULT_MODEL, getAnthropicClient } from "./anthropicClient";
import {
  LlmFailedError,
  LlmInvalidOutputError,
  NoCashflowDataError,
} from "./errors";
import { CashflowResult } from "./schema";

const TOOL_NAME = "report_cashflow";

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    company: { type: ["string", "null"] },
    period: { type: ["string", "null"] },
    currency: {
      type: ["string", "null"],
      pattern: "^[A-Z]{3}$",
      description: "ISO-4217 Währungscode wie USD, EUR, GBP — null wenn unklar.",
    },
    figures: {
      type: "object",
      properties: {
        operating: { type: ["number", "null"] },
        investing: { type: ["number", "null"] },
        financing: { type: ["number", "null"] },
        freeCashflow: { type: ["number", "null"] },
        unit: {
          type: "string",
          enum: ["thousand", "million", "billion", "absolute"],
        },
      },
      required: [
        "operating",
        "investing",
        "financing",
        "freeCashflow",
        "unit",
      ],
      additionalProperties: false,
    },
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
  required: [
    "company",
    "period",
    "currency",
    "figures",
    "verdict",
    "interpretation",
    "confidence",
    "warnings",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Du bist ein erfahrener Finanzanalyst. Deine einzige Aufgabe ist, aus einem übergebenen Textauszug einer Unternehmens-Webseite den Cashflow der letzten berichteten Periode zu identifizieren und knapp zu interpretieren.

Regeln:
1. Verwende ausschließlich Zahlen, die im Text explizit belegt sind. Rate nicht und ergänze keine Zahlen aus Allgemeinwissen.
2. "Letzte Periode" = der jüngste im Text ausgewiesene Berichtszeitraum (Quartal, Halbjahr oder Geschäftsjahr — das, was am aktuellsten ist).
3. Einheit \`unit\` beschreibt die Skalierung der Zahlen im Feld \`figures\`. Wenn im Text "Milliarden USD" steht und operating = 15,2 → gib \`operating: 15.2, unit: "billion", currency: "USD"\` zurück.
4. Free Cashflow: nur angeben, wenn direkt belegt oder trivial ableitbar (Operating - CapEx). Andernfalls null.
5. \`confidence\`:
   - high: alle drei Haupt-Cashflows explizit ausgewiesen, klare Periode.
   - medium: 1–2 Cashflows fehlen oder Periode leicht mehrdeutig.
   - low: nur Fragmente, starke Unsicherheit.
6. \`verdict\`:
   - positive: operativer CF deutlich positiv UND Free-CF ≥ 0 (falls bekannt).
   - negative: operativer CF negativ ODER Free-CF deutlich negativ.
   - neutral: sonst.
7. \`interpretation\`: 2–5 Sätze, Deutsch, nüchtern, keine Anlageberatung, keine Preisprognose, keine Kauf-/Verkaufsempfehlung.
8. Bei Unsicherheit füge einen kurzen Eintrag zu \`warnings\` hinzu (z. B. "Quelle ist Pressemitteilung, kein vollständiger Bericht").
9. Rufe ausschließlich das Tool \`report_cashflow\` auf. Antworte nicht in Prosa.

Wenn der Text keinerlei Cashflow-Daten enthält, rufe das Tool trotzdem auf, setze alle \`figures\` auf null, \`verdict: "neutral"\`, \`confidence: "low"\` und schreibe in \`warnings\` den Grund.`;

interface CallResult {
  input: unknown;
}

interface AnthropicMessageBlock {
  type: string;
  input?: unknown;
}

interface AnthropicResponse {
  content: AnthropicMessageBlock[];
}

async function callClaude(userText: string): Promise<CallResult> {
  const client = getAnthropicClient();
  let response: AnthropicResponse;
  try {
    response = (await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Gibt eine strukturierte Cashflow-Analyse der letzten Periode zurück.",
          cache_control: { type: "ephemeral" },
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: userText }],
    })) as unknown as AnthropicResponse;
  } catch (e) {
    throw new LlmFailedError(
      e instanceof Error ? e.message : "Anthropic API call failed",
    );
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.input === undefined) {
    throw new LlmFailedError("Antwort enthält keinen tool_use Block.");
  }
  return { input: toolUse.input };
}

export async function analyzeCashflow(params: {
  text: string;
  sourceUrl: string;
}): Promise<CashflowResult> {
  const userMessage = `Quell-URL: ${params.sourceUrl}\n\n<text>\n${params.text}\n</text>`;

  // Erster Call
  let { input } = await callClaude(userMessage);
  let merged = withMeta(input, params.sourceUrl);
  let parsed = CashflowResult.safeParse(merged);

  // Ein Retry bei Schema-Fail
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const retryMessage = `${userMessage}\n\nDein letzter Output war kein valides Schema: ${issues}. Ruf das Tool erneut auf und korrigiere die Felder.`;
    try {
      const retry = await callClaude(retryMessage);
      input = retry.input;
    } catch {
      throw new LlmInvalidOutputError(
        "Schema-Validierung fehlgeschlagen, Retry-Call konnte nicht ausgeführt werden.",
      );
    }
    merged = withMeta(input, params.sourceUrl);
    parsed = CashflowResult.safeParse(merged);
    if (!parsed.success) {
      throw new LlmInvalidOutputError(
        `Schema-Validierung zweimal fehlgeschlagen: ${parsed.error.issues[0]?.message ?? "unbekannt"}.`,
      );
    }
  }

  const result = parsed.data;

  const allFiguresNull =
    result.figures.operating === null &&
    result.figures.investing === null &&
    result.figures.financing === null &&
    result.figures.freeCashflow === null;

  if (allFiguresNull && result.confidence !== "high") {
    throw new NoCashflowDataError(
      result.warnings[0] ??
        "Auf der Seite konnten keine Cashflow-Zahlen identifiziert werden.",
    );
  }

  return result;
}

function withMeta(rawInput: unknown, sourceUrl: string): unknown {
  if (typeof rawInput !== "object" || rawInput === null) return rawInput;
  return {
    ...rawInput,
    sourceUrl,
    analyzedAt: new Date().toISOString(),
  };
}
