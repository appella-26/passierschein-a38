// Browser helpers for the assistant chat (/assistant page).
//
//   const ctl = new AbortController();
//   await streamChat({ messages, case_id, lang }, (e) => { ... }, ctl.signal);
//
// Event handling cheat sheet:
//   text     → append e.delta to the current assistant bubble
//   tool     → show a small "Suche in deinen Briefen …" status while status === 'start'
//   refs     → merge into a titles map, used by splitRefs() to label chips
//   change   → show a card with e.summary and a "Rückgängig" button → undo(e.event_id)
//   ui       → open_case: goto(`/cases/${e.case_id}`) · open_letter: goto(`/letters/${e.letter_id}`)
//              prepare_call: open the confirm-call sheet prefilled with e.call (user starts the call)
//   error    → show e.message
import type { AssistantEvent, CallDraft } from './server/assistant.ts';
import { language, t } from '#lib/i18n.ts';

export type { AssistantEvent, CallDraft };

export async function streamChat(
	body: { messages: { role: 'user' | 'assistant'; content: string }[]; case_id?: string | null; lang?: 'de' | 'en' },
	onEvent: (e: AssistantEvent) => void,
	signal?: AbortSignal
) {
	const res = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ...body, lang: body.lang ?? language.current }),
		signal
	});
	if (!res.ok || !res.body) {
		onEvent({ type: 'error', message: t('assistantError', { status: res.status }) });
		return;
	}
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
			if (line) onEvent(JSON.parse(line));
		}
	}
}

export const undo = (eventId: number) => fetch(`/api/case-events/${eventId}/undo`, { method: 'POST' }).then((r) => r.ok);

export type Segment =
	| { kind: 'text'; text: string }
	| { kind: 'letter'; id: string; label: string }
	| { kind: 'case'; id: string; label: string };

/** Splits assistant text into plain text and [[letter:ID]] / [[case:ID]] chips. */
export function splitRefs(
	text: string,
	titles: { letters: Record<string, { title: string }>; cases: Record<string, { title: string }> }
): Segment[] {
	const out: Segment[] = [];
	const re = /\[\[(letter|case):([\w-]+)\]\]/g;
	let last = 0;
	for (const m of text.matchAll(re)) {
		if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
		const [, kind, id] = m;
		const label = (kind === 'letter' ? titles.letters[id]?.title : titles.cases[id]?.title) ?? t(kind === 'letter' ? 'document' : 'caseLabel');
		out.push({ kind: kind as 'letter' | 'case', id, label });
		last = m.index! + m[0].length;
	}
	if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
	return out;
}
