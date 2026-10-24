// Server-side call flow against a fake ElevenLabs + Twilio API (see webServer.env in playwright.config.ts).
// Nothing here can place a real call: the app is pointed at the mock on 127.0.0.1:5199.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { createServer, type Server, type ServerResponse } from 'node:http';

const MOCK = 'http://127.0.0.1:5199';
const APP = 'http://127.0.0.1:5173'; // same as baseURL in playwright.config.ts
const SECRET = 'test-secret';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const outbound: Json[] = [];
const hangups: { path: string; body: string }[] = [];
const conversations = new Map<string, Json>();
const conversationOf = new Map<string, string>(); // call id -> conversation id
let server: Server | undefined;
let wiredToMock = false;

function send(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
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
				return send(res, 200, { success: true, message: 'Success', conversation_id: id, callSid: `CA_${next}` });
			}
			const conversation = url.pathname.match(/^\/v1\/convai\/conversations\/([^/]+)$/);
			if (req.method === 'GET' && conversation) {
				const found = conversations.get(conversation[1]);
				return found ? send(res, 200, found) : send(res, 404, { detail: 'Conversation not found' });
			}
			if (req.method === 'POST' && url.pathname.startsWith('/2010-04-01/Accounts/AC_test/Calls/')) {
				hangups.push({ path: url.pathname, body });
				return send(res, 200, { status: 'completed' });
			}
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
	return { id: id as string, conversation: conversations.get(conversationOf.get(id)!)! };
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

const agentTurn = (seconds: number, tool_name: string, params: Json, result?: Json) => ({
	role: 'agent',
	time_in_call_secs: seconds,
	message: null,
	tool_calls: [{ request_id: `${tool_name}-${seconds}`, tool_name, params_as_json: JSON.stringify(params) }],
	tool_results: result ? [{ request_id: `${tool_name}-${seconds}`, tool_name, type: 'system', ...result }] : []
});

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
	expect((await timeline(id, (states) => states.includes('on_hold'))).map((event) => event.state)).toEqual(['dialing', 'on_hold']);
});

test('menu, hold, human, then transfer ends as "connected"', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'in-progress';
	for (const [state, note] of [['ivr'], ['on_hold'], ['on_hold'], ['human_detected', 'Frau Müller, Veranlagung']] as const) {
		expect((await report(request, id, state, note)).status()).toBe(200);
	}
	conversation.transcript = [agentTurn(95, 'transfer_to_number', { transfer_number: '+49151000000' }, { is_error: false, result: { result_type: 'transfer_to_number_twilio_success', status: 'success' } })];
	conversation.status = 'done';
	const events = await timeline(id, (states) => states.includes('connected'));
	expect(events.map((event) => event.state)).toEqual(['dialing', 'ivr', 'on_hold', 'human_detected', 'transferring', 'connected']);
	expect(events[3].note).toBe('Frau Müller, Veranlagung');
	// A late webhook must not pull the screen back from "connected".
	expect((await report(request, id, 'on_hold')).status()).toBe(200);
	expect((await timeline(id, () => false, 1000)).at(-1)?.state).toBe('connected');
});

test('a busy line fails the call with a reason', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'done';
	conversation.metadata.phone_call = { type: 'twilio', call_sid: 'CA_busy', call_result: 'busy' };
	const events = await timeline(id, (states) => states.includes('failed'));
	expect(events.map((event) => [event.state, event.note])).toEqual([['dialing', undefined], ['failed', 'Line busy']]);
});

test('voicemail detection ends the call', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.transcript = [agentTurn(4, 'voicemail_detection', { reason: 'Außerhalb der Servicezeiten' }, { is_error: false })];
	conversation.status = 'done';
	conversation.metadata.termination_reason = 'Voicemail detected';
	const events = await timeline(id, (states) => states.includes('ended'));
	expect(events.map((event) => event.state)).toEqual(['dialing', 'voicemail', 'ended']);
});

test('the transcript fills in steps when the webhook never arrives', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'in-progress';
	conversation.transcript = [agentTurn(3, 'report_status', { state: 'ivr' }), agentTurn(20, 'report_status', { state: 'on_hold' })];
	expect((await timeline(id, (states) => states.includes('on_hold'))).map((event) => event.state)).toEqual(['dialing', 'ivr', 'on_hold']);
	conversation.transcript.push(agentTurn(300, 'end_call', { reason: 'Caller hung up' }, { is_error: false }));
	conversation.status = 'done';
	conversation.metadata.termination_reason = 'Call ended by remote party';
	const events = await timeline(id, (states) => states.includes('ended'));
	expect(events.at(-1)).toMatchObject({ state: 'ended', note: 'Call ended by remote party' });
});

test('a failed transfer does not show "connected"', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	await report(request, id, 'human_detected');
	conversation.transcript = [agentTurn(60, 'transfer_to_number', { transfer_number: '+49151000000' }, { is_error: true, result: { result_type: 'transfer_to_number_error' } })];
	conversation.status = 'done';
	const events = await timeline(id, (states) => states.includes('ended'));
	expect(events.map((event) => event.state)).toEqual(['dialing', 'human_detected', 'ended']);
});

test('cancel hangs up through Twilio', async ({ request }) => {
	const { id, conversation } = await startCall(request);
	conversation.status = 'in-progress';
	await report(request, id, 'on_hold');
	const res = await request.post(`/api/calls/${id}/cancel`);
	expect(await res.json()).toEqual({ ok: true });
	expect(hangups.at(-1)).toEqual({ path: expect.stringMatching(/\/Calls\/CA_\d+\.json$/), body: 'Status=completed' });
	const events = await timeline(id, (states) => states.includes('ended'));
	expect(events.at(-1)).toMatchObject({ state: 'ended', note: 'Cancelled by user' });
	expect(await (await request.post('/api/calls/unknown/cancel')).json()).toEqual({ ok: false, error: 'Unknown call' });
});
