# Cashflow Analyzer

Eine Web-App, die eine Unternehmens-URL entgegennimmt und in Sekunden eine automatisch ermittelte und interpretierte Cashflow-Auswertung der letzten Berichtsperiode liefert.

Quelle für Anforderungen: `PRD_Cashflow_Analyzer.md` und `SPEC_Cashflow_Analyzer.md` im übergeordneten Workspace.

## Stack

- **Next.js 16** (App Router) mit TypeScript strict
- **Tailwind CSS v4**
- **Anthropic SDK** mit Tool-Use + Prompt Caching
- **`@mozilla/readability` + `jsdom`** für HTML→Text-Extraktion
- **Zod** für Schema-Validierung (Request, Response, LLM-Output)
- **Upstash Redis + Ratelimit** (optional, sonst In-Memory-Fallback)
- **Vitest** + Testing Library

## Setup

```bash
npm ci
cp .env.example .env.local   # ANTHROPIC_API_KEY eintragen
npm run dev                  # http://localhost:3000
```

### Environment-Variablen

| Variable | Pflicht | Zweck |
|---|---|---|
| `ANTHROPIC_API_KEY` | ja | Zugriff auf Claude API |
| `ANTHROPIC_MODEL` | nein | Default: `claude-sonnet-4-6` |
| `UPSTASH_REDIS_REST_URL` | nein | Wenn gesetzt: persistenter Cache + Rate-Limit |
| `UPSTASH_REDIS_REST_TOKEN` | nein | s.o. |

Ohne Upstash läuft der Cache als In-Memory-`Map` pro Function-Instanz und das Rate-Limit als No-Op (mit Warnung im Log).

## Scripts

```bash
npm run dev         # Dev-Server (Turbopack)
npm run build       # Production-Build
npm run start       # Production-Server
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest single run
npm run test:watch  # Vitest watch
```

## Architektur

```
Browser ──POST /api/analyze──► Next.js Route Handler (Node runtime)
  ├── AnalyzeRequest.parse(body)         [Zod]
  ├── checkRateLimit(ip)                 [Upstash, optional]
  ├── cacheGet(sha256(url))              [Upstash KV / in-memory]
  ├── fetchPage(url)                     [Timeout + SSRF + Redirect-Check + 2 MB Cap]
  ├── extractText(html, url)             [Readability + Tabellen]
  ├── analyzeCashflow(text, url)         [Anthropic Tool-Use + Prompt Cache]
  ├── CashflowResult.parse(json)         [Zod, mit 1 Retry]
  └── cachePut(key, result, 30 min)
  ──► CashflowResult JSON
```

Die Landingpage selbst ist statisch pre-rendered. Nur `/api/analyze` ist dynamisch (Node-Runtime, `maxDuration = 30`).

## Sicherheit

- **SSRF-Schutz:** Vor jedem Hop Hostname/IP gegen IPv4/IPv6-Blocklisten geprüft (Loopback, RFC1918, Link-Local inkl. Cloud-Metadata-IP, IPv4-mapped IPv6, ULA, FE80). Hostname-Blockliste für `localhost`, `metadata.google.internal`.
- **Redirect-Limit:** maximal 5 Hops, jeder neu SSRF-validiert.
- **Body-Limit:** 2 MB, gestreamt per Reader, sauberer Abbruch bei Überschreitung.
- **Content-Type-Whitelist:** nur `text/html` und `application/xhtml+xml`.
- **Timeout:** 15 s server-seitig (`AbortController`), 35 s client-seitig.
- **CSP** + `Referrer-Policy`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` werden in `next.config.ts` für alle Routen gesetzt.
- **Keine Persistenz:** URLs und Ergebnisse landen weder in einer DB noch im Log.
- **Secrets** ausschließlich über Environment-Variablen, `.env.local` ist gitignored.

## Limitierungen (MVP)

- **Kein PDF-Support.** Nur HTML/XHTML; PDF-URLs werden mit `FETCH_FAILED` abgelehnt.
- **Kein JavaScript-Rendering.** Reines `fetch`; SPAs ohne SSR liefern oft zu wenig Text → `CONTENT_TOO_SHORT`.
- **Kein Anti-Bot-Bypass.** Cloudflare-Challenge & Co. führen zu `FETCH_FAILED`.
- **Nur die letzte Periode.** Kein Mehrjahres-/Mehrquartals-Vergleich.
- **Beste-Bemühen-Genauigkeit.** Der LLM kann Zahlen falsch zuordnen, besonders bei Pressemitteilungen ohne klare Tabellen.

## Disclaimer

> Automatisch generiert, kann Fehler enthalten. **Keine Anlageberatung.**

Ergebnisse dürfen nicht als Grundlage für Anlageentscheidungen verwendet werden. Es handelt sich um eine schnelle, automatisierte Erstauswertung — keine Empfehlung, keine Beratung, keine Garantie für Richtigkeit oder Vollständigkeit.

## Deployment

- **Vercel:** GitHub-Integration, `main` = Production, Preview-Deployments pro PR.
- **Tier:** Vercel Hobby für MVP.
- **Region:** `fra1` (Frankfurt) für niedrige Latenz.
- **Runtime:** Node (nicht Edge — `jsdom` benötigt Node-APIs).
