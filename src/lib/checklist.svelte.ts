export const checklist = $state({ completed: {} as Record<string, number[]>, ready: false });

export function initChecklist() {
  if (checklist.ready) return;
  try {
    const value: unknown = JSON.parse(localStorage.getItem('appella.checklist') ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [id, entries] of Object.entries(value)) {
        if (Array.isArray(entries)) checklist.completed[id] = entries.filter((entry): entry is number => Number.isInteger(entry) && entry >= 0);
      }
    }
  } catch { /* An unavailable or invalid storage entry must not prevent reading a letter. */ }
  checklist.ready = true;
}

export function setCompleted(id: string, index: number, complete: boolean) {
  const existing = checklist.completed[id] ?? [];
  checklist.completed[id] = complete ? [...new Set([...existing, index])] : existing.filter(item => item !== index);
  try { localStorage.setItem('appella.checklist', JSON.stringify(checklist.completed)); } catch { /* Session-only state still works. */ }
}

export function isDocumentDone(id: string, actionCount: number) {
  return actionCount > 0 && (checklist.completed[id] ?? []).filter(index => index < actionCount).length === actionCount;
}
