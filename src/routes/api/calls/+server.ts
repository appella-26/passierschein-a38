// POST /api/calls  { toNumber, senderName, purpose, reference, letterDate? } -> { id, state }
// 503 { message, missing } when ElevenLabs isn't configured yet.
import { json, error } from '@sveltejs/kit';
import { CallSetupError, startCall } from '#lib/server/calls.ts';

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export async function POST({ request }) {
	const body = await request.json().catch(() => null);
	const toNumber = text(body?.toNumber, 20);
	if (!/^\+[1-9]\d{6,14}$/.test(toNumber)) error(400, 'toNumber must be E.164, e.g. +496211234567');
	const purpose = text(body?.purpose, 500);
	if (!purpose) error(400, 'purpose is required');

	try {
		const call = await startCall({
			toNumber,
			purpose,
			senderName: text(body?.senderName, 200) || 'the organisation being called',
			reference: text(body?.reference, 500),
			letterDate: text(body?.letterDate, 32) || undefined
		});
		return json({ id: call.id, state: call.state });
	} catch (err) {
		if (err instanceof CallSetupError) return json({ message: err.message, missing: err.missing }, { status: 503 });
		throw err;
	}
}
