// GET /api/calls/:id/events  -> Server-Sent Events with the call's status timeline.
// Client: const es = new EventSource(`/api/calls/${id}/events`); es.onmessage = (m) => JSON.parse(m.data)
import { error } from '@sveltejs/kit';
import { getCall, subscribe } from '#lib/server/calls.ts';

export function GET({ params, request }) {
	const call = getCall(params.id);
	if (!call) error(404, 'Unknown call');

	let unsubscribe = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const send = (data: unknown) => controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			call.events.forEach(send); // replay history so a reload still shows the timeline
			unsubscribe = subscribe(call.id, send);
			const ping = setInterval(() => controller.enqueue(': ping\n\n'), 15000);
			request.signal.addEventListener('abort', () => {
				clearInterval(ping);
				unsubscribe();
			});
		},
		cancel() {
			unsubscribe();
		}
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }
	});
}
