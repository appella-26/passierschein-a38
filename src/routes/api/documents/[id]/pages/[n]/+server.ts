// GET /api/documents/:id/pages/:n -> original photo (JPEG) of page n (1-based)
import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UPLOAD_DIR } from '#lib/server/db.ts';

export async function GET({ params }) {
	if (!/^[\w-]+$/.test(params.id) || !/^\d+$/.test(params.n)) error(400);
	try {
		const img = await readFile(join(UPLOAD_DIR, params.id, `page-${params.n}.jpg`));
		return new Response(img, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
	} catch {
		error(404);
	}
}
