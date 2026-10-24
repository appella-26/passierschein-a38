import type { TranslationKey } from '#lib/i18n.ts';

const KEY = 'appella.upload-draft';
const errors: TranslationKey[] = ['imageOnly', 'resizeError', 'analysisError', 'analysisConfiguration', 'analysisRateLimit', 'analysisInvalidResponse', 'analysisUnavailable', 'analysisNetwork', 'analysisTimeout', 'analysisStorage', 'analysisInvalidInput', 'analysisInterrupted', 'analysisNavigation'];
export interface UploadDraft {
  version: 1;
  phase: 'ready' | 'sending' | 'error' | 'result';
  pages: { name: string; data: string }[];
  error?: TranslationKey | null;
  retryUntil?: number;
  requestId?: string | null;
  resultId?: string | null;
}

export function clearUploadDraft() {
  try { sessionStorage.removeItem(KEY); } catch { /* Storage is optional. */ }
}

export function readUploadDraft(): UploadDraft | null {
  try {
    const text = sessionStorage.getItem(KEY);
    if (!text) return null;
    if (text.length > 4_500_000) throw new Error('Draft exceeds recovery budget');
    const draft = JSON.parse(text);
    if (draft?.version !== 1 || !['ready', 'sending', 'error', 'result'].includes(draft.phase) || !Array.isArray(draft.pages)
      || !draft.pages.every((page: { name?: unknown; data?: unknown }) => typeof page?.name === 'string' && typeof page.data === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(page.data))
      || (draft.error != null && !errors.includes(draft.error))
      || (draft.retryUntil !== undefined && (!Number.isFinite(draft.retryUntil) || draft.retryUntil < 0))
      || (draft.requestId != null && (typeof draft.requestId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(draft.requestId)))
      || (draft.resultId != null && (typeof draft.resultId !== 'string' || !/^[\w-]+$/.test(draft.resultId)))
      || (draft.phase === 'result' && !draft.resultId)) throw new Error('Invalid recovery draft');
    return draft;
  } catch { clearUploadDraft(); return null; }
}

export function writeUploadDraft(draft: UploadDraft): boolean {
  try {
    const text = JSON.stringify(draft);
    if (text.length > 4_500_000) throw new Error('Draft exceeds recovery budget');
    sessionStorage.setItem(KEY, text);
    return true;
  } catch {
    // Never leave an older set of pages behind. A small checkpoint can still explain an interruption.
    clearUploadDraft();
    try { sessionStorage.setItem(KEY, JSON.stringify({ ...draft, pages: [] })); } catch { /* Explain unavailable recovery in the UI. */ }
    return false;
  }
}

export function clearCompletedUpload(id: string) {
  const draft = readUploadDraft();
  if (draft?.phase === 'result' && draft.resultId === id) clearUploadDraft();
}
