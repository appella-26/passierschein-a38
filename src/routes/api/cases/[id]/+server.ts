// GET   /api/cases/:id                      -> case + letters (chronological, with page URLs for the wheel) + history
// PATCH /api/cases/:id  { title?, status?, notes? } -> { changes: [{ event_id, summary }] }
import { json, error } from '@sveltejs/kit';
import { getCase, renameCase, setCaseStatus, setCaseNotes } from '#lib/server/cases.ts';
import { guard } from '#lib/server/http.ts';

export function GET({ params }) {
	const c = getCase(params.id);
	if (!c) error(404, 'Unknown case');
	return json(c);
}

export async function PATCH({ params, request }) {
	const body = await request.json();
	const changes = guard(() => [
		...(body.title !== undefined ? [renameCase(params.id, String(body.title), 'user')] : []),
		...(body.status !== undefined ? [setCaseStatus(params.id, body.status, 'user')] : []),
		...(body.notes !== undefined ? [setCaseNotes(params.id, String(body.notes), 'user')] : [])
	]);
	return json({ changes });
}
