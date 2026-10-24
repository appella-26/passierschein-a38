import { test, expect, type Page } from '@playwright/test';
import { getMockDocuments } from '../src/lib/mock/data.ts';

const sample = getMockDocuments('en')[0];
const caseId = 'chat-test-case';
const caseTitle = 'Income tax 2025';
type Harness = { requests: Array<{ messages: Array<{ role: string; content: string }>; case_id: string | null; lang: string }>; cancelled: number; push: (chunk: string) => void; bytes: (chunk: number[]) => void; close: () => void; fail: () => void };

test.beforeEach(async ({ page }) => {
  // Fail closed: every test's provider/call/API traffic stays mocked.
  await page.route('**/api/**', route => route.fulfill({ status: 404, json: {} }));
});

async function letters(page: Page, lang: 'en' | 'de' = 'en') {
  const docs = structuredClone(getMockDocuments(lang));
  for (const doc of docs.filter(doc => ['demo-tax', 'demo-prior'].includes(doc.id))) {
    doc.case_id = caseId; doc.case = { id: caseId, title: caseTitle, status: 'open' };
  }
  await page.route('**/api/documents', route => route.fulfill({ json: docs.map(({ analysis: _a, related: _r, case: _c, ...row }) => row) }));
  await page.route('**/api/documents/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const doc = docs.find(item => item.id === id);
    return route.fulfill({ status: doc ? 200 : 404, json: doc ?? {} });
  });
  await page.route(`**/api/cases/${caseId}`, route => route.fulfill({ json: { id: caseId, title: caseTitle, letters: docs.filter(doc => doc.case_id === caseId) } }));
  return docs;
}

async function installStream(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const harness = {
      requests: [] as unknown[], cancelled: 0,
      push(chunk: string) { try { controller.enqueue(encoder.encode(chunk)); } catch { /* Deliberately late test chunk. */ } },
      bytes(chunk: number[]) { controller.enqueue(new Uint8Array(chunk)); },
      close() { try { controller.close(); } catch { /* Already cancelled. */ } },
      fail() { controller.error(new Error('private-provider-body')); }
    };
    (window as unknown as { chatHarness: typeof harness }).chatHarness = harness;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname !== '/api/chat') return original(input, init);
      harness.requests.push(JSON.parse(String(init?.body)));
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { harness.cancelled++; } }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
    };
  });
}
async function emit(page: Page, ...events: unknown[]) {
  await page.evaluate(chunk => (window as unknown as { chatHarness: Harness }).chatHarness.push(chunk), events.map(event => JSON.stringify(event)).join('\n') + '\n');
}
async function send(page: Page, content = 'What needs my attention?') {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(content);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible();
}
async function requests(page: Page) { return page.evaluate(() => (window as unknown as { chatHarness: Harness }).chatHarness.requests); }
const refs = { type: 'refs', letters: { [sample.id]: { title: sample.document_type, date: sample.letter_date } }, cases: { [caseId]: { title: caseTitle } } };

test('streams split UTF-8/NDJSON, formats safely and keeps references clickable', async ({ page }) => {
  await letters(page); await installStream(page);
  await page.goto('/assistant');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await send(page);
  await emit(page, { type: 'tool', name: 'search_letters', status: 'start', args: { private: 'private-tool-argument' } }, refs);
  await expect(page.getByRole('status')).toContainText('Checking your letters');
  const bytes = Buffer.from(JSON.stringify({ type: 'text', delta: 'The amount is **€250**. ' }) + '\n');
  const split = bytes.indexOf(Buffer.from('€')) + 1;
  await page.evaluate(value => (window as unknown as { chatHarness: Harness }).chatHarness.bytes(value), [...bytes.subarray(0, split)]);
  await page.evaluate(value => (window as unknown as { chatHarness: Harness }).chatHarness.bytes(value), [...bytes.subarray(split)]);
  await expect(page.locator('strong')).toHaveText('€250');
  await emit(page, { type: 'text', delta: 'See [[letter:demo-' });
  await expect(page.getByRole('log')).not.toContainText('[[letter:');
  await page.evaluate(chunk => (window as unknown as { chatHarness: Harness }).chatHarness.push(chunk), [
    { type: 'text', delta: `tax]] and [[case:${caseId}]]. <img src=x onerror=alert(1)>` },
    { type: 'ui', action: 'open_letter', letter_id: sample.id },
    { type: 'ui', action: 'open_case', case_id: caseId },
    { type: 'done' }
  ].map(event => JSON.stringify(event)).join('\n'));
  await page.evaluate(() => (window as unknown as { chatHarness: Harness }).chatHarness.close());
  await expect(page.getByRole('button', { name: 'Stop response', exact: true })).not.toBeVisible();
  await expect(page.getByRole('log').locator('img')).toHaveCount(0);
  await expect(page.getByRole('log').getByRole('link', { name: sample.document_type, exact: true })).toHaveCount(1);
  await expect(page.getByRole('log').getByRole('button', { name: caseTitle, exact: true })).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText('private-tool-argument');
  await page.getByRole('button', { name: caseTitle, exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: new RegExp(sample.document_type) })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('log').getByRole('link', { name: sample.document_type, exact: true }).click();
  await expect(page).toHaveURL(`/letters/${sample.id}`);
  await page.getByRole('link', { name: 'Ask about this letter', exact: true }).click();
  await expect(page).toHaveURL(`/assistant?letter=${sample.id}`);
  await send(page, 'Explain the selected letter.');
  const sent = (await requests(page)).at(-1)!;
  expect(sent.case_id).toBe(caseId);
  expect(sent.messages.at(-1)!.content).toContain(`[Selected letter: ${sample.id}]`);
  expect(sent.lang).toBe('en');
  await emit(page, { type: 'text', delta: 'Selected letter answer.' }, { type: 'done' });
});

test('saved chat changes survive navigation, update Home, and Undo retries safely', async ({ page }) => {
  const docs = await letters(page); await installStream(page);
  await page.route('**/api/case-events/42/undo', route => route.fulfill({ status: 503, json: { message: 'private-undo-body' } }));
  await page.goto('/assistant'); await send(page, 'Complete these tasks.');
  docs[0].analysis.action_items.forEach(action => action.done = true);
  await emit(page, { type: 'change', event_id: 42, case_id: caseId, summary: 'Tasks completed.' }, { type: 'text', delta: 'Done.' }, { type: 'done' });
  await page.getByRole('navigation').getByRole('link', { name: 'Add letter', exact: true }).click();
  await expect(page.locator('.letter-card').first()).toContainText('Completed');
  await expect(page.locator('.letter-card').first()).not.toContainText('312,40 EUR');
  await page.getByRole('navigation').getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Tasks completed.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('couldn’t confirm Undo');
  await expect(page.locator('body')).not.toContainText('private-undo-body');
  await page.route('**/api/case-events/42/undo', route => { docs[0].analysis.action_items[0].done = false; return route.fulfill({ json: { event_id: 43 } }); });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Undone');
  await page.getByRole('navigation').getByRole('link', { name: 'Add letter', exact: true }).click();
  await expect(page.locator('.letter-card').first()).toContainText('312,40 EUR');
});

test('Stop keeps partial text and receipts and rejects late stream events', async ({ page }) => {
  await installStream(page); await page.goto('/assistant'); await send(page);
  await emit(page, { type: 'text', delta: 'Partial answer.' }, { type: 'change', event_id: 7, case_id: caseId, summary: 'A change already saved.' });
  await page.getByRole('button', { name: 'Stop response', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Partial answer.');
  await expect(page.getByRole('status')).toContainText('Response stopped');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await emit(page, { type: 'text', delta: 'Late reply must not appear.' });
  await expect(page.getByRole('log')).not.toContainText('Late reply');
  expect((await requests(page)).length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { chatHarness: Harness }).chatHarness.cancelled)).toBe(1);
});

for (const ending of ['eof', 'malformed', 'provider-error', 'network'] as const) {
  test(`chat handles ${ending} without losing replies or auto-retrying`, async ({ page }) => {
    await installStream(page); await page.goto('/assistant'); await send(page);
    await emit(page, { type: 'text', delta: 'A partial reply.' });
    if (ending === 'eof') await page.evaluate(() => (window as unknown as { chatHarness: Harness }).chatHarness.close());
    if (ending === 'malformed') await page.evaluate(() => (window as unknown as { chatHarness: Harness }).chatHarness.push('not-json\n'));
    if (ending === 'provider-error') await emit(page, { type: 'error', message: 'private-provider-body' });
    if (ending === 'network') await page.evaluate(() => (window as unknown as { chatHarness: Harness }).chatHarness.fail());
    await expect(page.getByRole('alert')).toContainText('couldn’t finish the reply');
    await expect(page.getByRole('log')).toContainText('A partial reply.');
    await expect(page.locator('body')).not.toContainText('private-provider-body');
    await expect(page.getByRole('button', { name: 'Stop response', exact: true })).not.toBeVisible();
    expect((await requests(page)).length).toBe(1);
  });
}

test('HTTP errors retain the user message and an empty or IME submission sends nothing', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/chat', route => { calls++; return route.fulfill({ status: 429, json: { message: 'private-key' } }); });
  await page.goto('/assistant');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(input).toBeEnabled();
  await input.fill('   '); await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await input.fill('Composing');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  expect(calls).toBe(0);
  await input.fill('First line'); await input.press('Shift+Enter'); await input.type('Second line'); await input.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('log')).toContainText('First line\nSecond line');
  await expect(page.locator('body')).not.toContainText('private-key');
  expect(calls).toBe(1);
  await expect(input).toHaveAttribute('maxlength', '4000');
});

test('call drafts only open review and never start a call automatically', async ({ page }) => {
  await letters(page); await installStream(page);
  const callRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/calls')) callRequests.push(request.url()); });
  await page.goto('/assistant'); await send(page, 'Prepare a call.');
  await emit(page, { type: 'ui', action: 'prepare_call', call: { letter_id: sample.id, todo_index: 2, toNumber: '+496212920', phone_raw: '0621 / 292-0', senderName: sample.sender_name, purpose: 'Synthetische Rückfrage zum Brief.', reference: 'TEST', letterDate: sample.letter_date } }, { type: 'done' });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Review call', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Reason for calling' })).toHaveValue('Synthetische Rückfrage zum Brief.');
  await expect(sheet.getByRole('button', { name: 'Start the call', exact: true })).toBeDisabled();
  expect(callRequests).toEqual([]);
});

test('missing context fails visibly rather than chatting about another letter', async ({ page }) => {
  await page.goto('/assistant?letter=missing-letter');
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.getByRole('link', { name: 'Chat about all letters', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
});

test('a terminal event without an answer or action is an error, not an empty bubble', async ({ page }) => {
  await installStream(page); await page.goto('/assistant'); await send(page);
  await emit(page, { type: 'done' });
  await expect(page.getByRole('alert')).toContainText('couldn’t finish the reply');
});

test('a normal conversation survives visiting the isolated demo', async ({ page }) => {
  await installStream(page); await page.goto('/assistant'); await send(page, 'A normal chat question.');
  await emit(page, { type: 'text', delta: 'Normal conversation answer.' }, { type: 'done' });
  async function navigate(href: string) {
    await page.evaluate(url => { const a = document.createElement('a'); a.id = 'test-chat-nav'; a.href = url; a.textContent = 'Navigate'; a.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:white'; document.body.append(a); }, href);
    await page.locator('#test-chat-nav').click(); await expect(page).toHaveURL(href); await page.locator('#test-chat-nav').evaluate(a => a.remove());
  }
  await navigate('/assistant?demo=1');
  await expect(page.getByRole('log')).not.toBeVisible();
  await send(page, 'What needs my attention?');
  await expect(page.getByRole('log')).toContainText('tax office');
  await navigate('/assistant');
  await expect(page.getByRole('log')).toContainText('Normal conversation answer.');
  await expect(page.getByRole('log')).not.toContainText('tax office');
  expect((await requests(page)).length).toBe(1);
});

test('streaming does not pull readers away from earlier messages and New chat clears only the conversation', async ({ page }) => {
  await installStream(page); await page.goto('/assistant'); await send(page);
  await emit(page, { type: 'text', delta: 'A long answer.\n\n'.repeat(70) });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await emit(page, { type: 'text', delta: 'A new part at the end.' });
  await expect(page.getByRole('log')).toContainText('A new part at the end.');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await emit(page, { type: 'done' });
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('log')).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  expect((await requests(page)).length).toBe(1);
});

test('demo chat edits and Undo stay local and cannot leak into normal chat', async ({ page }) => {
  const api: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.goto('/assistant?demo=1');
  await send(page, 'Mark the first task complete.');
  await expect(page.getByRole('log')).toContainText('First task marked as complete (demo).');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Undone');
  expect(api).toEqual([]);
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/assistant'; a.id = 'leave-demo'; a.textContent = 'Leave demo'; a.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:white'; document.body.prepend(a); });
  await page.locator('#leave-demo').click();
  await expect(page).toHaveURL('/assistant');
  await expect(page.getByRole('log')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Let’s look at your letters.' })).toBeVisible();
});

for (const width of [320, 375, 390, 768, 1366]) {
  for (const lang of ['en', 'de'] as const) {
    test(`minimal chat layout at ${width}px in ${lang}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem('appella.language', value), lang);
      await page.goto('/assistant?demo=1');
      const input = page.getByRole('textbox', { name: lang === 'en' ? 'Message' : 'Nachricht', exact: true });
      await expect(input).toBeEnabled();
      await expect(page.locator('nav a')).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const composer = await page.locator('form').boundingBox();
      const nav = await page.locator('nav').boundingBox();
      expect(composer!.y + composer!.height).toBeLessThan(nav!.y);
      await page.screenshot({ path: testInfo.outputPath(`chat-empty-${width}-${lang}.png`) });
      await input.fill(lang === 'en' ? 'What needs my attention?' : 'Was braucht meine Aufmerksamkeit?');
      await page.getByRole('button', { name: lang === 'en' ? 'Send message' : 'Nachricht senden', exact: true }).click();
      await expect(page.getByRole('button', { name: lang === 'en' ? 'Stop response' : 'Antwort stoppen', exact: true })).not.toBeVisible();
      await expect(page.getByRole('log')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`chat-reply-${width}-${lang}.png`) });
    });
  }
}

test('mobile keyboard keeps the composer visible and restores navigation on exit', async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard = height => { viewport.height = height; viewport.dispatchEvent(new Event('resize')); };
  });
  await page.goto('/assistant');
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toBeEnabled();
  await expect(input).toHaveCSS('font-size', '16px');
  await input.focus();
  await page.evaluate(() => (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard(440));
  await expect(page.locator('html')).toHaveAttribute('data-chat-keyboard-open', 'true');
  await expect(page.locator('nav')).not.toBeVisible();
  expect((await input.boundingBox())!.y + (await input.boundingBox())!.height).toBeLessThan(440);
  await input.blur();
  await page.evaluate(() => (window as unknown as { setKeyboard: (height: number) => void }).setKeyboard(844));
  await expect(page.locator('nav')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Archive', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-chat-keyboard-open');
});
