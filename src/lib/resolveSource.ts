import { DEFAULT_MODEL, getAnthropicClient } from "./anthropicClient";
import { cacheGet, cachePut } from "./cache";
import { NoSourceFoundError } from "./errors";
import { sha256 } from "./sha256";

export interface ResolvedSource {
  url: string;
  companyHint: string | null;
  reason: string;
}

const REPORT_SOURCE_TOOL = "report_source";
const CACHE_PREFIX = "src:";
const CACHE_TTL_SECONDS = 24 * 60 * 60;

const REPORT_SOURCE_SCHEMA = {
  type: "object" as const,
  properties: {
    url: {
      type: "string",
      description:
        "Vollständige http(s)-URL zur ermittelten Cashflow-Quelle. Eine einzige URL, kein Array.",
    },
    companyHint: {
      type: ["string", "null"],
      description:
        "Offizieller Firmenname, falls aus der Suche eindeutig ableitbar — null wenn unsicher.",
    },
    reason: {
      type: "string",
      maxLength: 280,
      description:
        "Ein bis zwei Sätze, warum diese Quelle gewählt wurde (z.B. 'aktuellste HKEXnews-Pflichtveröffentlichung Q1 2026').",
    },
  },
  required: ["url", "companyHint", "reason"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Du bist ein Recherche-Assistent für Finanzdaten. Deine einzige Aufgabe: aus einem Firmennamen, Tickersymbol oder Suchbegriff die aktuellste belastbare Cashflow-Quelle finden und per Tool-Call \`report_source\` zurückgeben.

Vorgehen:
1. Web-Suche durchführen, um das Unternehmen eindeutig zu identifizieren (Mehrdeutigkeiten via Ticker/ISIN auflösen).
2. Die jüngste verfügbare Quelle mit Cashflow-Statement finden — bevorzugt:
   - Pflichtveröffentlichungen (HKEXnews, SEC EDGAR 10-Q/10-K/8-K, BaFin/Bundesanzeiger)
   - Offizielle Investor-Relations-Seite des Unternehmens (Quartals-/Jahresbericht, Press Release)
   - Pressemitteilung mit Cashflow-Tabelle
3. Vermeiden:
   - Aggregatoren (Yahoo Finance, marketscreener, finance.com, seekingalpha) — meist JS-gerendert, schlecht extrahierbar
   - Wikipedia, Reuters-Snippets, Tweets, Foren
   - News-Artikel ohne Primärzahlen
4. Bevorzuge **kürzere** Quartals- oder Press-Release-PDFs gegenüber 300-seitigen Geschäftsberichten (Größenlimit 10 MB).
5. Bei Aktien mit Mehrfach-Listing (z.B. BYD: HK 1211 + Shenzhen 002594): nimm die englischsprachige HKEX-Variante.
6. Liefere genau **eine** finale URL. Wenn keine geeignete Quelle gefunden, rufe \`report_source\` trotzdem auf, mit \`url: ""\` und einem Reason, der das Problem benennt — der Aufrufer interpretiert das als „nicht gefunden".

Antworte NUR über den Tool-Call \`report_source\`. Keine Prosa.`;

interface AnthropicBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content: AnthropicBlock[];
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function resolveSource(query: string): Promise<ResolvedSource> {
  const normalized = normalizeQuery(query);
  const cacheKey = `${CACHE_PREFIX}${sha256(normalized)}`;

  const cached = await cacheGet<ResolvedSource>(cacheKey);
  if (cached) return cached;

  const client = getAnthropicClient();
  let response: AnthropicResponse;
  try {
    response = (await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
        },
        {
          name: REPORT_SOURCE_TOOL,
          description:
            "Meldet die ermittelte Quell-URL für die Cashflow-Analyse zurück.",
          input_schema: REPORT_SOURCE_SCHEMA,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: query }],
    })) as unknown as AnthropicResponse;
  } catch (e) {
    throw new NoSourceFoundError(
      e instanceof Error ? e.message : "Quellen-Suche fehlgeschlagen.",
    );
  }

  const reportCall = response.content.find(
    (b) => b.type === "tool_use" && b.name === REPORT_SOURCE_TOOL,
  );
  const input = reportCall?.input as
    | { url?: unknown; companyHint?: unknown; reason?: unknown }
    | undefined;

  if (!input || !isHttpUrl(input.url)) {
    const reason =
      typeof input?.reason === "string"
        ? input.reason
        : "Keine geeignete Quelle gefunden.";
    throw new NoSourceFoundError(
      `Für "${query}" konnte keine Cashflow-Quelle ermittelt werden: ${reason}`,
    );
  }

  const resolved: ResolvedSource = {
    url: input.url,
    companyHint:
      typeof input.companyHint === "string" && input.companyHint.trim()
        ? input.companyHint.trim()
        : null,
    reason: typeof input.reason === "string" ? input.reason : "",
  };

  await cachePut(cacheKey, resolved, CACHE_TTL_SECONDS);
  return resolved;
}
