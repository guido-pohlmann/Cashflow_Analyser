import { RESOLVER_MODEL, getAnthropicClient } from "./anthropicClient";
import { cacheGet, cachePut } from "./cache";
import { KgvResult } from "./schema";
import { sha256 } from "./sha256";

const TOOL_NAME = "report_kgv";
const CACHE_PREFIX = "kgv:v1:";
const CACHE_TTL_SECONDS = 24 * 60 * 60;

const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    currentKgv: {
      type: ["number", "null"],
      description:
        "Aktuelles KGV (P/E Ratio, TTM bevorzugt; sonst Forward-KGV). null wenn nicht ermittelbar.",
    },
    previousKgv: {
      type: ["number", "null"],
      description:
        "KGV der Vorperiode (vorheriges Geschäftsjahr). null wenn nicht verfügbar.",
    },
    stockPrice: {
      type: ["number", "null"],
      description: "Aktueller Aktienkurs in der primären Handelswährung.",
    },
    currency: {
      type: ["string", "null"],
      description: "Währung des Kurses (z.B. HKD, USD, EUR).",
    },
    exchange: {
      type: ["string", "null"],
      description: "Primäre Börse (z.B. HKEX, NYSE, NASDAQ, XETRA).",
    },
    period: {
      type: ["string", "null"],
      description:
        "Bezugszeitraum des KGV, z.B. 'TTM', 'FY2025', 'Forward FY2026'.",
    },
  },
  required: [
    "currentKgv",
    "previousKgv",
    "stockPrice",
    "currency",
    "exchange",
    "period",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "Du bist ein Finanzrecherche-Assistent. Deine einzige Aufgabe: für ein gegebenes Unternehmen den aktuellen Aktienkurs und das Kurs-Gewinn-Verhältnis (KGV / P/E Ratio) ermitteln und per Tool-Call `report_kgv` zurückgeben.\n\n" +
  "Vorgehen:\n" +
  "1. Web-Suche mit Firmenname + Ticker + 'KGV' oder 'P/E ratio' + 'Aktienkurs'.\n" +
  "2. Such-Snippets von Google Finance, Yahoo Finance oder Finanzen.net sind für Kursdaten ausdrücklich erlaubt.\n" +
  "3. currentKgv: TTM-KGV bevorzugt; falls nicht verfügbar Forward-KGV. Negative oder absurd hohe Werte (>5000) als null zurückgeben.\n" +
  "4. previousKgv: KGV des vorherigen abgeschlossenen Geschäftsjahres — null wenn nicht verfügbar.\n" +
  "5. stockPrice: aktueller Kurs in der Handelswährung der primären Börsennotierung.\n" +
  "6. Wenn kein Kurs oder KGV gefunden: null-Werte zurückgeben.\n\n" +
  "Antworte NUR über den Tool-Call `report_kgv`. Keine Prosa.";

interface AnthropicBlock {
  type: string;
  name?: string;
  input?: unknown;
}

function normalizeIdentifier(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function fetchKgv(identifier: string): Promise<KgvResult | null> {
  const cacheKey = `${CACHE_PREFIX}${sha256(normalizeIdentifier(identifier))}`;

  const cached = await cacheGet<KgvResult>(cacheKey);
  if (cached) return cached;

  try {
    const client = getAnthropicClient();
    const response = (await client.messages.create({
      model: RESOLVER_MODEL,
      max_tokens: 512,
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
          description: "Gibt Aktienkurs und KGV des Unternehmens zurück.",
          input_schema: TOOL_SCHEMA,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content: `Aktienkurs und KGV ermitteln für: ${identifier}`,
        },
      ],
    })) as unknown as { content: AnthropicBlock[] };

    const toolCall = response.content.find(
      (b) => b.type === "tool_use" && b.name === TOOL_NAME,
    );
    if (!toolCall?.input) return null;

    const parsed = KgvResult.safeParse({
      ...(toolCall.input as object),
      fetchedAt: new Date().toISOString(),
    });
    if (!parsed.success) return null;

    await cachePut(cacheKey, parsed.data, CACHE_TTL_SECONDS);
    return parsed.data;
  } catch {
    return null;
  }
}
