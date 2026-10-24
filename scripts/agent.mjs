#!/usr/bin/env node
// scripts/agent.mjs — keeps the ElevenLabs phone agent wired to this app.
//
//   pnpm agent:sync [https://your-tunnel.trycloudflare.com]
//     Points the agent's report_status tool at this app, sets the transfer number from
//     TRANSFER_NUMBER, and adds any phone tools the agent is missing. Safe to re-run:
//     run it whenever the tunnel URL changes. The URL comes from the argument, TUNNEL_URL,
//     or a running `cloudflared tunnel --url http://localhost:5173` (found automatically).
//
//   pnpm agent:check
//     Read-only. Lists what the agent and .env still need.

import process from 'node:process';

try {
	process.loadEnvFile('.env');
} catch {
	// No .env file: fall back to the shell environment.
}
const env = process.env;

const API = (env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io').replace(/\/+$/, '');
const AGENT_ID = env.ELEVENLABS_AGENT_ID;
const TRANSFER_NUMBER = env.TRANSFER_NUMBER?.replace(/[\s/()-]/g, '');
const LANGUAGE = env.AGENT_LANGUAGE?.trim();
const E164 = /^\+[1-9]\d{6,14}$/;
const STATUS_TOOL = 'report_status';
const STATUS_PATH = '/api/agent/status';
const PLACEHOLDER_URL = `https://appella-tunnel-not-set.invalid${STATUS_PATH}`;

// ---------- What the app expects from the agent ----------

/** The report_status webhook tool. The app owns this tool: sync rewrites it completely. */
const statusTool = (url) => ({
	type: 'webhook',
	name: STATUS_TOOL,
	description:
		"Report the current phase of the call to the user's app. Call it once whenever the phase changes (phone menu, on hold, human answered, voicemail, failed). It runs silently: never mention it and never wait for its answer.",
	api_schema: {
		url,
		method: 'POST',
		content_type: 'application/json',
		// Filled per call by the app (secret__ variables never reach the LLM).
		request_headers: { 'x-webhook-secret': { variable_name: 'secret__webhook_secret' } },
		request_body_schema: {
			type: 'object',
			description: "Status update for the user's app",
			properties: {
				call_id: { type: 'string', dynamic_variable: 'call_id' },
				state: { type: 'string', description: 'The phase the call just entered', enum: ['ivr', 'on_hold', 'human_detected', 'voicemail', 'failed'] },
				note: { type: 'string', description: 'Short note, e.g. who answered or what the announcement said. Empty if there is nothing to add.' }
			},
			required: ['call_id', 'state']
		}
	},
	response_timeout_secs: 5,
	execution_mode: 'async', // never let a slow tunnel delay the transfer
	pre_tool_speech: 'off',
	tool_error_handling_mode: 'hide'
});

/** Built-in tools the prompt relies on. Missing ones are added; existing ones are left alone. */
const builtInTools = {
	skip_turn: {
		type: 'system',
		name: 'skip_turn',
		description:
			'Stay silent. Use this whenever the other side is a recording or nobody is speaking to you: hold music, silence, "please hold", queue-position announcements, or a phone menu that is still talking. Never reply to recordings.',
		pre_tool_speech: 'off',
		params: { system_tool_type: 'skip_turn', wait_timeout_secs: -1 }
	},
	play_keypad_touch_tone: {
		type: 'system',
		name: 'play_keypad_touch_tone',
		description: '',
		pre_tool_speech: 'off',
		params: { system_tool_type: 'play_keypad_touch_tone', suppress_turn_after_dtmf: true }
	},
	end_call: { type: 'system', name: 'end_call', description: '', params: { system_tool_type: 'end_call' } },
	voicemail_detection: {
		type: 'system',
		name: 'voicemail_detection',
		description:
			'Use only when the call reached an answering machine, a mailbox, or an "outside our business hours" announcement that will not connect you to a person. Never use it for hold announcements or phone menus. Report the voicemail state first.',
		pre_tool_speech: 'off',
		params: { system_tool_type: 'voicemail_detection' }
	},
	language_detection: { type: 'system', name: 'language_detection', description: '', params: { system_tool_type: 'language_detection' } }
};

const transferTool = (number) => ({
	type: 'system',
	name: 'transfer_to_number',
	description: '',
	params: {
		system_tool_type: 'transfer_to_number',
		enable_client_message: true,
		transfers: [
			{
				transfer_destination: { type: 'phone', phone_number: number },
				condition: 'A live human employee of the called organization is on the line and you have introduced the user.',
				transfer_type: 'conference' // lets the agent brief the user before connecting (agent_message)
			}
		]
	}
});

/** Dashboard test calls use these when the app isn't the one starting the call. */
const placeholders = {
	call_id: 'dashboard-test',
	user_name: 'Kevin',
	sender_name: 'Finanzamt Mannheim-Stadt',
	purpose: 'Rückfrage zum Einkommensteuerbescheid 2025 und zur Nachzahlung von 312,40 Euro.',
	reference: 'Steuernummer: 37 012 345 67 · Aktenzeichen: 38/204/91823',
	letter_date: '2026-10-02',
	secret__webhook_secret: 'dashboard-test'
};

// ---------- Output ----------

const paint = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const [green, red, yellow, dim, bold] = [32, 31, 33, 2, 1].map(paint);
let problems = 0;
const hint = (fix) => (fix ? `\n      ${dim('→ ' + fix)}` : '');
const ok = (text) => console.log(`  ${green('✓')} ${text}`);
const warn = (text, fix) => console.log(`  ${yellow('!')} ${text}${hint(fix)}`);
const bad = (text, fix) => {
	problems++;
	console.log(`  ${red('✗')} ${text}${hint(fix)}`);
};
const changed = (text) => console.log(`  ${green('+')} ${text}`);

// ---------- ElevenLabs API ----------

async function api(method, path, body) {
	const res = await fetch(API + path, {
		method,
		headers: { 'xi-api-key': env.ELEVENLABS_API_KEY ?? '', 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(20_000)
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) {
		const detail = data?.detail ?? data;
		const text =
			typeof detail === 'string'
				? detail
				: Array.isArray(detail)
					? detail.map((item) => `${(item.loc ?? []).join('.')}: ${item.msg}`).join('; ')
					: (detail?.message ?? `HTTP ${res.status}`);
		throw new Error(`${method} ${path} → ${res.status}: ${text}`);
	}
	return data;
}

const getAgent = () => api('GET', `/v1/convai/agents/${encodeURIComponent(AGENT_ID)}`);
const promptOf = (agent) => agent.conversation_config?.agent?.prompt ?? {};

async function findStatusTool(agent) {
	for (const id of promptOf(agent).tool_ids ?? []) {
		const tool = await api('GET', `/v1/convai/tools/${encodeURIComponent(id)}`);
		if (tool.tool_config?.name === STATUS_TOOL) return { tool, attached: true };
	}
	const { tools = [] } = await api('GET', `/v1/convai/tools?search=${STATUS_TOOL}&page_size=100`);
	const tool = tools.find((item) => item.tool_config?.name === STATUS_TOOL && item.tool_config?.type === 'webhook');
	return tool ? { tool, attached: false } : null;
}

// ---------- The app's public URL ----------

function origin(value) {
	try {
		return new URL(value.includes('://') ? value : `https://${value}`).origin;
	} catch {
		return null;
	}
}

/** Argument, then TUNNEL_URL, then a running cloudflared quick tunnel (its metrics port knows the URL). */
async function findPublicUrl(argument) {
	if (argument) return { url: origin(argument), source: 'command line' };
	if (env.TUNNEL_URL) return { url: origin(env.TUNNEL_URL), source: 'TUNNEL_URL' };
	for (let port = 20241; port <= 20245; port++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/quicktunnel`, { signal: AbortSignal.timeout(800) });
			const { hostname } = await res.json();
			if (hostname) return { url: `https://${hostname}`, source: 'running cloudflared tunnel' };
		} catch {
			// cloudflared isn't listening on this port.
		}
	}
	return null;
}

async function appHealth(base) {
	try {
		const res = await fetch(base + '/api/agent/health', { signal: AbortSignal.timeout(10_000) });
		const data = await res.json();
		return data?.app === 'appella' ? data : null;
	} catch {
		return null;
	}
}

// ---------- sync ----------

async function sync(argument) {
	const before = await getAgent();
	console.log(bold(`\nSyncing "${before.name}" (${AGENT_ID})`));
	const publicUrl = await findPublicUrl(argument);
	if (publicUrl && !publicUrl.url) throw new Error(`Not a URL: ${argument ?? env.TUNNEL_URL}`);
	const webhook = publicUrl ? publicUrl.url + STATUS_PATH : null;
	if (publicUrl) console.log(dim(`  App URL from ${publicUrl.source}: ${publicUrl.url}`));

	const prompt = promptOf(before);
	const patch = {};
	const setPrompt = (key, value) => ((patch.conversation_config ??= { agent: { prompt: {} } }).agent.prompt[key] = value);

	// report_status: create, attach, and point at this app.
	const found = await findStatusTool(before);
	if (!found) {
		const created = await api('POST', '/v1/convai/tools', { tool_config: statusTool(webhook ?? PLACEHOLDER_URL) });
		setPrompt('tool_ids', [...(prompt.tool_ids ?? []), created.id]);
		changed(`created the ${STATUS_TOOL} tool`);
	} else {
		if (webhook) {
			await api('PATCH', `/v1/convai/tools/${encodeURIComponent(found.tool.id)}`, { tool_config: statusTool(webhook) });
			changed(`${STATUS_TOOL} now calls ${webhook}`);
		}
		if (!found.attached) setPrompt('tool_ids', [...(prompt.tool_ids ?? []), found.tool.id]);
	}

	// Built-in phone tools the prompt uses.
	const builtIns = {};
	for (const [name, config] of Object.entries(builtInTools)) if (!prompt.built_in_tools?.[name]) builtIns[name] = config;
	if (TRANSFER_NUMBER && E164.test(TRANSFER_NUMBER)) {
		const current = prompt.built_in_tools?.transfer_to_number?.params?.transfers?.[0]?.transfer_destination?.phone_number;
		if (current !== TRANSFER_NUMBER) builtIns.transfer_to_number = transferTool(TRANSFER_NUMBER);
	}
	if (Object.keys(builtIns).length) setPrompt('built_in_tools', builtIns);

	// Test placeholders for the variables the app sends with each call.
	const existing = before.conversation_config?.agent?.dynamic_variables?.dynamic_variable_placeholders ?? {};
	if (Object.keys(placeholders).some((key) => !(key in existing))) {
		(patch.conversation_config ??= { agent: { prompt: {} } }).agent.dynamic_variables = {
			dynamic_variable_placeholders: { ...placeholders, ...existing }
		};
	}

	if (patch.conversation_config && !Object.keys(patch.conversation_config.agent.prompt).length) delete patch.conversation_config.agent.prompt;
	if (Object.keys(patch).length) {
		await api('PATCH', `/v1/convai/agents/${encodeURIComponent(AGENT_ID)}`, patch);
		for (const name of Object.keys(builtIns)) changed(name === 'transfer_to_number' ? `transfers to ${TRANSFER_NUMBER}` : `added ${name}`);
		if (patch.conversation_config?.agent?.dynamic_variables) changed('added test placeholders for the call variables');
		const after = await getAgent();
		if (promptOf(after).prompt !== prompt.prompt) {
			bad(
				'The system prompt changed unexpectedly while updating the agent.',
				`Restore the previous version${before.version_id ? ` (${before.version_id})` : ''} in the ElevenLabs dashboard.`
			);
		}
	}
	await check(argument, publicUrl);
}

// ---------- check ----------

async function check(argument, knownUrl) {
	const agent = await getAgent();
	console.log(bold(`\nChecking "${agent.name}" (${AGENT_ID})`));
	const prompt = promptOf(agent);
	const tools = prompt.built_in_tools ?? {};

	// The status webhook.
	const publicUrl = knownUrl ?? (await findPublicUrl(argument));
	const found = await findStatusTool(agent);
	const url = found?.tool.tool_config?.api_schema?.url;
	if (!found) bad(`No ${STATUS_TOOL} tool, so the app can't follow the call.`, 'Run pnpm agent:sync');
	else if (!found.attached) bad(`${STATUS_TOOL} exists but isn't attached to this agent.`, 'Run pnpm agent:sync');
	else if (!url || url.includes('.invalid')) bad(`${STATUS_TOOL} doesn't point at the app yet.`, 'Start the tunnel, then run pnpm agent:sync');
	else if (publicUrl?.url && url !== publicUrl.url + STATUS_PATH) bad(`${STATUS_TOOL} calls ${url}, but the app is at ${publicUrl.url}.`, 'Run pnpm agent:sync');
	else ok(`${STATUS_TOOL} → ${url}`);
	if (found) {
		const schema = found.tool.tool_config.api_schema ?? {};
		if (schema.request_headers?.['x-webhook-secret']?.variable_name !== 'secret__webhook_secret') {
			warn(`${STATUS_TOOL} doesn't send the secret the app expects.`, 'Run pnpm agent:sync to reset the tool');
		}
		if (schema.request_body_schema?.properties?.call_id?.dynamic_variable !== 'call_id') {
			bad(`${STATUS_TOOL} doesn't send call_id, so updates can't be matched to a call.`, 'Run pnpm agent:sync to reset the tool');
		}
	}

	// Built-in tools.
	const missing = Object.keys(builtInTools).filter((name) => !tools[name]);
	if (missing.length) bad(`Missing phone tools: ${missing.join(', ')}`, 'Run pnpm agent:sync');
	else ok('Phone tools: skip turn, keypad tones, end call, voicemail and language detection');
	const transferTo = tools.transfer_to_number?.params?.transfers?.map((rule) => rule.transfer_destination?.phone_number).filter(Boolean) ?? [];
	if (!TRANSFER_NUMBER) bad('TRANSFER_NUMBER is not set, so nobody is called when a person answers.', 'Add your mobile in E.164 (e.g. +49151…) to .env, then run pnpm agent:sync');
	else if (!E164.test(TRANSFER_NUMBER)) bad(`TRANSFER_NUMBER "${env.TRANSFER_NUMBER}" is not in E.164 format.`, 'Use +<country code><number>, e.g. +4915112345678');
	else if (!transferTo.includes(TRANSFER_NUMBER)) bad(`The agent transfers to ${transferTo.join(', ') || 'nobody'}, not TRANSFER_NUMBER.`, 'Run pnpm agent:sync');
	else ok(`Transfers to ${TRANSFER_NUMBER} (conference, with a briefing)`);

	// Call behaviour.
	const turn = agent.conversation_config?.turn ?? {};
	const maxMinutes = Math.round((agent.conversation_config?.conversation?.max_duration_seconds ?? 600) / 60);
	warn(`Calls end after ${maxMinutes} min (max call duration in the agent settings).`, maxMinutes < 30 ? 'Long hold queues need more; raise it in the agent settings if needed' : undefined);
	if ((turn.turn_timeout ?? 7) < 15) warn(`The agent speaks up after ${turn.turn_timeout ?? 7} s of silence.`, 'A longer turn timeout keeps it quiet on hold');
	if (turn.silence_end_call_timeout > 0 && turn.silence_end_call_timeout < 1800) {
		bad(`The agent hangs up after ${turn.silence_end_call_timeout} s of silence, which ends calls on hold.`, 'Set "end call after silence" to off');
	}
	if (LANGUAGE) {
		if (agent.platform_settings?.overrides?.conversation_config_override?.agent?.language === true) ok(`Calls start in "${LANGUAGE}"`);
		else bad(`AGENT_LANGUAGE="${LANGUAGE}" but the agent doesn't allow a language override, so calls will be rejected.`, 'Agent → Security → Overrides: enable Language, or clear AGENT_LANGUAGE');
	}

	// Phone number.
	if (!env.ELEVENLABS_PHONE_NUMBER_ID) {
		bad('ELEVENLABS_PHONE_NUMBER_ID is not set.', 'Import your Twilio number in ElevenLabs (Phone Numbers → Import) and copy its ID into .env');
	} else {
		try {
			const number = await api('GET', `/v1/convai/phone-numbers/${encodeURIComponent(env.ELEVENLABS_PHONE_NUMBER_ID)}`);
			if (number.provider && number.provider !== 'twilio') bad(`The phone number is a ${number.provider} number; the app dials through Twilio.`, 'Import a Twilio number');
			else ok(`Dials from ${number.phone_number ?? env.ELEVENLABS_PHONE_NUMBER_ID}${number.label ? ` (${number.label})` : ''}`);
		} catch (err) {
			bad(`ELEVENLABS_PHONE_NUMBER_ID doesn't work: ${err.message}`, 'Copy the ID from ElevenLabs → Phone Numbers');
		}
	}

	// .env bits the app itself needs.
	if (!env.WEBHOOK_SECRET || env.WEBHOOK_SECRET === 'change-me') warn('WEBHOOK_SECRET is empty or the example value.', 'Set a random string, e.g. `openssl rand -hex 16`');
	else ok('WEBHOOK_SECRET is set');
	if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) warn('No Twilio credentials, so "End call" in the app cannot hang up.', 'Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
	if (env.DEMO_TARGET_NUMBER) ok(`Demo safety on: every call goes to ${env.DEMO_TARGET_NUMBER}`);

	// Can ElevenLabs reach the app?
	if (!publicUrl?.url) {
		warn('No tunnel found, so the reachability check was skipped.', 'Start `cloudflared tunnel --url http://localhost:5173`, or set TUNNEL_URL');
	} else {
		const health = await appHealth(publicUrl.url);
		if (!health) bad(`${publicUrl.url} doesn't reach the app.`, 'Is `pnpm dev` running, and the tunnel pointed at port 5173?');
		else if (!health.ready) bad(`The app is reachable, but its .env is missing ${health.missing.join(', ')}.`, 'Fill them in and restart pnpm dev');
		else ok(`ElevenLabs can reach the app at ${publicUrl.url}`);
	}

	console.log(problems ? `\n${red(`${problems} thing${problems === 1 ? '' : 's'} to fix.`)}\n` : `\n${green('Ready for a test call.')}\n`);
	process.exitCode = problems ? 1 : 0;
}

// ---------- main ----------

const [command = 'check', argument] = process.argv.slice(2);
if (!['sync', 'check'].includes(command)) {
	console.error('Usage: node scripts/agent.mjs sync [tunnel-url] | check');
	process.exit(2);
}
if (!env.ELEVENLABS_API_KEY || !AGENT_ID) {
	console.error(red('Set ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID in .env first.'));
	process.exit(1);
}
try {
	await (command === 'sync' ? sync(argument) : check(argument));
} catch (err) {
	console.error(red(`\n${err.message}\n`));
	process.exit(1);
}
