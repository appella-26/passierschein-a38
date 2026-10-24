// GET   /api/cases/:id                      -> case + letters (chronological, with page URLs for the wheel) + history
// PATCH /api/cases/:id  { title?, status?, notes? } -> { changes: [{ event_id, summary }] }
// DELETE /api/cases/:id { letter_ids: string[] } -> permanently delete the confirmed case and letters
import { json, error } from '@sveltejs/kit';
import { getCase, getCaseRow, renameCase, setCaseStatus, setCaseNotes, deleteCasePermanently, CaseChangedError, CaseError } from '#lib/server/cases.ts';
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

export async function DELETE({ params, request }) {
	const body = await request.json().catch(() => null);
	if (!Array.isArray(body?.letter_ids) || !body.letter_ids.every((id: unknown) => typeof id === 'string')
		|| new Set(body.letter_ids).size !== body.letter_ids.length) error(400, 'Confirm the case letter IDs before deleting.');
	if (!getCaseRow(params.id)) error(404, 'Unknown case');
	try {
		return json(deleteCasePermanently(params.id, body.letter_ids));
	} catch (cause) {
		if (cause instanceof CaseChangedError) error(409, cause.message);
		if (cause instanceof CaseError) error(400, cause.message);
		console.error('Case deletion failed.');
		error(500, 'Case deletion could not be completed.');
	}
}
