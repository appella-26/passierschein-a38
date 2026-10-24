// src/lib/server/cases.ts
// Cases (Akten): groups of letters about one matter. Every change is logged in case_events together
// with its inverse operation, so the user can undo anything, including edits made by the assistant.

import { db, transaction, now, newId, listCols, readAnalysis, writeAnalysis, type DocumentRow } from './db.ts';

export type Actor = 'user' | 'assistant' | 'system';
export type CaseStatus = 'open' | 'closed';

export interface CaseRow {
	id: string;
	title: string;
	status: CaseStatus;
	notes: string;
	created_at: string;
	updated_at: string;
}

export interface ChangeResult {
	event_id: number;
	case_id: string;
	summary: string;
}

export class CaseError extends Error {}

const today = () => new Date().toISOString().slice(0, 10);
const URGENCY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

// ---------- read ----------

export function getCaseRow(id: string): CaseRow | null {
	return (db.prepare(`SELECT * FROM cases WHERE id = ?`).get(id) as unknown as CaseRow) ?? null;
}

function requireCase(id: string): CaseRow {
	const c = getCaseRow(id);
	if (!c) throw new CaseError(`Unknown case ${id}`);
	return c;
}

function requireDoc(id: string): DocumentRow {
	const d = db.prepare(`SELECT ${listCols} FROM documents WHERE id = ?`).get(id) as unknown as DocumentRow | undefined;
	if (!d) throw new CaseError(`Unknown letter ${id}`);
	return d;
}

/** All cases with at least one letter, open ones first, nearest deadline first. */
export function listCases() {
	const rows = db
		.prepare(
			`SELECT c.*, COUNT(d.id) AS letter_count,
			        MIN(CASE WHEN d.deadline >= ? THEN d.deadline END) AS next_deadline,
			        GROUP_CONCAT(d.urgency) AS urgencies,
			        GROUP_CONCAT(d.document_type, ' · ') AS letter_titles
			 FROM cases c JOIN documents d ON d.case_id = c.id
			 GROUP BY c.id`
		)
		.all(today()) as any[];
	return rows
		.map(({ urgencies, ...r }) => ({
			...r,
			urgency: (urgencies ?? '').split(',').reduce(
				(best: string, u: string) => ((URGENCY_RANK[u] ?? 0) > (URGENCY_RANK[best] ?? 0) ? u : best),
				'low'
			)
		}))
		.sort(
			(a, b) =>
				Number(a.status === 'closed') - Number(b.status === 'closed') ||
				(a.next_deadline ?? '9999').localeCompare(b.next_deadline ?? '9999') ||
				b.updated_at.localeCompare(a.updated_at)
		);
}

/** A case with its letters in chronological order (for the document wheel) and its recent history. */
export function getCase(id: string) {
	const c = getCaseRow(id);
	if (!c) return null;
	const letters = (
		db
			.prepare(
				`SELECT ${listCols}, analysis_json FROM documents WHERE case_id = ?
				 ORDER BY COALESCE(letter_date, substr(created_at, 1, 10)) ASC, created_at ASC`
			)
			.all(id) as any[]
	).map(({ analysis_json, ...d }) => {
		const a = JSON.parse(analysis_json);
		return {
			...d,
			amount_due: a.amount_due ?? null,
			references: a.references ?? [],
			todos: (a.action_items ?? []).map((t: any, index: number) => ({
				index, title: t.title, type: t.type, due: t.due, done: !!t.done
			})),
			pages: Array.from({ length: d.page_count }, (_, i) => `/api/documents/${d.id}/pages/${i + 1}`)
		};
	});
	const events = db
		.prepare(`SELECT id, at, actor, kind, summary, undo_json IS NOT NULL AND undone = 0 AS undoable, undone FROM case_events WHERE case_id = ? ORDER BY id DESC LIMIT 30`)
		.all(id);
	const upcoming = letters.map((l) => l.deadline).filter((d: string | null) => d && d >= today()).sort();
	return { ...c, next_deadline: upcoming[0] ?? null, letters, events };
}

/** Letters with a deadline from today on and at least one open to-do. */
export function listOpenDeadlines() {
	return (
		db
			.prepare(
				`SELECT ${listCols.split(', ').map((c) => 'd.' + c).join(', ')}, d.analysis_json, c.title AS case_title
				 FROM documents d LEFT JOIN cases c ON c.id = d.case_id
				 WHERE d.deadline >= ? ORDER BY d.deadline ASC`
			)
			.all(today()) as any[]
	)
		.map(({ analysis_json, ...d }) => {
			const open = (JSON.parse(analysis_json).action_items ?? []).filter((t: any) => !t.done).map((t: any) => t.title);
			return { ...d, open_todos: open };
		})
		.filter((d) => d.open_todos.length > 0);
}

// ---------- write primitives (no logging) ----------

type UndoOp =
	| { op: 'rename_case'; case_id: string; title: string }
	| { op: 'set_case_status'; case_id: string; status: CaseStatus }
	| { op: 'set_notes'; case_id: string; notes: string }
	| { op: 'move_letter'; letter_id: string; case_id: string }
	| { op: 'set_todo'; letter_id: string; index: number; done: boolean }
	| { op: 'delete_case'; case_id: string; moves: { letter_id: string; case_id: string }[] };

function touch(caseId: string) {
	db.prepare(`UPDATE cases SET updated_at = ? WHERE id = ?`).run(now(), caseId);
}

function apply(op: UndoOp) {
	switch (op.op) {
		case 'rename_case':
			db.prepare(`UPDATE cases SET title = ? WHERE id = ?`).run(op.title, op.case_id);
			return touch(op.case_id);
		case 'set_case_status':
			db.prepare(`UPDATE cases SET status = ? WHERE id = ?`).run(op.status, op.case_id);
			return touch(op.case_id);
		case 'set_notes':
			db.prepare(`UPDATE cases SET notes = ? WHERE id = ?`).run(op.notes, op.case_id);
			return touch(op.case_id);
		case 'move_letter':
			db.prepare(`UPDATE documents SET case_id = ? WHERE id = ?`).run(op.case_id, op.letter_id);
			return touch(op.case_id);
		case 'set_todo': {
			const a = readAnalysis(op.letter_id);
			if (!a?.action_items[op.index]) throw new CaseError(`Unknown to-do ${op.index}`);
			a.action_items[op.index].done = op.done;
			return writeAnalysis(op.letter_id, a);
		}
		case 'delete_case':
			for (const m of op.moves) db.prepare(`UPDATE documents SET case_id = ? WHERE id = ?`).run(m.case_id, m.letter_id);
			db.prepare(`DELETE FROM cases WHERE id = ?`).run(op.case_id);
			return;
	}
}

function log(actor: Actor, caseId: string, kind: string, summary: string, undo: UndoOp | null): ChangeResult {
	const r = db
		.prepare(`INSERT INTO case_events (at, actor, case_id, kind, summary, undo_json) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
		.get(now(), actor, caseId, kind, summary, undo ? JSON.stringify(undo) : null) as { id: number };
	return { event_id: r.id, case_id: caseId, summary };
}

// ---------- write API (logged + undoable) ----------

export function createCase(title: string, letterIds: string[], actor: Actor): ChangeResult {
	const t = title.trim();
	if (!t) throw new CaseError('Title must not be empty');
	return transaction(() => {
		const id = newId();
		db.prepare(`INSERT INTO cases (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(id, t, now(), now());
		const moves = letterIds.map((lid) => {
			const d = requireDoc(lid);
			db.prepare(`UPDATE documents SET case_id = ? WHERE id = ?`).run(id, lid);
			return { letter_id: lid, case_id: d.case_id ?? id };
		});
		return log(actor, id, 'case_created', `Akte „${t}" angelegt${moves.length ? ` mit ${moves.length} Brief(en)` : ''}`, {
			op: 'delete_case', case_id: id, moves
		});
	});
}

export function renameCase(caseId: string, title: string, actor: Actor): ChangeResult {
	const c = requireCase(caseId);
	const t = title.trim();
	if (!t) throw new CaseError('Title must not be empty');
	return transaction(() => {
		apply({ op: 'rename_case', case_id: caseId, title: t });
		return log(actor, caseId, 'case_renamed', `Akte umbenannt: „${c.title}" → „${t}"`, {
			op: 'rename_case', case_id: caseId, title: c.title
		});
	});
}

export function setCaseStatus(caseId: string, status: CaseStatus, actor: Actor): ChangeResult {
	const c = requireCase(caseId);
	if (status !== 'open' && status !== 'closed') throw new CaseError('status must be open or closed');
	return transaction(() => {
		apply({ op: 'set_case_status', case_id: caseId, status });
		return log(actor, caseId, 'case_status', status === 'closed' ? `Akte „${c.title}" geschlossen` : `Akte „${c.title}" wieder geöffnet`, {
			op: 'set_case_status', case_id: caseId, status: c.status
		});
	});
}

export function setCaseNotes(caseId: string, notes: string, actor: Actor): ChangeResult {
	const c = requireCase(caseId);
	return transaction(() => {
		apply({ op: 'set_notes', case_id: caseId, notes });
		return log(actor, caseId, 'notes_changed', `Notizen in „${c.title}" geändert`, { op: 'set_notes', case_id: caseId, notes: c.notes });
	});
}

export function addCaseNote(caseId: string, note: string, actor: Actor): ChangeResult {
	const c = requireCase(caseId);
	const line = `${today()}: ${note.trim()}`;
	return transaction(() => {
		apply({ op: 'set_notes', case_id: caseId, notes: c.notes ? `${c.notes}\n${line}` : line });
		return log(actor, caseId, 'note_added', `Notiz zu „${c.title}": ${note.trim().slice(0, 80)}`, {
			op: 'set_notes', case_id: caseId, notes: c.notes
		});
	});
}

export function moveLetter(letterId: string, caseId: string, actor: Actor): ChangeResult {
	const d = requireDoc(letterId);
	const target = requireCase(caseId);
	if (d.case_id === caseId) throw new CaseError('Letter is already in this case');
	return transaction(() => {
		apply({ op: 'move_letter', letter_id: letterId, case_id: caseId });
		return log(actor, caseId, 'letter_moved', `„${d.document_type}" in Akte „${target.title}" verschoben`, {
			op: 'move_letter', letter_id: letterId, case_id: d.case_id ?? caseId
		});
	});
}

export function setTodoDone(letterId: string, index: number, done: boolean, actor: Actor): ChangeResult {
	const d = requireDoc(letterId);
	const a = readAnalysis(letterId);
	const todo = a?.action_items[index];
	if (!todo) throw new CaseError(`Letter ${letterId} has no to-do #${index}`);
	return transaction(() => {
		apply({ op: 'set_todo', letter_id: letterId, index, done });
		return log(actor, d.case_id ?? '', 'todo', `${done ? 'Erledigt' : 'Wieder offen'}: ${todo.title}`, {
			op: 'set_todo', letter_id: letterId, index, done: !!todo.done
		});
	});
}

/** Reverts one logged change. The revert itself is logged but cannot be undone again. */
export function undoEvent(eventId: number, actor: Actor = 'user') {
	const ev = db.prepare(`SELECT * FROM case_events WHERE id = ?`).get(eventId) as any;
	if (!ev) throw new CaseError('Unknown event');
	if (!ev.undo_json) throw new CaseError('This change cannot be undone');
	if (ev.undone) throw new CaseError('Already undone');
	return transaction(() => {
		apply(JSON.parse(ev.undo_json) as UndoOp);
		db.prepare(`UPDATE case_events SET undone = 1 WHERE id = ?`).run(eventId);
		return log(actor, ev.case_id, 'undo', `Rückgängig: ${ev.summary}`, null);
	});
}
