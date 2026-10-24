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
  demo: false,
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
  try { sessionStorage.setItem(context.demo ? 'appella.demo.call' : 'appella.call', JSON.stringify(context)); } catch { /* Metadata is optional. */ }
}

export function restoreCallContext(demo = false) {
  callSession.context = null;
  try {
    const value = JSON.parse(sessionStorage.getItem(demo ? 'appella.demo.call' : 'appella.call') ?? 'null');
    if (value && ['id', 'senderName', 'toNumber', 'purpose', 'reference', 'letterId'].every(key => typeof value[key] === 'string') && (value.demo === undefined || typeof value.demo === 'boolean') && !!value.demo === demo && (value.mode === undefined || value.mode === 'phone' || value.mode === 'browser')) callSession.context = value;
  } catch { /* SSE remains usable even without metadata. */ }
}

function forgetCallContext(id: string, demo: boolean) {
  if (callSession.context?.id === id && !!callSession.context.demo === demo) callSession.context = null;
  try {
    const key = demo ? 'appella.demo.call' : 'appella.call';
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (saved?.id === id && !!saved.demo === demo) sessionStorage.removeItem(key);
  } catch { /* An unavailable call must still stop monitoring if storage is disabled. */ }
}

export function selectCallMode(demo: boolean) {
  if (callSession.demo !== demo) {
    stopCallEvents();
    callSession.demo = demo;
    callSession.id = ''; callSession.events = []; callSession.state = 'dialing';
    callSession.connection = 'loading'; alerted = false;
    restoreCallContext(demo);
  }
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
  selectCallMode(demo);
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
  const current = new EventSource(`/api/calls/${encodeURIComponent(id)}/events`);
  source = current;
  current.onmessage = message => {
    if (source !== current) return;
    try {
      const event = JSON.parse(message.data);
      if (event?.type === 'unavailable') {
        stopCallEvents();
        callSession.connection = 'unavailable';
        forgetCallContext(id, demo);
      } else receiveEvent(event as CallEvent);
    } catch { /* Ignore malformed messages, never invent progress. */ }
  };
  current.onopen = () => { if (source === current) callSession.connection = 'live'; };
  current.onerror = () => {
    if (source !== current) return;
    if (terminalStates.includes(callSession.state)) return;
    callSession.connection = source?.readyState === EventSource.CLOSED ? 'unavailable' : 'reconnecting';
  };
}
