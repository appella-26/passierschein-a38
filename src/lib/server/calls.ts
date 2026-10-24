// src/lib/server/calls.ts
// In-memory call store + ElevenLabs outbound call + live status fan-out (SSE).
// No DB on purpose: restart = state gone, fine for a demo.

import * as env from '$app/env/private';
import { randomUUID } from 'node:crypto';

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

export interface Call {
	id: string;
	toNumber: string;
	senderName: string;
	purpose: string;
	reference: string;
	conversationId?: string;
	callSid?: string;
	state: CallState;
	events: CallEvent[];
	startedAt: string;
}

const calls = new Map<string, Call>();
const listeners = new Map<string, Set<(e: CallEvent) => void>>();

export const getCall = (id: string) => calls.get(id);

export function subscribe(id: string, fn: (e: CallEvent) => void): () => void {
	if (!listeners.has(id)) listeners.set(id, new Set());
	listeners.get(id)!.add(fn);
	return () => listeners.get(id)?.delete(fn);
}

export function pushState(id: string, state: CallState, note?: string) {
	const call = calls.get(id);
	if (!call) return false;
	// Ignore duplicate "on_hold" reports from the agent so the timeline stays clean.
	if (call.state === state && state === 'on_hold') return true;
	const ev: CallEvent = { state, note, at: new Date().toISOString() };
	call.state = state;
	call.events.push(ev);
	listeners.get(id)?.forEach((fn) => fn(ev));
	return true;
}

// ---------- ElevenLabs outbound call (native Twilio integration) ----------

export async function startCall(input: {
	toNumber: string; // E.164
	senderName: string;
	purpose: string; // German sentence, e.g. from call_purpose_de
	reference: string; // e.g. "Aktenzeichen 123/456"
	letterDate?: string;
}): Promise<Call> {
	const id = randomUUID().slice(0, 8);
	const call: Call = {
		id,
		...input,
		state: 'dialing',
		events: [{ state: 'dialing', at: new Date().toISOString() }],
		startedAt: new Date().toISOString()
	};
	calls.set(id, call);

	// DEMO_TARGET_NUMBER lets you force every call to your mock hotline, whatever the letter says.
	const to = env.DEMO_TARGET_NUMBER || input.toNumber;

	const res = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
		method: 'POST',
		headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			agent_id: env.ELEVENLABS_AGENT_ID,
			agent_phone_number_id: env.ELEVENLABS_PHONE_NUMBER_ID,
			to_number: to,
			conversation_initiation_client_data: {
				dynamic_variables: {
					call_id: id,
					user_name: env.USER_DISPLAY_NAME ?? 'Kevin',
					sender_name: input.senderName,
					purpose: input.purpose,
					reference: input.reference || 'keine Angabe',
					letter_date: input.letterDate ?? ''
				}
			}
		})
	});

	const data = await res.json().catch(() => ({}));
	if (!res.ok || data.success === false) {
		pushState(id, 'failed', data.message ?? `ElevenLabs ${res.status}`);
		return call;
	}
	call.conversationId = data.conversation_id;
	call.callSid = data.callSid ?? data.call_sid;
	return call;
}

/** Hang up via Twilio (the user pressed "cancel"). */
export async function cancelCall(id: string) {
	const call = calls.get(id);
	if (!call?.callSid) return false;
	const sid = env.TWILIO_ACCOUNT_SID!;
	const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
	await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${call.callSid}.json`, {
		method: 'POST',
		headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ Status: 'completed' })
	});
	pushState(id, 'ended', 'Cancelled by user');
	return true;
}
