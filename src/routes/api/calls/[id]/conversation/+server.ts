// POST /api/calls/:id/conversation  { conversationId } -> { ok }
// The hotline page connected; the server now follows the conversation like a phone call.
import { json, error } from '@sveltejs/kit';
import { CallStateError, attachConversation } from '#lib/server/calls.ts';

export async function POST({ params, request }) {
	const body = await request.json().catch(() => null);
	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.trim().slice(0, 100) : '';
	if (!conversationId) error(400, 'conversationId is required');
	try {
		if (!attachConversation(params.id, conversationId)) error(409, 'The hotline has already answered this call');
		return json({ ok: true });
	} catch (err) {
		if (err instanceof CallStateError) error(409, err.message);
		throw err;
	}
}
