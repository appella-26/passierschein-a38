import type { DocumentDetail } from '#lib/types.ts';

export class ApiError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}

export function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal });
}

const details = new Map<string, DocumentDetail>();
export function cacheDocument(doc: DocumentDetail) { details.set(doc.id, doc); }
export function cachedDocument(id: string) { return details.get(id); }
export async function getDocument(id: string, signal?: AbortSignal): Promise<DocumentDetail> {
  const cached = details.get(id);
  if (cached) return cached;
  const doc = await request<DocumentDetail>(`/api/documents/${encodeURIComponent(id)}`, { signal });
  cacheDocument(doc);
  return doc;
}
