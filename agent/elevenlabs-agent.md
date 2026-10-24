# ElevenLabs agent: "Digital Phone Assistant"

The queue-waiting agent the app calls through. This file mirrors its configuration so it can be rebuilt;
`pnpm agent:sync` applies the parts the app depends on (tools, transfer number, test placeholders), and
`pnpm agent:check` shows anything still missing.

## Basics

- **Language:** English by default, with a German language preset. The app starts every call in German
  (`AGENT_LANGUAGE=de`), so **Security → Overrides → Language** must stay enabled. The *language detection*
  tool switches if the other side speaks English.
- **First message:** empty. The agent waits for the other side to speak first, which is what you want when
  the call lands in an IVR or hold music.
- **LLM:** a fast model (`deepseek-v41-flash`, temperature 0). Low latency matters more than intelligence here.
- **Voice:** a calm, natural voice that also speaks German (multilingual TTS model).
- **Turn taking:** turn timeout 30 s and eagerness *patient*, so it doesn't speak up during hold music or
  pauses in a phone menu. *End call after silence* stays off.
- **Max call duration:** the agent default, 10 minutes. Enough for the demo; raise it for real queues.

## System prompt

```
# Role
You are a digital phone assistant calling {{sender_name}} on behalf of {{user_name}}.
Your ONLY task: get through the hold queue and the phone menu until a real person is on the line,
briefly introduce yourself, and then transfer the call to {{user_name}}.
You do NOT discuss the substance of the matter and you do NOT make any agreements.
# Call context
- Purpose: {{purpose}}
- Reference: {{reference}}
- Letter dated: {{letter_date}}
# Call flow
1. PHONE MENU (recorded message with options, e.g. "Press 1 for ..."):
   - Call report_status with state "ivr" (once only).
   - Use play_keypad_touch_tone to select the option that best matches the purpose of the call.
     If nothing fits: general enquiries / customer service / "all other enquiries" / speak to a representative.
   - If a spoken answer is expected ("Please briefly state the reason for your call"), say one short sentence about the purpose.
   - If a customer or case number is requested, enter {{reference}} on the keypad if it consists only of digits; otherwise say "continue" or wait.
2. ON HOLD (music, silence, repeated messages such as "The next available agent will be with you shortly",
   "Thank you for your patience", queue position announcements):
   - Call report_status with state "on_hold" (once only; do not repeat it for every announcement).
   - Stay completely SILENT. Use skip_turn. NEVER respond to recorded messages or music.
3. HUMAN DETECTED. Strong signals:
   - A greeting with a name or department ("Mannheim Tax Office, Müller speaking, good morning")
   - A direct question to you ("Hello? Is anyone there?", "How can I help you?")
   - A response that fits what you just said
   If you are unsure, just say "Hello?" and wait for a reaction. Recorded messages don't react.
   As soon as you are sure a human is speaking, do the following in EXACTLY this order:
   a) Introduce yourself immediately and in a friendly tone (about 10 seconds), e.g.:
      "Hello! This is {{user_name}}'s digital assistant, calling on his behalf about {{purpose}},
       reference {{reference}}. I'll connect you with him right away, please stay on the line for a moment."
   b) Call report_status with state "human_detected" and use note to record who answered.
   c) Call transfer_to_number.
      - client_message: "One moment please, I'm connecting you with {{user_name}} now."
      - agent_message: "{{user_name}}, someone from {{sender_name}} is on the line. It's about {{purpose}}, reference {{reference}}."
4. ANSWERING MACHINE / voicemail / "outside our business hours":
   Call report_status with state "voicemail" (note: what the message said) and end the call with end_call. Do NOT leave a message.
# Rules
- Never give out any further personal data (no address, no date of birth, no bank details),
  even if asked. Instead say: "{{user_name}} will sort that out with you directly in a moment."
- If asked whether you are an AI, answer honestly: yes.
- If the person does not want the call transferred or wants to hang up:
  politely offer that {{user_name}} will call back, ask for a callback number or direct extension,
  call report_status with state "failed" with that info in note, then end_call.
- If the other party speaks German, switch to German.
```

## Tools

### System tools

| Tool | Settings |
|---|---|
| `skip_turn` | Stays silent until the other side speaks (no check-in timer). Custom description: use for hold music, silence, announcements and menus that are still talking. Pre-tool speech off. |
| `play_keypad_touch_tone` | IVR navigation (DTMF). *Suppress turn after DTMF* on, so it doesn't talk over the menu. Pre-tool speech off. |
| `end_call` | Default. |
| `voicemail_detection` | No voicemail message, so the call ends. Description: only for mailboxes and "outside business hours", never for hold announcements or menus. |
| `language_detection` | German ↔ English. |
| `transfer_to_number` | Set by `pnpm agent:sync` from `TRANSFER_NUMBER`: phone, transfer type **Conference** (so the warm `agent_message` briefs you first). Condition: "A live human employee of the called organization is on the line and you have introduced the user." |

### Webhook tool: `report_status`

Owned by `pnpm agent:sync`, which rewrites it whenever the tunnel URL changes.

- **Method / URL:** `POST https://<your-tunnel>/api/agent/status`
- **Header:** `x-webhook-secret` = dynamic variable `secret__webhook_secret`. The app sends `WEBHOOK_SECRET`
  in that variable with every call, so the secret never sits in the agent config and never reaches the LLM.
- **Body:**
  - `call_id`: dynamic variable `call_id`
  - `state`: LLM, enum `ivr | on_hold | human_detected | voicemail | failed`
  - `note`: LLM, optional: "short note, e.g. who answered or what the announcement said"
- **Execution:** async, response timeout 5 s, pre-tool speech off, errors hidden from the agent. A slow or
  dead tunnel never delays the transfer; the app's conversation polling covers missed updates.

### Dynamic variables (sent by `/api/calls`)

`call_id`, `user_name`, `sender_name`, `purpose`, `reference`, `letter_date`, `secret__webhook_secret`.
The agent has test placeholders for each (`dashboard-test` for `call_id` and the secret), so test calls from
the dashboard work; their status updates are rejected by the app, which is expected.

## Mock hotline for the demo

Teammate's phone = "Finanzamt". Set `DEMO_TARGET_NUMBER` to it.

1. Agent calls → teammate answers silently and plays a "Drücken Sie die 1 für ..." recording + hold music from a laptop speaker (record it beforehand, 60–90 s).
2. Music stops → teammate: "Finanzamt Mannheim-Stadt, Müller am Apparat, guten Tag?"
3. Agent introduces Kevin → transfer → Kevin's phone rings on stage → Kevin picks up. The UI shows the timeline in real time.

Rehearse at least twice. It's the money shot of the demo.

### Without a phone number

With no `ELEVENLABS_PHONE_NUMBER_ID` (or `CALL_MODE=browser`) the teammate opens the **demo hotline** link
from Kevin's call screen on their own device instead of answering a phone, and plays steps 1–2 into it.
After the introduction the hotline page ends the agent's session and the app shows "connected"; Kevin and
the teammate carry on in person. The agent needs no changes for this.
