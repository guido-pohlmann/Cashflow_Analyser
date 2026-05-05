# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Kommandos

```bash
npm run dev            # Turbopack-Dev-Server (Port 3000)
npm run build          # Production-Build
npm run start          # Production-Server (nach build)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm test               # Vitest single-run (jsdom + node Env)
npm run test:watch     # Vitest im Watch-Modus
npm run test:coverage  # Coverage nur für src/lib mit --environment=node
```

Einzelner Testlauf: `npx vitest run src/tests/<datei>.test.ts`
Einzelner Test-Case: `npx vitest run src/tests/<datei>.test.ts -t "name"`

`@`-Alias: `@/` zeigt auf `src/` (konfiguriert in `vitest.config.ts` + `tsconfig.json`).

## Nicht-offensichtliche Fallen

- **Coverage OOMt mit `npm test --coverage`.** jsdom + Vitest-Worker-Pool crashen unter v8/istanbul. `test:coverage` läuft nur `src/lib` mit `--environment=node` + istanbul-Provider; DoD-Ziel ≥ 80 % erreichbar (Stand: 91 % Stmts / 94 % Lines). `npm test` selbst läuft mit `fileParallelism: false` — sonst sterben Worker zufällig.
- **SSRF-Guard nicht umgehen.** `resolveAndCheck(url)` wird für jeden Redirect-Hop aufgerufen. Nicht entfernen, um lokal zu testen — es ist Teil des Sicherheitsmodells.
- **Prompt-Cache-Breakpoints.** System-Prompt und Tool-Schema in `analyzeCashflow.ts`, `resolveSource.ts` und `fetchKgv.ts` tragen `cache_control: { type: "ephemeral", ttl: "1h" }`. Jede beiläufige Formatierung invalidiert alle Cache-Hits.
- **Cache-Key-Versionierung.** Keys tragen Präfixe mit Versionsnummer (`cf:v2:`, `src:v3:`, `kgv:v1:`). Bei inkompatiblen Schema-Änderungen Präfix hochzählen — sonst liest der Code gecachte Objekte im alten Format.
- **`anthropicClient.ts`** ist vom Coverage-Include ausgenommen (`vitest.config.ts`); es ist ein Singleton-Wrapper ohne testbare Logik.
- **`resolveSource` macht keine SSRF-Prüfung** — das übernimmt `fetchPage` im nächsten Schritt.

## Architektur-Pipeline

Statische Landingpage (`src/app/page.tsx`) + ein dynamischer Endpunkt. Die Sequenz in `src/app/api/analyze/route.ts`:

```
POST /api/analyze  (Node-Runtime, maxDuration 60 s)
  AnalyzeRequest.parse(query)       [Zod — query: Firmenname, Ticker oder http(s)-URL]
  checkRateLimit(ip)                [10 req/h/IP via Upstash; no-op-Fallback ohne ENV]
  resolveSource(query)              [nur wenn kein http(s)-URL:
                                     Claude (Haiku) + web_search → Regulator-Filing-URL
                                     24 h Cache, Key "src:v3:{sha256(normalizedQuery)}"]
  cacheGet("cf:v2:" + sha256(url))  [Upstash KV; In-Memory-Fallback ohne ENV]
  fetchPage(url)                    [SSRF pro Hop, 20 s Timeout,
                                     5 MB HTML-Cap / 10 MB PDF-Cap, max 5 Redirects
                                     SEC EDGAR → identifizierende User-Agent-Header]
  extractText(html) / extractTextFromPdf(bytes)   [Readability + Tabellen als Text;
                                                   PDF via unpdf; Cap 30 000 Zeichen]
  analyzeCashflow(text)             [Claude (Haiku) Tool-Use; Prompt Caching;
    ↳ Fallback: schlägt fetchPage fehl (Timeout/403/ContentTooShort/PdfFail),
                ruft Claude die URL direkt via web_search ab]
  CashflowResult.parse(json)        [Zod; 1 Retry bei Schema-Fail → LlmInvalidOutputError]
  cachePut("cf:v2:…", result, 24h)
  fetchKgv(company)                 [Claude (Haiku) + web_search; 24 h Cache "kgv:v1:…";
                                     gibt null statt Error zurück — nie blocking]
→ Response.json({ ...CashflowResult, kgv })  +  x-cache: hit|miss
```

## Modul-Boundaries

| Pfad | Inhalt |
|---|---|
| `src/lib/` | Server-Logik, keine React-Imports. Schwerpunkt der Tests. |
| `src/lib/schema.ts` | Alle Zod-Typen: `CashflowResult`, `KgvResult`, `AnalyzeRequest`, `ApiError`, `ApiErrorCode` |
| `src/lib/errors.ts` | Alle Error-Klassen (`CashflowError`-Subklassen) + `mapError()` → HTTP-Status |
| `src/lib/anthropicClient.ts` | Singleton `getAnthropicClient()`, `DEFAULT_MODEL`, `RESOLVER_MODEL` |
| `src/components/` | UI, alle Komponenten mit `"use client"` wenn State vorhanden |
| `src/app/` | App-Router: `page.tsx` (statisch), `api/analyze/route.ts` (dynamisch) |

## AI-Modelle

Alle drei LLM-Module (`resolveSource`, `analyzeCashflow`, `fetchKgv`) verwenden `RESOLVER_MODEL` (Standard: `claude-haiku-4-5-20251001`), konfigurierbar via `ANTHROPIC_RESOLVER_MODEL`. `DEFAULT_MODEL` (`claude-sonnet-4-6`) ist definiert, aber derzeit nicht aktiv verwendet.

## Environment Variables

```
ANTHROPIC_API_KEY=          # Pflicht
ANTHROPIC_RESOLVER_MODEL=   # Optional; default: claude-haiku-4-5-20251001
ANTHROPIC_MODEL=            # Optional; default: claude-sonnet-4-6 (derzeit ungenutzt)

# Optional — ohne: In-Memory-Cache, kein Rate-Limit
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Deployment

- **Vercel** Hobby, Region `fra1` (Frankfurt). `main` = Production, Preview-Deployments pro PR.
- **Runtime:** Node (nicht Edge — jsdom benötigt Node-APIs).
- GitHub-Repo: https://github.com/guido-pohlmann/Cashflow_Analyser

## Tailwind Design-Tokens

```ts
colors: {
  bg:      { base: "#05070B", deep: "#0B0F1A" },
  accent:  { primary: "#5EE7DF", secondary: "#2BB3C0" },
  text:    { primary: "#E6F1F5", muted: "#8BA1AE" },
  verdict: { positive: "#4ADE80", neutral: "#FACC15", negative: "#F87171" },
}
// Schriften: font-sans (Inter), font-display (Space Grotesk)
// Schatten: shadow-glow  |  Animation: animate-fade-up
// Klasse .tabular → font-variant-numeric: tabular-nums (Zahlen in FigureCell)
```
