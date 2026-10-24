import { streamChat, undo, type AssistantEvent, type CallDraft } from '#lib/assistant-client.ts';
import type { Language, TranslationKey } from '#lib/i18n.ts';

type UiEvent = Extract<AssistantEvent, { type: 'ui' }>;
export interface ChatChange {
  eventId: number; caseId: string; summary: string;
  status: 'ready' | 'undoing' | 'undone' | 'failed';
}
export interface ChatAction { event: UiEvent; failed: boolean }
export interface ChatMessage {
  id: number; role: 'user' | 'assistant'; content: string;
  requestContent?: string;
  status: 'done' | 'pending' | 'failed' | 'stopped';
  changes: ChatChange[]; actions: ChatAction[]; toolFailed: boolean;
}
export interface ChatThread {
  key: string; demo: boolean; caseId: string | null; draft: string;
  messages: ChatMessage[]; pending: boolean; undoing: boolean;
  activity: TranslationKey;
  refs: { letters: Record<string, { title: string; date: string | null }>; cases: Record<string, { title: string }> };
}

// Conversation state is browser memory only, never shared with demo or written to localStorage.
const session = $state({ threads: {} as Record<string, ChatThread> });
const controllers = new Map<string, AbortController>();
let sequence = 0;

export function getChatThread(demo: boolean, caseId: string | null): ChatThread {
  const key = `${demo ? 'demo' : 'live'}:${caseId ?? 'all'}`;
  session.threads[key] ??= { key, demo, caseId, draft: '', messages: [], pending: false, undoing: false,
    activity: 'chatThinking', refs: { letters: {}, cases: {} } };
  return session.threads[key];
}

export function stopChat(thread: ChatThread) {
  controllers.get(thread.key)?.abort();
  controllers.delete(thread.key);
  thread.pending = false;
  const last = thread.messages.at(-1);
  if (last?.status === 'pending') last.status = 'stopped';
}
export function clearChat(thread: ChatThread) {
  stopChat(thread);
  thread.messages = []; thread.draft = ''; thread.refs = { letters: {}, cases: {} };
}
export function resetDemoChats() {
  for (const thread of Object.values(session.threads)) {
    if (thread.demo) { stopChat(thread); delete session.threads[thread.key]; }
  }
}

const writeTools = new Set(['create_case', 'rename_case', 'set_case_status', 'move_letter', 'set_todo_done', 'add_case_note']);
function actionKey(event: UiEvent): string {
  return event.action === 'open_case' ? `case:${event.case_id}`
    : event.action === 'open_letter' ? `letter:${event.letter_id}` : `call:${event.call.letter_id}`;
}

export async function sendChat(thread: ChatThread, text: string, lang: Language, letterId: string | null = null) {
  const content = text.trim();
  const requestContent = letterId ? `[Selected letter: ${letterId}]\n${content}` : content;
  if (!content || requestContent.length > 4000 || thread.pending || thread.undoing) return;
  const history = thread.messages.filter(message => message.content.trim()).map(message => ({ role: message.role, content: (message.requestContent ?? message.content).slice(0, 4000) }));
  history.push({ role: 'user', content: requestContent });
  thread.messages.push({ id: ++sequence, role: 'user', content, requestContent, status: 'done', changes: [], actions: [], toolFailed: false });
  thread.messages.push({ id: ++sequence, role: 'assistant', content: '', status: 'pending', changes: [], actions: [], toolFailed: false });
  const reply = thread.messages.at(-1)!;
  thread.draft = ''; thread.pending = true; thread.activity = 'chatThinking';
  const abort = new AbortController();
  controllers.set(thread.key, abort);
  const receive = (event: AssistantEvent) => {
    if (abort.signal.aborted || reply.status !== 'pending') return;
    switch (event.type) {
      case 'text': reply.content += event.delta; break;
      case 'refs':
        thread.refs = { letters: { ...thread.refs.letters, ...event.letters }, cases: { ...thread.refs.cases, ...event.cases } };
        break;
      case 'tool':
        thread.activity = event.status === 'start' ? writeTools.has(event.name) ? 'chatUpdating' : 'chatSearching' : 'chatThinking';
        if (event.status === 'done' && !event.ok) reply.toolFailed = true;
        break;
      case 'change':
        if (!reply.changes.some(change => change.eventId === event.event_id)) reply.changes.push({ eventId: event.event_id, caseId: event.case_id, summary: event.summary, status: 'ready' });
        break;
      case 'ui':
        if (!reply.actions.some(action => actionKey(action.event) === actionKey(event))) reply.actions.push({ event, failed: false });
        break;
      case 'done': reply.status = reply.content.trim() || reply.changes.length || reply.actions.length ? 'done' : 'failed'; break;
      case 'error': reply.status = 'failed'; break;
    }
  };
  try {
    if (thread.demo) {
      const { streamDemoChat } = await import('#lib/mock/chat.ts');
      if (!abort.signal.aborted) await streamDemoChat(content, lang, thread.caseId, receive, abort.signal, letterId);
    } else await streamChat({ messages: history, case_id: thread.caseId, lang }, receive, abort.signal);
    if (reply.status === 'pending') reply.status = abort.signal.aborted ? 'stopped' : 'failed';
  } catch { if (!abort.signal.aborted) reply.status = 'failed'; }
  finally {
    if (controllers.get(thread.key) === abort) { controllers.delete(thread.key); thread.pending = false; }
  }
}

export async function undoChatChange(thread: ChatThread, change: ChatChange, lang: Language) {
  if (thread.pending || thread.undoing || change.status === 'undone') return;
  thread.undoing = true; change.status = 'undoing';
  try {
    const ok = thread.demo ? (await import('#lib/mock/chat.ts')).undoDemoChange(change.eventId, lang) : await undo(change.eventId);
    change.status = ok ? 'undone' : 'failed';
  } catch { change.status = 'failed'; }
  finally { thread.undoing = false; }
}

export type { CallDraft };
