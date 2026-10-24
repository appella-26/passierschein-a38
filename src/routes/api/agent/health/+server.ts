// GET /api/agent/health -> which parts of the phone assistant are configured (no secrets).
// `pnpm agent:check` calls this through the tunnel to prove ElevenLabs can reach the app.
import { json } from '@sveltejs/kit';
import * as env from '$app/env/private';
import { missingConfig } from '#lib/server/calls.ts';

export function GET() {
	const missing = missingConfig();
	return json({
		app: 'appella',
		ready: missing.length === 0,
		missing,
		elevenlabsApi: new URL(env.ELEVENLABS_API_URL).origin,
		webhookSecret: Boolean(env.WEBHOOK_SECRET),
		hangUp: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
		language: env.AGENT_LANGUAGE || null,
		demoTarget: Boolean(env.DEMO_TARGET_NUMBER)
	});
}
