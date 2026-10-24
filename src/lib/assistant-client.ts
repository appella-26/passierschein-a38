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
//   ui       → explicit links, case previews or call review (never automatic navigation/dialling)
//   error    → a safe localized message; partial text and saved changes remain available
import type { AssistantEvent, CallDraft } from './server/assistant.ts';
import { language, t } from '#lib/i18n.ts';

export type { AssistantEvent, CallDraft };

export function validChatId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,128}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
}
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const nullableText = (value: unknown) => value === null || typeof value === 'string';

function parseEvent(line: string): AssistantEvent {
  const value = JSON.parse(line);
  if (!record(value)) throw new Error('Invalid chat event');
  if (value.type === 'text' && typeof value.delta === 'string') return value as AssistantEvent;
  if (value.type === 'done') return { type: 'done' };
  if (value.type === 'error') return { type: 'error', message: t('chatReplyFailed') };
  if (value.type === 'tool' && typeof value.name === 'string'
    && ((value.status === 'start' && record(value.args)) || (value.status === 'done' && typeof value.ok === 'boolean'))) return value as AssistantEvent;
  if (value.type === 'change' && Number.isSafeInteger(value.event_id) && value.event_id > 0 && validChatId(value.case_id) && typeof value.summary === 'string') return value as AssistantEvent;
  if (value.type === 'refs' && record(value.letters) && record(value.cases)
    && Object.entries(value.letters).every(([id, ref]) => validChatId(id) && record(ref) && typeof ref.title === 'string' && nullableText(ref.date))
    && Object.entries(value.cases).every(([id, ref]) => validChatId(id) && record(ref) && typeof ref.title === 'string')) return value as AssistantEvent;
  if (value.type === 'ui') {
    if (value.action === 'open_letter' && validChatId(value.letter_id)) return value as AssistantEvent;
    if (value.action === 'open_case' && validChatId(value.case_id)) return value as AssistantEvent;
    const call = value.call;
    if (value.action === 'prepare_call' && record(call) && validChatId(call.letter_id)
      && (call.todo_index === null || (Number.isSafeInteger(call.todo_index) && call.todo_index >= 0))
      && ['toNumber', 'phone_raw', 'letterDate'].every(key => nullableText(call[key]))
      && ['senderName', 'purpose', 'reference'].every(key => typeof call[key] === 'string')) return value as AssistantEvent;
  }
  throw new Error('Invalid chat event');
}

export async function streamChat(
  body: { messages: { role: 'user' | 'assistant'; content: string }[]; case_id?: string | null; lang?: 'de' | 'en' },
  onEvent: (e: AssistantEvent) => void,
  signal?: AbortSignal
) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, lang: body.lang ?? language.current }),
      signal
    });
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', message: !res.ok ? t('assistantError', { status: res.status }) : t('chatReplyFailed') });
      return;
    }
    reader = res.body.getReader();
    signal?.addEventListener('abort', cancel, { once: true });
    const decoder = new TextDecoder();
    let buf = '';
    let finished = false;
    const emitLine = (line: string) => {
      if (finished || signal?.aborted || !line.trim()) return;
      const event = parseEvent(line);
      finished = event.type === 'done' || event.type === 'error';
      onEvent(event);
    };
    while (!finished && !signal?.aborted) {
      const { value, done } = await reader.read();
      if (signal?.aborted) break;
      if (done) {
        buf += decoder.decode();
        emitLine(buf);
        if (!finished) onEvent({ type: 'error', message: t('chatReplyInterrupted') });
        break;
      }
      buf += decoder.decode(value, { stream: true });
      if (buf.length > 1_000_000) throw new Error('Chat event exceeds the client limit');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        emitLine(line);
      }
    }
  } catch {
    if (!signal?.aborted) onEvent({ type: 'error', message: t('chatReplyFailed') });
  } finally {
    signal?.removeEventListener('abort', cancel);
    try { await reader?.cancel(); } catch { /* A disconnected stream is already closed. */ }
    reader?.releaseLock();
  }
}

export async function undo(eventId: number): Promise<boolean> {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return false;
  try { return (await fetch(`/api/case-events/${eventId}/undo`, { method: 'POST' })).ok; }
  catch { return false; }
}

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
