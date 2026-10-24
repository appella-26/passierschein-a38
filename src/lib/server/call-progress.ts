// src/lib/server/call-progress.ts
// Reads an ElevenLabs conversation and derives the call steps the UI shows.
// The agent reports most steps live via report_status; this fills the gaps it can't report
// (transfer finished, call ended, busy/no answer) and backs up the webhook if the tunnel drops.

import type { CallState } from '#lib/server/calls.ts';
import type { Conversation, ToolResult } from '#lib/server/elevenlabs.ts';

export interface Milestone {
	key: string; // stable per conversation, so each milestone is applied once
	state: CallState;
	note?: string;
	at?: string; // when it happened, if the transcript says
}

/** How far a call has got. Inferred milestones only ever move a call forward on this scale. */
export const progressRank: Record<CallState, number> = {
	dialing: 0,
	ivr: 1,
	on_hold: 2,
	human_detected: 3,
	transferring: 4,
	connected: 5,
	voicemail: 5,
	failed: 6,
	ended: 6
};

export const terminalStates: CallState[] = ['failed', 'ended'];

const aliases: Record<string, CallState> = {
	ivr: 'ivr',
	menu: 'ivr',
	phone_menu: 'ivr',
	on_hold: 'on_hold',
	hold: 'on_hold',
	onhold: 'on_hold',
	queue: 'on_hold',
	human_detected: 'human_detected',
	human: 'human_detected',
	human_answered: 'human_detected',
	transferring: 'transferring',
	transfer: 'transferring',
	connected: 'connected',
	voicemail: 'voicemail',
	mailbox: 'voicemail',
	answering_machine: 'voicemail',
	failed: 'failed',
	error: 'failed',
	ended: 'ended',
	completed: 'ended'
};

/** Accepts the agent's state values, forgiving case, spaces and hyphens ("On Hold" → on_hold). */
export function normalizeState(value: unknown): CallState | null {
	if (typeof value !== 'string') return null;
	return aliases[value.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null;
}

export const isFinished = (conversation: Conversation) =>
	conversation.status === 'processing' || conversation.status === 'done' || conversation.status === 'failed';

const parse = (json: string | undefined): Record<string, unknown> | null => {
	try {
		const value = JSON.parse(json ?? '');
		return value && typeof value === 'object' ? value : null;
	} catch {
		return null;
	}
};

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : undefined);

function failed(result: ToolResult): boolean {
	if (result.is_error) return true;
	const detail = `${result.result?.result_type ?? ''} ${result.result?.status ?? ''}`;
	return /error|fail/i.test(detail);
}

/** All milestones visible in the conversation so far, in transcript order. */
export function milestones(conversation: Conversation): Milestone[] {
	const start = conversation.metadata?.start_time_unix_secs;
	const at = (seconds?: number) =>
		start && typeof seconds === 'number' && Number.isFinite(seconds) ? new Date((start + seconds) * 1000).toISOString() : undefined;
	const transcript = conversation.transcript ?? [];
	const results = new Map<string, ToolResult>();
	for (const turn of transcript) for (const result of turn.tool_results ?? []) results.set(result.request_id, result);

	const out: Milestone[] = [];
	let transferred = false;
	let voicemail = false;
	for (const turn of transcript) {
		for (const call of turn.tool_calls ?? []) {
			const key = `tool:${call.request_id}`;
			const when = at(turn.time_in_call_secs);
			if (call.tool_name === 'report_status') {
				const params = parse(call.params_as_json);
				const state = normalizeState(params?.state);
				if (state) out.push({ key, state, note: text(params?.note), at: when });
			} else if (call.tool_name === 'play_keypad_touch_tone') {
				out.push({ key, state: 'ivr', at: when });
			} else if (call.tool_name === 'voicemail_detection') {
				voicemail = true;
				out.push({ key, state: 'voicemail', at: when });
			} else if (call.tool_name === 'transfer_to_number') {
				const result = results.get(call.request_id);
				if (result && failed(result)) continue; // the transfer didn't go through; the agent carries on
				transferred = true;
				out.push({ key, state: 'transferring', at: when });
			}
		}
	}

	if (!isFinished(conversation)) return out;

	// The call is over. After a successful conference transfer the agent leaves and the user
	// keeps talking to the person, so "connected" is the end state rather than "ended".
	const meta = conversation.metadata ?? {};
	const result = meta.phone_call?.call_result;
	const reason = text(meta.error?.reason) ?? text(meta.termination_reason);
	if (transferred) out.push({ key: 'end', state: 'connected' });
	else if (result === 'busy') out.push({ key: 'end', state: 'failed', note: 'Line busy' });
	else if (result === 'no_answer') out.push({ key: 'end', state: 'failed', note: 'No answer' });
	else if (result === 'failed' || conversation.status === 'failed') out.push({ key: 'end', state: 'failed', note: reason ?? 'Call failed' });
	else {
		if (voicemail || result === 'voicemail') out.push({ key: 'end:voicemail', state: 'voicemail' });
		out.push({ key: 'end', state: 'ended', note: reason });
	}
	return out;
}
