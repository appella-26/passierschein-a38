// src/env.ts — SvelteKit 3 environment variables.
// Server code imports them from '$app/env/private'. Values come from .env (see .env.example).
import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (fallback: string) => (v: string | undefined) => (v && v.trim() ? v.trim() : fallback);
const milliseconds = (fallback: number) => (v: string | undefined) => {
	const value = Number(v);
	return v && Number.isFinite(value) && value >= 100 ? value : fallback;
};

export const variables = defineEnvVars({
	// Letter analysis: hosted Gemma via Gemini API by default, or local Ollama.
	GEMMA_PROVIDER: { schema: optional('gemini'), description: 'gemini or ollama' },
	GEMINI_API_KEY: { schema: optional('') },
	GEMINI_MODEL: { schema: optional('models/gemma-4-26b-a4b-it') },
	OLLAMA_URL: { schema: optional('http://localhost:11434') },
	GEMMA_MODEL: { schema: optional('gemma4:26b') },
	// Embeddings are used only with GEMMA_PROVIDER=ollama. Leave the default for
	// local semantic search, or set it to an empty value to use FTS-only search.
	EMBED_MODEL: { schema: optional('embeddinggemma') },
	DATA_DIR: { schema: optional('data') },

	// ElevenLabs Agents (native Twilio integration)
	ELEVENLABS_API_KEY: { schema: optional('') },
	ELEVENLABS_AGENT_ID: { schema: optional('') },
	ELEVENLABS_PHONE_NUMBER_ID: { schema: optional(''), description: 'ID of the imported Twilio number in ElevenLabs' },
	ELEVENLABS_API_URL: {
		schema: optional('https://api.elevenlabs.io'),
		description: 'ElevenLabs API base URL (EU data residency: https://api.eu.residency.elevenlabs.io)'
	},
	CALL_MODE: {
		schema: optional('auto'),
		description:
			'phone (dial via the imported Twilio number), browser (free demo: a second device answers at /hotline/<id>), or auto = phone once ELEVENLABS_PHONE_NUMBER_ID is set'
	},
	AGENT_LANGUAGE: {
		schema: optional(''),
		description: 'Language the agent starts each call in, e.g. "de". Empty = the agent default.'
	},
	CALL_POLL_MS: {
		schema: milliseconds(2000),
		description: 'How often a running call is checked with ElevenLabs (ms)'
	},

	// Twilio (only for "cancel call")
	TWILIO_ACCOUNT_SID: { schema: optional('') },
	TWILIO_AUTH_TOKEN: { schema: optional('') },
	TWILIO_API_URL: { schema: optional('https://api.twilio.com'), description: 'Twilio REST base URL (tests point this at a mock)' },

	// Shared secret the agent's report_status tool sends as x-webhook-secret
	WEBHOOK_SECRET: { schema: optional('') },

	USER_DISPLAY_NAME: { schema: optional('Kevin') },
	DEMO_TARGET_NUMBER: { schema: optional(''), description: 'If set, every call goes here (mock hotline)' },

	// Only read by `pnpm agent:sync`, listed here so they are documented in one place
	TRANSFER_NUMBER: { schema: optional(''), description: 'Phone (E.164) the agent transfers to when a person answers' },
	TUNNEL_URL: { schema: optional(''), description: 'Public HTTPS URL of this app, e.g. your cloudflared tunnel' }
});
