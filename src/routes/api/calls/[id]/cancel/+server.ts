// POST /api/calls/:id/cancel  -> { ok, error? }
import { json } from '@sveltejs/kit';
import { cancelCall } from '#lib/server/calls.ts';

export async function POST({ params }) {
	return json(await cancelCall(params.id));
}
