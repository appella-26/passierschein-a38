// POST /api/chat  { messages: [{ role: 'user'|'assistant', content }], case_id?: string, lang?: 'de'|'en' }
// -> application/x-ndjson stream of AssistantEvent (see src/lib/server/assistant.ts):
//    text deltas, tool start/done, refs (titles for [[letter:ID]] / [[case:ID]] chips),
//    change (undoable edit → POST /api/case-events/:event_id/undo), ui (open_case, open_letter, prepare_call), done | error
import { error } from '@sveltejs/kit';
import { runAssistant, type AssistantEvent, type ChatMessage } from '#lib/server/assistant.ts';

export async function POST({ request }) {
	const body = await request.json();
	const history: ChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
		.filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
		.map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
	if (!history.length || history.at(-1)!.role !== 'user') error(400, 'Last message must be from the user');

	const lang = body.lang === 'de' ? 'de' : 'en';

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			const emit = (e: AssistantEvent) => {
				try {
					controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
				} catch {
					/* client went away */
				}
			};
			try {
				await runAssistant(
					history,
					{ lang, caseId: typeof body.case_id === 'string' ? body.case_id : null, signal: request.signal },
					emit
				);
			} catch (e) {
				if (!request.signal.aborted) {
					// Do not log provider errors which may contain request/document content or credentials.
					const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : undefined;
					const reason = (e instanceof Error ? e.cause : null) as { finishReason?: string } | null;
					console.error('[assistant] The configured AI provider could not complete the request', { status, finishReason: reason?.finishReason });
					emit({
						type: 'error',
						message: lang === 'de'
							? 'Der Assistent ist gerade nicht erreichbar. Prüfen Sie den API-Schlüssel oder versuchen Sie es später erneut.'
							: 'We couldn’t reach the assistant. Check your API key or try again later.'
					});
				}
			} finally {
				try { controller.close(); } catch { /* already closed */ }
			}
		}
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' }
	});
}
