// PATCH /api/documents/:id/todos/:index  { done: boolean }  -> tick a to-do off (undoable)
import { json, error } from '@sveltejs/kit';
import { setTodoDone } from '#lib/server/cases.ts';
import { guard } from '#lib/server/http.ts';

export async function PATCH({ params, request }) {
	const index = Number(params.index);
	if (!Number.isInteger(index) || index < 0) error(400, 'Bad index');
	const { done } = await request.json();
	return json(guard(() => setTodoDone(params.id, index, !!done, 'user')));
}
