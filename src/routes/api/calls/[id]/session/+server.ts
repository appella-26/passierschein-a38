// GET  /api/calls/:id/session  -> { senderName, userName }   (409 once answered, ended, or not a browser call)
// POST /api/calls/:id/session  -> { conversationToken, dynamicVariables, senderName, userName }
// Browser hotline only: what /hotline/:id needs to run the agent over WebRTC. The API key stays on the server.
import { json, error } from '@sveltejs/kit';
import { CallStateError, hotlineInfo, startBrowserSession } from '#lib/server/calls.ts';

export function GET({ params }) {
	try {
		return json(hotlineInfo(params.id));
	} catch (err) {
		if (err instanceof CallStateError) error(409, err.message);
		throw err;
	}
}

export async function POST({ params }) {
	try {
		return json(await startBrowserSession(params.id));
	} catch (err) {
		if (err instanceof CallStateError) error(409, err.message);
		error(502, err instanceof Error ? err.message : 'ElevenLabs did not start the session');
	}
}
