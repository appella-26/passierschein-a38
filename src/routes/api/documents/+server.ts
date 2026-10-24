// GET /api/documents            -> all stored letters, newest first
// GET /api/documents?q=steuer   -> hybrid search (full-text + semantic)
import { json } from '@sveltejs/kit';
import { listDocuments, search } from '#lib/server/db.ts';

export async function GET({ url }) {
	const q = url.searchParams.get('q')?.trim();
	return json(q ? await search(q) : listDocuments());
}
