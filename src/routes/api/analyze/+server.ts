// POST /api/analyze  { images: string[] (base64, no data: prefix), lang: 'de' | 'en' }
// -> { id, case_id, case_created, analysis, related }   (photos + analysis are stored locally)
import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { analyzeLetter, LetterAnalysisError } from '#lib/server/analyze.ts';
import { saveDocument, relatedDocuments } from '#lib/server/db.ts';

export async function POST({ request }) {
	const requestId = randomUUID();
	const failure = (message: string, code: string, status: number, retryAfter: number | null = null, providerStatus: number | null = null) => {
		console.error(`Letter analysis failed: request=${requestId} code=${code} status=${status}${providerStatus === null ? '' : ` provider_status=${providerStatus}`}`);
		return json({ message, code, request_id: requestId, provider_status: providerStatus }, { status, headers: retryAfter === null ? {} : { 'Retry-After': String(retryAfter) } });
	};
	const body = await request.json().catch(() => null);
	const { images, lang } = body ?? {};
	if (!Array.isArray(images) || images.length === 0 || !images.every(image => typeof image === 'string' && image.trim())) return failure('Select at least one valid page image.', 'invalid_input', 400);
	const l = lang === 'de' ? 'de' : 'en';

	let analysis;
	try {
		analysis = await analyzeLetter(images, l);
	} catch (e) {
		return e instanceof LetterAnalysisError
			? failure(e.message, e.code, e.status, e.retryAfter, e.providerStatus)
			: failure('The analysis service could not complete this request.', 'unavailable', 503);
	}

	try {
		const saved = await saveDocument(images, analysis, l);
		return json({
			id: saved.id,
			case_id: saved.caseId,
			case_created: saved.caseCreated,
			analysis,
			related: relatedDocuments(saved.id)
		});
	} catch {
		return failure('The letter was analyzed, but could not be saved. Check local storage before trying again.', 'storage', 500);
	}
}
