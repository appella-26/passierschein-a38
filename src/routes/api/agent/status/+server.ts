// POST /api/agent/status   <- called by the ElevenLabs server tool `report_status`
// Body (configured in the tool): { call_id: "{{call_id}}", state: "...", note: "..." }
// Header: x-webhook-secret: <WEBHOOK_SECRET>
import { json, error } from '@sveltejs/kit';
import * as env from '$app/env/private';
import { pushState, type CallState } from '#lib/server/calls.ts';

const allowed: CallState[] = ['ivr', 'on_hold', 'human_detected', 'transferring', 'voicemail', 'failed', 'ended'];

export async function POST({ request }) {
	if (env.WEBHOOK_SECRET && request.headers.get('x-webhook-secret') !== env.WEBHOOK_SECRET) error(401);
	const { call_id, state, note } = await request.json();
	console.log('[agent]', call_id, state, note ?? '');
	if (!allowed.includes(state)) error(400, `Unknown state ${state}`);
	if (!pushState(call_id, state, note)) error(404, 'Unknown call');
	// The agent reads this response; keep it short.
	return json({ ok: true });
}
