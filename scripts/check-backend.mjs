// Focused backend checks: a fresh temporary SQLite DB and a mocked Gemini SDK, no real API calls.
// Run with: node scripts/check-backend.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const dataDir = mkdtempSync(join(process.env.APPELLA_TEST_TMPDIR || tmpdir(), 'appella-backend-'));
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
try {
  server = await createServer({
    server: { middlewareMode: true, hmr: false },
    logLevel: 'error',
    ssr: { noExternal: ['@google/genai'] },
    plugins: [{
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
