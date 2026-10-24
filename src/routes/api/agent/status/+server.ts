// POST /api/agent/status   <- called by the agent's `report_status` webhook tool
// Body: { call_id: "{{call_id}}", state: "ivr" | "on_hold" | "human_detected" | "voicemail" | "failed", note?: "..." }
// Header: x-webhook-secret (the tool fills it from the secret__webhook_secret dynamic variable):
// WEBHOOK_SECRET, or for a browser hotline call that call's own token.
import { json, error } from '@sveltejs/kit';
import * as env from '$app/env/private';
import { createHash, timingSafeEqual } from 'node:crypto';
import { findCall, reportState } from '#lib/server/calls.ts';
import { normalizeState } from '#lib/server/call-progress.ts';

const digest = (value: string) => createHash('sha256').update(value).digest();
const same = (given: string | null, expected: string) => given !== null && timingSafeEqual(digest(given), digest(expected));

export async function POST({ request }) {
	const given = request.headers.get('x-webhook-secret');
	const body = await request.json().catch(() => null);
	const { call_id, conversation_id, state, note } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
	const call = findCall(call_id, conversation_id);
	const authorized = !env.WEBHOOK_SECRET || same(given, env.WEBHOOK_SECRET) || (call?.webhookToken !== undefined && same(given, call.webhookToken));
	if (!authorized) error(401, 'Bad webhook secret');
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON body');
	console.log('[agent]', call_id ?? conversation_id, state, note ?? '');

	const normalized = normalizeState(state);
	if (!normalized) error(400, `Unknown state ${String(state)}`);
	if (!call) error(404, 'Unknown call');
	reportState(call.id, normalized, typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : undefined);
	// The agent doesn't wait for this response; keep it short anyway.
	return json({ ok: true });
}
