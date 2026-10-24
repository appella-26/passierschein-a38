// GET /api/graph -> { nodes, links } in the shape force-graph / d3-force expect
import { json } from '@sveltejs/kit';
import { getGraph } from '#lib/server/db.ts';

export function GET() {
	return json(getGraph());
}
