// POST /api/agent/status   <- called by the agent's `report_status` webhook tool
// Body: { call_id: "{{call_id}}", state: "ivr" | "on_hold" | "human_detected" | "voicemail" | "failed", note?: "..." }
// Header: x-webhook-secret (the tool fills it from the secret__webhook_secret dynamic variable)
import { json, error } from '@sveltejs/kit';
import * as env from '$app/env/private';
import { createHash, timingSafeEqual } from 'node:crypto';
import { findCall, reportState } from '#lib/server/calls.ts';
import { normalizeState } from '#lib/server/call-progress.ts';

const digest = (value: string) => createHash('sha256').update(value).digest();
const secretMatches = (given: string | null) =>
	!env.WEBHOOK_SECRET || (given !== null && timingSafeEqual(digest(given), digest(env.WEBHOOK_SECRET)));

export async function POST({ request }) {
	if (!secretMatches(request.headers.get('x-webhook-secret'))) error(401, 'Bad webhook secret');
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON body');
	const { call_id, conversation_id, state, note } = body as Record<string, unknown>;
	console.log('[agent]', call_id ?? conversation_id, state, note ?? '');

	const normalized = normalizeState(state);
	if (!normalized) error(400, `Unknown state ${String(state)}`);
	const call = findCall(call_id, conversation_id);
	if (!call) error(404, 'Unknown call');
	reportState(call.id, normalized, typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : undefined);
	// The agent doesn't wait for this response; keep it short anyway.
	return json({ ok: true });
}
