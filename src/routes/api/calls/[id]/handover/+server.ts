// POST /api/calls/:id/handover  -> { ok }
// Browser hotline only: the agent introduced the user and left, so the call counts as handed over.
import { json, error } from '@sveltejs/kit';
import { CallStateError, handOver } from '#lib/server/calls.ts';

export function POST({ params }) {
	try {
		handOver(params.id);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof CallStateError) error(409, err.message);
		throw err;
	}
}
