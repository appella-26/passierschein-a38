// POST /api/cases/:id/letters  { letter_id }  -> move a letter into this case
import { json } from '@sveltejs/kit';
import { moveLetter } from '#lib/server/cases.ts';
import { guard } from '#lib/server/http.ts';

export async function POST({ params, request }) {
	const { letter_id } = await request.json();
	return json(guard(() => moveLetter(String(letter_id ?? ''), params.id, 'user')));
}
