// src/lib/server/call-progress.ts
// Reads an ElevenLabs conversation and derives the call steps the UI shows.
// The agent reports most steps live via report_status; this fills the gaps it can't report
// (transfer finished, call ended, busy/no answer) and backs up the webhook if the tunnel drops.

import type { CallState } from '#lib/server/calls.ts';
import type { Conversation, ToolCall, ToolResult } from '#lib/server/elevenlabs.ts';

/** A step the transcript shows, in the order it happened. */
export interface Step {
	key: string; // stable per conversation, so each step is applied once
	state: CallState;
	note?: string;
	at?: string; // when it happened, from the transcript
	/** A report_status call the platform executed, i.e. one that was also sent to the webhook. */
	report: boolean;
}

export interface Progress {
	steps: Step[];
	/** Number of executed report_status calls, to match against the webhooks received. */
	reports: number;
	/** How the call ended; empty while it is still running. */
	ending: { state: CallState; note?: string }[];
}

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
	if (result.is_error || result.tool_has_been_called === false) return true;
	return /error|fail/i.test(`${result.result?.result_type ?? ''} ${result.result?.status ?? ''}`);
}

/** Only a transfer the platform ran and reported as successful counts as connected. */
function transferSucceeded(call: ToolCall, result: ToolResult | undefined): boolean {
	if (!result || call.tool_has_been_called === false || failed(result)) return false;
	const { status, result_type } = result.result ?? {};
	// System tools report e.g. { result_type: "transfer_to_number_twilio_success", status: "success" }.
	if (status !== undefined || result_type !== undefined) return status === 'success' || /success/i.test(String(result_type ?? ''));
	return result.is_error === false;
}

/** Everything the conversation shows so far: steps in transcript order and, once over, how it ended. */
export function readProgress(conversation: Conversation): Progress {
	const start = conversation.metadata?.start_time_unix_secs;
	const at = (seconds?: number) =>
		start && typeof seconds === 'number' && Number.isFinite(seconds) ? new Date((start + seconds) * 1000).toISOString() : undefined;
	const transcript = conversation.transcript ?? [];
	const results = new Map<string, ToolResult>();
	for (const turn of transcript) for (const result of turn.tool_results ?? []) results.set(result.request_id, result);

	const steps: Step[] = [];
	let reports = 0;
	let transferred = false;
	let voicemail = false;
	for (const turn of transcript) {
		for (const call of turn.tool_calls ?? []) {
			const key = `tool:${call.request_id}`;
			const when = at(turn.time_in_call_secs);
			const ran = call.tool_has_been_called !== false;
			const result = results.get(call.request_id);
			if (call.tool_name === 'report_status') {
				const params = parse(call.params_as_json);
				const state = normalizeState(params?.state);
				if (!state) continue; // the webhook rejects these too, so they aren't counted on either side
				if (ran) reports++;
				steps.push({ key, state, note: text(params?.note), at: when, report: ran });
			} else if (!ran) {
				continue; // requested by the model but never executed
			} else if (call.tool_name === 'play_keypad_touch_tone') {
				steps.push({ key, state: 'ivr', at: when, report: false });
			} else if (call.tool_name === 'voicemail_detection') {
				voicemail = true;
				steps.push({ key, state: 'voicemail', at: when, report: false });
			} else if (call.tool_name === 'transfer_to_number') {
				if (result && failed(result)) continue; // the transfer didn't go through; the agent carries on
				steps.push({ key, state: 'transferring', at: when, report: false });
				transferred ||= transferSucceeded(call, result);
			}
		}
	}
	if (!isFinished(conversation)) return { steps, reports, ending: [] };

	// Provider failures come first: a transfer attempt on a call that failed is not a connection.
	// After a confirmed conference transfer the agent leaves and the user keeps talking to the
	// person, so "connected" is the end state rather than "ended".
	const meta = conversation.metadata ?? {};
	const outcome = meta.phone_call?.call_result;
	const reason = text(meta.error?.reason) ?? text(meta.termination_reason);
	let ending: Progress['ending'];
	if (outcome === 'busy') ending = [{ state: 'failed', note: 'Line busy' }];
	else if (outcome === 'no_answer') ending = [{ state: 'failed', note: 'No answer' }];
	else if (outcome === 'failed' || conversation.status === 'failed') ending = [{ state: 'failed', note: reason ?? 'Call failed' }];
	else if (transferred) ending = [{ state: 'connected' }];
	else if (voicemail || outcome === 'voicemail') ending = [{ state: 'voicemail' }, { state: 'ended', note: reason }];
	else ending = [{ state: 'ended', note: reason }];
	return { steps, reports, ending };
}
