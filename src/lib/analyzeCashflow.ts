import { DEFAULT_MODEL, getAnthropicClient } from "./anthropicClient";
import {
  LlmFailedError,
  LlmInvalidOutputError,
  NoCashflowDataError,
} from "./errors";
import { CashflowResult, type SourceMediaType } from "./schema";

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

const SYSTEM_PROMPT = `Du bist ein erfahrener Finanzanalyst. Du erhältst eine URL zu einem Finanzdokument (SEC-Filing, HKEXnews-Announcement, Pressemitteilung o.ä.). Deine Aufgabe:
1. Rufe die URL mit dem web_search-Tool auf, um den Dokumentinhalt zu lesen.
2. Identifiziere den Cashflow der letzten berichteten Periode aus dem gelesenen Inhalt.
3. Rufe ausschließlich das Tool \`report_cashflow\` auf. Antworte nicht in Prosa.

Regeln:
1. Verwende ausschließlich Zahlen, die im Dokument explizit belegt sind. Rate nicht und ergänze keine Zahlen aus Allgemeinwissen.
2. "Letzte Periode" = der jüngste im Dokument ausgewiesene Berichtszeitraum (Quartal, Halbjahr oder Geschäftsjahr).
3. Einheit \`unit\` beschreibt die Skalierung der Zahlen im Feld \`figures\`. Wenn im Dokument "Milliarden USD" steht und operating = 15,2 → gib \`operating: 15.2, unit: "billion", currency: "USD"\` zurück.
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
9. Wenn das Dokument keinerlei Cashflow-Daten enthält, rufe das Tool trotzdem auf, setze alle \`figures\` auf null, \`verdict: "neutral"\`, \`confidence: "low"\` und schreibe in \`warnings\` den Grund.`;

interface AnthropicMessageBlock {
  type: string;
  input?: unknown;
}

interface AnthropicResponse {
  content: AnthropicMessageBlock[];
}

function guessMediaType(url: string): SourceMediaType {
  return /\.pdf(\?|#|$)/i.test(url) ? "application/pdf" : "text/html";
}

async function callClaude(
  sourceUrl: string,
  hint?: string,
): Promise<{ input: unknown }> {
  const client = getAnthropicClient();
  const userContent = hint
    ? `${hint}\n\nURL: ${sourceUrl}`
    : `Bitte diese URL aufrufen und Cashflow-Daten der letzten berichteten Periode per Tool-Call \`report_cashflow\` extrahieren:\n${sourceUrl}`;

  let response: AnthropicResponse;
  try {
    response = (await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 1,
        },
        {
          name: TOOL_NAME,
          description:
            "Gibt eine strukturierte Cashflow-Analyse der letzten Periode zurück.",
          cache_control: { type: "ephemeral", ttl: "1h" },
          input_schema: TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: userContent }],
    })) as unknown as AnthropicResponse;
  } catch (e) {
    throw new LlmFailedError(
      e instanceof Error ? e.message : "Anthropic API call failed",
    );
  }

  const toolUse = response.content.find(
    (b) => b.type === "tool_use" && (b as { name?: string }).name === TOOL_NAME,
  );
  if (!toolUse || toolUse.input === undefined) {
    throw new LlmFailedError("Antwort enthält keinen report_cashflow-Block.");
  }
  return { input: toolUse.input };
}

export async function analyzeCashflow(params: {
  sourceUrl: string;
  requestedQuery: string;
  sourceResolved: boolean;
}): Promise<CashflowResult> {
  const meta = {
    sourceUrl: params.sourceUrl,
    sourceMediaType: guessMediaType(params.sourceUrl),
    requestedQuery: params.requestedQuery,
    sourceResolved: params.sourceResolved,
  };

  let { input } = await callClaude(params.sourceUrl);
  let merged = withMeta(input, meta);
  let parsed = CashflowResult.safeParse(merged);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const hint = `Vorheriger Versuch hatte Schema-Fehler: ${issues}. Bitte report_cashflow erneut aufrufen und die Felder korrigieren.`;
    try {
      const retry = await callClaude(params.sourceUrl, hint);
      input = retry.input;
    } catch {
      throw new LlmInvalidOutputError(
        "Schema-Validierung fehlgeschlagen, Retry-Call konnte nicht ausgeführt werden.",
      );
    }
    merged = withMeta(input, meta);
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

function withMeta(
  rawInput: unknown,
  meta: {
    sourceUrl: string;
    sourceMediaType: SourceMediaType;
    requestedQuery: string;
    sourceResolved: boolean;
  },
): unknown {
  if (typeof rawInput !== "object" || rawInput === null) return rawInput;
  return {
    ...rawInput,
    sourceUrl: meta.sourceUrl,
    sourceMediaType: meta.sourceMediaType,
    requestedQuery: meta.requestedQuery,
    sourceResolved: meta.sourceResolved,
    analyzedAt: new Date().toISOString(),
  };
}
