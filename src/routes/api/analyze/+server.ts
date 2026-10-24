// POST /api/analyze  { images: string[] (base64, no data: prefix), lang: 'de' | 'en' }
// -> { id, case_id, case_created, analysis, related }   (photos + analysis are stored locally)
import { json, error } from '@sveltejs/kit';
import { analyzeLetter, LetterAnalysisError } from '#lib/server/analyze.ts';
import { saveDocument, relatedDocuments } from '#lib/server/db.ts';

export async function POST({ request }) {
	const { images, lang } = await request.json();
	if (!Array.isArray(images) || images.length === 0) error(400, 'No images');
	const l = lang === 'de' ? 'de' : 'en';

	let analysis;
	try {
		analysis = await analyzeLetter(images, l);
	} catch (e) {
		const details = e instanceof LetterAnalysisError ? e.message : 'Unexpected analysis error';
		console.error(`Letter analysis failed: ${details}`);
		error(e instanceof LetterAnalysisError ? e.status : 502, details);
	}

	const saved = await saveDocument(images, analysis, l);
	return json({
		id: saved.id,
		case_id: saved.caseId,
		case_created: saved.caseCreated,
		analysis,
		related: relatedDocuments(saved.id)
	});
}
