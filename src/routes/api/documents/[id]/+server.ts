// GET /api/documents/:id -> { ...row, analysis, related }
import { json, error } from '@sveltejs/kit';
import { getDocument } from '#lib/server/db.ts';

export function GET({ params }) {
	const doc = getDocument(params.id);
	if (!doc) error(404, 'Unknown document');
	return json(doc);
}
