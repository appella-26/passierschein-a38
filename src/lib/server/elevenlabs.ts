// src/lib/server/elevenlabs.ts
// Minimal ElevenLabs Agents API client: start an outbound call or a browser session, read a conversation.

import * as env from '$app/env/private';

export class ElevenLabsError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

/** Pulls a readable message out of the error shapes the API returns. */
export function errorMessage(data: unknown, fallback: string): string {
	const detail = (data as { detail?: unknown } | null)?.detail ?? data;
	if (typeof detail === 'string' && detail) return detail;
	if (Array.isArray(detail)) {
		const parts = detail.map((item) => (item as { msg?: string })?.msg).filter(Boolean);
		if (parts.length) return parts.join('; ');
	}
	const message = (detail as { message?: unknown } | null)?.message;
	return typeof message === 'string' && message ? message : fallback;
}

const baseUrl = () => env.ELEVENLABS_API_URL.replace(/\/+$/, '');

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(baseUrl() + path, {
		...init,
		headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', ...init.headers },
		signal: AbortSignal.timeout(20_000)
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new ElevenLabsError(errorMessage(data, `ElevenLabs ${res.status}`), res.status);
	return data as T;
}

// ---------- Outbound call (native Twilio integration) ----------

export interface OutboundCallRequest {
	agent_id: string;
	agent_phone_number_id: string;
	to_number: string;
	conversation_initiation_client_data: {
		dynamic_variables: Record<string, string>;
		conversation_config_override?: { agent?: { language?: string } };
	};
}

export interface OutboundCallResponse {
	success: boolean;
	message: string;
	conversation_id?: string | null;
	callSid?: string | null;
}

export const startOutboundCall = (body: OutboundCallRequest) =>
	api<OutboundCallResponse>('/v1/convai/twilio/outbound-call', { method: 'POST', body: JSON.stringify(body) });

// ---------- Browser conversation (WebRTC) ----------

/** A short-lived token that lets a browser start a WebRTC conversation with the agent without the API key. */
export const getConversationToken = (agentId: string) =>
	api<{ token: string }>(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`);

// ---------- Conversation details ----------

export type ConversationStatus = 'initiated' | 'in-progress' | 'processing' | 'done' | 'failed';

export interface ToolCall {
	request_id: string;
	tool_name: string;
	params_as_json?: string;
	/** false when the model asked for the tool but the platform never executed it */
	tool_has_been_called?: boolean;
}

export interface ToolResult {
	request_id: string;
	tool_name: string;
	result_value?: string;
	is_error?: boolean;
	tool_has_been_called?: boolean;
	result?: Record<string, unknown> | null;
}

export interface TranscriptTurn {
	role: 'user' | 'agent';
	time_in_call_secs?: number;
	message?: string | null;
	tool_calls?: ToolCall[] | null;
	tool_results?: ToolResult[] | null;
}

export interface Conversation {
	conversation_id: string;
	status: ConversationStatus;
	transcript?: TranscriptTurn[] | null;
	metadata?: {
		start_time_unix_secs?: number;
		termination_reason?: string | null;
		error?: { code?: number; reason?: string | null } | null;
		phone_call?: { call_sid?: string; call_result?: 'answered' | 'voicemail' | 'busy' | 'no_answer' | 'failed' | null } | null;
	} | null;
}

export const getConversation = (id: string) => api<Conversation>(`/v1/convai/conversations/${encodeURIComponent(id)}`);
