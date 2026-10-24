// POST /api/analyze  { images: string[] (base64, no data: prefix), lang: 'de' | 'en' }
// -> { id, analysis, related }   (photos + analysis are stored locally)
import { json, error } from '@sveltejs/kit';
import { analyzeLetter } from '#lib/server/analyze.ts';
import { saveDocument, relatedDocuments } from '#lib/server/db.ts';

export async function POST({ request }) {
	const { images, lang } = await request.json();
	if (!Array.isArray(images) || images.length === 0) error(400, 'No images');
	const l = lang === 'en' ? 'en' : 'de';

	let analysis;
	try {
		analysis = await analyzeLetter(images, l);
	} catch (e) {
		console.error(e);
		error(502, 'Analysis failed — is Ollama running?');
	}

	const id = await saveDocument(images, analysis, l);
	return json({ id, analysis, related: relatedDocuments(id) });
}
