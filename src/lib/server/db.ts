// src/lib/server/db.ts
// Local persistence: original photos on disk, analyses + knowledge graph + search index in SQLite.
// Optional embeddings use embeddinggemma via local Ollama; hosted analysis does not need it.
//
// Uses Node's built-in node:sqlite (including FTS5); no native addon is needed.
//   ollama pull embeddinggemma
//
// Graph model (bipartite, simple on purpose):
//   documents ──edges(role)──▶ nodes(type: organization | reference | person | topic)
//   Two letters are "related" when they share nodes (same sender, same Aktenzeichen, same topic ...).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as env from '$app/env/private';
import type { Analysis } from '#lib/server/analyze.ts';

const DATA_DIR = env.DATA_DIR ?? 'data';
export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'letters.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

let inTx = false;
/** Runs fn in a transaction (nested calls join the outer one). */
export function transaction<T>(fn: () => T): T {
	if (inTx) return fn();
	db.exec('BEGIN');
	inTx = true;
	try {
		const result = fn();
		db.exec('COMMIT');
		return result;
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	} finally {
		inTx = false;
	}
}

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
  embedding     TEXT,           -- JSON float array, NULL if embedding failed
  case_id       TEXT REFERENCES cases(id)
);
CREATE INDEX IF NOT EXISTS documents_case ON documents(case_id);

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

CREATE TABLE IF NOT EXISTS cases (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every case/letter change records its actor and inverse operation for undo.
CREATE TABLE IF NOT EXISTS case_events (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  actor     TEXT NOT NULL,
  case_id   TEXT,
  kind      TEXT NOT NULL,
  summary   TEXT NOT NULL,
  undo_json TEXT,
  undone    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS case_events_case ON case_events(case_id, id);
`);

// ---------- helpers ----------

export const normKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const normRef = (s: string) => s.toUpperCase().replace(/\s+/g, '');
export const now = () => new Date().toISOString();
export const newId = () => randomUUID().slice(0, 12);

async function embed(text: string, kind: 'doc' | 'query'): Promise<number[] | null> {
	// Hosted Gemini demos work without an Ollama download. Full-text search remains available.
	if ((env.GEMMA_PROVIDER ?? 'gemini').toLowerCase() !== 'ollama') return null;
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

/** Saves photos + analysis, builds graph edges/search, and assigns the letter to a case. */
export async function saveDocument(
	imagesB64: string[], analysis: Analysis, lang: string
): Promise<{ id: string; caseId: string; caseCreated: boolean }> {
	const id = newId();

	const dir = join(UPLOAD_DIR, id);
	mkdirSync(dir, { recursive: true });
	imagesB64.forEach((b64, i) => writeFileSync(join(dir, `page-${i + 1}.jpg`), Buffer.from(b64, 'base64')));

	const t = searchableText(analysis);
	const embedding = await embed(Object.values(t).filter(Boolean).join('\n'), 'doc');

	return transaction(() => {
		db.prepare(
			`INSERT INTO documents (id, created_at, lang, page_count, document_type, sender_name, letter_date,
			   deadline, urgency, summary, analysis_json, embedding)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(
			id, now(), lang, imagesB64.length, analysis.document_type, analysis.sender.name,
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
		return assignCase(id, analysis);
	});
}

/** Join the newest letter's case with a shared reference; otherwise create a new case. */
function assignCase(docId: string, analysis: Analysis) {
	const match = db.prepare(
		`SELECT d.case_id FROM edges mine
		 JOIN nodes n      ON n.id = mine.node_id AND n.type = 'reference'
		 JOIN edges theirs ON theirs.node_id = n.id AND theirs.document_id != mine.document_id
		 JOIN documents d  ON d.id = theirs.document_id AND d.case_id IS NOT NULL
		 WHERE mine.document_id = ?
		 ORDER BY d.created_at DESC LIMIT 1`
	).get(docId) as { case_id: string } | undefined;

	let caseId = match?.case_id;
	const caseCreated = !caseId;
	const title = analysis.case_title?.trim() || analysis.document_type || 'Neue Akte';
	if (!caseId) {
		caseId = newId();
		db.prepare('INSERT INTO cases (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
			.run(caseId, title, now(), now());
	}
	db.prepare('UPDATE documents SET case_id = ? WHERE id = ?').run(caseId, docId);
	db.prepare("UPDATE cases SET updated_at = ?, status = 'open' WHERE id = ?").run(now(), caseId);
	db.prepare(
		`INSERT INTO case_events (at, actor, case_id, kind, summary, undo_json) VALUES (?, 'system', ?, ?, ?, NULL)`
	).run(
		now(), caseId, caseCreated ? 'case_created' : 'letter_added',
		caseCreated
			? `Akte „${title}" angelegt mit „${analysis.document_type}"`
			: `„${analysis.document_type}" zugeordnet (gleiches Aktenzeichen)`
	);
	return { id: docId, caseId, caseCreated };
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
	case_id: string | null;
}

export const listCols = `id, created_at, page_count, document_type, sender_name, letter_date, deadline, urgency, summary, case_id`;

export function listDocuments(): DocumentRow[] {
	return db.prepare(`SELECT ${listCols} FROM documents ORDER BY created_at DESC`).all() as unknown as DocumentRow[];
}

export function getDocument(id: string) {
	const row = db.prepare(`SELECT ${listCols}, analysis_json FROM documents WHERE id = ?`).get(id) as
		| (DocumentRow & { analysis_json: string })
		| undefined;
	if (!row) return null;
	const { analysis_json, ...rest } = row;
	const caseRow = rest.case_id
		? db.prepare('SELECT id, title, status FROM cases WHERE id = ?').get(rest.case_id) as
			{ id: string; title: string; status: 'open' | 'closed' } | undefined
		: undefined;
	return { ...rest, analysis: JSON.parse(analysis_json) as Analysis, case: caseRow ?? null, related: relatedDocuments(id) };
}

/** Analysis for in-place to-do updates. */
export function readAnalysis(id: string): Analysis | null {
	const row = db.prepare('SELECT analysis_json FROM documents WHERE id = ?').get(id) as { analysis_json: string } | undefined;
	return row ? JSON.parse(row.analysis_json) as Analysis : null;
}

export function writeAnalysis(id: string, analysis: Analysis) {
	db.prepare('UPDATE documents SET analysis_json = ? WHERE id = ?').run(JSON.stringify(analysis), id);
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

/** Whole graph for a visualization (e.g. force-graph / cytoscape), including cases. */
export function getGraph() {
	const docs = db.prepare(`SELECT id, document_type, sender_name, letter_date, urgency, case_id FROM documents`).all() as any[];
	const nodes = db
		.prepare(`SELECT n.id, n.type, n.label, COUNT(e.document_id) AS degree FROM nodes n JOIN edges e ON e.node_id = n.id GROUP BY n.id`)
		.all() as any[];
	const edges = db.prepare(`SELECT document_id, node_id, role FROM edges`).all() as any[];
	const cases = db.prepare(
		`SELECT c.id, c.title, c.status, COUNT(d.id) AS degree FROM cases c JOIN documents d ON d.case_id = c.id GROUP BY c.id`
	).all() as any[];
	return {
		nodes: [
			...cases.map((c) => ({ id: `case:${c.id}`, kind: 'case', label: c.title, status: c.status, degree: c.degree })),
			...docs.map((d) => ({ id: `doc:${d.id}`, kind: 'document', label: `${d.document_type} (${d.letter_date ?? '?'})`, urgency: d.urgency })),
			...nodes.map((n) => ({ id: `node:${n.id}`, kind: n.type, label: n.label, degree: n.degree }))
		],
		links: [
			...docs.filter((d) => d.case_id).map((d) => ({ source: `doc:${d.id}`, target: `case:${d.case_id}`, role: 'case' })),
			...edges.map((e) => ({ source: `doc:${e.document_id}`, target: `node:${e.node_id}`, role: e.role }))
		]
	};
}

/** Entity neighbors and the other letters sharing them: the assistant's graph view. */
export function graphNeighbors(docId: string) {
	const rows = db.prepare(
		`SELECT n.type, n.label, e.role, d.id AS other_id, d.document_type AS other_title, d.letter_date AS other_date, d.case_id AS other_case
		 FROM edges e
		 JOIN nodes n ON n.id = e.node_id
		 LEFT JOIN edges e2 ON e2.node_id = n.id AND e2.document_id != e.document_id
		 LEFT JOIN documents d ON d.id = e2.document_id
		 WHERE e.document_id = ?`
	).all(docId) as any[];
	const byEntity = new Map<string, { type: string; label: string; role: string; letters: any[] }>();
	for (const row of rows) {
		const key = `${row.type}:${row.label}`;
		if (!byEntity.has(key)) byEntity.set(key, { type: row.type, label: row.label, role: row.role, letters: [] });
		if (row.other_id) byEntity.get(key)!.letters.push({ id: row.other_id, title: row.other_title, date: row.other_date, case_id: row.other_case });
	}
	return [...byEntity.values()];
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
		.all(...ids) as unknown as DocumentRow[];
	const byId = new Map(rows.map((r) => [r.id, r]));
	return ids.map((id) => byId.get(id)!).filter(Boolean);
}
