// Server-side call flow against a fake ElevenLabs + Twilio API (see webServer.env in playwright.config.ts).
// Nothing here can place a real call: the app is pointed at the mock on 127.0.0.1:5199.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';

const MOCK = 'http://127.0.0.1:5199';
const APP = 'http://127.0.0.1:5173'; // same as baseURL in playwright.config.ts
const SECRET = 'test-secret';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const outbound: Json[] = [];
const hangups: { sid: string; status: string }[] = [];
const conversations = new Map<string, Json>();
const conversationOf = new Map<string, string>(); // call id -> conversation id
const twilioCalls = new Map<string, { status: string; answerOnCancel?: boolean }>(); // call SID -> Twilio state
const tokenRequests: string[] = []; // agent_id of each browser-rehearsal token request
let tokenStatus = 200;
let server: Server | undefined;
let wiredToMock = false;

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

/** Twilio's Calls API: "completed" ends a call in progress, "canceled" one that is queued or ringing. */
function twilio(sid: string, method: string, body: string, res: ServerResponse) {
	const call = twilioCalls.get(sid);
	if (!call) return send(res, 404, { code: 20404, message: 'The requested resource was not found' });
	if (method === 'GET') return send(res, 200, { sid, status: call.status });
	const status = new URLSearchParams(body).get('Status') ?? '';
	hangups.push({ sid, status });
	const invalid = () => send(res, 400, { code: 21220, message: 'Invalid call state for this action' });
	if (status === 'canceled' && call.answerOnCancel) {
		// The callee picked up a moment before the cancel arrived.
		call.answerOnCancel = false;
		call.status = 'in-progress';
		return invalid();
	}
	if (status === 'completed' && call.status !== 'in-progress') return invalid();
	if (status === 'canceled' && !['queued', 'ringing'].includes(call.status)) return invalid();
	call.status = status;
	return send(res, 200, { sid, status });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
	// Safety interlock: only run against a server whose ElevenLabs URL is the mock.
	const health = await (await fetch(`${APP}/api/agent/health`)).json();
	wiredToMock = health.elevenlabsApi === MOCK;
	if (!wiredToMock) return;

	let next = 0;
	server = createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => (body += chunk));
		req.on('end', () => {
			const url = new URL(req.url ?? '/', MOCK);
			if (req.method === 'POST' && url.pathname === '/v1/convai/twilio/outbound-call') {
				if (req.headers['xi-api-key'] !== 'test-key') return send(res, 401, { detail: { message: 'Invalid API key' } });
				const data = JSON.parse(body);
				outbound.push(data);
				const id = `conv_${++next}`;
				conversationOf.set(data.conversation_initiation_client_data.dynamic_variables.call_id, id);
				conversations.set(id, { conversation_id: id, status: 'initiated', transcript: [], metadata: { start_time_unix_secs: Math.floor(Date.now() / 1000) - 120 } });
				twilioCalls.set(`CA_${next}`, { status: 'in-progress' });
				return send(res, 200, { success: true, message: 'Success', conversation_id: id, callSid: `CA_${next}` });
			}
			if (req.method === 'GET' && url.pathname === '/v1/convai/conversation/token') {
				if (req.headers['xi-api-key'] !== 'test-key') return send(res, 401, { detail: { message: 'Invalid API key' } });
				tokenRequests.push(url.searchParams.get('agent_id') ?? '');
				if (tokenStatus !== 200) return send(res, tokenStatus, { detail: { message: 'Agent not found' } });
				return send(res, 200, { token: `rehearsal_token_${tokenRequests.length}` });
			}
			const conversation = url.pathname.match(/^\/v1\/convai\/conversations\/([^/]+)$/);
			if (req.method === 'GET' && conversation) {
				const found = conversations.get(conversation[1]);
				return found ? send(res, 200, found) : send(res, 404, { detail: 'Conversation not found' });
			}
			const call = url.pathname.match(/^\/2010-04-01\/Accounts\/AC_test\/Calls\/([^/]+)\.json$/);
			if (call) return twilio(call[1], req.method ?? 'GET', body, res);
			send(res, 404, { detail: `Unexpected ${req.method} ${url.pathname}` });
		});
	});
	await new Promise<void>((resolve) => server!.listen(5199, '127.0.0.1', resolve));
});

test.beforeEach(() => {
	test.skip(!wiredToMock, 'A dev server with your real .env is already running. Stop it so Playwright starts one wired to the mock.');
});

test.afterAll(async () => {
	if (!server) return;
	for (const conversation of conversations.values()) conversation.status = 'done'; // let every poller finish
	await new Promise((resolve) => setTimeout(resolve, 600));
	await new Promise((resolve) => server!.close(resolve));
});

async function startCall(request: APIRequestContext, toNumber = '+4930123456') {
	const res = await request.post('/api/calls', {
		data: { toNumber, senderName: 'Finanzamt Mannheim-Stadt', purpose: 'Rückfrage zum Steuerbescheid', reference: 'Steuernummer: 37 012 345 67', letterDate: '2026-10-02' }
	});
	expect(res.status()).toBe(200);
	const { id, state } = await res.json();
	expect(state).toBe('dialing');
	const conversationId = conversationOf.get(id)!;
	return { id: id as string, conversation: conversations.get(conversationId)!, twilio: twilioCalls.get(`CA_${conversationId.slice(5)}`)! };
}

const report = (request: APIRequestContext, call_id: string, state: string, note?: string, secret = SECRET) =>
	request.post('/api/agent/status', { headers: { 'x-webhook-secret': secret }, data: { call_id, state, note } });

/** Reads the call's SSE timeline until `done` returns true (or times out). */
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
	return events;
}
const states = (events: Json[]) => events.map((event) => event.state);
const settle = () => new Promise((resolve) => setTimeout(resolve, 800)); // a few poll intervals

/** One agent tool call as it appears in the transcript; pass `result` once the tool has returned. */
const toolTurn = (seconds: number, tool_name: string, params: Json, result?: Json, called = true) => ({
	role: 'agent',
	time_in_call_secs: seconds,
	message: null,
	tool_calls: [{ request_id: `${tool_name}-${seconds}`, tool_name, params_as_json: JSON.stringify(params), tool_has_been_called: called }],
	tool_results: result ? [{ request_id: `${tool_name}-${seconds}`, tool_name, type: 'system', tool_has_been_called: called, ...result }] : []
});
const statusTurn = (seconds: number, state: string, note?: string) => toolTurn(seconds, 'report_status', { state, note }, { type: 'webhook', is_error: false });
const transferred = { is_error: false, result: { result_type: 'transfer_to_number_twilio_success', status: 'success' } };

test('starts the outbound call with the dynamic variables the agent expects', async ({ request }) => {
	const { id } = await startCall(request);
	const body = outbound.at(-1)!;
	expect(body).toMatchObject({ agent_id: 'agent_test', agent_phone_number_id: 'phnum_test', to_number: '+4930123456' });
	expect(body.conversation_initiation_client_data).toEqual({
		dynamic_variables: {
			call_id: id,
			user_name: 'Kevin',
			sender_name: 'Finanzamt Mannheim-Stadt',
			purpose: 'Rückfrage zum Steuerbescheid',
			reference: 'Steuernummer: 37 012 345 67',
			letter_date: '2026-10-02',
			secret__webhook_secret: SECRET
		},
		conversation_config_override: { agent: { language: 'de' } }
	});
	expect((await request.post('/api/calls', { data: { toNumber: '0621 292', purpose: 'x' } })).status()).toBe(400);
});

test('the status webhook checks the secret, the state and the call', async ({ request }) => {
	const { id } = await startCall(request);
	expect((await report(request, id, 'on_hold', undefined, 'wrong')).status()).toBe(401);
	expect((await request.post('/api/agent/status', { data: { call_id: id, state: 'on_hold' } })).status()).toBe(401);
	expect((await report(request, id, 'dancing')).status()).toBe(400);
	expect((await report(request, 'nope', 'on_hold')).status()).toBe(404);
	expect((await report(request, id, 'On Hold')).status()).toBe(200);
	expect(states(await timeline(id, (seen) => seen.includes('on_hold')))).toEqual(['dialing', 'on_hold']);
});

test('menu, hold, human, then a confirmed transfer ends as "connected"', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'in-progress';
	for (const [state, note] of [['ivr'], ['on_hold'], ['on_hold'], ['human_detected', 'Frau Müller, Veranlagung']] as const) {
		expect((await report(request, id, state, note)).status()).toBe(200);
	}
	conversation.transcript = [
		statusTurn(3, 'ivr'),
		statusTurn(20, 'on_hold'),
		statusTurn(50, 'on_hold'),
		statusTurn(90, 'human_detected', 'Frau Müller, Veranlagung'),
		toolTurn(95, 'transfer_to_number', { transfer_number: '+49151000000' }, transferred)
	];
	conversation.status = 'done';
	const events = await timeline(id, (seen) => seen.includes('connected'));
	expect(states(events)).toEqual(['dialing', 'ivr', 'on_hold', 'human_detected', 'transferring', 'connected']);
	expect(events[3].note).toBe('Frau Müller, Veranlagung');
	// A late webhook must not pull the screen back from "connected".
	expect((await report(request, id, 'on_hold')).status()).toBe(200);
	expect(states(await timeline(id, () => false, 1000)).at(-1)).toBe('connected');
});

test('a transfer that never ran is not "connected", and the provider failure is kept', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	await report(request, id, 'human_detected');
	conversation.transcript = [statusTurn(60, 'human_detected'), toolTurn(62, 'transfer_to_number', { transfer_number: '+49151000000' }, undefined, false)];
	conversation.status = 'failed';
	conversation.metadata.error = { code: 1011, reason: 'Telephony provider error' };
	const events = await timeline(id, (seen) => seen.includes('failed'));
	expect(events.map((event) => [event.state, event.note])).toEqual([['dialing', undefined], ['human_detected', undefined], ['failed', 'Telephony provider error']]);
});

test('a transfer without a confirmed result ends as "ended", not "connected"', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	await report(request, id, 'human_detected');
	conversation.transcript = [statusTurn(60, 'human_detected'), toolTurn(62, 'transfer_to_number', { transfer_number: '+49151000000' })];
	conversation.status = 'done';
	expect(states(await timeline(id, (seen) => seen.includes('ended')))).toEqual(['dialing', 'human_detected', 'transferring', 'ended']);
});

test('a failed transfer does not show "connected"', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	await report(request, id, 'human_detected');
	conversation.transcript = [
		statusTurn(60, 'human_detected'),
		toolTurn(62, 'transfer_to_number', { transfer_number: '+49151000000' }, { is_error: true, result: { result_type: 'transfer_to_number_error', status: 'error' } })
	];
	conversation.status = 'done';
	expect(states(await timeline(id, (seen) => seen.includes('ended')))).toEqual(['dialing', 'human_detected', 'ended']);
});

test('a busy line fails the call with a reason', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'done';
	conversation.metadata.phone_call = { type: 'twilio', call_sid: 'CA_busy', call_result: 'busy' };
	const events = await timeline(id, (seen) => seen.includes('failed'));
	expect(events.map((event) => [event.state, event.note])).toEqual([['dialing', undefined], ['failed', 'Line busy']]);
});

test('voicemail detection ends the call', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.transcript = [toolTurn(4, 'voicemail_detection', { reason: 'Außerhalb der Servicezeiten' }, { is_error: false })];
	conversation.status = 'done';
	conversation.metadata.termination_reason = 'Voicemail detected';
	expect(states(await timeline(id, (seen) => seen.includes('ended')))).toEqual(['dialing', 'voicemail', 'ended']);
});

test('the transcript fills in steps when the webhook never arrives', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'in-progress';
	conversation.transcript = [statusTurn(3, 'ivr'), statusTurn(20, 'on_hold')];
	expect(states(await timeline(id, (seen) => seen.includes('on_hold')))).toEqual(['dialing', 'ivr', 'on_hold']);
	conversation.transcript.push(toolTurn(300, 'end_call', { reason: 'Caller hung up' }, { is_error: false }));
	conversation.status = 'done';
	conversation.metadata.termination_reason = 'Call ended by remote party';
	const events = await timeline(id, (seen) => seen.includes('ended'));
	expect(events.at(-1)).toMatchObject({ state: 'ended', note: 'Call ended by remote party' });
});

test('a late webhook cannot undo what the transcript already showed', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'in-progress';
	conversation.transcript = [statusTurn(20, 'on_hold'), statusTurn(90, 'human_detected', 'Herr Weber')];
	expect(states(await timeline(id, (seen) => seen.includes('human_detected')))).toEqual(['dialing', 'on_hold', 'human_detected']);
	// The same two reports now arrive late through the tunnel.
	expect((await report(request, id, 'on_hold')).status()).toBe(200);
	expect((await report(request, id, 'human_detected', 'Herr Weber')).status()).toBe(200);
	await settle();
	expect(states(await timeline(id, () => false, 500))).toEqual(['dialing', 'on_hold', 'human_detected']);
});

test('webhooks that arrive out of order are put right by the transcript', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'in-progress';
	await report(request, id, 'human_detected');
	await report(request, id, 'on_hold'); // sent first by the agent, delivered second
	conversation.transcript = [statusTurn(20, 'on_hold'), statusTurn(90, 'human_detected')];
	const events = await timeline(id, (seen) => seen.at(-1) === 'human_detected' && seen.length > 3);
	expect(states(events)).toEqual(['dialing', 'human_detected', 'on_hold', 'human_detected']);
});

test('hang-up ends a call in progress through Twilio', async ({ request }) => {
	const { id, conversation, twilio } = await startCall(request);
	conversation.status = 'in-progress';
	await report(request, id, 'on_hold');
	const before = hangups.length;
	expect(await (await request.post(`/api/calls/${id}/cancel`)).json()).toEqual({ ok: true });
	expect(hangups.slice(before).map((hangup) => hangup.status)).toEqual(['completed']);
	expect(twilio.status).toBe('completed');
	expect((await timeline(id, (seen) => seen.includes('ended'))).at(-1)).toMatchObject({ state: 'ended', note: 'Cancelled by user' });
	expect(await (await request.post('/api/calls/unknown/cancel')).json()).toEqual({ ok: false, error: 'Unknown call' });
});

test('hang-up cancels a call that is still ringing', async ({ request }) => {
	const { id, twilio } = await startCall(request);
	twilio.status = 'ringing';
	const before = hangups.length;
	expect(await (await request.post(`/api/calls/${id}/cancel`)).json()).toEqual({ ok: true });
	expect(hangups.slice(before).map((hangup) => hangup.status)).toEqual(['canceled']);
	expect(twilio.status).toBe('canceled');
});

test('hang-up retries when the call is answered mid-cancel', async ({ request }) => {
	const { id, twilio } = await startCall(request);
	twilio.status = 'ringing';
	twilio.answerOnCancel = true; // Twilio rejects "canceled" because the call was just answered
	const before = hangups.length;
	expect(await (await request.post(`/api/calls/${id}/cancel`)).json()).toEqual({ ok: true });
	expect(hangups.slice(before).map((hangup) => hangup.status)).toEqual(['canceled', 'completed']);
	expect(twilio.status).toBe('completed');
	expect((await timeline(id, (seen) => seen.includes('ended'))).at(-1)?.state).toBe('ended');
});

test('browser rehearsal mints a token for the rehearsal agent only, and never dials', async ({ request }) => {
	const before = outbound.length;
	const status = await request.get('/api/rehearsal');
	expect(status.headers()['cache-control']).toBe('no-store');
	expect(await status.json()).toEqual({ ready: true, missing: [] });

	const res = await request.post('/api/rehearsal');
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body).toEqual({ conversationToken: expect.stringMatching(/^rehearsal_token_\d+$/) });
	expect(JSON.stringify(body)).not.toContain('test-key');
	expect(tokenRequests.at(-1)).toBe('agent_rehearsal_test');
	expect(outbound.length).toBe(before);
});

test('browser rehearsal hides ElevenLabs errors behind a classified 502', async ({ request }) => {
	tokenStatus = 404;
	try {
		const res = await request.post('/api/rehearsal');
		expect(res.status()).toBe(502);
		expect(await res.json()).toEqual({ message: 'ElevenLabs could not start the rehearsal.', code: 'configuration' });
	} finally {
		tokenStatus = 200;
	}
});
