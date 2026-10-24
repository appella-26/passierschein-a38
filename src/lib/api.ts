import type { DocumentDetail } from '#lib/types.ts';

export class ApiError extends Error {
  readonly kind: 'configuration' | 'rateLimit' | 'invalidResponse' | 'unavailable' | 'timeout' | 'storage' | 'invalidInput' | 'generic';
  constructor(public status: number, detail = '', public retryAfter: number | null = null, code?: string, public requestId: string | null = null) {
    // Provider text can contain secrets (notably from Ollama). Classify it, never display it.
    super(`HTTP ${status}`);
    const codes = { configuration: 'configuration', rate_limit: 'rateLimit', invalid_response: 'invalidResponse', unavailable: 'unavailable', timeout: 'timeout', storage: 'storage', invalid_input: 'invalidInput' } as const;
    this.kind = code && Object.hasOwn(codes, code) ? codes[code as keyof typeof codes] : status === 429 ? 'rateLimit'
      : /^The model returned (an empty response|an invalid analysis response)\.?$/.test(detail) ? 'invalidResponse'
      : status === 401 || status === 403
        || /^Gemini is not configured\./.test(detail)
        || /^GEMMA_PROVIDER must be either/.test(detail)
        || ([400, 404].includes(status) && /^Gemini could not analyze this letter\./.test(detail)) ? 'configuration'
      : status === 503 || status === 504 ? 'unavailable' : 'generic';
  }
}

function retryDelay(value: string | null): number | null {
  if (!value?.trim()) return null;
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const requestId = typeof body?.request_id === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.request_id) ? body.request_id : null;
    throw new ApiError(response.status, typeof body?.message === 'string' ? body.message.trim() : '', retryDelay(response.headers.get('Retry-After')), typeof body?.code === 'string' ? body.code : undefined, requestId);
  }
  try { return await response.json() as T; }
  catch { throw new ApiError(502, 'The model returned an invalid analysis response.'); }
}

export function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal });
}

export function getDocument(id: string, signal?: AbortSignal): Promise<DocumentDetail> {
  // Re-read on navigation and after edits: another client or the assistant can change to-dos.
  return request<DocumentDetail>(`/api/documents/${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
}
