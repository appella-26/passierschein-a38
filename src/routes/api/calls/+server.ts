// POST /api/calls  { toNumber, senderName, purpose, reference, letterDate? } -> { id, state }
import { json, error } from '@sveltejs/kit';
import { startCall } from '#lib/server/calls.ts';

export async function POST({ request }) {
	const body = await request.json();
	if (!/^\+[1-9]\d{6,14}$/.test(body.toNumber ?? '')) error(400, 'toNumber must be E.164, e.g. +496211234567');
	const call = await startCall(body);
	return json({ id: call.id, state: call.state });
}
