// Browser hotline (CALL_MODE=browser) against a fake ElevenLabs API (second webServer in playwright.config.ts).
// No phone number is configured there, so `auto` picks the browser hotline and nothing is ever dialed.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';

const MOCK = 'http://127.0.0.1:5198';
const APP = 'http://127.0.0.1:5174';
const SECRET = 'test-secret';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const conversations = new Map<string, Json>();
const unexpected: string[] = [];
let tokens = 0;
let server: Server | undefined;
let wiredToMock = false;

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

test.describe.configure({ mode: 'serial' });
test.use({ baseURL: APP });

test.beforeAll(async () => {
	const health = await (await fetch(`${APP}/api/agent/health`)).json();
	wiredToMock = health.elevenlabsApi === MOCK;
	if (!wiredToMock) return;
	server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', MOCK);
		if (req.headers['xi-api-key'] !== 'test-key') return send(res, 401, { detail: { message: 'Invalid API key' } });
		if (req.method === 'GET' && url.pathname === '/v1/convai/conversation/token') {
			if (url.searchParams.get('agent_id') !== 'agent_test') return send(res, 404, { detail: 'Agent not found' });
			return send(res, 200, { token: `token_${++tokens}` });
		}
		const conversation = url.pathname.match(/^\/v1\/convai\/conversations\/([^/]+)$/);
		if (req.method === 'GET' && conversation) {
			const found = conversations.get(conversation[1]);
			return found ? send(res, 200, found) : send(res, 404, { detail: 'Conversation not found' });
		}
		unexpected.push(`${req.method} ${url.pathname}`);
		send(res, 404, { detail: `Unexpected ${req.method} ${url.pathname}` });
	});
	await new Promise<void>((resolve) => server!.listen(5198, '127.0.0.1', resolve));
});

test.beforeEach(() => {
	test.skip(!wiredToMock, 'A dev server with your real .env is already running on port 5174.');
});

test.afterAll(async () => {
	if (!server) return;
	for (const conversation of conversations.values()) conversation.status = 'done';
	await new Promise((resolve) => setTimeout(resolve, 600));
	await new Promise((resolve) => server!.close(resolve));
	expect(unexpected).toEqual([]); // e.g. no outbound-call request
});

async function startCall(request: APIRequestContext) {
	const res = await request.post('/api/calls', {
		data: { toNumber: '+4930123456', senderName: 'Finanzamt Mannheim-Stadt', purpose: 'Rückfrage zum Steuerbescheid', reference: 'Steuernummer: 37 012 345 67', letterDate: '2026-10-02' }
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body).toMatchObject({ state: 'dialing', mode: 'browser' });
	return body.id as string;
}

/** The hotline page answers: fetch the session, then report the WebRTC conversation id. */
async function answer(request: APIRequestContext, id: string) {
	const session = await (await request.post(`/api/calls/${id}/session`)).json();
	const conversationId = `conv_${id}`;
	conversations.set(conversationId, { conversation_id: conversationId, status: 'in-progress', transcript: [], metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000) - 60 } });
	expect((await request.post(`/api/calls/${id}/conversation`, { data: { conversationId } })).status()).toBe(200);
	return { session, conversation: conversations.get(conversationId)! };
}

const report = (request: APIRequestContext, call_id: string, state: string, secret: string) =>
	request.post('/api/agent/status', { headers: { 'x-webhook-secret': secret }, data: { call_id, state } });

async function timeline(id: string, done: (states: string[]) => boolean, timeout = 8000) {
	const events: Json[] = [];
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeout);
	try {
		const res = await fetch(`${APP}/api/calls/${id}/events`, { signal: abort.signal });
		const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = '';
		while (!done(events.map((event) => event.state))) {
			const { value, done: closed } = await reader.read();
			if (closed) break;
			buffer += value;
			const blocks = buffer.split('\n\n');
			buffer = blocks.pop() ?? '';
			for (const block of blocks) if (block.startsWith('data: ')) events.push(JSON.parse(block.slice(6)));
		}
	} catch (err) {
		if (!abort.signal.aborted) throw err;
	} finally {
		clearTimeout(timer);
		abort.abort();
	}
	return events.map((event) => event.state);
}

test('without a phone number the call waits for the hotline instead of dialing', async ({ request }) => {
	expect(await (await request.get('/api/agent/health')).json()).toMatchObject({ ready: true, callMode: 'browser', missing: [] });
	const id = await startCall(request);
	expect(await timeline(id, () => false, 600)).toEqual(['dialing']);
});

test('the hotline session carries the call variables and a secret for this call only', async ({ request }) => {
	const first = await startCall(request);
	const second = await startCall(request);
	const { session } = await answer(request, first);
	expect(session.conversationToken).toMatch(/^token_/);
	expect(session).toMatchObject({ senderName: 'Finanzamt Mannheim-Stadt', userName: 'Kevin' });
	const token = session.dynamicVariables.secret__webhook_secret;
	expect(session.dynamicVariables).toMatchObject({ call_id: first, user_name: 'Kevin', purpose: 'Rückfrage zum Steuerbescheid', letter_date: '2026-10-02' });
	expect(token).not.toBe(SECRET);
	expect(token.length).toBeGreaterThan(16);
	// Answered once: a second session or another conversation id is refused.
	expect((await request.post(`/api/calls/${first}/session`)).status()).toBe(409);
	expect((await request.post(`/api/calls/${first}/conversation`, { data: { conversationId: 'conv_other' } })).status()).toBe(409);
	expect((await request.post('/api/calls/nope/session')).status()).toBe(409);
	// The per-call token works for its own call, not for another one; the global secret still works.
	expect((await report(request, first, 'on_hold', token)).status()).toBe(200);
	expect((await report(request, second, 'on_hold', token)).status()).toBe(401);
	expect((await report(request, second, 'on_hold', SECRET)).status()).toBe(200);
	expect(await timeline(first, (seen) => seen.includes('on_hold'))).toEqual(['dialing', 'on_hold']);
});

test('handover after a person answers ends as "connected", even when the conversation closes', async ({ request }) => {
	const id = await startCall(request);
	const { session, conversation } = await answer(request, id);
	const token = session.dynamicVariables.secret__webhook_secret;
	await report(request, id, 'on_hold', token);
	await report(request, id, 'human_detected', token);
	expect((await request.post(`/api/calls/${id}/handover`)).status()).toBe(200);
	// The hotline page leaves; the transcript (including a transfer attempt) must not change the result.
	conversation.transcript = [
		{ role: 'agent', time_in_call_secs: 30, tool_calls: [{ request_id: 't1', tool_name: 'transfer_to_number', params_as_json: '{}', tool_has_been_called: true }], tool_results: [] }
	];
	conversation.status = 'done';
	await new Promise((resolve) => setTimeout(resolve, 800));
	expect(await timeline(id, () => false, 600)).toEqual(['dialing', 'on_hold', 'human_detected', 'transferring', 'connected']);
	expect((await request.post(`/api/calls/${id}/handover`)).status()).toBe(200);
});

test('a hotline that hangs up ends the call, and the user can cancel without Twilio', async ({ request }) => {
	const hungUp = await startCall(request);
	const { conversation } = await answer(request, hungUp);
	conversation.status = 'done';
	conversation.metadata.termination_reason = 'Client disconnected';
	expect((await timeline(hungUp, (seen) => seen.includes('ended'))).at(-1)).toBe('ended');

	const cancelled = await startCall(request);
	expect(await (await request.post(`/api/calls/${cancelled}/cancel`)).json()).toEqual({ ok: true });
	expect(await timeline(cancelled, (seen) => seen.includes('ended'))).toEqual(['dialing', 'ended']);
	expect((await request.post(`/api/calls/${cancelled}/session`)).status()).toBe(409);
});
