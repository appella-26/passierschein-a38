// src/lib/server/calls.ts
// In-memory call store + ElevenLabs outbound call + live status fan-out (SSE).
// No DB on purpose: restart = state gone, fine for a demo.
//
// Status comes from two places:
//  1. the agent's report_status tool (webhook → reportState), live, for menu / hold / human / voicemail;
//  2. polling the ElevenLabs conversation (trackConversation), for what the agent can't report:
//     transfer completed, call ended, busy / no answer — and as a backup if the webhook is unreachable.

import * as env from '$app/env/private';
import { randomUUID } from 'node:crypto';
import { getConversation, startOutboundCall } from '#lib/server/elevenlabs.ts';
import { isFinished, milestones, progressRank, terminalStates, type Milestone } from '#lib/server/call-progress.ts';

export type CallState =
	| 'dialing'
	| 'ivr'
	| 'on_hold'
	| 'human_detected'
	| 'transferring'
	| 'connected'
	| 'voicemail'
	| 'failed'
	| 'ended';

export interface CallEvent {
	state: CallState;
	note?: string;
	at: string; // ISO timestamp
}

export interface CallInput {
	toNumber: string; // E.164
	senderName: string;
	purpose: string; // German sentence, e.g. from call_purpose_de
	reference: string; // e.g. "Aktenzeichen 123/456"
	letterDate?: string;
}

export interface Call extends CallInput {
	id: string;
	conversationId?: string;
	callSid?: string;
	state: CallState;
	events: CallEvent[];
	startedAt: string;
	/** Highest progressRank reached; inferred milestones never go below it. */
	progress: number;
	poll?: ReturnType<typeof setTimeout>;
}

const calls = new Map<string, Call>();
const listeners = new Map<string, Set<(e: CallEvent) => void>>();

export const getCall = (id: string) => calls.get(id);

/** Finds a call by our id, or by the ElevenLabs conversation id as a fallback. */
export function findCall(callId: unknown, conversationId?: unknown): Call | undefined {
	if (typeof callId === 'string' && calls.has(callId)) return calls.get(callId);
	if (typeof conversationId !== 'string' || !conversationId) return undefined;
	return [...calls.values()].find((call) => call.conversationId === conversationId);
}

export function subscribe(id: string, fn: (e: CallEvent) => void): () => void {
	if (!listeners.has(id)) listeners.set(id, new Set());
	listeners.get(id)!.add(fn);
	return () => listeners.get(id)?.delete(fn);
}

const isTerminal = (state: CallState) => terminalStates.includes(state);

export function pushState(id: string, state: CallState, note?: string, at?: string) {
	const call = calls.get(id);
	if (!call) return false;
	// Nothing changes after the call is over; repeated reports ("on_hold" on every announcement) are dropped.
	if (isTerminal(call.state) || call.state === state) return true;
	// Keep the timeline in order: a time read from the transcript is only used if it fits.
	const now = new Date().toISOString();
	const last = call.events.at(-1)?.at ?? call.startedAt;
	const ev: CallEvent = { state, note, at: at && at > last && at < now ? at : now };
	call.state = state;
	call.progress = Math.max(call.progress, progressRank[state]);
	call.events.push(ev);
	listeners.get(id)?.forEach((fn) => fn(ev));
	if (isTerminal(state)) clearTimeout(call.poll);
	return true;
}

/** A state reported by the agent (report_status webhook). */
export function reportState(id: string, state: CallState, note?: string) {
	const call = calls.get(id);
	if (!call) return false;
	// After a transfer the agent has left the call, so a late webhook must not pull the UI back.
	if (call.state === 'connected') return true;
	return pushState(id, state, note);
}

/** A state read from the conversation: only applied if it moves the call forward. */
function advance(call: Call, milestone: Milestone) {
	if (progressRank[milestone.state] > call.progress) pushState(call.id, milestone.state, milestone.note, milestone.at);
}

// ---------- Configuration ----------

export class CallSetupError extends Error {
	constructor(public missing: string[]) {
		super(`ElevenLabs is not configured. Set ${missing.join(', ')} in .env and restart the app.`);
	}
}

export function missingConfig(): string[] {
	const required = ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_PHONE_NUMBER_ID'] as const;
	return required.filter((key) => !env[key]);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------- ElevenLabs outbound call (native Twilio integration) ----------

export async function startCall(input: CallInput): Promise<Call> {
	const missing = missingConfig();
	if (missing.length) throw new CallSetupError(missing);

	const id = randomUUID().slice(0, 8);
	const now = new Date().toISOString();
	const call: Call = { id, ...input, state: 'dialing', events: [{ state: 'dialing', at: now }], startedAt: now, progress: 0 };
	calls.set(id, call);

	// DEMO_TARGET_NUMBER lets you force every call to your mock hotline, whatever the letter says.
	const to = env.DEMO_TARGET_NUMBER || input.toNumber;
	const language = env.AGENT_LANGUAGE;

	try {
		const data = await startOutboundCall({
			agent_id: env.ELEVENLABS_AGENT_ID,
			agent_phone_number_id: env.ELEVENLABS_PHONE_NUMBER_ID,
			to_number: to,
			conversation_initiation_client_data: {
				dynamic_variables: {
					call_id: id,
					user_name: env.USER_DISPLAY_NAME,
					sender_name: input.senderName,
					purpose: input.purpose,
					reference: input.reference || 'keine Angabe',
					letter_date: input.letterDate ?? '',
					// The report_status tool sends this as its x-webhook-secret header.
					// secret__ variables are never shown to the LLM.
					secret__webhook_secret: env.WEBHOOK_SECRET || 'not-set'
				},
				// Authorities answer in German; the agent's language detection can still switch.
				...(language ? { conversation_config_override: { agent: { language } } } : {})
			}
		});
		if (data.success === false || !data.conversation_id) {
			pushState(id, 'failed', data.message || 'ElevenLabs did not start the call');
			return call;
		}
		call.conversationId = data.conversation_id;
		call.callSid = data.callSid ?? undefined;
		trackConversation(call);
	} catch (err) {
		pushState(id, 'failed', message(err));
	}
	return call;
}

// ---------- Conversation tracking ----------

const MAX_TRACKING_MS = 3 * 60 * 60 * 1000;

function trackConversation(call: Call) {
	const conversationId = call.conversationId;
	if (!conversationId) return;
	const applied = new Set<string>();
	const started = Date.now();
	let failures = 0;

	const tick = async () => {
		if (calls.get(call.id) !== call || isTerminal(call.state)) return;
		try {
			const conversation = await getConversation(conversationId);
			failures = 0;
			call.callSid ??= conversation.metadata?.phone_call?.call_sid;
			for (const milestone of milestones(conversation)) {
				if (applied.has(milestone.key)) continue;
				applied.add(milestone.key);
				advance(call, milestone);
			}
			if (isFinished(conversation)) return;
		} catch (err) {
			failures++;
			if (failures === 1 || failures % 10 === 0) console.warn(`[call ${call.id}] status check failed (${failures}x): ${message(err)}`);
		}
		if (isTerminal(call.state) || Date.now() - started > MAX_TRACKING_MS) return;
		// Back off while ElevenLabs is unreachable, so a flaky network doesn't spam the API.
		call.poll = setTimeout(tick, Math.min(env.CALL_POLL_MS * 2 ** Math.min(failures, 4), 30_000));
	};
	call.poll = setTimeout(tick, env.CALL_POLL_MS);
}

// ---------- Hang up ----------

/** Hang up via Twilio (the user pressed "cancel"). */
export async function cancelCall(id: string): Promise<{ ok: boolean; error?: string }> {
	const call = calls.get(id);
	if (!call) return { ok: false, error: 'Unknown call' };
	if (isTerminal(call.state)) return { ok: true };
	const sid = env.TWILIO_ACCOUNT_SID;
	if (!sid || !env.TWILIO_AUTH_TOKEN) return { ok: false, error: 'Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env to hang up from the app' };
	if (!call.callSid) return { ok: false, error: 'The call has not reached Twilio yet, try again in a moment' };

	const url = `${env.TWILIO_API_URL.replace(/\/+$/, '')}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls/${encodeURIComponent(call.callSid)}.json`;
	const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
	const update = async (status: 'completed' | 'canceled') => {
		const res = await fetch(url, {
			method: 'POST',
			headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ Status: status }),
			signal: AbortSignal.timeout(15_000)
		});
		const data = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
		if (!res.ok) throw new Error(data?.message ?? `Twilio ${res.status}`);
		return data?.status;
	};

	try {
		// "completed" ends a call in progress; a call that is still queued or ringing needs "canceled".
		const status = await update('completed');
		if (status === 'queued' || status === 'ringing') await update('canceled');
	} catch (err) {
		console.warn(`[call ${id}] hang-up failed: ${message(err)}`);
		return { ok: false, error: message(err) };
	}
	pushState(id, 'ended', 'Cancelled by user');
	return { ok: true };
}
