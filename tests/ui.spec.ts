import { test, expect, type Page } from '@playwright/test';
import { mockDocuments, mockRows, mockGraph } from '../src/lib/mock/data.ts';

const sample = mockDocuments[0];
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

async function mockApi(page: Page) {
  await page.route('**/api/documents*', route => route.fulfill({ json: mockRows(new URL(route.request().url()).searchParams.get('q') ?? '') }));
  await page.route('**/api/documents/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const doc = mockDocuments.find(item => item.id === id);
    return route.fulfill({ status: doc ? 200 : 404, json: doc ?? {} });
  });
  await page.route('**/api/graph', route => route.fulfill({ json: mockGraph() }));
}

test('upload resizes images, shows analysis, and navigates to a result', async ({ page }) => {
  await mockApi(page);
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => finish = resolve);
  let payload: { images: string[]; lang: string } | undefined;
  await page.route('**/api/analyze', async route => {
    payload = route.request().postDataJSON();
    await waiting;
    await route.fulfill({ json: { id: sample.id, analysis: sample.analysis, related: sample.related } });
  });
  await page.goto('/');
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.getByText('Erfasste Seiten (1)')).toBeVisible();
  await page.getByRole('button', { name: '1 Seite jetzt analysieren', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Analyse läuft' })).toBeVisible();
  await expect.poll(() => payload?.lang).toBe('de');
  expect(payload?.images[0]).toMatch(/^\/9j\//);
  expect(payload?.images[0]).not.toContain('data:');
  finish();
  await expect(page).toHaveURL(`/letters/${sample.id}`);
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
});

test('language and checklist persist, clipboard and original scans work', async ({ page, context }) => {
  await mockApi(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/letters/${sample.id}`);
  const check = page.getByRole('checkbox', { name: `Als erledigt markieren: ${sample.analysis.action_items[0].title}` });
  await check.check();
  await page.getByRole('button', { name: 'Steuernummer kopieren' }).click();
  await expect(page.getByRole('status')).toHaveText('In die Zwischenablage kopiert');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('37 012 345 67');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your next steps' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your next steps' })).toBeVisible();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await page.route('**/api/documents/*/pages/*', route => route.fulfill({ contentType: 'image/png', body: tinyPng }));
  await page.getByRole('button', { name: 'View original scan' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Original scan · Page 2' })).toHaveAttribute('src', `/api/documents/${sample.id}/pages/2`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('analysis errors retain uploads and cancelling does not navigate to a late result', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/analyze', route => route.fulfill({ status: 502, json: { message: 'Ollama unavailable' } }));
  await page.goto('/');
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: tinyPng });
  await page.getByRole('button', { name: '1 Seite jetzt analysieren', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Die Analyse ist fehlgeschlagen.');
  await expect(page.getByText('Erfasste Seiten (1)')).toBeVisible();
  await page.unroute('**/api/analyze');
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => finish = resolve);
  await page.route('**/api/analyze', async route => {
    await waiting;
    await route.fulfill({ json: { id: sample.id, analysis: sample.analysis, related: sample.related } }).catch(() => {});
  });
  await page.getByRole('button', { name: '1 Seite jetzt analysieren', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Analyse läuft' })).toBeVisible();
  await page.getByRole('button', { name: 'Zur Erfassung zurück', exact: true }).click();
  finish();
  await expect(page.getByRole('heading', { name: 'Brief erfassen', exact: true })).toBeVisible();
  await expect(page).toHaveURL('/');
});

test('call confirmation sends only reviewed metadata and requires consent', async ({ page }) => {
  await mockApi(page);
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/calls', route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { id: 'test-call', state: 'dialing' } }); });
  await page.route('**/api/calls/test-call/events', route => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ state: 'on_hold', at: new Date().toISOString() })}\n\n` }));
  await page.goto(`/letters/${sample.id}`);
  await page.getByRole('button', { name: 'In der Warteschleife warten', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const start = sheet.getByRole('button', { name: 'Anruf starten & Warteschleife übergeben', exact: true });
  await expect(start).toBeDisabled();
  await sheet.getByLabel('Rufnummer', { exact: true }).fill('0621 / 292-0');
  await sheet.getByRole('checkbox').check();
  await start.click();
  await expect(page).toHaveURL('/calls/test-call');
  expect(payload?.toNumber).toBe('+496212920');
  expect(payload?.purpose).toBe(sample.analysis.action_items[2].call_purpose_de);
  expect(payload?.reference).toContain('37 012 345 67');
  expect(payload).not.toHaveProperty('images');
  await expect(page.getByRole('heading', { name: sample.sender_name })).toBeVisible();
});

test('all live call states render and cancellation uses the endpoint', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    class FakeEventSource {
      static CLOSED = 2;
      readyState = 1;
      onmessage?: (event: { data: string }) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor() {
        (window as unknown as { emitCall: (state: string, at?: string) => void }).emitCall = (state, at) => this.onmessage?.({ data: JSON.stringify({ state, at: at ?? new Date().toISOString() }) });
        setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ state: 'dialing', at: new Date(Date.now() - 5000).toISOString() }) }); }, 50);
      }
      close() { this.readyState = 2; }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeEventSource });
    Object.defineProperty(navigator, 'vibrate', { value: () => { (window as unknown as { didVibrate: boolean }).didVibrate = true; return true; } });
  });
  await page.goto('/calls/test-call');
  await page.waitForFunction(() => typeof (window as unknown as { emitCall: unknown }).emitCall === 'function');
  async function emit(state: string) { await page.evaluate(value => (window as unknown as { emitCall: (s: string) => void }).emitCall(value), state); }
  await expect(page.getByRole('status').filter({ hasText: 'Nummer wird gewählt' })).toBeVisible();
  await emit('ivr');
  await expect(page.getByRole('status').filter({ hasText: 'Telefonmenü wird durchlaufen' })).toBeVisible();
  await emit('on_hold');
  await expect(page.getByText('Zeit in der Warteschleife')).toBeVisible();
  await emit('human_detected');
  await expect(page.getByRole('heading', { name: 'Jemand ist für Sie da.' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { didVibrate: boolean }).didVibrate)).toBe(true);
  await emit('transferring');
  await expect(page.getByRole('heading', { name: 'Jemand ist für Sie da.' })).toBeVisible();
  await emit('connected');
  await expect(page.getByRole('heading', { name: 'Sie sind verbunden' })).toBeVisible();
  await emit('voicemail');
  await expect(page.getByRole('heading', { name: 'Anrufbeantworter erreicht' })).toBeVisible();
  let cancelled = false;
  await page.route('**/api/calls/test-call/cancel', async route => { cancelled = true; await route.fulfill({ json: { ok: true } }); });
  await page.getByRole('button', { name: 'Anruf beenden', exact: true }).click();
  await expect.poll(() => cancelled).toBe(true);
  await emit('ended');
  await expect(page.getByRole('heading', { name: 'Anruf beendet' })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => typeof (window as unknown as { emitCall: unknown }).emitCall === 'function');
  await expect(page.getByRole('status').filter({ hasText: 'Nummer wird gewählt' })).toBeVisible();
  await emit('failed');
  await expect(page.getByRole('heading', { name: 'Anruf fehlgeschlagen' })).toBeVisible();
});

test('archive search is debounced, filters combine with search, and graph documents navigate', async ({ page }) => {
  await mockApi(page);
  const queries: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/documents' && url.searchParams.has('q')) queries.push(url.searchParams.get('q')!); });
  await page.goto('/archive');
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Finanzamt/ }).click();
  await expect(page.getByRole('heading', { name: 'Betriebskostenabrechnung 2025' })).not.toBeVisible();
  await page.getByRole('button', { name: /^Alle/ }).click();
  const search = page.getByRole('searchbox');
  await search.fill('t'); await search.fill('ta'); await search.fill('tax');
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
  await expect.poll(() => queries).toEqual(['tax']);
  await search.fill('no-such-letter');
  await expect(page.getByRole('heading', { name: 'Keine Briefe gefunden' })).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click();
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
  await page.goto('/graph');
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vergrößern' })).toBeEnabled();
  await page.getByRole('button', { name: sample.sender_name, exact: true }).click();
  await expect(page.getByText('2 verknüpfte Briefe')).toBeVisible();
  await page.getByRole('link', { name: sample.document_type, exact: true }).first().click();
  await expect(page).toHaveURL(`/letters/${sample.id}`);
});

test('demo preview cannot call the backend and captures analyzing, confirmation and human views', async ({ page }, testInfo) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Analyse-Vorschau' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Analyse läuft' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('analyzing-390.png'), fullPage: true });
  await page.goto('/letters/demo-tax?demo=1');
  await page.getByRole('button', { name: 'In der Warteschleife warten', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('confirmation-390.png') });
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Anruf starten & Warteschleife übergeben', exact: true }).click();
  await expect(page).toHaveURL('/calls/demo-call?demo=1');
  await page.getByLabel('Demo-Anrufstatus').selectOption('on_hold');
  await expect(page.getByText('Zeit in der Warteschleife')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('on-hold-390.png'), fullPage: true });
  await page.getByLabel('Demo-Anrufstatus').selectOption('human_detected');
  await expect(page.getByRole('heading', { name: 'Jemand ist für Sie da.' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('human-390.png'), fullPage: true });
  expect(apiRequests).toEqual([]);
});

for (const width of [390, 1366]) {
  test(`screens render without browser errors or horizontal overflow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [name, path] of [['home', '/?demo=1'], ['result', '/letters/demo-tax?demo=1'], ['call', '/calls/demo-call?demo=1'], ['archive', '/archive?demo=1'], ['graph', '/graph?demo=1']]) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByText('Wird geladen…', { exact: true })).not.toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true, style: 'body { position: relative; } header { position: static !important; } nav { position: absolute !important; }' });
    }
    expect(errors).toEqual([]);
  });
}
