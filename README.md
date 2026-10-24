# Letter Agent: Hacktoberfest starter

Photo of a letter → hosted Gemma 4 explains it (DE/EN) → to-dos + deadline → letters are stored in a
local knowledge graph you can search → "wait in the phone queue for me" via an ElevenLabs agent that
transfers the call to your phone when a human answers.

**Privacy:** with the default Gemini provider, letter images and prompts are sent to Google for analysis;
the original photos, analyses, graph and search index are then stored locally. Use redacted/sample letters
for the demo. The assistant also sends the conversation and retrieved letter details to Google.
Set `GEMMA_PROVIDER=ollama` to run analysis, assistant chat and optional embeddings locally instead.
Only number, reference and call purpose go to ElevenLabs/Twilio.

## Setup (≈ 15 min)

```bash
pnpm install                                      # Node >= 22.17, pnpm 12
cp .env.example .env                            # add GEMINI_API_KEY from Google AI Studio
pnpm dev
cloudflared tunnel --url http://localhost:5173        # public URL for the agent's status webhook
pnpm agent:sync                                       # points the ElevenLabs agent at that URL
```

The default configuration needs no model download:

```dotenv
GEMMA_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=models/gemma-4-26b-a4b-it
```

For a fully local setup, change `GEMMA_PROVIDER=ollama` and run:

```bash
ollama pull gemma4:26b       # analysis (try gemma4:31b if OCR is weak)
ollama pull embeddinggemma   # optional semantic search
```

`GEMMA_MODEL` is the Ollama model name; `GEMINI_MODEL` is the hosted model name (the app also accepts
the short name without `models/`). With Gemini, archive search uses SQLite full-text search and skips the
optional Ollama embedding request.

Storage uses Node's built-in `node:sqlite`. The complete current schema is created directly on a fresh
database; there is no legacy migration or backfill. This backend expects a fresh database.

The phone agent is described in `agent/elevenlabs-agent.md`; see [Phone agent](#phone-agent-elevenlabs) for the
one-time setup. Create the board with `REPO=owner/repo PROJECT="..." A=.. B=.. C=.. D=.. ./scripts/create-issues.sh`.

> SvelteKit 3 notes: env vars are declared in `src/env.ts` and imported from `$app/env/private`;
> `$lib` is now `#lib` (imports include the `.ts` extension).

## API

| Route | What |
|---|---|
| `POST /api/analyze` `{images: base64[], lang}` | Gemma analysis, stores photos + graph, assigns a case → `{id, case_id, case_created, analysis, related}` |
| `GET /api/documents[?q=]` | Archive list, or hybrid search (FTS5 + embeddings, DE/EN) |
| `GET /api/documents/:id` | Analysis + its case + related letters (shared sender / Aktenzeichen / topic) |
| `GET /api/documents/:id/pages/:n` | Original photo |
| `PATCH /api/documents/:id/todos/:index` `{done}` | Set server-side to-do completion (logged, undoable) |
| `GET /api/cases` | Cases, open first and nearest deadline first |
| `POST /api/cases` `{title, letter_ids?}` | Create a case, optionally moving letters into it |
| `GET /api/cases/:id` | Case + chronological letters, page URLs, to-dos and history |
| `PATCH /api/cases/:id` `{title?, status?, notes?}` | Rename, close/reopen, or change notes |
| `POST /api/cases/:id/letters` `{letter_id}` | Move a letter into a case |
| `POST /api/case-events/:id/undo` | Undo a logged change |
| `POST /api/chat` `{messages, case_id?, lang?}` | Assistant, streaming NDJSON events |
| `GET /api/graph` | `{nodes, links}` for force-graph, including case nodes |
| `POST /api/calls` `{toNumber, senderName, purpose, reference, letterDate?}` | Start queue-waiting call (503 if ElevenLabs isn't configured) |
| `GET /api/calls/:id/events` | SSE status timeline |
| `POST /api/calls/:id/cancel` | Hang up via Twilio → `{ok, error?}` |
| `POST /api/calls/:id/session` | Browser hotline: WebRTC token + call variables for `/hotline/:id` |
| `POST /api/calls/:id/conversation` `{conversationId}` | Browser hotline: start following the conversation |
| `POST /api/calls/:id/handover` | Browser hotline: the agent introduced the user and left |
| `POST /api/agent/status` | Webhook for the agent's `report_status` tool |
| `GET /api/agent/health` | Which parts of the phone setup are configured (no secrets) |
| `DELETE /api/cases/:id` | Permanently delete a reviewed case and all its letters; body: `{letter_ids: string[]}` |

Client helpers: `src/lib/resize.ts` downsizes photos before upload; `src/lib/assistant-client.ts`
streams chat and parses `[[letter:ID]]` / `[[case:ID]]` references.

## Cases and assistant

A new letter joins the case of the newest letter sharing a reference number; otherwise it starts a
new case named by Gemma's `case_title`. Changes to case names, status, notes, letter assignment and
server-side to-dos are logged with inverse operations for undo.

The assistant uses hosted Gemma through Gemini by default, with up to six tool rounds per answer.
No Ollama installation or model download is required. It supports:

- Read: `search_letters`, `list_cases`, `get_case`, `get_letter`, `list_open_deadlines`, `graph_neighbors`, `draft_reply`.
- Edit: `create_case`, `rename_case`, `set_case_status`, `move_letter`, `set_todo_done`, `add_case_note`.
- UI events: `open_case`, `open_letter`, `prepare_call`. The last only prepares a call; it never dials.

Stream events: `text`, `tool` (start/done), `refs`, `change`, `ui`, `done`, `error`.
`/assistant` provides a minimal streaming chat UI over this backend, with optional case context and a
quiet **Ask about this letter** link from a letter. References open letters or a read-only case preview;
there is no separate case-management screen. Explicitly requested edits show a compact Undo control.
Call drafts use the existing review/consent sheet and never dial automatically.
Conversation history stays in browser memory across app navigation, not in persistent browser storage,
and clears on reload or **New chat**. Stopping or losing a reply keeps partial text and received change
receipts; it never automatically retries an operation. DE/EN follows the selected UI language.
The UI checklist uses server-side to-dos and offers Undo for its latest saved change. Checkmarks are
confirmed only after a successful save; failed saves keep the previous state. Letter details are
reloaded after edits and on navigation, so changes from other clients are not hidden by a browser cache.
The quiet **Delete case…** option at the bottom of a letter opens a list of every letter in its case.
Deletion requires explicit confirmation and cannot be undone. It removes scans, analyses, search/graph
entries and that case's history, while preserving other cases and shared graph entities. The server rejects
deletion if case membership changed since review. Duplicate uploads sharing a reference can belong to the
same case, so deleting that case may remove the original as well.

```bash
curl -N localhost:5173/api/chat -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Was ist offen?"}]}'
```

A successful stream ends with `{"type":"done"}`; provider failures emit an `error` event instead.

## Knowledge graph

Bipartite and built from the Gemma output in the same call, so there's no extra LLM pass:

```
document ──sender──▶ organization   (Finanzamt Mannheim-Stadt)
document ──reference▶ reference      (Steuernummer 37 012 345 67)
document ──mentions─▶ person | topic (Sachbearbeiterin Müller, Einkommensteuer 2025)
document ──case────▶ case            (Einkommensteuer 2025)
```

Related letters = shared nodes, weighted reference 3 · organization 2 · person/topic 1.
Search = SQLite FTS5 + `embeddinggemma` cosine, merged with reciprocal rank fusion. Gemma also emits
bilingual keywords, so "tax" finds a "Steuerbescheid".

## Phone agent (ElevenLabs)

The "Wait in the queue for me" button uses the ElevenLabs agent **Digital Phone Assistant** over a Twilio
number. How the app and the agent talk:

1. `POST /api/calls` starts an outbound call (`/v1/convai/twilio/outbound-call`) with the dynamic variables
   `call_id`, `user_name`, `sender_name`, `purpose`, `reference`, `letter_date` and `secret__webhook_secret`,
   in the language from `AGENT_LANGUAGE`.
2. During the call the agent's `report_status` tool posts menu / hold / human / voicemail / failed to
   `/api/agent/status`, which the live call screen receives over SSE.
3. The server also reads the conversation from ElevenLabs every 2 s. That catches what the agent can't
   report itself: the transfer to your phone going through ("connected"), hang-ups, busy lines, no answer.
   It also fills in steps if the tunnel drops and a webhook never arrives.
4. "End call" hangs up through Twilio.

One-time setup:

1. In ElevenLabs, import your Twilio number (Phone Numbers → Import → Twilio) and put its ID in
   `ELEVENLABS_PHONE_NUMBER_ID`. Without it no call can start.
2. In `.env`: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `TRANSFER_NUMBER` (your mobile, E.164),
   a random `WEBHOOK_SECRET`, `USER_DISPLAY_NAME`, and the Twilio credentials for "End call".
3. Start `pnpm dev` and the tunnel, then run `pnpm agent:sync`. It finds the cloudflared quick-tunnel URL
   on its own (or pass it: `pnpm agent:sync https://….trycloudflare.com`), points `report_status` at it,
   sets the transfer number, adds any missing phone tools and checks that ElevenLabs can reach the app.
   Quick-tunnel URLs change on every start, so re-run it each time. `pnpm agent:check` only reports.

The agent ends calls after its maximum call duration (10 minutes unless you raise it in the agent
settings), so a long real queue can run out; the demo hotline is well under that.

## Demo without a phone number (browser hotline)

No Twilio number yet? Leave `ELEVENLABS_PHONE_NUMBER_ID` empty (or set `CALL_MODE=browser`) and the app
runs the same agent over the browser instead of a phone line. Nothing is dialed and there are no telephony
costs; the conversation still counts towards your ElevenLabs agent minutes.

1. `.env`: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `WEBHOOK_SECRET`, `USER_DISPLAY_NAME`.
2. `pnpm dev`, `cloudflared tunnel --url http://localhost:5173`, `pnpm agent:sync`, and open the app
   through the tunnel URL.
3. Start a call from a letter as usual. The call screen shows a **demo hotline** link.
4. Open that link on a second device (the teammate playing the Finanzamt) and tap **Answer call**.
   Play the menu recording and hold music, then answer as a clerk. The agent stays quiet on hold,
   introduces Kevin when a person speaks, and leaves; Kevin's screen shows each step live and the
   "someone answered" alert. There is no phone to transfer to, so the two then talk in person.

How it works: `POST /api/calls` creates the call without dialing; `/hotline/:id` fetches a short-lived
WebRTC token from `POST /api/calls/:id/session` (the API key stays on the server), reports the conversation
id, and calls `POST /api/calls/:id/handover` once the agent has introduced the user. Each browser call gets
its own webhook secret, since the hotline page can see it. "End call" works without Twilio.

## Demo safety

Set `DEMO_TARGET_NUMBER` to the mock hotline (teammate's phone) so no real authority gets called.
The tunnel makes the whole app public, so anyone with the URL could start calls: keep
`DEMO_TARGET_NUMBER` set while it runs and stop the tunnel after the demo.
Use redacted/sample letters only; `data/` is gitignored.

## Appella UI

The UI uses Svelte 5 runes and Tailwind 4. SvelteKit 3 configuration is in `vite.config.ts`;
design tokens are in `src/app.css`. The original Stitch references are in `design:stitch/`.

- `/`: photograph or upload one or more JPEG, PNG or WebP pages, then analyze with the configured provider.
- `/letters/:id`: summary, deadlines, copyable references and payment details, server-backed checklist with Undo, original scans and call confirmation.
- `/calls/:id`: live SSE timeline, queue timer, human-answer alert and cancellation.
- `/archive`: bilingual search and filters, including completion from server-backed checklists.
- `/graph`: interactive document connections, plus keyboard-accessible document links.
  Disconnected groups are gently centered while keeping existing link distances and collision spacing.
- `/assistant`: chat about letters, deadlines and cases, with clickable references and Undo for edits.

English is the default; an explicitly saved DE/EN preference takes priority. The toggle changes the
interface and the language of **new** analyses. Stored letter text is not automatically
translated. PDFs and HEIC must first be exported as images. Web fonts are fetched from Google Fonts. With
the Gemini provider, letter images and analysis data are sent to Google for the requested analysis; with
Ollama they remain local. Sound/vibration support varies by browser, and the page must remain open for
alerts. Returning from analysis stops the browser's wait, not necessarily the provider request.
Double-tap zoom is disabled for the app's touch UI; pinch/browser zoom and the graph's explicit zoom controls
remain available. Phone inputs use at least 16px text to avoid iOS focus magnification.
Upload errors distinguish configuration, rate limits, invalid model responses and connectivity problems
without displaying raw provider messages. Selected pages stay available for retry; `Retry-After` is shown
when the service supplies it. Payment details must be checked against the original; Appella never initiates payment.
Analysis failures have a safe `code` and `request_id`; server logs include the matching reference and
numeric provider status, never raw provider bodies or letter contents. Temporary provider failures,
configuration errors, invalid output, timeouts and storage failures are handled separately. Provider requests
have a three-minute timeout; rate limits disable retry for the suggested wait instead of resubmitting automatically.

Resized upload pages are temporarily stored in **this tab's session storage**. After an unexpected reload,
the app restores the pages and explains that an interrupted analysis may already be in the archive. It never
automatically sends them again. A saved-result checkpoint lets you reopen the result if navigation fails.
The draft is cleared once that result loads successfully or you choose **Discard selected pages**; it is
isolated from demo captures. If browser storage is unavailable or the pages exceed its quota, a visible
warning explains that recovery is not guaranteed.
After selecting pages, the upload view focuses on previews, **Add a page**, and one **Explain** button.
Recent letters and the empty-upload prompt are hidden until you discard the pages. Routine privacy/recovery
information and technical error details are collapsed; failures show a short message with the relevant action.

### Preview without Ollama or telephony

With `pnpm dev`, open `http://localhost:5173/?demo=1`. The explicit demo banner and sample Finanzamt letter
use `src/lib/mock/analysis.json` and its English companion `analysis.en.json`; archive and graph previews
follow the selected language while keeping printed references and German call purposes intact. The demo call has
a state selector to preview every call view. Demo mode never starts a real call or silently replaces a failed API response.
It is disabled in production builds.
Preview checkmarks and call metadata are isolated from normal state. Leaving `?demo=1` resets page-local
preview state (including captures, analysis screens, search filters and graph selections).
The chat demo uses canned replies and local-only edits/Undo; it never calls the model or phone APIs,
and its conversation state is separate from normal chat.

### Validation

```bash
pnpm check
pnpm build
pnpm exec playwright install chromium --only-shell  # once, for browser tests
pnpm test
node scripts/check-backend.mjs                     # isolated fresh DB + mocked providers, no network
# Optional regression while the normal dev server is running (reads documents only):
APPELLA_LIVE_URL=http://localhost:5173 node scripts/check-backend.mjs
```

Browser tests mock the APIs, so they don't need Gemini or Ollama and cannot dial a real number. They cover upload,
language persistence, reference/payment copying, checklist saves/failures/Undo, demo-to-normal navigation,
localized upload errors, confirmation, call states, search and graph navigation,
and capture screenshots at 390px and laptop widths in the gitignored `test-results/` directory.
Backend checks use separate generated SvelteKit configuration and Vite caches in their own temporary
directory; they never rewrite the running app's generated environment or use its database.

`tests/agent-api.spec.ts` runs the server side of a call (outbound call, status webhook, transfer, voicemail,
busy line, hang-up) against a fake ElevenLabs and Twilio API on port 5199; `playwright.config.ts` points the
dev server there, overriding `.env`. If a `pnpm dev` with your real keys is already running, Playwright reuses
it and these tests skip themselves instead of calling ElevenLabs.
When Playwright starts its own server, generated configuration and Vite caches go into
`.svelte-kit/playwright/`, so mock phone credentials do not overwrite a separate running dev server's environment.

For just the next batch of GitHub issues, use `ONLY_ROUND2=1` with `scripts/create-issues.sh`.
The script is not run automatically.
