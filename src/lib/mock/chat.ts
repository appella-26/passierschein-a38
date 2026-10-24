import type { AssistantEvent } from '#lib/assistant-client.ts';
import type { Language } from '#lib/i18n.ts';
import { getMockDocuments } from './data.ts';
import { completedActions, setDemoCompleted } from '#lib/checklist.svelte.ts';

let sequence = 100000;
const changes = new Map<number, { letterId: string; index: number; before: boolean }>();
function pause(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 160);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

export async function streamDemoChat(text: string, lang: Language, caseId: string | null, emit: (event: AssistantEvent) => void, signal: AbortSignal, letterId: string | null = null) {
  const documents = getMockDocuments(lang);
  const doc = documents.find(item => item.id === letterId) ?? documents.find(item => caseId === `demo-case-${item.id}`) ?? documents[0];
  const caseKey = caseId ?? 'demo-case';
  const en = lang === 'en';
  emit({ type: 'tool', name: 'get_letter', status: 'start', args: {} });
  await pause(signal);
  if (signal.aborted) return;
  emit({ type: 'refs', letters: { [doc.id]: { title: doc.document_type, date: doc.letter_date } }, cases: { [caseKey]: { title: doc.analysis.case_title } } });
  emit({ type: 'tool', name: 'get_letter', status: 'done', ok: true });
  let reply = `${doc.analysis.summary}\n\n[[letter:${doc.id}]]`;
  if (/mark.*(?:complete|done)|complete the|tick|abhaken|markier|als erledigt/i.test(text) && doc.analysis.action_items.length) {
    const eventId = ++sequence;
    changes.set(eventId, { letterId: doc.id, index: 0, before: completedActions(doc, true).includes(0) });
    setDemoCompleted(doc, 0, true);
    emit({ type: 'change', event_id: eventId, case_id: caseKey, summary: en ? 'First task marked as complete (demo).' : 'Erste Aufgabe als erledigt markiert (Demo).' });
    reply = en ? 'The first task is complete. You can undo it below.' : 'Die erste Aufgabe ist erledigt. Du kannst die Änderung unten rückgängig machen.';
  } else if (/call|anruf|telefon/i.test(text)) {
    const index = doc.analysis.action_items.findIndex(action => action.type === 'call');
    const action = doc.analysis.action_items[index];
    if (action) {
      emit({ type: 'ui', action: 'prepare_call', call: { letter_id: doc.id, todo_index: index, toNumber: action.phone, phone_raw: action.phone_raw,
        senderName: doc.sender_name, purpose: action.call_purpose_de ?? '', reference: doc.analysis.references.map(ref => ref.value).join(', '), letterDate: doc.letter_date } });
      reply = en ? 'Review the number and reason before starting a call.' : 'Prüfe Nummer und Gesprächsgrund, bevor du einen Anruf startest.';
    }
  } else if (/case|akte/i.test(text)) {
    reply = `${en ? 'These letters belong together:' : 'Diese Briefe gehören zusammen:'} [[case:${caseKey}]]`;
  }
  const middle = Math.floor(reply.length / 2);
  emit({ type: 'text', delta: reply.slice(0, middle) });
  await pause(signal);
  if (signal.aborted) return;
  emit({ type: 'text', delta: reply.slice(middle) });
  emit({ type: 'done' });
}

export function undoDemoChange(eventId: number, lang: Language) {
  const change = changes.get(eventId);
  const doc = change && getMockDocuments(lang).find(item => item.id === change.letterId);
  if (!change || !doc) return false;
  setDemoCompleted(doc, change.index, change.before); changes.delete(eventId);
  return true;
}
