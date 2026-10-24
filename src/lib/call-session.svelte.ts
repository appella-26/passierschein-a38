import type { CallEvent, CallState } from '#lib/types.ts';
import { notifyHuman } from '#lib/notifications.svelte.ts';

export interface CallContext {
  id: string;
  senderName: string;
  toNumber: string;
  purpose: string;
  reference: string;
  letterId: string;
  demo?: boolean;
  /** "browser": no phone line, a second device answers at /hotline/<id> */
  mode?: 'phone' | 'browser';
}
export const callSession = $state({
  context: null as CallContext | null,
  id: '',
  events: [] as CallEvent[],
  state: 'dialing' as CallState,
  connection: 'loading' as 'loading' | 'live' | 'reconnecting' | 'unavailable'
});
export const callStates: CallState[] = ['dialing', 'ivr', 'on_hold', 'human_detected', 'transferring', 'connected', 'voicemail', 'failed', 'ended'];
export const terminalStates: CallState[] = ['failed', 'ended'];
let source: EventSource | undefined;
let alertTimer: ReturnType<typeof setTimeout> | undefined;
let alerted = false;

export function saveCallContext(context: CallContext) {
  callSession.context = context;
  try { sessionStorage.setItem('appella.call', JSON.stringify(context)); } catch { /* Metadata is optional. */ }
}

export function restoreCallContext() {
  try {
    const value = JSON.parse(sessionStorage.getItem('appella.call') ?? 'null');
    if (value && ['id', 'senderName', 'toNumber', 'purpose', 'reference', 'letterId'].every(key => typeof value[key] === 'string') && (value.demo === undefined || typeof value.demo === 'boolean') && (value.mode === undefined || value.mode === 'phone' || value.mode === 'browser')) callSession.context = value;
  } catch { /* SSE remains usable even without metadata. */ }
}

export function stopCallEvents() {
  source?.close();
  source = undefined;
  clearTimeout(alertTimer);
}

export function receiveEvent(event: CallEvent) {
  if (!callStates.includes(event.state) || typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at)) || (event.note !== undefined && typeof event.note !== 'string')) return;
  const duplicate = callSession.events.some(item => item.at === event.at && item.state === event.state && item.note === event.note);
  if (duplicate) return;
  callSession.events.push(event);
  callSession.state = event.state;
  callSession.connection = 'live';
  // "transferring" also alerts, in case the human_detected report never arrived.
  if ((event.state === 'human_detected' || event.state === 'transferring') && !alerted) {
    clearTimeout(alertTimer);
    // The endpoint immediately replays history. Don't alert for a call already finished.
    alertTimer = setTimeout(() => {
      if (!terminalStates.includes(callSession.state)) { notifyHuman(); alerted = true; }
    }, 150);
  }
  if (terminalStates.includes(event.state)) stopCallEvents();
}

export function watchCall(id: string, demo = false) {
  if (callSession.id === id && ((source && source.readyState !== EventSource.CLOSED) || demo || terminalStates.includes(callSession.state))) return;
  stopCallEvents();
  const sameCall = callSession.id === id;
  if (!sameCall) { callSession.events = []; callSession.state = 'dialing'; alerted = false; }
  callSession.id = id;
  callSession.connection = 'loading';
  if (demo) {
    if (!sameCall || !callSession.events.length) receiveEvent({ state: 'dialing', at: new Date().toISOString() });
    return;
  }
  source = new EventSource(`/api/calls/${encodeURIComponent(id)}/events`);
  source.onmessage = message => {
    try { receiveEvent(JSON.parse(message.data) as CallEvent); } catch { /* Ignore malformed messages, never invent progress. */ }
  };
  source.onopen = () => { callSession.connection = 'live'; };
  source.onerror = () => {
    if (terminalStates.includes(callSession.state)) return;
    callSession.connection = source?.readyState === EventSource.CLOSED ? 'unavailable' : 'reconnecting';
  };
}
