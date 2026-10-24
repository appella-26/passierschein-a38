// src/lib/server/assistant.ts
// The "Bürger-Assistent": a chat agent over letters and cases, using hosted Gemma 4 via
// Gemini by default (local Ollama is optional). It searches the knowledge graph and edits cases
// (every edit is logged and undoable), and can open screens in the app. It can never dial a
// phone number on its own: prepare_call only opens the confirm sheet for the user.

import { GoogleGenAI, type Content, type Part } from '@google/genai';
import * as env from '$app/env/private';
import { OLLAMA_URL, MODEL, GEMINI_MODEL, geminiModelName } from '#lib/server/analyze.ts';
import { search, getDocument, graphNeighbors } from './db.ts';
import {
	listCases, getCase, listOpenDeadlines, createCase, renameCase, setCaseStatus, moveLetter,
	setTodoDone, addCaseNote, CaseError, type ChangeResult
} from './cases.ts';

// ---------- events streamed to the browser (NDJSON, one per line) ----------

export type AssistantEvent =
	| { type: 'text'; delta: string }
	| { type: 'tool'; name: string; status: 'start'; args: Record<string, unknown> }
	| { type: 'tool'; name: string; status: 'done'; ok: boolean; error?: string }
	| { type: 'refs'; letters: Record<string, { title: string; date: string | null }>; cases: Record<string, { title: string }> }
	| { type: 'change'; event_id: number; case_id: string; summary: string }
	| { type: 'ui'; action: 'open_case'; case_id: string }
	| { type: 'ui'; action: 'open_letter'; letter_id: string }
	| { type: 'ui'; action: 'prepare_call'; call: CallDraft }
	| { type: 'done' }
	| { type: 'error'; message: string };

export interface CallDraft {
	letter_id: string;
	todo_index: number | null;
	toNumber: string | null; // E.164, user confirms/edits in the sheet
	phone_raw: string | null;
	senderName: string;
	purpose: string;
	reference: string;
	letterDate: string | null;
}

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

type Emit = (e: AssistantEvent) => void;

// ---------- tools ----------

const S = (description: string) => ({ type: 'string', description });

const TOOLS = [
	{ name: 'search_letters', description: 'Full-text + semantic search over all stored letters (German and English queries both work). Use this first for any question about the user\'s letters.', parameters: { type: 'object', properties: { query: S('search terms, e.g. "Steuer Nachzahlung" or "rent"') }, required: ['query'] } },
	{ name: 'list_cases', description: 'List all cases (Akten) with letter count, status and next deadline.', parameters: { type: 'object', properties: {}, required: [] } },
	{ name: 'get_case', description: 'One case with all its letters in chronological order, their deadlines, amounts and to-dos.', parameters: { type: 'object', properties: { case_id: S('case id') }, required: ['case_id'] } },
	{ name: 'get_letter', description: 'Full analysis of one letter: summary, references, deadline, amount, payment details, to-dos, case.', parameters: { type: 'object', properties: { letter_id: S('letter id') }, required: ['letter_id'] } },
	{ name: 'list_open_deadlines', description: 'All upcoming deadlines that still have open to-dos, nearest first.', parameters: { type: 'object', properties: {}, required: [] } },
	{ name: 'graph_neighbors', description: 'Knowledge graph around a letter: its sender, reference numbers, people and topics, and which other letters share each of them.', parameters: { type: 'object', properties: { letter_id: S('letter id') }, required: ['letter_id'] } },
	{ name: 'open_case', description: 'Open a case screen in the app for the user.', parameters: { type: 'object', properties: { case_id: S('case id') }, required: ['case_id'] } },
	{ name: 'open_letter', description: 'Open a letter screen in the app for the user.', parameters: { type: 'object', properties: { letter_id: S('letter id') }, required: ['letter_id'] } },
	{ name: 'create_case', description: 'Create a new case and optionally move letters into it. Only when the user asks to regroup.', parameters: { type: 'object', properties: { title: S('short case title, e.g. "Kfz-Versicherung 2026"'), letter_ids: { type: 'array', items: { type: 'string' }, description: 'letters to move into the new case' } }, required: ['title'] } },
	{ name: 'rename_case', description: 'Rename a case.', parameters: { type: 'object', properties: { case_id: S('case id'), title: S('new title') }, required: ['case_id', 'title'] } },
	{ name: 'set_case_status', description: 'Close a finished case or reopen it.', parameters: { type: 'object', properties: { case_id: S('case id'), status: { type: 'string', enum: ['open', 'closed'] } }, required: ['case_id', 'status'] } },
	{ name: 'move_letter', description: 'Move a letter into another existing case.', parameters: { type: 'object', properties: { letter_id: S('letter id'), case_id: S('target case id') }, required: ['letter_id', 'case_id'] } },
	{ name: 'set_todo_done', description: 'Mark a to-do of a letter as done or open again. todo_index is the 0-based position from get_letter / get_case.', parameters: { type: 'object', properties: { letter_id: S('letter id'), todo_index: { type: 'integer' }, done: { type: 'boolean' } }, required: ['letter_id', 'todo_index', 'done'] } },
	{ name: 'add_case_note', description: 'Append a dated note to a case, e.g. what was agreed on the phone.', parameters: { type: 'object', properties: { case_id: S('case id'), note: S('the note') }, required: ['case_id', 'note'] } },
	{ name: 'draft_reply', description: 'Get the facts needed to draft a reply or objection (Einspruch/Widerspruch) to a letter. Then write the draft in your answer; the user sends it themselves.', parameters: { type: 'object', properties: { letter_id: S('letter id'), goal: S('what the reply should achieve') }, required: ['letter_id', 'goal'] } },
	{ name: 'prepare_call', description: 'Prepare the queue-waiting phone assistant for a letter. Opens a confirm sheet; the USER starts the call. Never claim a call was started.', parameters: { type: 'object', properties: { letter_id: S('letter id'), todo_index: { type: 'integer', description: 'index of the call to-do, if known' } }, required: ['letter_id'] } }
].map((f) => ({ type: 'function', function: f }));

const WRITE_TOOLS = new Set(['create_case', 'rename_case', 'set_case_status', 'move_letter', 'set_todo_done', 'add_case_note']);

const cut = (s: string | null | undefined, n: number) => (s && s.length > n ? s.slice(0, n) + '…' : (s ?? ''));

type Refs = { letters: Record<string, { title: string; date: string | null }>; cases: Record<string, { title: string }> };

function compactLetter(d: any, refs: Refs) {
	refs.letters[d.id] = { title: d.document_type, date: d.letter_date };
	return {
		letter_id: d.id, title: d.document_type, sender: d.sender_name, letter_date: d.letter_date,
		deadline: d.deadline, urgency: d.urgency, case_id: d.case_id, summary: cut(d.summary, 220)
	};
}

async function runTool(name: string, args: any, emit: Emit, refs: Refs): Promise<unknown> {
	const change = (r: ChangeResult) => {
		emit({ type: 'change', ...r });
		return { ok: true, change: r.summary, note: 'Applied. The user can undo it in the app.' };
	};
	const requireLetter = (id: string) => {
		const d = getDocument(String(id ?? ''));
		if (!d) throw new CaseError(`No letter with id "${id}". Use search_letters to find ids.`);
		return d;
	};

	switch (name) {
		case 'search_letters': {
			const hits = await search(String(args.query ?? ''), 8);
			return { results: hits.map((d) => compactLetter(d, refs)) };
		}
		case 'list_cases':
			return {
				cases: listCases().map((c) => {
					refs.cases[c.id] = { title: c.title };
					return { case_id: c.id, title: c.title, status: c.status, letters: c.letter_count, next_deadline: c.next_deadline, urgency: c.urgency };
				})
			};
		case 'get_case': {
			const c = getCase(String(args.case_id ?? ''));
			if (!c) throw new CaseError(`No case with id "${args.case_id}". Use list_cases.`);
			refs.cases[c.id] = { title: c.title };
			return {
				case_id: c.id, title: c.title, status: c.status, notes: cut(c.notes, 600), next_deadline: c.next_deadline,
				letters: c.letters.map((l: any) => ({ ...compactLetter(l, refs), amount_due: l.amount_due, todos: l.todos }))
			};
		}
		case 'get_letter': {
			const d = requireLetter(args.letter_id);
			compactLetter(d, refs);
			if (d.case) refs.cases[d.case.id] = { title: d.case.title };
			const a = d.analysis;
			return {
				letter_id: d.id, title: a.document_type, sender: a.sender, letter_date: a.letter_date, summary: a.summary,
				deadline: a.deadline, deadline_is_estimate: a.deadline_is_estimate, amount_due: a.amount_due, payment: a.payment,
				references: a.references, urgency: a.urgency, case: d.case,
				todos: a.action_items.map((t, i) => ({ index: i, title: t.title, type: t.type, due: t.due, details: t.details, done: !!t.done }))
			};
		}
		case 'list_open_deadlines':
			return {
				deadlines: listOpenDeadlines().map((d) => ({
					...compactLetter(d, refs), case_title: d.case_title, open_todos: d.open_todos
				}))
			};
		case 'graph_neighbors': {
			const d = requireLetter(args.letter_id);
			compactLetter(d, refs);
			const ents = graphNeighbors(d.id);
			ents.forEach((e) => e.letters.forEach((l: any) => (refs.letters[l.id] = { title: l.title, date: l.date })));
			return { letter_id: d.id, entities: ents };
		}
		case 'open_case': {
			const c = getCase(String(args.case_id ?? ''));
			if (!c) throw new CaseError(`No case with id "${args.case_id}".`);
			refs.cases[c.id] = { title: c.title };
			emit({ type: 'ui', action: 'open_case', case_id: c.id });
			return { ok: true, opened: c.title };
		}
		case 'open_letter': {
			const d = requireLetter(args.letter_id);
			compactLetter(d, refs);
			emit({ type: 'ui', action: 'open_letter', letter_id: d.id });
			return { ok: true, opened: d.document_type };
		}
		case 'create_case': {
			const r = createCase(String(args.title ?? ''), Array.isArray(args.letter_ids) ? args.letter_ids.map(String) : [], 'assistant');
			refs.cases[r.case_id] = { title: String(args.title) };
			return { ...change(r), case_id: r.case_id };
		}
		case 'rename_case':
			return change(renameCase(String(args.case_id ?? ''), String(args.title ?? ''), 'assistant'));
		case 'set_case_status':
			return change(setCaseStatus(String(args.case_id ?? ''), args.status, 'assistant'));
		case 'move_letter':
			return change(moveLetter(String(args.letter_id ?? ''), String(args.case_id ?? ''), 'assistant'));
		case 'set_todo_done':
			return change(setTodoDone(String(args.letter_id ?? ''), Number(args.todo_index), args.done !== false, 'assistant'));
		case 'add_case_note':
			return change(addCaseNote(String(args.case_id ?? ''), String(args.note ?? ''), 'assistant'));
		case 'draft_reply': {
			const d = requireLetter(args.letter_id);
			compactLetter(d, refs);
			const a = d.analysis;
			return {
				goal: args.goal, letter: { title: a.document_type, sender: a.sender.name, letter_date: a.letter_date, references: a.references, summary: a.summary, deadline: a.deadline, amount_due: a.amount_due },
				instructions: 'Write a short, polite, formal German letter draft. Start with a "Betreff" line naming the letter and all reference numbers. Use [Platzhalter] for anything you do not know (sender address, user address, reasons, IBAN). Mark it clearly as ENTWURF. Do not cite laws that are not in the letter. Remind the user to check it and send it themselves before the deadline.'
			};
		}
		case 'prepare_call': {
			const d = requireLetter(args.letter_id);
			compactLetter(d, refs);
			const a = d.analysis;
			const idx = Number.isInteger(args.todo_index) ? args.todo_index : a.action_items.findIndex((t) => t.type === 'call');
			const todo = idx >= 0 ? a.action_items[idx] : undefined;
			const call: CallDraft = {
				letter_id: d.id, todo_index: idx >= 0 ? idx : null,
				toNumber: todo?.phone ?? a.sender.phone, phone_raw: todo?.phone_raw ?? null,
				senderName: a.sender.name, purpose: todo?.call_purpose_de ?? `Rückfrage zu ${a.document_type}`,
				reference: a.references.map((r) => `${r.label} ${r.value}`).join(', '), letterDate: a.letter_date
			};
			if (!call.toNumber) return { ok: false, error: 'No phone number found on this letter. Ask the user for the number.' };
			emit({ type: 'ui', action: 'prepare_call', call });
			return { ok: true, note: 'The confirm sheet is now open. The user checks the number and starts the call themselves.' };
		}
		default:
			throw new CaseError(`Unknown tool ${name}`);
	}
}

// ---------- prompt ----------

function systemPrompt(lang: 'de' | 'en', caseId: string | null) {
	const today = new Date().toISOString().slice(0, 10);
	let context = '';
	if (caseId) {
		const c = getCase(caseId);
		if (c) {
			context = `\n\nThe user opened the chat from the case "${c.title}" (case_id ${c.id}). "This case", "hier", "die Akte" refer to it. Its letters:\n` +
				c.letters.map((l: any) => `- ${l.document_type} (letter_id ${l.id}, ${l.letter_date ?? 'no date'}${l.deadline ? `, deadline ${l.deadline}` : ''}, open to-dos: ${l.todos.filter((t: any) => !t.done).length})`).join('\n');
		}
	}
	return `You are the Bürger-Assistent inside a letter app. You help one person understand and organize their official letters (tax office, health insurance, landlord, authorities), grouped into cases (Akten). The archive is stored locally. AI analysis and this chat use the configured model provider, which may be hosted.

Today is ${today}. Answer in ${lang === 'de' ? 'German (du-form, plain language)' : 'English (plain language)'}.

How you work:
- Use tools before answering anything about the user's letters, cases, deadlines or amounts. Never guess or invent letters, dates, amounts or numbers. If tools find nothing, say so.
- Cite every letter you rely on as [[letter:ID]] and every case as [[case:ID]], using ids from tool results. The app turns them into tappable chips. Never show raw ids otherwise.
- When the user clearly asks to change something (rename, regroup, close a case, tick off a to-do, add a note), do it directly with the tool, then say in one sentence what you changed. Changes can be undone in the app. If the request is ambiguous (which letter? which case?), ask one short question instead.
- When the user wants to see something, use open_case / open_letter.
- For phone calls, use prepare_call. It only opens a confirm sheet: the user starts the call. Never say a call is running.
- Drafts (Einspruch, Widerspruch, Antwort): use draft_reply, then write the draft. The user sends it themselves.
- You explain letters; you do not give binding legal or tax advice. For real disputes, suggest a Steuerberater, Mieterverein or Verbraucherzentrale.
- Be brief: short paragraphs or a few bullets, deadlines and amounts in bold.${context}`;
}

// ---------- agent loop ----------

const MAX_ROUNDS = 6;

async function runOllamaAssistant(
	history: ChatMessage[],
	opts: { lang: 'de' | 'en'; caseId: string | null; signal?: AbortSignal },
	emit: Emit
) {
	const messages: any[] = [
		{ role: 'system', content: systemPrompt(opts.lang, opts.caseId) },
		...history.slice(-20).map((m) => ({ role: m.role, content: String(m.content ?? '') }))
	];

	for (let round = 0; round < MAX_ROUNDS; round++) {
		const res = await fetch(`${OLLAMA_URL}/api/chat`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal: opts.signal,
			body: JSON.stringify({
				model: MODEL,
				stream: true,
				think: false,
				tools: TOOLS,
				messages,
				options: { temperature: 0.3, num_ctx: 16384 }
			})
		});
		if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

		// Stream text to the user as it arrives; collect tool calls.
		let content = '';
		const toolCalls: { function: { name: string; arguments: any } }[] = [];
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let nl;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				if (!line) continue;
				const chunk = JSON.parse(line);
				if (chunk.error) throw new Error(chunk.error);
				const m = chunk.message ?? {};
				if (m.content) {
					content += m.content;
					emit({ type: 'text', delta: m.content });
				}
				if (Array.isArray(m.tool_calls)) toolCalls.push(...m.tool_calls);
			}
		}

		if (!toolCalls.length) {
			emit({ type: 'done' });
			return;
		}

		messages.push({ role: 'assistant', content, tool_calls: toolCalls });
		for (const call of toolCalls) {
			const name = call.function?.name;
			let args = call.function?.arguments ?? {};
			if (typeof args === 'string') {
				try { args = JSON.parse(args); } catch { args = {}; }
			}
			emit({ type: 'tool', name, status: 'start', args });
			const refs: Refs = { letters: {}, cases: {} };
			let result: unknown;
			try {
				result = await runTool(name, args, emit, refs);
				emit({ type: 'tool', name, status: 'done', ok: true });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				result = { ok: false, error: msg };
				emit({ type: 'tool', name, status: 'done', ok: false, error: msg });
				if (!(e instanceof CaseError)) console.error('[assistant tool]', name, e);
			}
			if (Object.keys(refs.letters).length || Object.keys(refs.cases).length) emit({ type: 'refs', ...refs });
			messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result) });
		}
		if (toolCalls.some((c) => WRITE_TOOLS.has(c.function?.name))) {
			// Keep the system prompt's case context fresh after edits.
			messages[0] = { role: 'system', content: systemPrompt(opts.lang, opts.caseId) };
		}
	}

	emit({ type: 'text', delta: opts.lang === 'de' ? '\n\n(Ich habe zu viele Schritte gebraucht – formulier die Frage bitte etwas genauer.)' : '\n\n(That took too many steps, please narrow the question down.)' });
	emit({ type: 'done' });
}

/** Hosted equivalent of the starter's tool loop, preserving the same browser events. */
async function runGeminiAssistant(
	history: ChatMessage[],
	opts: { lang: 'de' | 'en'; caseId: string | null; signal?: AbortSignal },
	emit: Emit
) {
	if (!env.GEMINI_API_KEY?.trim()) throw new Error('GEMINI_API_KEY is not configured');
	const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
	const contents: Content[] = history.slice(-20).map((message) => ({
		role: message.role === 'assistant' ? 'model' : 'user',
		parts: [{ text: String(message.content ?? '') }]
	}));
	const functionDeclarations = TOOLS.map(({ function: tool }) => ({
		name: tool.name,
		description: tool.description,
		...(Object.keys(tool.parameters.properties).length ? { parametersJsonSchema: tool.parameters } : {})
	}));

	for (let round = 0; round < MAX_ROUNDS; round++) {
		opts.signal?.throwIfAborted();
		const stream = await ai.models.generateContentStream({
			model: geminiModelName(GEMINI_MODEL),
			contents,
			config: {
				systemInstruction: systemPrompt(opts.lang, opts.caseId),
				temperature: 0.3,
				tools: [{ functionDeclarations }],
				abortSignal: opts.signal
			}
		});
		const parts: Part[] = [];
		for await (const chunk of stream) {
			opts.signal?.throwIfAborted();
			const candidate = chunk.candidates?.[0];
			if (candidate?.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason)) {
				throw new Error('Gemini could not finish the assistant response', { cause: { finishReason: candidate.finishReason } });
			}
			for (const part of candidate?.content?.parts ?? []) {
				// Preserve signatures/function calls in the next model turn, but never expose reasoning.
				parts.push(part);
				if (part.text && !part.thought) emit({ type: 'text', delta: part.text });
			}
		}
		if (!parts.length) throw new Error('Gemini returned an empty assistant response');
		const calls = parts.flatMap((part) => part.functionCall ? [part.functionCall] : []);
		if (!calls.length) {
			if (!parts.some((part) => part.text && !part.thought)) throw new Error('Gemini returned no assistant text');
			emit({ type: 'done' });
			return;
		}
		contents.push({ role: 'model', parts });
		const responses: Part[] = [];
		for (const call of calls) {
			opts.signal?.throwIfAborted();
			if (!call.name) throw new Error('Gemini returned an unnamed tool call');
			const name = call.name;
			const args = call.args ?? {};
			emit({ type: 'tool', name, status: 'start', args });
			const refs: Refs = { letters: {}, cases: {} };
			let result: unknown;
			try {
				result = await runTool(name, args, emit, refs);
				emit({ type: 'tool', name, status: 'done', ok: true });
			} catch (e) {
				const message = e instanceof CaseError ? e.message : 'The assistant tool could not complete this operation';
				result = { ok: false, error: message };
				emit({ type: 'tool', name, status: 'done', ok: false, error: message });
			}
			if (Object.keys(refs.letters).length || Object.keys(refs.cases).length) emit({ type: 'refs', ...refs });
			responses.push({ functionResponse: { name, ...(call.id ? { id: call.id } : {}), response: { output: result } } });
		}
		contents.push({ role: 'user', parts: responses });
	}

	emit({ type: 'text', delta: opts.lang === 'de'
		? '\n\n(Ich habe zu viele Schritte gebraucht – formulier die Frage bitte etwas genauer.)'
		: '\n\n(That took too many steps, please narrow the question down.)' });
	emit({ type: 'done' });
}

export async function runAssistant(
	history: ChatMessage[],
	opts: { lang: 'de' | 'en'; caseId: string | null; signal?: AbortSignal },
	emit: Emit
) {
	const provider = (env.GEMMA_PROVIDER ?? 'gemini').toLowerCase();
	if (provider === 'gemini') return runGeminiAssistant(history, opts, emit);
	if (provider === 'ollama') return runOllamaAssistant(history, opts, emit);
	throw new Error('GEMMA_PROVIDER must be gemini or ollama');
}
