// Focused backend checks: a fresh temporary SQLite DB and a mocked Gemini SDK, no real API calls.
// Run with: node scripts/check-backend.mjs
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const dataDir = mkdtempSync(join(process.env.APPELLA_TEST_TMPDIR || tmpdir(), 'appella-backend-'));
// Generated modules outside the project still need to resolve the project's dependencies.
symlinkSync(resolve('node_modules'), join(dataDir, 'node_modules'), 'dir');
const liveEnvPath = resolve('.svelte-kit/generated/dev/env/config.js');
const liveEnvBefore = existsSync(liveEnvPath) ? readFileSync(liveEnvPath) : null;
const savedEnv = { DATA_DIR: process.env.DATA_DIR, GEMMA_PROVIDER: process.env.GEMMA_PROVIDER, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
Object.assign(process.env, { DATA_DIR: dataDir, GEMMA_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key-not-a-real-secret' });

let generateContent = async () => { throw new Error('Unexpected model call'); };
let generateContentStream = async () => { throw new Error('Unexpected model stream'); };
globalThis.__appellaTestGenai = class {
  models = {
    generateContent: (...args) => generateContent(...args),
    generateContentStream: (...args) => generateContentStream(...args)
  };
};

let server;
let backend;
const originalFetch = globalThis.fetch;
const liveUrl = process.env.APPELLA_LIVE_URL;
async function liveDocuments() {
  const response = await originalFetch(new URL('/api/documents', liveUrl), { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  const liveBefore = liveUrl ? await liveDocuments() : null;
  server = await createServer({
    // Never load the normal app config: its shared generated env is watched by the live dev server.
    configFile: false,
    cacheDir: join(dataDir, 'vite-cache'),
    server: { middlewareMode: true, hmr: false },
    logLevel: 'error',
    ssr: { noExternal: ['@google/genai'] },
    plugins: [sveltekit({ outDir: join(dataDir, '.svelte-kit'), preprocess: vitePreprocess() }), {
      name: 'backend-test-genai',
      enforce: 'pre',
      resolveId(id) { if (id === '@google/genai') return '\0backend-test-genai'; },
      load(id) { if (id === '\0backend-test-genai') return 'export const GoogleGenAI = globalThis.__appellaTestGenai;'; }
    }]
  });
  backend = await server.ssrLoadModule('/src/lib/server/db.ts');
  assert.equal(backend.UPLOAD_DIR, join(dataDir, 'uploads'), 'must never use the real data directory');
  const cases = await server.ssrLoadModule('/src/lib/server/cases.ts');
  const analyze = await server.ssrLoadModule('/src/lib/server/analyze.ts');
  const assistant = await server.ssrLoadModule('/src/lib/server/assistant.ts');
  const chatRoute = await server.ssrLoadModule('/src/routes/api/chat/+server.ts');
  const analyzeRoute = await server.ssrLoadModule('/src/routes/api/analyze/+server.ts');
  const todosRoute = await server.ssrLoadModule('/src/routes/api/documents/[id]/todos/[index]/+server.ts');
  const undoRoute = await server.ssrLoadModule('/src/routes/api/case-events/[id]/undo/+server.ts');
  const caseRoute = await server.ssrLoadModule('/src/routes/api/cases/[id]/+server.ts');
  const client = await server.ssrLoadModule('/src/lib/assistant-client.ts');
  globalThis.fetch = async () => { throw new Error('Real network access is forbidden in backend checks'); };

  const sample = JSON.parse(readFileSync(new URL('../src/lib/mock/analysis.json', import.meta.url), 'utf8'));
  sample.deadline = '2099-11-05';
  const raw = {
    ...sample,
    payment: { recipient: 'Finanzkasse', iban: ' de89   3704 0044 0532 0130 00 ', purpose: 'Einkommensteuer 2025' },
    action_items: sample.action_items.map((item) => ({ ...item, done: true }))
  };
  generateContent = async (params) => {
    assert.match(params.model, /^models\/gemma-/);
    assert.ok(params.contents[0].parts[0].inlineData);
    assert.match(params.config.systemInstruction, /case_title/);
    assert.match(params.config.systemInstruction, /payment/);
    return { text: '```json\n' + JSON.stringify(raw) + '\n```' };
  };
  const analysis = await analyze.analyzeLetter(['dGVzdA=='], 'de');
  assert.equal(analysis.payment.iban, 'DE89 3704 0044 0532 0130 00');
  assert.ok(analysis.action_items.every((item) => item.done === false), 'model must not mark to-dos done');

  const first = await backend.saveDocument(['dGVzdA=='], analysis, 'de');
  const second = await backend.saveDocument(['dGVzdA=='], analysis, 'de');
  assert.equal(first.caseCreated, true);
  assert.equal(second.caseCreated, false);
  assert.equal(first.caseId, second.caseId);
  const separate = await backend.saveDocument(['dGVzdA=='], { ...analysis, references: [], case_title: 'Andere Akte' }, 'de');
  assert.notEqual(separate.caseId, first.caseId);
  assert.equal(cases.getCase(first.caseId).letters.length, 2);
  assert.deepEqual(cases.getCase(first.caseId).letters[0].pages, [`/api/documents/${first.id}/pages/1`]);
  assert.equal(backend.getDocument(first.id).case.id, first.caseId);
  assert.equal(readFileSync(join(backend.UPLOAD_DIR, first.id, 'page-1.jpg'), 'utf8'), 'test');
  assert.equal((await backend.search('tax')).length, 3);
  assert.equal(cases.listOpenDeadlines().length, 3);
  assert.ok(backend.getGraph().nodes.some((node) => node.id === `case:${first.caseId}`));
  assert.ok(backend.graphNeighbors(first.id).some((node) => node.letters.some((letter) => letter.id === second.id)));
  console.log('PASS fresh schema, analysis normalization, case assignment, search and graph');

  const rename = cases.renameCase(first.caseId, 'Umbenannt', 'user');
  assert.equal(cases.getCaseRow(first.caseId).title, 'Umbenannt');
  cases.undoEvent(rename.event_id);
  assert.equal(cases.getCaseRow(first.caseId).title, analysis.case_title);
  assert.throws(() => cases.undoEvent(rename.event_id), cases.CaseError);
  const note = cases.addCaseNote(first.caseId, 'Telefonat geplant', 'assistant');
  assert.match(cases.getCaseRow(first.caseId).notes, /Telefonat geplant/);
  cases.undoEvent(note.event_id);
  assert.equal(cases.getCaseRow(first.caseId).notes, '');
  const move = cases.moveLetter(second.id, separate.caseId, 'user');
  assert.equal(backend.getDocument(second.id).case_id, separate.caseId);
  cases.undoEvent(move.event_id);
  assert.equal(backend.getDocument(second.id).case_id, first.caseId);
  const created = cases.createCase('Neue Ablage', [second.id], 'user');
  assert.equal(backend.getDocument(second.id).case_id, created.case_id);
  cases.undoEvent(created.event_id);
  assert.equal(cases.getCaseRow(created.case_id), null);
  assert.equal(backend.getDocument(second.id).case_id, first.caseId);
  const count = cases.listCases().length;
  assert.throws(() => cases.createCase('Rollback', ['nonexistent'], 'user'), cases.CaseError);
  assert.equal(cases.listCases().length, count);
  const status = cases.setCaseStatus(first.caseId, 'closed', 'user');
  cases.undoEvent(status.event_id);
  assert.equal(cases.getCaseRow(first.caseId).status, 'open');
  console.log('PASS logged edits, undo and rollback');

  const todoResponse = await todosRoute.PATCH({
    params: { id: first.id, index: '0' },
    request: new Request('http://localhost/api/documents/todos/0', { method: 'PATCH', body: JSON.stringify({ done: true }) })
  });
  const todoChange = await todoResponse.json();
  assert.equal(backend.readAnalysis(first.id).action_items[0].done, true);
  await undoRoute.POST({ params: { id: String(todoChange.event_id) } });
  assert.equal(backend.readAnalysis(first.id).action_items[0].done, false);
  const uploadResponse = await analyzeRoute.POST({
    request: new Request('http://localhost/api/analyze', { method: 'POST', body: JSON.stringify({ images: ['dGVzdA=='], lang: 'de' }) })
  });
  const uploaded = await uploadResponse.json();
  assert.equal(typeof uploaded.id, 'string');
  assert.equal(uploaded.case_id, first.caseId);
  assert.equal(uploaded.case_created, false);
  assert.ok(uploaded.related.length);
  console.log('PASS analyze and to-do/undo endpoint contracts');

  const opts = { lang: 'de', caseId: null };
  let round = 0;
  generateContentStream = async (params) => {
    assert.match(params.model, /^models\/gemma-/);
    assert.ok(params.config.tools[0].functionDeclarations.some((tool) => tool.name === 'list_cases'));
    if (round++ === 0) {
      return (async function* () {
        yield { candidates: [{ content: { parts: [{ functionCall: { name: 'list_cases', args: {}, id: 'call-1' }, thoughtSignature: 'signature' }] } }] };
      })();
    }
    assert.equal(params.contents.at(-2).parts[0].thoughtSignature, 'signature');
    assert.equal(params.contents.at(-1).parts[0].functionResponse.id, 'call-1');
    assert.ok(params.contents.at(-1).parts[0].functionResponse.response.output.cases.length > 0);
    return (async function* () {
      yield { candidates: [{ content: { parts: [{ text: 'Offen: ' }] } }] };
      yield { candidates: [{ content: { parts: [{ text: 'deine Akten.' }] }, finishReason: 'STOP' }] };
    })();
  };
  const events = [];
  await assistant.runAssistant([{ role: 'user', content: 'Was ist offen?' }], opts, (event) => events.push(event));
  assert.deepEqual(events.at(-1), { type: 'done' });
  assert.ok(events.some((event) => event.type === 'refs'));
  assert.ok(events.some((event) => event.type === 'tool' && event.status === 'done' && event.ok));
  assert.equal(events.filter((event) => event.type === 'text').map((event) => event.delta).join(''), 'Offen: deine Akten.');
  console.log('PASS hosted assistant function-call roundtrip and streamed text');

  generateContentStream = async () => (async function* () {
    yield { candidates: [{ content: { parts: [{ text: 'Keine weiteren Aufgaben.' }] }, finishReason: 'STOP' }] };
  })();
  const response = await chatRoute.POST({
    request: new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Was ist offen?' }] }) })
  });
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.at(-1), { type: 'done' });
  await assert.rejects(() => chatRoute.POST({ request: new Request('http://localhost/api/chat', { method: 'POST', body: '{"messages":[]}' }) }), (error) => error.status === 400);
  const segments = client.splitRefs(`Siehe [[letter:${first.id}]] und [[case:${first.caseId}]].`, { letters: { [first.id]: { title: 'Brief' } }, cases: { [first.caseId]: { title: 'Akte' } } });
  assert.ok(segments.some((segment) => segment.kind === 'letter' && segment.label === 'Brief'));
  assert.ok(segments.some((segment) => segment.kind === 'case' && segment.label === 'Akte'));
  console.log('PASS NDJSON endpoint, input validation and reference parsing');

  round = 0;
  generateContentStream = async () => (async function* () {
    yield { candidates: [{ content: { parts: round++ === 0
      ? [{ functionCall: { name: 'set_todo_done', args: { letter_id: first.id, todo_index: 0, done: true }, id: 'write-1' } }]
      : [{ text: 'Erledigt.' }] }, finishReason: 'STOP' }] };
  })();
  const writeEvents = [];
  await assistant.runAssistant([{ role: 'user', content: 'Markiere die erste Aufgabe als erledigt.' }], opts, (event) => writeEvents.push(event));
  const change = writeEvents.find((event) => event.type === 'change');
  assert.ok(change);
  assert.equal(backend.readAnalysis(first.id).action_items[0].done, true);
  cases.undoEvent(change.event_id);
  assert.equal(backend.readAnalysis(first.id).action_items[0].done, false);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => assistant.runAssistant([{ role: 'user', content: 'Hallo' }], { ...opts, signal: abort.signal }, () => {}), (error) => error.name === 'AbortError');

  generateContentStream = async () => { throw new Error('Sensitive provider error must not be returned'); };
  const savedConsoleError = console.error;
  console.error = () => {};
  try {
    const failed = await chatRoute.POST({ request: new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Hallo' }] }) }) });
    const failedEvents = (await failed.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(failedEvents.at(-1).type, 'error');
    assert.ok(failedEvents.every((event) => event.type !== 'done'));
    assert.ok(!JSON.stringify(failedEvents).includes('Sensitive provider error'));
  } finally {
    console.error = savedConsoleError;
  }
  console.log('PASS hosted assistant edits/undo, cancellation and safe provider errors');

  const savedErrors = console.error;
  const safeLogs = [];
  console.error = (...args) => safeLogs.push(args.join(' '));
  try {
    const countBefore = backend.listDocuments().length;
    for (const text of ['', 'not-json', 'null', '{}', JSON.stringify({ ...raw, action_items: 'bad' }), JSON.stringify({ ...raw, keywords: [123] }), JSON.stringify({ ...raw, deadline: '2026-02-30' })]) {
      generateContent = async () => ({ text });
      const response = await analyzeRoute.POST({ request: new Request('http://localhost/api/analyze', { method: 'POST', body: JSON.stringify({ images: ['dGVzdA=='], lang: 'en' }) }) });
      assert.equal(response.status, 502);
      assert.equal((await response.json()).code, 'invalid_response');
    }
    for (const [cause, status, code] of [
      [{ status: 500, message: 'secret-provider-token' }, 503, 'unavailable'],
      [{ status: 503, message: 'secret-provider-token' }, 503, 'unavailable'],
      [{ status: 401, message: 'secret-provider-token' }, 503, 'configuration'],
      [{ status: 429, message: 'secret-provider-token' }, 429, 'rate_limit'],
      [{ name: 'TimeoutError', message: 'secret-provider-token' }, 504, 'timeout'],
      [new Error('secret-provider-token'), 503, 'unavailable']
    ]) {
      generateContent = async () => { throw cause; };
      const response = await analyzeRoute.POST({ request: new Request('http://localhost/api/analyze', { method: 'POST', body: JSON.stringify({ images: ['dGVzdA=='] }) }) });
      const body = await response.json();
      assert.equal(response.status, status);
      assert.equal(body.code, code);
      assert.match(body.request_id, /^[a-f\d-]{36}$/);
      assert.ok(!JSON.stringify(body).includes('secret-provider-token'));
      if (code === 'rate_limit') assert.equal(response.headers.get('Retry-After'), '30');
    }
    assert.equal(backend.listDocuments().length, countBefore, 'failed analysis must not create letters');
    for (const body of ['invalid-json', '{}', '{"images":[123]}']) {
      const response = await analyzeRoute.POST({ request: new Request('http://localhost/api/analyze', { method: 'POST', body }) });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, 'invalid_input');
    }
    generateContent = async () => ({ text: JSON.stringify(raw) });
    backend.db.exec("CREATE TEMP TRIGGER fail_storage BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'secret-storage-path'); END");
    try {
      const response = await analyzeRoute.POST({ request: new Request('http://localhost/api/analyze', { method: 'POST', body: '{"images":["dGVzdA=="]}' }) });
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.code, 'storage');
      assert.ok(!JSON.stringify(body).includes('secret-storage-path'));
    } finally { backend.db.exec('DROP TRIGGER fail_storage'); }
    assert.ok(safeLogs.every(line => !/secret-provider-token|secret-storage-path/.test(line)));
  } finally { console.error = savedErrors; }
  console.log('PASS analysis shape validation, transient/configuration errors, timeouts and safe storage failures');

  const deletionAnalysis = { ...analysis, references: [{ label: 'Test reference', value: 'DELETE-CASE-REF' }] };
  const deleteFirst = await backend.saveDocument(['dGVzdA=='], deletionAnalysis, 'en');
  const deleteSecond = await backend.saveDocument(['dGVzdA=='], deletionAnalysis, 'en');
  const keep = await backend.saveDocument(['dGVzdA=='], { ...analysis, references: [{ label: 'Keep', value: 'KEEP-CASE-REF' }] }, 'en');
  const movedOut = cases.moveLetter(deleteFirst.id, keep.caseId, 'user');
  cases.moveLetter(deleteFirst.id, deleteFirst.caseId, 'user');
  const ids = [deleteFirst.id, deleteSecond.id];
  const deletionRequest = body => caseRoute.DELETE({ params: { id: deleteFirst.caseId }, request: new Request('http://localhost/api/cases/delete', { method: 'DELETE', body: JSON.stringify(body) }) });
  for (const body of [{}, { letter_ids: [123] }, { letter_ids: [deleteFirst.id, deleteFirst.id] }]) {
    await assert.rejects(() => deletionRequest(body), error => error.status === 400);
  }
  await assert.rejects(() => deletionRequest({ letter_ids: [deleteFirst.id] }), error => error.status === 409);
  assert.ok(ids.every(id => existsSync(join(backend.UPLOAD_DIR, id, 'page-1.jpg'))));
  backend.db.exec(`CREATE TEMP TRIGGER fail_delete BEFORE DELETE ON cases WHEN OLD.id = '${deleteFirst.caseId}' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END`);
  console.error = () => {};
  try {
    await assert.rejects(() => deletionRequest({ letter_ids: ids }), error => error.status === 500);
    assert.ok(ids.every(id => backend.getDocument(id) && existsSync(join(backend.UPLOAD_DIR, id, 'page-1.jpg'))), 'rollback must restore scans and database records');
  } finally { backend.db.exec('DROP TRIGGER fail_delete'); console.error = savedErrors; }
  const deletedResponse = await deletionRequest({ letter_ids: ids });
  assert.equal(deletedResponse.status, 200);
  const deleted = await deletedResponse.json();
  assert.deepEqual(deleted.deleted_letters.sort(), ids.sort());
  assert.equal(deleted.cleanup_pending, false);
  assert.equal(cases.getCaseRow(deleteFirst.caseId), null);
  for (const id of ids) {
    assert.equal(backend.getDocument(id), null);
    assert.equal(existsSync(join(backend.UPLOAD_DIR, id)), false);
    assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM docs_fts WHERE doc_id = ?').get(id).n, 0);
    assert.ok(!backend.getGraph().nodes.some(node => node.id === `doc:${id}`));
  }
  assert.equal(backend.db.prepare('SELECT COUNT(*) AS n FROM case_events WHERE case_id = ?').get(deleteFirst.caseId).n, 0);
  assert.equal(cases.getCase(keep.caseId).events.find(event => event.id === movedOut.event_id).undoable, 0);
  assert.ok(backend.getDocument(keep.id));
  assert.ok(existsSync(join(backend.UPLOAD_DIR, keep.id, 'page-1.jpg')));
  assert.ok(backend.getGraph().nodes.some(node => node.label === analysis.sender.name), 'shared graph entities must remain');
  assert.deepEqual(backend.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok((await backend.search('tax')).every(doc => !ids.includes(doc.id)));
  await assert.rejects(() => deletionRequest({ letter_ids: ids }), error => error.status === 404);
  console.log('PASS confirmed whole-case deletion, scan/DB rollback, search/graph cleanup and unrelated case preservation');
  assert.deepEqual(existsSync(liveEnvPath) ? readFileSync(liveEnvPath) : null, liveEnvBefore, 'backend checks must not rewrite the live generated environment');
  if (liveUrl) assert.deepEqual(await liveDocuments(), liveBefore, 'the running app must keep serving its own database');
  console.log('PASS generated configuration isolation' + (liveUrl ? ' alongside the live dev server' : ''));
} finally {
  globalThis.fetch = originalFetch;
  backend?.db.close();
  await server?.close();
  delete globalThis.__appellaTestGenai;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  // This directory was created by this script; never remove the project's data/ directory.
  assert.notEqual(resolve(dataDir), resolve('data'));
  rmSync(dataDir, { recursive: true, force: true });
}
