#!/usr/bin/env bash
# Creates labels + all hackathon issues and adds them to a GitHub Project.
#
# Prereqs:
#   gh auth login
#   gh auth refresh -s project          # needed for --project
#   Create the Project in the GitHub UI first (Board view), then:
#
# Usage:
#   REPO=owner/repo PROJECT="Hacktoberfest" \
#   A=gh-handle-frontend B=gh-handle-gemma C=gh-handle-voice D=gh-handle-glue \
#   ./scripts/create-issues.sh
set -euo pipefail

: "${REPO:?set REPO=owner/repo}"
: "${PROJECT:?set PROJECT=<project title>}"
A="${A:-}"; B="${B:-}"; C="${C:-}"; D="${D:-}"

label() { gh label create "$1" --repo "$REPO" --color "$2" --force >/dev/null; }
label setup     "6e7781"
label contract  "8250df"
label gemma     "1f883d"
label ui        "0969da"
label voice     "bf3989"
label api       "d4a72c"
label demo      "fb8f44"
label kg        "0e8a16"
label stretch   "afb8c1"
label "P0"      "cf222e"
label "P1"      "fb8500"

issue() { # title, labels, assignee, body
  local args=(--repo "$REPO" --title "$1" --label "$2" --project "$PROJECT" --body "$4")
  [[ -n "$3" ]] && args+=(--assignee "$3")
  gh issue create "${args[@]}"
}

# ---------------- Phase 0: setup (0:00–0:30) ----------------
issue "[setup] Repo, SvelteKit scaffold, env, tunnel" "setup,P0" "$D" "- \`npx sv create app --template minimal --types ts\` (SvelteKit 3), copy starter \`src/\`, \`agent/\`, \`scripts/\` in
- \`pnpm add better-sqlite3\` · add \`data/\` + \`.env\` to .gitignore
- \`.env\` from \`.env.example\`
- \`cloudflared tunnel --url http://localhost:5173\` → put URL in agent webhook
**Done when:** everyone can run the app and the tunnel URL reaches \`/api/agent/status\`."

issue "[setup] Ollama + Gemma 4 model decision on a real letter" "setup,gemma,P0" "$B" "- \`ollama pull gemma4:26b\` and \`gemma4:31b\`
- Run one real German letter photo through both, compare reading of numbers/dates
**Done when:** model chosen, latency per letter noted (target < 30 s)."

issue "[setup] ElevenLabs agent + Twilio number, first test call" "setup,voice,P0" "$C" "- Twilio account, buy a number (non-DE is faster) or verify caller ID
- Import via native Twilio integration in ElevenLabs
- Create agent from \`agent/elevenlabs-agent.md\`
**Done when:** agent calls your own phone from the dashboard."

issue "[contract] Analysis JSON schema + mock fixture" "contract,P0" "$B" "- Types in \`src/lib/server/analyze.ts\`
- Add \`src/lib/mock/analysis.json\` (realistic Finanzamt letter) so UI can build without Gemma
**Done when:** fixture committed, team agreed on fields."

# ---------------- Phase 1: build (0:30–2:30) ----------------
issue "[gemma] /api/analyze with Ollama structured output" "gemma,api,P0" "$B" "- Accept base64 images + lang, call Ollama \`/api/chat\` with \`format\` schema
- Normalize phone numbers to E.164
**Done when:** curl with a test image returns valid Analysis JSON."

issue "[gemma] Prompt tuning on 3–4 sample letters" "gemma,P1" "$B" "- Finanzamt Bescheid, Krankenkasse, Mahnung, Rundfunkbeitrag
- Check: no invented phone numbers, deadlines correct, summary in DE and EN
**Done when:** all samples produce correct deadline + action items."

issue "[ui] Upload screen (camera, multi-page, loading)" "ui,P0" "$A" "- \`<input type=file accept=image/* capture=environment multiple>\`
- Resize client-side with \`src/lib/resize.ts\`, POST to \`/api/analyze\`
- Loading state with friendly copy (Gemma takes a few seconds)"

issue "[ui] Result screen: summary, deadline, urgency, action items" "ui,P0" "$A" "- Deadline countdown badge (+ 'estimated' hint), urgency color
- Action item checklist; 'Wait in queue for me' button on call items
**Done when:** renders the mock fixture nicely on a phone-width screen."

issue "[ui] DE/EN language toggle" "ui,P1" "$A" "- Simple dictionary object for UI strings, toggle stored in localStorage
- Lang is sent to /api/analyze so Gemma answers in that language"

issue "[ui] Confirm-call dialog" "ui,P0" "$A" "- Editable number (show phone_raw + E.164), purpose (call_purpose_de), reference
- Clear note: 'An AI assistant will wait in the queue and connect you'
- POST /api/calls"

issue "[voice] Agent prompt: IVR → hold → human → intro → transfer" "voice,P0" "$C" "- From \`agent/elevenlabs-agent.md\`
- Test with teammate playing hold music, then answering
**Done when:** agent stays silent during music and transfers on a real 'Hallo'."

issue "[voice] System tools + timeouts" "voice,P0" "$C" "- skip_turn, DTMF, voicemail detection, end_call, language detection
- transfer_to_number (conference) to presenter's mobile
- Raise max duration + silence timeout"

issue "[voice] Server tool report_status → webhook" "voice,api,P0" "$C" "- POST tunnel/api/agent/status, header x-webhook-secret
- call_id as dynamic variable, state enum
**Done when:** states show up in server log during a test call."

issue "[api] /api/calls: start outbound call with dynamic variables" "api,P0" "$D" "- \`startCall()\` in \`src/lib/server/calls.ts\`
- DEMO_TARGET_NUMBER override for the mock hotline"

issue "[api] Webhook + in-memory store + SSE endpoint" "api,P0" "$D" "- \`/api/agent/status\` → pushState → \`/api/calls/:id/events\`
**Done when:** curl to webhook updates an open EventSource in the browser."

issue "[kg] Persist photos + analysis in SQLite, build graph edges" "kg,api,P0" "$B" "- \`pnpm add better-sqlite3\`, \`ollama pull embeddinggemma\`
- \`saveDocument()\` in \`src/lib/server/db.ts\` is called from /api/analyze
- Add \`data/\` to .gitignore (real letters must never be committed!)
**Done when:** analyzing 2 letters from the same sender creates 1 shared organization node."

issue "[kg] Hybrid search endpoint (FTS5 + embeddings)" "kg,api,P0" "$B" "- GET /api/documents?q=...
- Test bilingual: searching 'tax' must find a German Steuerbescheid
**Done when:** 3 test queries return the expected letter first."

issue "[ui] Archive screen: list + search + document detail" "ui,kg,P0" "$A" "- List of stored letters (urgency dot, sender, date), search box with debounce
- Detail: original photo(s) via /api/documents/:id/pages/:n, analysis, 'Related letters' with shared reason
- Result screen after upload also shows 'related' (e.g. 'You got a letter with the same Aktenzeichen on 03.09.')"

issue "[ui] Knowledge graph view" "ui,kg,P1" "$D" "- \`pnpm add force-graph\`, render GET /api/graph
- Color by kind (document / organization / reference / person / topic), click document → detail
- Good demo moment, but after the call flow works"

# ---------------- Phase 2: integrate (2:30–3:45) ----------------
issue "[ui] Live call view + browser notification + sound" "ui,P0" "$A" "- Timeline: Dialing → Menu → On hold (timer) → Human! → Ringing your phone
- Notification API + sound on human_detected
- Cancel button → /api/calls/:id/cancel"

issue "[api] End-to-end integration run" "api,P0" "$D" "Photo → analysis → call button → mock hotline → transfer → phone rings. Fix whatever breaks.
**Feature freeze at 3:45.**"

# ---------------- Phase 3: demo (3:45–5:00) ----------------
issue "[demo] Mock hotline: recording + script" "demo,P0" "$C" "- Record IVR + 60–90 s hold music
- Teammate script for 'Finanzamt Müller'
- 2 full dry runs"

issue "[demo] Sample letters + pitch (problem, privacy story, live demo)" "demo,P0" "$D" "- Printed sample letters (redact real data!)
- 3 slides max: problem, how (local Gemma = letter never leaves laptop), live demo
- Backup screen recording in case telephony fails on stage"

# ---------------- Stretch ----------------
issue "[stretch] Add deadline to calendar (.ics download)" "stretch" "" "Generate an .ics from deadline + title in the browser."
issue "[stretch] Letter history in localStorage" "stretch" "" "List past analyses, reopen result screen."
issue "[stretch] Callback handling when user misses the transfer" "stretch" "" "Agent asks for a direct extension / callback slot and reports it via report_status note."

echo "Done. Open the project board: gh project list --owner ${REPO%%/*}"
