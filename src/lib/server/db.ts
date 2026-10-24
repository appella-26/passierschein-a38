// src/lib/server/db.ts
// Local persistence: original photos on disk, analyses + knowledge graph + search index in SQLite.
// Nothing leaves the laptop: embeddings come from embeddinggemma via local Ollama.
//
//   pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3
//   ollama pull embeddinggemma
//
// Graph model (bipartite, simple on purpose):
//   documents ──edges(role)──▶ nodes(type: organization | reference | person | topic)
//   Two letters are "related" when they share nodes (same sender, same Aktenzeichen, same topic ...).

import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as env from '$app/env/private';
import type { Analysis } from './analyze';

const DATA_DIR = env.DATA_DIR ?? 'data';
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'letters.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  lang          TEXT NOT NULL,
  page_count    INTEGER NOT NULL,
  document_type TEXT,
  sender_name   TEXT,
  letter_date   TEXT,
  deadline      TEXT,
  urgency       TEXT,
  summary       TEXT,
  analysis_json TEXT NOT NULL,
  embedding     TEXT            -- JSON float array, NULL if embedding failed
);

CREATE TABLE IF NOT EXISTS nodes (
  id    INTEGER PRIMARY KEY,
  type  TEXT NOT NULL,          -- organization | reference | person | topic
  key   TEXT NOT NULL,          -- normalized for dedup
  label TEXT NOT NULL,          -- display name
  UNIQUE(type, key)
);

CREATE TABLE IF NOT EXISTS edges (
  document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  node_id     INTEGER NOT NULL REFERENCES nodes(id)     ON DELETE CASCADE,
  role        TEXT    NOT NULL, -- sender | reference | mentions
  PRIMARY KEY (document_id, node_id, role)
);
CREATE INDEX IF NOT EXISTS edges_node ON edges(node_id);

CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  doc_id UNINDEXED, document_type, sender, summary, keywords, refs, entities, actions,
  tokenize = 'unicode61 remove_diacritics 2'
);
`);

// ---------- helpers ----------

const normKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const normRef = (s: string) => s.toUpperCase().replace(/\s+/g, '');

async function embed(text: string, kind: 'doc' | 'query'): Promise<number[] | null> {
	try {
		// embeddinggemma works best with task prefixes
		const input = kind === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}`;
		const res = await fetch(`${env.OLLAMA_URL ?? 'http://localhost:11434'}/api/embed`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: env.EMBED_MODEL ?? 'embeddinggemma', input })
		});
		if (!res.ok) return null;
		return (await res.json()).embeddings?.[0] ?? null;
	} catch {
		return null; // search still works via full-text
	}
}

function cosine(a: number[], b: number[]) {
	let dot = 0, na = 0, nb = 0;
	for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
	return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function searchableText(a: Analysis) {
	return {
		document_type: a.document_type,
		sender: a.sender.name,
		summary: a.summary,
		keywords: a.keywords.join(' '),
		refs: a.references.map((r) => `${r.label} ${r.value}`).join(' '),
		entities: a.entities.map((e) => e.name).join(' '),
		actions: a.action_items.map((x) => `${x.title} ${x.details}`).join(' ')
	};
}

// ---------- write ----------

const upsertNode = db.prepare(
	`INSERT INTO nodes (type, key, label) VALUES (?, ?, ?)
	 ON CONFLICT(type, key) DO UPDATE SET label = label
	 RETURNING id`
);
const insertEdge = db.prepare(`INSERT OR IGNORE INTO edges (document_id, node_id, role) VALUES (?, ?, ?)`);

/** Saves photos + analysis, builds graph edges and search index. Returns the new document id. */
export async function saveDocument(imagesB64: string[], analysis: Analysis, lang: string): Promise<string> {
	const id = randomUUID().slice(0, 12);

	const dir = join(UPLOAD_DIR, id);
	mkdirSync(dir, { recursive: true });
	imagesB64.forEach((b64, i) => writeFileSync(join(dir, `page-${i + 1}.jpg`), Buffer.from(b64, 'base64')));

	const t = searchableText(analysis);
	const embedding = await embed(Object.values(t).filter(Boolean).join('\n'), 'doc');

	db.transaction(() => {
		db.prepare(
			`INSERT INTO documents (id, created_at, lang, page_count, document_type, sender_name, letter_date,
			   deadline, urgency, summary, analysis_json, embedding)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			id, new Date().toISOString(), lang, imagesB64.length, analysis.document_type, analysis.sender.name,
			analysis.letter_date, analysis.deadline, analysis.urgency, analysis.summary,
			JSON.stringify(analysis), embedding ? JSON.stringify(embedding) : null
		);

		const link = (type: string, key: string, label: string, role: string) => {
			if (!key) return;
			const { id: nodeId } = upsertNode.get(type, key, label) as { id: number };
			insertEdge.run(id, nodeId, role);
		};
		if (analysis.sender.name) link('organization', normKey(analysis.sender.name), analysis.sender.name, 'sender');
		for (const r of analysis.references) link('reference', normRef(r.value), `${r.label}: ${r.value}`, 'reference');
		for (const e of analysis.entities) link(e.type, normKey(e.name), e.name, 'mentions');

		db.prepare(
			`INSERT INTO docs_fts (doc_id, document_type, sender, summary, keywords, refs, entities, actions)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(id, t.document_type, t.sender, t.summary, t.keywords, t.refs, t.entities, t.actions);
	})();

	return id;
}

// ---------- read ----------

export interface DocumentRow {
	id: string;
	created_at: string;
	page_count: number;
	document_type: string;
	sender_name: string;
	letter_date: string | null;
	deadline: string | null;
	urgency: string;
	summary: string;
}

const listCols = `id, created_at, page_count, document_type, sender_name, letter_date, deadline, urgency, summary`;

export function listDocuments(): DocumentRow[] {
	return db.prepare(`SELECT ${listCols} FROM documents ORDER BY created_at DESC`).all() as DocumentRow[];
}

export function getDocument(id: string) {
	const row = db.prepare(`SELECT ${listCols}, analysis_json FROM documents WHERE id = ?`).get(id) as
		| (DocumentRow & { analysis_json: string })
		| undefined;
	if (!row) return null;
	const { analysis_json, ...rest } = row;
	return { ...rest, analysis: JSON.parse(analysis_json) as Analysis, related: relatedDocuments(id) };
}

/** Letters sharing graph nodes with this one. Same reference number weighs most. */
export function relatedDocuments(id: string, limit = 5) {
	return db
		.prepare(
			`SELECT d.id, d.document_type, d.sender_name, d.letter_date, d.urgency,
			        SUM(CASE n.type WHEN 'reference' THEN 3 WHEN 'organization' THEN 2 ELSE 1 END) AS score,
			        GROUP_CONCAT(n.label, ' · ') AS shared
			 FROM edges mine
			 JOIN edges theirs ON theirs.node_id = mine.node_id AND theirs.document_id != mine.document_id
			 JOIN nodes n      ON n.id = mine.node_id
			 JOIN documents d  ON d.id = theirs.document_id
			 WHERE mine.document_id = ?
			 GROUP BY d.id ORDER BY score DESC, d.created_at DESC LIMIT ?`
		)
		.all(id, limit);
}

/** Whole graph for a visualization (e.g. force-graph / cytoscape). */
export function getGraph() {
	const docs = db.prepare(`SELECT id, document_type, sender_name, letter_date, urgency FROM documents`).all() as any[];
	const nodes = db
		.prepare(`SELECT n.id, n.type, n.label, COUNT(e.document_id) AS degree FROM nodes n JOIN edges e ON e.node_id = n.id GROUP BY n.id`)
		.all() as any[];
	const edges = db.prepare(`SELECT document_id, node_id, role FROM edges`).all() as any[];
	return {
		nodes: [
			...docs.map((d) => ({ id: `doc:${d.id}`, kind: 'document', label: `${d.document_type} (${d.letter_date ?? '?'})`, urgency: d.urgency })),
			...nodes.map((n) => ({ id: `node:${n.id}`, kind: n.type, label: n.label, degree: n.degree }))
		],
		links: edges.map((e) => ({ source: `doc:${e.document_id}`, target: `node:${e.node_id}`, role: e.role }))
	};
}

// ---------- search: full-text + semantic, merged with reciprocal rank fusion ----------

function ftsQuery(q: string) {
	return q
		.split(/\s+/)
		.map((w) => w.replace(/["*()^:]/g, ''))
		.filter((w) => w.length > 1)
		.map((w) => `"${w}"*`)
		.join(' OR ');
}

export async function search(q: string, limit = 10) {
	const scores = new Map<string, number>();
	const K = 60; // RRF constant

	const fq = ftsQuery(q);
	if (fq) {
		const hits = db
			.prepare(`SELECT doc_id FROM docs_fts WHERE docs_fts MATCH ? ORDER BY bm25(docs_fts) LIMIT 50`)
			.all(fq) as { doc_id: string }[];
		hits.forEach((h, rank) => scores.set(h.doc_id, (scores.get(h.doc_id) ?? 0) + 1 / (K + rank)));
	}

	const qv = await embed(q, 'query');
	if (qv) {
		const rows = db.prepare(`SELECT id, embedding FROM documents WHERE embedding IS NOT NULL`).all() as {
			id: string;
			embedding: string;
		}[];
		rows
			.map((r) => ({ id: r.id, sim: cosine(qv, JSON.parse(r.embedding)) }))
			.filter((r) => r.sim > 0.3)
			.sort((a, b) => b.sim - a.sim)
			.slice(0, 50)
			.forEach((r, rank) => scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (K + rank)));
	}

	const ids = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
	if (!ids.length) return [];
	const rows = db
		.prepare(`SELECT ${listCols} FROM documents WHERE id IN (${ids.map(() => '?').join(',')})`)
		.all(...ids) as DocumentRow[];
	const byId = new Map(rows.map((r) => [r.id, r]));
	return ids.map((id) => byId.get(id)!).filter(Boolean);
}
