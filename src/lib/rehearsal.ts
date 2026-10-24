// Browser rehearsal: what the "Appella Browser Rehearsal" agent may report through its
// report_browser_status client tool. The agent's arguments are model output, so check them.

export const REHEARSAL_STATES = ['ivr', 'on_hold', 'human_detected', 'voicemail'] as const;
export type RehearsalState = (typeof REHEARSAL_STATES)[number];

export interface RehearsalStep {
  state: RehearsalState;
  note?: string;
  at: string;
}

const NOTE_MAX = 240;

/** Returns the reported phase, or null for anything the tool's schema doesn't allow. */
export function parseStatus(params: unknown): Omit<RehearsalStep, 'at'> | null {
  const { state, note } = (params ?? {}) as { state?: unknown; note?: unknown };
  if (typeof state !== 'string' || !(REHEARSAL_STATES as readonly string[]).includes(state)) return null;
  const text = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '';
  return { state: state as RehearsalState, ...(text ? { note: text } : {}) };
}

/** Each phase is shown once, in the order it was first reported. */
export function addStep(steps: RehearsalStep[], params: unknown, at = new Date()): RehearsalStep[] {
  const status = parseStatus(params);
  if (!status || steps.some((step) => step.state === status.state)) return steps;
  return [...steps, { ...status, at: at.toISOString() }];
}
