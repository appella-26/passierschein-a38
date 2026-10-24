// Browser rehearsal: the "Appella Browser Rehearsal" agent runs in this browser over WebRTC.
// GET  /api/rehearsal -> { ready, missing }
// POST /api/rehearsal -> { conversationToken }, 503 { message, missing } when it isn't configured.
// The API key stays on the server; the browser only ever sees a single-use conversation token.
import { json } from '@sveltejs/kit';
import * as env from '$app/env/private';
import { ElevenLabsError, getConversationToken } from '#lib/server/elevenlabs.ts';

const noStore = { 'Cache-Control': 'no-store' };

function missingConfig() {
	return (['ELEVENLABS_API_KEY', 'ELEVENLABS_BROWSER_AGENT_ID'] as const).filter((key) => !env[key]);
}

export function GET() {
	const missing = missingConfig();
	return json({ ready: missing.length === 0, missing }, { headers: noStore });
}

export async function POST() {
	const missing = missingConfig();
	if (missing.length) {
		return json({ message: `Browser rehearsal isn't set up: ${missing.join(', ')} missing in .env`, code: 'configuration', missing }, { status: 503, headers: noStore });
	}
	try {
		return json({ conversationToken: await getConversationToken(env.ELEVENLABS_BROWSER_AGENT_ID) }, { headers: noStore });
	} catch (err) {
		if (!(err instanceof ElevenLabsError)) throw err;
		console.warn(`[rehearsal] ElevenLabs refused a conversation token (${err.status}): ${err.message}`);
		const configuration = err.status === 401 || err.status === 403 || err.status === 404;
		return json({ message: 'ElevenLabs could not start the rehearsal.', code: configuration ? 'configuration' : 'unavailable' }, { status: 502, headers: noStore });
	}
}
