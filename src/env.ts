// src/env.ts — SvelteKit 3 environment variables.
// Server code imports them from '$app/env/private'. Values come from .env (see .env.example).
import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (fallback: string) => (v: string | undefined) => (v && v.trim() ? v.trim() : fallback);

export const variables = defineEnvVars({
	// Gemma (local, via Ollama)
	OLLAMA_URL: { schema: optional('http://localhost:11434') },
	GEMMA_MODEL: { schema: optional('gemma4:26b') },
	EMBED_MODEL: { schema: optional('embeddinggemma') },
	DATA_DIR: { schema: optional('data') },

	// ElevenLabs Agents (native Twilio integration)
	ELEVENLABS_API_KEY: { schema: optional('') },
	ELEVENLABS_AGENT_ID: { schema: optional('') },
	ELEVENLABS_PHONE_NUMBER_ID: { schema: optional(''), description: 'ID of the imported Twilio number in ElevenLabs' },

	// Twilio (only for "cancel call")
	TWILIO_ACCOUNT_SID: { schema: optional('') },
	TWILIO_AUTH_TOKEN: { schema: optional('') },

	// Shared secret the ElevenLabs server tool sends as x-webhook-secret
	WEBHOOK_SECRET: { schema: optional('') },

	USER_DISPLAY_NAME: { schema: optional('Kevin') },
	DEMO_TARGET_NUMBER: { schema: optional(''), description: 'If set, every call goes here (mock hotline)' }
});
