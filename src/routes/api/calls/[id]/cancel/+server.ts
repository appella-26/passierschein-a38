// POST /api/calls/:id/cancel
import { json } from '@sveltejs/kit';
import { cancelCall } from '#lib/server/calls.ts';

export async function POST({ params }) {
	return json({ ok: await cancelCall(params.id) });
}
