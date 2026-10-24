# Letter Agent: Hacktoberfest starter

Photo of a letter → local Gemma 4 explains it (DE/EN) → to-dos + deadline → letters are stored in a
local knowledge graph you can search → "wait in the phone queue for me" via an ElevenLabs agent that
transfers the call to your phone when a human answers.

**Privacy:** photos, analyses, graph and embeddings stay on the laptop (Ollama + SQLite).
Only number, reference and call purpose go to ElevenLabs/Twilio.

## Setup (≈ 15 min)

```bash
pnpm install                                       # Node >= 22.17, pnpm 12
cp .env.example .env                                  # fill in keys

ollama pull gemma4:26b       # analysis (try gemma4:31b if OCR is weak)
ollama pull embeddinggemma   # semantic search
pnpm dev
cloudflared tunnel --url http://localhost:5173        # URL → ElevenLabs server tool webhook
```

Then configure the agent from `agent/elevenlabs-agent.md`, and create the board with
`REPO=owner/repo PROJECT="..." A=.. B=.. C=.. D=.. ./scripts/create-issues.sh`.

> SvelteKit 3 notes: env vars are declared in `src/env.ts` and imported from `$app/env/private`;
> `$lib` is now `#lib` (imports include the `.ts` extension).

## API

| Route | What |
|---|---|
| `POST /api/analyze` `{images: base64[], lang}` | Gemma analysis, stores photos + graph → `{id, analysis, related}` |
| `GET /api/documents[?q=]` | Archive list, or hybrid search (FTS5 + embeddings, DE/EN) |
| `GET /api/documents/:id` | Analysis + related letters (shared sender / Aktenzeichen / topic) |
| `GET /api/documents/:id/pages/:n` | Original photo |
| `GET /api/graph` | `{nodes, links}` for force-graph |
| `POST /api/calls` `{toNumber, senderName, purpose, reference}` | Start queue-waiting call |
| `GET /api/calls/:id/events` | SSE status timeline |
| `POST /api/calls/:id/cancel` | Hang up |
| `POST /api/agent/status` | Webhook for the agent's `report_status` tool |

Client helper: `src/lib/resize.ts` downsizes photos in the browser before upload.

## Knowledge graph

Bipartite and built from the Gemma output in the same call, so there's no extra LLM pass:

```
document ──sender──▶ organization   (Finanzamt Mannheim-Stadt)
document ──reference▶ reference      (Steuernummer 37 012 345 67)
document ──mentions─▶ person | topic (Sachbearbeiterin Müller, Einkommensteuer 2025)
```

Related letters = shared nodes, weighted reference 3 · organization 2 · person/topic 1.
Search = SQLite FTS5 + `embeddinggemma` cosine, merged with reciprocal rank fusion. Gemma also emits
bilingual keywords, so "tax" finds a "Steuerbescheid".

## Demo safety

Set `DEMO_TARGET_NUMBER` to the mock hotline (teammate's phone) so no real authority gets called.
Use redacted/sample letters only; `data/` is gitignored.

## Appella UI

The UI uses Svelte 5 runes and Tailwind 4. SvelteKit 3 configuration is in `vite.config.ts`;
design tokens are in `src/app.css`. The original Stitch references are in `design:stitch/`.

- `/`: photograph or upload one or more JPEG, PNG or WebP pages, then analyze locally.
- `/letters/:id`: summary, deadlines, copyable references, local checklist, original scans and call confirmation.
- `/calls/:id`: live SSE timeline, queue timer, human-answer alert and cancellation.
- `/archive`: bilingual search and filters. Completed-checklist marks are browser-local, not server records.
- `/graph`: interactive document connections, plus keyboard-accessible document links.

DE/EN changes the interface and the language of **new** analyses. Stored letter text is not automatically
translated. PDFs and HEIC must first be exported as images. Web fonts are fetched from Google Fonts;
letter images and analysis data are not sent there. Sound/vibration support varies by browser, and the
page must remain open for alerts. Returning from analysis stops the browser's wait, not necessarily Ollama's work.

### Preview without Ollama or telephony

With `pnpm dev`, open `http://localhost:5173/?demo=1`. The explicit demo banner and sample Finanzamt letter
use `src/lib/mock/analysis.json`; archive and graph previews use the same sample data. The demo call has
a state selector to preview every call view. Demo mode never starts a real call or silently replaces a failed API response.
It is disabled in production builds.

### Validation

```bash
pnpm check
pnpm build
pnpm exec playwright install chromium --only-shell  # once, for browser tests
pnpm test
```

Browser tests mock the APIs, so they don't need Ollama and cannot dial a real number. They cover upload,
language persistence, reference copying, checklists, confirmation, call states, search and graph navigation,
and capture screenshots at 390px and laptop widths in the gitignored `test-results/` directory.
