// GET  /api/cases                                  -> all cases (open first, nearest deadline first)
// POST /api/cases  { title, letter_ids?: string[] } -> { event_id, case_id, summary }
import { json } from '@sveltejs/kit';
import { listCases, createCase } from '#lib/server/cases.ts';
import { guard } from '#lib/server/http.ts';

export function GET() {
	return json(listCases());
}

export async function POST({ request }) {
	const { title, letter_ids } = await request.json();
	return json(guard(() => createCase(String(title ?? ''), Array.isArray(letter_ids) ? letter_ids : [], 'user')));
}
