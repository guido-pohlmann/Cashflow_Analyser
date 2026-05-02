import { RESOLVER_MODEL, getAnthropicClient } from "./anthropicClient";
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

const SYSTEM_PROMPT = `Du bist ein erfahrener Finanzanalyst. Deine einzige Aufgabe ist es, Cashflow-Daten der letzten berichteten Periode zu identifizieren und strukturiert per Tool-Call \`report_cashflow\` zurückzugeben.

Falls du eine URL erhältst: Rufe sie mit dem web_search-Tool auf und lies den Inhalt.
Falls du einen Textauszug erhältst: Analysiere den bereitgestellten Inhalt direkt.

Regeln:
1. Verwende ausschließlich Zahlen, die im Inhalt explizit belegt sind. Rate nicht und ergänze keine Zahlen aus Allgemeinwissen.
2. "Letzte Periode" = der jüngste ausgewiesene Berichtszeitraum (Quartal, Halbjahr oder Geschäftsjahr).
3. Einheit \`unit\` beschreibt die Skalierung der Zahlen im Feld \`figures\`. Wenn "Milliarden USD" und operating = 15,2 → \`operating: 15.2, unit: "billion", currency: "USD"\`.
4. Free Cashflow: nur angeben, wenn direkt belegt oder trivial ableitbar (Operating - CapEx). Andernfalls null.
5. \`confidence\`: high = alle drei Haupt-Cashflows explizit, klare Periode; medium = 1–2 fehlen oder Periode mehrdeutig; low = nur Fragmente.
6. \`verdict\`: positive = operativer CF deutlich positiv UND Free-CF ≥ 0; negative = operativer CF negativ ODER Free-CF deutlich negativ; neutral = sonst.
7. \`interpretation\`: 2–5 Sätze, Deutsch, nüchtern, keine Anlageberatung, keine Kauf-/Verkaufsempfehlung.
8. Bei Unsicherheit Eintrag in \`warnings\` (z. B. "Quelle ist Pressemitteilung, kein vollständiger Bericht").
9. Wenn keinerlei Cashflow-Daten vorhanden: Tool trotzdem aufrufen, alle \`figures\` null, \`verdict: "neutral"\`, \`confidence: "low"\`, Grund in \`warnings\`.

Antworte NUR über den Tool-Call \`report_cashflow\`. Keine Prosa.`;

interface AnthropicMessageBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content: AnthropicMessageBlock[];
}

interface CallParams {
  sourceUrl: string;
  text?: string;
  sourceMediaType?: SourceMediaType;
  hint?: string;
}

function guessMediaType(url: string): SourceMediaType {
  return /\.pdf(\?|#|$)/i.test(url) ? "application/pdf" : "text/html";
}

async function callClaude(params: CallParams): Promise<{ input: unknown }> {
  const client = getAnthropicClient();
  const isTextMode = params.text !== undefined;

  let userContent: string;
  if (params.hint) {
    userContent = isTextMode
      ? `${params.hint}\n\nQuell-URL: ${params.sourceUrl}\n\n<text>\n${params.text}\n</text>`
      : `${params.hint}\n\nURL: ${params.sourceUrl}`;
  } else {
    userContent = isTextMode
      ? `Quell-URL: ${params.sourceUrl}\nQuelltyp: ${params.sourceMediaType === "application/pdf" ? "PDF" : "HTML"}\n\n<text>\n${params.text}\n</text>`
      : `Bitte diese URL aufrufen und Cashflow-Daten per Tool-Call \`report_cashflow\` extrahieren:\n${params.sourceUrl}`;
  }

  const systemBlock = {
    type: "text" as const,
    text: SYSTEM_PROMPT,
    cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
  };
  const reportTool = {
    name: TOOL_NAME,
    description: "Gibt eine strukturierte Cashflow-Analyse der letzten Periode zurück.",
    cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
    input_schema: TOOL_INPUT_SCHEMA,
  };

  let response: AnthropicResponse;
  try {
    if (isTextMode) {
      response = (await client.messages.create({
        model: RESOLVER_MODEL,
        max_tokens: 2048,
        system: [systemBlock],
        tools: [reportTool],
        tool_choice: { type: "tool" as const, name: TOOL_NAME },
        messages: [{ role: "user", content: userContent }],
      })) as unknown as AnthropicResponse;
    } else {
      response = (await client.messages.create({
        model: RESOLVER_MODEL,
        max_tokens: 4096,
        system: [systemBlock],
        tools: [
          { type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 1 },
          reportTool,
        ],
        tool_choice: { type: "any" as const },
        messages: [{ role: "user", content: userContent }],
      })) as unknown as AnthropicResponse;
    }
  } catch (e) {
    throw new LlmFailedError(
      e instanceof Error ? e.message : "Anthropic API call failed",
    );
  }

  const toolUse = response.content.find(
    (b) => b.type === "tool_use" && (b as AnthropicMessageBlock & { name?: string }).name === TOOL_NAME,
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
  text?: string;
  sourceMediaType?: SourceMediaType;
}): Promise<CashflowResult> {
  const meta = {
    sourceUrl: params.sourceUrl,
    sourceMediaType: params.sourceMediaType ?? guessMediaType(params.sourceUrl),
    requestedQuery: params.requestedQuery,
    sourceResolved: params.sourceResolved,
  };

  const callParams: CallParams = {
    sourceUrl: params.sourceUrl,
    text: params.text,
    sourceMediaType: params.sourceMediaType,
  };

  let { input } = await callClaude(callParams);
  let merged = withMeta(input, meta);
  let parsed = CashflowResult.safeParse(merged);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const hint = `Vorheriger Versuch hatte Schema-Fehler: ${issues}. Bitte report_cashflow erneut aufrufen und die Felder korrigieren.`;
    try {
      const retry = await callClaude({ ...callParams, hint });
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
