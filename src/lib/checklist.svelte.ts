import type { DocumentDetail } from '#lib/types.ts';

// Preview-only session state. Real completion always comes from analysis.action_items[].done.
export const demoChecklist = $state({ completed: {} as Record<string, number[]> });

export function resetDemoChecklist() { demoChecklist.completed = {}; }

export function setDemoCompleted(doc: DocumentDetail, index: number, complete: boolean) {
  const existing = completedActions(doc, true);
  demoChecklist.completed[doc.id] = complete ? [...new Set([...existing, index])] : existing.filter(item => item !== index);
}

export function completedActions(doc: DocumentDetail, demo = false): number[] {
  return demo && demoChecklist.completed[doc.id]
    ? demoChecklist.completed[doc.id].filter(index => index < doc.analysis.action_items.length)
    : doc.analysis.action_items.flatMap((action, index) => action.done ? [index] : []);
}

export function isDocumentDone(doc: DocumentDetail, demo = false) {
  return doc.analysis.action_items.length > 0 && completedActions(doc, demo).length === doc.analysis.action_items.length;
}
