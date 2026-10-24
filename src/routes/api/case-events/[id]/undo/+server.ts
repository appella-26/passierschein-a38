// POST /api/case-events/:id/undo  -> revert a change (works for the assistant's edits too)
import { json } from '@sveltejs/kit';
import { undoEvent } from '#lib/server/cases.ts';
import { guard } from '#lib/server/http.ts';

export function POST({ params }) {
	return json(guard(() => undoEvent(Number(params.id), 'user')));
}
