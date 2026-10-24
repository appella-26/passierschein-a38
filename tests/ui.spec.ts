import { test, expect, type Page } from '@playwright/test';
import { getMockDocuments, mockDocuments, mockRows, mockGraph } from '../src/lib/mock/data.ts';

const sample = mockDocuments[0];
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const draftKey = 'appella.upload-draft';

/** setInputFiles before hydration fires a change event no handler hears, so retry until the page lists it. */
async function addPage(page: Page, listed: string, name = 'sample.png') {
  await expect(async () => {
    await page.locator('input[type=file][multiple]').setInputFiles({ name, mimeType: 'image/png', buffer: tinyPng });
    await expect(page.getByText(listed, { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass();
}

async function mockApi(page: Page, lang: 'de' | 'en' = 'de') {
  const documents = structuredClone(getMockDocuments(lang));
  const changes = new Map<number, { id: string; index: number; before: boolean }>();
  let eventId = 0;
  await page.route('**/api/documents*', route => {
    const rows = mockRows(new URL(route.request().url()).searchParams.get('q') ?? '', lang).flatMap(row => {
      const doc = documents.find(item => item.id === row.id);
      if (!doc) return [];
      const { analysis: _analysis, related: _related, case: _case, ...current } = doc;
      return [current];
    });
    return route.fulfill({ json: rows });
  });
  await page.route('**/api/documents/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const doc = documents.find(item => item.id === id);
    return route.fulfill({ status: doc ? 200 : 404, json: doc ?? {} });
  });
  await page.route('**/api/documents/*/pages/*', route => route.fulfill({ contentType: 'image/png', body: tinyPng }));
  await page.route('**/api/documents/*/todos/*', route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[3], index = Number(parts[5]);
    const doc = documents.find(item => item.id === id);
    if (!doc || !doc.analysis.action_items[index]) return route.fulfill({ status: 404, json: {} });
    changes.set(++eventId, { id, index, before: !!doc.analysis.action_items[index].done });
    doc.analysis.action_items[index].done = route.request().postDataJSON().done;
    return route.fulfill({ json: { event_id: eventId, case_id: 'test-case', summary: 'To-do updated' } });
  });
  await page.route('**/api/case-events/*/undo', route => {
    const id = Number(new URL(route.request().url()).pathname.split('/')[3]);
    const change = changes.get(id);
    if (!change) return route.fulfill({ status: 400, json: {} });
    documents.find(doc => doc.id === change.id)!.analysis.action_items[change.index].done = change.before;
    changes.delete(id);
    return route.fulfill({ json: { event_id: ++eventId, case_id: 'test-case', summary: 'Undone' } });
  });
  await page.route('**/api/graph', route => route.fulfill({ json: mockGraph(lang) }));
  return documents;
}

const workflowCopy = {
  en: {
    pages: 'Your pages (1)', analyzeOne: 'Explain this page', analyzing: 'Reading your letter…', analysisError: 'We couldn’t finish reading this letter.',
    cancelAnalysis: 'Back to your pages', capture: 'Your letter', completeAction: 'Mark as complete:', copyReference: 'Copy Steuernummer', copied: 'Copied. One less thing to type.',
    waitForMe: 'Hold the line for me', startCall: 'Start the call', phone: 'Phone number', dialing: 'Dialling…', ivr: 'Working through the phone menu',
    waitingTime: 'Time on hold', humanTitle: 'You’re up.', connected: 'You’re connected', voicemail: 'Voicemail reached', cancelCall: 'End call', ended: 'Call ended', failed: 'Call failed',
    taxOffice: /^Tax office/, all: /^All letters/, noResults: 'Nothing turned up.', resetFilters: 'Clear search & filters', zoomIn: 'Zoom in', connections: '2 linked letters',
    previewAnalysis: 'See how it works', demoCallState: 'Try a call status', callNotConfigured: 'The on-hold assistant isn’t set up yet.',
    hotlineTitle: 'Demo hotline', hotlineLink: 'Demo hotline link', hotlineRinging: 'Incoming call', answerCall: 'Answer call', hotlineUnavailable: /isn’t available any more/,
    other: { button: 'Deutsch', todos: 'Ihre To-Dos', original: 'Original-Scan ansehen', page2: 'Seite 2', originalPage2: 'Original-Scan · Seite 2' }
  },
  de: {
    pages: 'Erfasste Seiten (1)', analyzeOne: '1 Seite jetzt analysieren', analyzing: 'Analyse läuft', analysisError: 'Die Analyse ist fehlgeschlagen.',
    cancelAnalysis: 'Zur Erfassung zurück', capture: 'Ihr Brief', completeAction: 'Als erledigt markieren:', copyReference: 'Steuernummer kopieren', copied: 'In die Zwischenablage kopiert',
    waitForMe: 'In der Warteschleife warten', startCall: 'Anruf starten & Warteschleife übergeben', phone: 'Rufnummer', dialing: 'Nummer wird gewählt', ivr: 'Telefonmenü wird durchlaufen',
    waitingTime: 'Zeit in der Warteschleife', humanTitle: 'Jemand ist für Sie da.', connected: 'Sie sind verbunden', voicemail: 'Anrufbeantworter erreicht', cancelCall: 'Anruf beenden', ended: 'Anruf beendet', failed: 'Anruf fehlgeschlagen',
    taxOffice: /^Finanzamt/, all: /^Alle/, noResults: 'Keine Briefe gefunden', resetFilters: 'Filter zurücksetzen', zoomIn: 'Vergrößern', connections: '2 verknüpfte Briefe',
    previewAnalysis: 'Analyse-Vorschau', demoCallState: 'Demo-Anrufstatus', callNotConfigured: 'Der Telefon-Assistent ist noch nicht eingerichtet.',
    hotlineTitle: 'Demo-Hotline', hotlineLink: 'Link der Demo-Hotline', hotlineRinging: 'Eingehender Anruf', answerCall: 'Anruf annehmen', hotlineUnavailable: /nicht mehr verfügbar/,
    other: { button: 'English', todos: 'Your next steps', original: 'See the original', page2: 'Page 2', originalPage2: 'Original letter · Page 2' }
  }
} as const;

for (const lang of ['en', 'de'] as const) {
test.describe(`${lang === 'en' ? 'English' : 'German'} workflows`, () => {
const sample = getMockDocuments(lang)[0];
const rent = getMockDocuments(lang).find(doc => doc.id === 'demo-rent')!;
const ui = workflowCopy[lang];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(value => {
    if (!localStorage.getItem('appella.language')) localStorage.setItem('appella.language', value);
  }, lang);
});
test('upload resizes images, shows analysis, and navigates to a result', async ({ page }) => {
  await mockApi(page, lang);
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => finish = resolve);
  let payload: { images: string[]; lang: string } | undefined;
  await page.route('**/api/analyze', async route => {
    payload = route.request().postDataJSON();
    await waiting;
    await route.fulfill({ json: { id: sample.id, analysis: sample.analysis, related: sample.related } });
  });
  await page.goto('/');
  await addPage(page, ui.pages);
  await page.getByRole('button', { name: ui.analyzeOne, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: ui.analyzing })).toBeVisible();
  await expect.poll(() => payload?.lang).toBe(lang);
  expect(payload?.images[0]).toMatch(/^\/9j\//);
  expect(payload?.images[0]).not.toContain('data:');
  finish();
  await expect(page).toHaveURL(`/letters/${sample.id}`);
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
});

test('language and server checklist persist, clipboard and original scans work', async ({ page, context }) => {
  await mockApi(page, lang);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/letters/${sample.id}`);
  const check = page.getByRole('checkbox', { name: `${ui.completeAction} ${sample.analysis.action_items[0].title}` });
  await check.click();
  await expect(check).toBeChecked();
  await page.getByRole('button', { name: ui.copyReference }).click();
  await expect(page.getByRole('status').filter({ hasText: ui.copied })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('37 012 345 67');
  await page.getByRole('button', { name: ui.other.button, exact: true }).click();
  await expect(page.getByRole('heading', { name: ui.other.todos })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: ui.other.todos })).toBeVisible();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await page.route('**/api/documents/*/pages/*', route => route.fulfill({ contentType: 'image/png', body: tinyPng }));
  await page.getByRole('button', { name: ui.other.original }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: ui.other.page2, exact: true }).click();
  await expect(page.getByRole('img', { name: ui.other.originalPage2 })).toHaveAttribute('src', `/api/documents/${sample.id}/pages/2`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('analysis errors retain uploads and cancelling does not navigate to a late result', async ({ page }) => {
  await mockApi(page, lang);
  await page.route('**/api/analyze', route => route.fulfill({ status: 502, json: { message: 'Ollama unavailable' } }));
  await page.goto('/');
  await addPage(page, ui.pages);
  await page.getByRole('button', { name: ui.analyzeOne, exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(ui.analysisError);
  await expect(page.getByText(ui.pages)).toBeVisible();
  await page.unroute('**/api/analyze');
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => finish = resolve);
  await page.route('**/api/analyze', async route => {
    await waiting;
    await route.fulfill({ json: { id: sample.id, analysis: sample.analysis, related: sample.related } }).catch(() => {});
  });
  await page.getByRole('button', { name: ui.analyzeOne, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: ui.analyzing })).toBeVisible();
  await page.getByRole('button', { name: ui.cancelAnalysis, exact: true }).click();
  finish();
  await expect(page.getByRole('heading', { name: ui.capture, exact: true })).toBeVisible();
  await expect(page).toHaveURL('/');
});

test('call confirmation sends only reviewed metadata and requires consent', async ({ page }) => {
  await mockApi(page, lang);
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/calls', route => { payload = route.request().postDataJSON(); return route.fulfill({ json: { id: 'test-call', state: 'dialing' } }); });
  await page.route('**/api/calls/test-call/events', route => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ state: 'on_hold', at: new Date().toISOString() })}\n\n` }));
  await page.goto(`/letters/${sample.id}`);
  await page.getByRole('button', { name: ui.waitForMe, exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const start = sheet.getByRole('button', { name: ui.startCall, exact: true });
  await expect(start).toBeDisabled();
  await sheet.getByLabel(ui.phone, { exact: true }).fill('0621 / 292-0');
  await sheet.getByRole('checkbox').check();
  await start.click();
  await expect(page).toHaveURL('/calls/test-call');
  expect(payload?.toNumber).toBe('+496212920');
  expect(payload?.purpose).toBe(sample.analysis.action_items[2].call_purpose_de);
  expect(payload?.reference).toContain('37 012 345 67');
  expect(payload).not.toHaveProperty('images');
  await expect(page.getByRole('heading', { name: sample.sender_name })).toBeVisible();
});

test('a browser-mode call shows the demo hotline link', async ({ page }) => {
  await mockApi(page, lang);
  await page.route('**/api/calls', route => route.fulfill({ json: { id: 'test-call', state: 'dialing', mode: 'browser' } }));
  await page.route('**/api/calls/test-call/events', route => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ state: 'dialing', at: new Date().toISOString() })}\n\n` }));
  await page.goto(`/letters/${sample.id}`);
  await page.getByRole('button', { name: ui.waitForMe, exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel(ui.phone, { exact: true }).fill('0621 / 292-0');
  await sheet.getByRole('checkbox').check();
  await sheet.getByRole('button', { name: ui.startCall, exact: true }).click();
  await expect(page).toHaveURL('/calls/test-call');
  await expect(page.getByRole('heading', { name: ui.hotlineTitle })).toBeVisible();
  await expect(page.getByLabel(ui.hotlineLink)).toHaveValue(/\/hotline\/test-call$/);
});

test('the demo hotline names the caller, and explains when its call is gone', async ({ page }) => {
  await page.route('**/api/calls/live-call/session', route => route.fulfill({ json: { senderName: 'Finanzamt Mannheim-Stadt', userName: 'Kevin' } }));
  await page.goto('/hotline/live-call');
  await expect(page.getByRole('heading', { name: ui.hotlineRinging })).toBeVisible();
  await expect(page.getByRole('button', { name: ui.answerCall, exact: true })).toBeEnabled();
  await expect(page.getByText('Finanzamt Mannheim-Stadt, Müller')).toBeVisible();
  await page.route('**/api/calls/old-call/session', route => route.fulfill({ status: 409, json: { message: 'This call has already ended' } }));
  await page.goto('/hotline/old-call');
  await expect(page.getByRole('heading', { name: ui.hotlineUnavailable })).toBeVisible();
});

test('call confirmation explains when the phone assistant is not set up', async ({ page }) => {
  await mockApi(page, lang);
  await page.route('**/api/calls', route => route.fulfill({ status: 503, json: { message: 'ElevenLabs is not configured.', missing: ['ELEVENLABS_PHONE_NUMBER_ID'] } }));
  await page.goto(`/letters/${sample.id}`);
  await page.getByRole('button', { name: ui.waitForMe, exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel(ui.phone, { exact: true }).fill('0621 / 292-0');
  await sheet.getByRole('checkbox').check();
  await sheet.getByRole('button', { name: ui.startCall, exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText(ui.callNotConfigured);
  await expect(page).toHaveURL(`/letters/${sample.id}`);
});

test('all live call states render and cancellation uses the endpoint', async ({ page }) => {
  await mockApi(page, lang);
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
  await expect(page.getByRole('status').filter({ hasText: ui.dialing })).toBeVisible();
  // "Dialling" is also the state before any event arrives: wait for the replayed history, so it can't land after the next event.
  await expect(page.getByRole('listitem').filter({ hasText: ui.dialing })).toBeVisible();
  await emit('ivr');
  await expect(page.getByRole('status').filter({ hasText: ui.ivr })).toBeVisible();
  await emit('on_hold');
  await expect(page.getByText(ui.waitingTime)).toBeVisible();
  await emit('human_detected');
  await expect(page.getByRole('heading', { name: ui.humanTitle })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { didVibrate: boolean }).didVibrate)).toBe(true);
  await emit('transferring');
  await expect(page.getByRole('heading', { name: ui.humanTitle })).toBeVisible();
  await emit('connected');
  await expect(page.getByRole('heading', { name: ui.connected })).toBeVisible();
  await emit('voicemail');
  await expect(page.getByRole('heading', { name: ui.voicemail })).toBeVisible();
  let cancelled = false;
  await page.route('**/api/calls/test-call/cancel', async route => { cancelled = true; await route.fulfill({ json: { ok: true } }); });
  await page.getByRole('button', { name: ui.cancelCall, exact: true }).click();
  await expect.poll(() => cancelled).toBe(true);
  await emit('ended');
  await expect(page.getByRole('heading', { name: ui.ended })).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => typeof (window as unknown as { emitCall: unknown }).emitCall === 'function');
  await expect(page.getByRole('status').filter({ hasText: ui.dialing })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: ui.dialing })).toBeVisible();
  await emit('failed');
  await expect(page.getByRole('heading', { name: ui.failed })).toBeVisible();
});

test('archive search is debounced, filters combine with search, and graph documents navigate', async ({ page }) => {
  await mockApi(page, lang);
  const queries: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/documents' && url.searchParams.has('q')) queries.push(url.searchParams.get('q')!); });
  await page.goto('/archive');
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
  await page.getByRole('button', { name: ui.taxOffice }).click();
  await expect(page.getByRole('heading', { name: rent.document_type })).not.toBeVisible();
  await page.getByRole('button', { name: ui.all }).click();
  const search = page.getByRole('searchbox');
  await search.fill('t'); await search.fill('ta'); await search.fill('tax');
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
  await expect.poll(() => queries).toEqual(['tax']);
  await search.fill('no-such-letter');
  await expect(page.getByRole('heading', { name: ui.noResults })).toBeVisible();
  await page.getByRole('button', { name: ui.resetFilters, exact: true }).click();
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
  await page.goto('/graph');
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('button', { name: ui.zoomIn })).toBeEnabled();
  await page.getByRole('button', { name: sample.sender_name, exact: true }).click();
  await expect(page.getByText(ui.connections)).toBeVisible();
  await page.getByRole('link', { name: sample.document_type, exact: true }).first().click();
  await expect(page).toHaveURL(`/letters/${sample.id}`);
});

test('demo preview cannot call the backend and captures analyzing, confirmation and human views', async ({ page }, testInfo) => {
  const apiRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: ui.previewAnalysis }).click();
  await expect(page.getByRole('status').filter({ hasText: ui.analyzing })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`analyzing-390-${lang}.png`), fullPage: true });
  await page.goto('/letters/demo-tax?demo=1');
  await page.getByRole('button', { name: ui.waitForMe, exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath(`confirmation-390-${lang}.png`) });
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('dialog').getByRole('button', { name: ui.startCall, exact: true }).click();
  await expect(page).toHaveURL('/calls/demo-call?demo=1');
  await page.getByLabel(ui.demoCallState).selectOption('on_hold');
  await expect(page.getByText(ui.waitingTime)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`on-hold-390-${lang}.png`), fullPage: true });
  await page.getByLabel(ui.demoCallState).selectOption('human_detected');
  await expect(page.getByRole('heading', { name: ui.humanTitle })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`human-390-${lang}.png`), fullPage: true });
  expect(apiRequests).toEqual([]);
});
});
}

async function assertLayout(page: Page) {
  const measurements = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const header = document.querySelector('header > .shell-container')!;
    const style = getComputedStyle(main);
    const headerStyle = getComputedStyle(header);
    const dates = [...main.querySelectorAll('time')].filter(date => date.getBoundingClientRect().width > 0);
    return {
      overflows: document.documentElement.scrollWidth > window.innerWidth,
      contentLeft: main.getBoundingClientRect().left + parseFloat(style.paddingLeft),
      headerLeft: header.getBoundingClientRect().left + parseFloat(headerStyle.paddingLeft),
      splitDates: dates.filter(date => date.getClientRects().length > 1).map(date => date.textContent)
    };
  });
  expect(measurements.overflows).toBe(false);
  expect(Math.abs(measurements.contentLeft - measurements.headerLeft)).toBeLessThan(1);
  expect(measurements.splitDates).toEqual([]);
}

for (const width of [375, 390, 430, 768, 1366]) {
  for (const lang of ['de', 'en'] as const) {
    test(`actual sticky layouts at ${width}px in ${lang}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      // Use a native advancing clock for canvas rendering. Calendar-date behavior is covered separately.
      await page.addInitScript(value => localStorage.setItem('appella.language', value), lang);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const ui = lang === 'de'
        ? { loading: 'Wird geladen…', camera: 'Kamera öffnen', files: 'Bilder auswählen', wait: 'In der Warteschleife warten', close: 'Schließen' }
        : { loading: 'Loading…', camera: 'Take a photo', files: 'Choose images', wait: 'Hold the line for me', close: 'Close' };

      for (const [name, path] of [['home', '/?demo=1'], ['result', '/letters/demo-tax?demo=1'], ['call', '/calls/demo-call?demo=1'], ['archive', '/archive?demo=1'], ['graph', '/graph?demo=1']]) {
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByText(ui.loading, { exact: true })).not.toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await page.evaluate(() => document.fonts.ready);
        if (name === 'home' || name === 'archive') await expect(page.locator('.letter-card').first()).toContainText('312,40 EUR');
        if (name === 'graph') {
          await expect(page.getByRole('button', { name: lang === 'de' ? 'Vergrößern' : 'Zoom in' })).toBeEnabled();
          // The fitted camera is painted on the next animation frame, after the controls become ready.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const canvas = await page.getByRole('img', { name: lang === 'de' ? 'Interaktives Wissensnetz' : 'Interactive knowledge graph', exact: true }).boundingBox();
          const zoom = await page.getByRole('button', { name: lang === 'de' ? 'Vergrößern' : 'Zoom in', exact: true }).boundingBox();
          expect(zoom!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height);
        }
        await assertLayout(page);
        await expect(page.locator('header')).toHaveCSS('position', 'sticky');
        if (name !== 'result' && name !== 'call') {
          await expect(page.locator('nav')).toHaveCSS('position', 'fixed');
          const nav = await page.locator('nav').boundingBox();
          expect(Math.abs(nav!.y + nav!.height - 900)).toBeLessThan(1);
        }
        await page.screenshot({ path: testInfo.outputPath(`${name}-${width}-${lang}.png`) });

        if (name === 'home') {
          for (const label of [ui.camera, ui.files]) {
            const button = page.getByRole('button', { name: label, exact: true });
            const bounds = await button.boundingBox();
            expect(bounds!.height).toBeGreaterThanOrEqual(44);
            expect(bounds!.height).toBeLessThanOrEqual(52);
          }
          await page.locator('input[type=file][multiple]').setInputFiles([
            { name: 'page-1.png', mimeType: 'image/png', buffer: tinyPng },
            { name: 'page-2.png', mimeType: 'image/png', buffer: tinyPng }
          ]);
          await expect(page.locator('main img')).toHaveCount(2);
          await assertLayout(page);
          await page.screenshot({ path: testInfo.outputPath(`upload-${width}-${lang}.png`) });
        }
        if (name === 'result') {
          const summary = page.getByRole('heading', { name: lang === 'de' ? 'Klartext-Zusammenfassung' : 'The short version' }).locator('..');
          const bounds = await summary.boundingBox();
          const main = await page.locator('main').boundingBox();
          expect(bounds!.width).toBeGreaterThan(main!.width * 0.85);
          await expect(page.locator('main .relative > .absolute').first()).toHaveCSS('margin-bottom', '0px');
          await page.getByRole('heading', { name: lang === 'de' ? 'Ihre To-Dos' : 'Your next steps' }).evaluate(element => element.scrollIntoView({ block: 'start' }));
          await page.screenshot({ path: testInfo.outputPath(`result-actions-${width}-${lang}.png`) });
          await page.getByRole('button', { name: ui.wait, exact: true }).click();
          const sheet = page.getByRole('dialog');
          await expect(sheet).toBeVisible();
          expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(width);
          await page.screenshot({ path: testInfo.outputPath(`confirmation-${width}-${lang}.png`) });
          await sheet.evaluate(element => element.scrollTop = element.scrollHeight);
          await page.screenshot({ path: testInfo.outputPath(`confirmation-actions-${width}-${lang}.png`) });
          await sheet.getByRole('button', { name: ui.close, exact: true }).click();
        }
        if (name === 'archive') {
          const action = await page.locator('.archive-action').boundingBox();
          const nav = await page.locator('nav').boundingBox();
          expect(Math.abs(action!.y + action!.height - nav!.y)).toBeLessThan(1);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const lastCard = await page.locator('.letter-card').last().boundingBox();
          expect(lastCard!.y + lastCard!.height).toBeLessThanOrEqual(action!.y);
          await page.screenshot({ path: testInfo.outputPath(`archive-bottom-${width}-${lang}.png`) });
        }
      }
      expect(errors).toEqual([]);
    });
  }
}

test('long sender names and references wrap without losing data', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('appella.language', 'de'));
  await mockApi(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const value = 'AZ-2026-' + '1234567890'.repeat(6);
  const doc = structuredClone(sample);
  doc.analysis.sender.name = 'Landesamt für Bürger- und Ordnungsangelegenheiten Berlin';
  doc.analysis.references = [{ label: 'Versicherungsnummer', value }];
  await page.route('**/api/documents/*', route => route.fulfill({ json: doc }));
  await page.goto(`/letters/${sample.id}`);
  const chip = page.getByRole('button', { name: 'Versicherungsnummer kopieren' });
  await expect(chip).toContainText(value);
  await assertLayout(page);
  await chip.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  await page.getByRole('button', { name: 'In der Warteschleife warten', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('dd')).toHaveText(value);
  expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('English is the first-paint default and new analyses request English', async ({ page, request }) => {
  const response = await request.get('/');
  const html = await response.text();
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('Let’s untangle this.');
  await mockApi(page, 'en');
  const doc = getMockDocuments('en')[0];
  let payload: { images: string[]; lang: string } | undefined;
  await page.route('**/api/analyze', route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { id: doc.id, analysis: doc.analysis, related: doc.related } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Let’s untangle this.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await addPage(page, 'Your pages (1)', 'letter.png');
  await page.getByRole('button', { name: 'Explain this page', exact: true }).click();
  await expect.poll(() => payload?.lang).toBe('en');
  await expect(page).toHaveURL(`/letters/${doc.id}`);
  await expect(page.getByRole('heading', { name: doc.document_type, exact: true })).toBeVisible();
});

test('saved German wins over the default and switching languages updates demo copy', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('appella.language')) localStorage.setItem('appella.language', 'de');
  });
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Guten Tag' })).toBeVisible();
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: getMockDocuments('en')[0].document_type, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Let’s untangle this.' })).toBeVisible();
  await page.goto('/letters/demo-tax?demo=1');
  await expect(page.getByText('Pay the outstanding €312.40', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Deutsch', exact: true }).click();
  await expect(page.getByRole('heading', { name: sample.document_type, exact: true })).toBeVisible();
});

for (const unavailable of [false, true]) {
  test(`English fallback when language preference is ${unavailable ? 'unavailable' : 'invalid'}`, async ({ page }) => {
    await page.addInitScript(disabled => {
      if (!disabled) { localStorage.setItem('appella.language', 'fr'); return; }
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) { if (key === 'appella.language') throw new Error('Storage unavailable'); return get.call(this, key); };
      Storage.prototype.setItem = function (key, value) { if (key === 'appella.language') throw new Error('Storage unavailable'); set.call(this, key, value); };
    }, unavailable);
    await page.goto('/?demo=1');
    await expect(page.getByRole('heading', { name: 'Let’s untangle this.' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
}

test('English demo keeps call purposes in German and never dials a real number', async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.goto('/letters/demo-tax?demo=1');
  await page.getByRole('button', { name: 'Hold the line for me', exact: true }).click();
  const purpose = page.getByRole('textbox', { name: 'Reason for calling' });
  await expect(purpose).toHaveAttribute('lang', 'de');
  await expect(purpose).toHaveValue(sample.analysis.action_items[2].call_purpose_de!);
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start the call', exact: true }).click();
  await page.getByLabel('Try a call status').selectOption('human_detected');
  await expect(page.getByRole('heading', { name: 'You’re up.' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('human-english.png') });
  expect(requests).toEqual([]);
});

test('demo translations preserve printed facts and support bilingual search', () => {
  const english = getMockDocuments('en');
  for (const original of mockDocuments) {
    const translated = english.find(doc => doc.id === original.id)!;
    expect(translated.sender_name).toBe(original.sender_name);
    expect(translated.letter_date).toBe(original.letter_date);
    expect(translated.deadline).toBe(original.deadline);
    expect(translated.analysis.references).toEqual(original.analysis.references);
    expect(translated.analysis.amount_due).toBe(original.analysis.amount_due);
    expect(translated.analysis.action_items.map(action => ({ type: action.type, due: action.due, phone: action.phone, phone_raw: action.phone_raw, purpose: action.call_purpose_de })))
      .toEqual(original.analysis.action_items.map(action => ({ type: action.type, due: action.due, phone: action.phone, phone_raw: action.phone_raw, purpose: action.call_purpose_de })));
  }
  expect(mockRows('Steuerbescheid', 'en').some(doc => doc.id === 'demo-tax')).toBe(true);
  expect(mockRows('income tax', 'de').some(doc => doc.id === 'demo-tax')).toBe(true);
});

test('chat helper follows the UI language and has English fallback labels', async ({ page }) => {
  const languages: string[] = [];
  await page.route('**/api/chat', route => {
    languages.push(route.request().postDataJSON().lang);
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: 'Let’s untangle this.' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const path = '/src/lib/assistant-client.ts';
    const { streamChat, splitRefs } = await import(path);
    const errors: { type: string; message?: string }[] = [];
    await streamChat({ messages: [{ role: 'user', content: 'What needs my attention?' }] }, (event: { type: string; message?: string }) => errors.push(event));
    await streamChat({ messages: [{ role: 'user', content: 'Was ist offen?' }], lang: 'de' }, () => {});
    return { errors, refs: splitRefs('[[letter:unknown]] [[case:unknown]]', { letters: {}, cases: {} }) };
  });
  expect(languages).toEqual(['en', 'de']);
  expect(result.errors[0].message).toBe('We couldn’t reach the assistant (error 503). Try again.');
  expect(result.refs.filter((ref: { kind: string }) => ref.kind !== 'text').map((ref: { label: string }) => ref.label)).toEqual(['Letter', 'Case']);
});

// Real SvelteKit navigation, not a full reload: catches state retained after a query-only change.
async function navigateInApp(page: Page, href: string) {
  await page.evaluate(url => {
    const link = document.createElement('a');
    link.href = url; link.textContent = 'Test navigation'; link.dataset.testNavigation = 'true';
    link.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:white';
    document.body.append(link);
  }, href);
  await page.locator('[data-test-navigation]').click();
  await expect(page).toHaveURL(href);
  await page.locator('[data-test-navigation]').evaluate(link => link.remove());
}

test('checklists confirm saves, retry failed Undo, and refresh archive completion', async ({ page }) => {
  const documents = await mockApi(page, 'en');
  const doc = documents[0];
  doc.analysis.action_items.slice(1).forEach(action => action.done = true);
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => finish = resolve);
  await page.route('**/api/documents/*/todos/0', async route => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().postDataJSON()).toEqual({ done: true });
    await waiting;
    doc.analysis.action_items[0].done = true;
    await route.fulfill({ json: { event_id: 42, case_id: 'test-case', summary: 'Updated' } });
  });
  await page.goto(`/letters/${doc.id}`);
  const check = page.getByRole('checkbox').first();
  await check.click();
  await expect(check).not.toBeChecked();
  await expect(check).toBeDisabled();
  await expect(page.getByText('Saving…', { exact: true })).toBeVisible();
  finish();
  await expect(check).toBeChecked();
  await expect(check).toBeEnabled();
  await page.route('**/api/case-events/42/undo', route => route.fulfill({ status: 409, json: { message: 'secret-provider-token' } }));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('couldn’t undo');
  await expect(check).toBeChecked();
  await expect(page.locator('body')).not.toContainText('secret-provider-token');
  await page.route('**/api/case-events/42/undo', route => {
    doc.analysis.action_items[0].done = false;
    return route.fulfill({ json: { event_id: 43, case_id: 'test-case', summary: 'Undone' } });
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(check).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).not.toBeVisible();
  await page.reload();
  await expect(check).not.toBeChecked();
  await check.click();
  await expect(check).toBeChecked();
  await expect(check).toBeEnabled();
  await page.getByRole('link', { name: 'Open archive', exact: true }).click();
  await page.getByRole('button', { name: /^Completed/ }).click();
  await expect(page.locator('.letter-card')).toHaveCount(1);
  await expect(page.locator('.letter-card')).toContainText(doc.document_type);
  // Simulate another client/assistant changing the stored analysis; navigation must not use old cache.
  doc.analysis.action_items[0].done = false;
  await page.locator('.letter-card').click();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
});

test('failed checklist saves keep confirmed state and do not import browser checkmarks', async ({ page }) => {
  await mockApi(page, 'en');
  await page.addInitScript(id => localStorage.setItem('appella.checklist', JSON.stringify({ [id]: [0, 1, 2] })), sample.id);
  await page.route('**/api/documents/*/todos/*', route => route.fulfill({ status: 503, json: { message: 'private-key' } }));
  await page.goto(`/letters/${sample.id}`);
  const check = page.getByRole('checkbox').first();
  await expect(check).not.toBeChecked();
  await check.click();
  await expect(page.getByRole('alert')).toContainText('couldn’t save');
  await expect(check).not.toBeChecked();
  await expect(check).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).not.toBeVisible();
  await expect(page.locator('body')).not.toContainText('private-key');
  await page.unroute('**/api/documents/*/todos/*');
  // Reinstall the mutable mock so retry is a genuine successful server-backed operation.
  await mockApi(page, 'en');
  await check.click();
  await expect(check).toBeChecked();
  await expect(page.getByText('Change saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(check).not.toBeChecked();
});

test('a confirmed write survives refresh failure and retry only reloads details', async ({ page }) => {
  const documents = await mockApi(page, 'en');
  let patches = 0;
  page.on('request', request => { if (request.method() === 'PATCH') patches++; });
  await page.goto(`/letters/${sample.id}`);
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  await page.route(`**/api/documents/${sample.id}`, route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('checkbox').first().click();
  await expect(page.getByRole('alert')).toContainText('Your change was saved');
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  documents[0].analysis.action_items[1].done = true;
  await page.unroute(`**/api/documents/${sample.id}`);
  await page.getByRole('button', { name: 'Reload letter', exact: true }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
  expect(patches).toBe(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
});

test('query-only demo exits reset uploads, analysis preview, archive filters and graph data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/documents*', route => route.fulfill({ json: [] }));
  await page.route('**/api/graph', route => route.fulfill({ json: { nodes: [], links: [] } }));
  await page.goto('/?demo=1');
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.getByText('Your pages (1)', { exact: true })).toBeVisible();
  await navigateInApp(page, '/');
  await expect(page.locator('main img')).toHaveCount(0);
  await navigateInApp(page, '/?demo=1');
  await page.getByRole('button', { name: 'See how it works', exact: true }).click();
  await navigateInApp(page, '/');
  await expect(page.getByRole('heading', { name: 'Add a letter', exact: true })).toBeVisible();
  await expect(page.getByText('Nothing here—yet.', { exact: true })).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explain my letter', exact: true })).toBeDisabled();
  await expect(page.getByText('Just a demo', { exact: false })).not.toBeVisible();
  await navigateInApp(page, '/archive?demo=1');
  await page.getByRole('searchbox').fill('tax');
  await page.getByRole('button', { name: /^Tax office/ }).click();
  await expect(page.locator('.letter-card').first()).toBeVisible();
  await navigateInApp(page, '/archive');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.getByRole('button', { name: /^All letters/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.letter-card')).toHaveCount(0);
  await navigateInApp(page, '/graph?demo=1');
  await expect(page.getByRole('button', { name: sample.sender_name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: sample.sender_name, exact: true }).click();
  await navigateInApp(page, '/graph');
  await expect(page.getByRole('heading', { name: 'The dots will connect.' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByText(sample.sender_name, { exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('demo checklist edits stay local even when a real document has the same ID', async ({ page }) => {
  await mockApi(page, 'en');
  const writes: string[] = [];
  page.on('request', request => { if (['POST', 'PATCH'].includes(request.method())) writes.push(request.url()); });
  await page.goto('/letters/demo-tax?demo=1');
  await page.getByRole('checkbox').first().check();
  await expect(page.getByText('Demo checkmarks stay in this preview only.')).toBeVisible();
  await navigateInApp(page, '/archive?demo=1');
  await navigateInApp(page, '/letters/demo-tax?demo=1');
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).not.toBeVisible();
  // The Undo affordance is scoped to the current result; a new visit still retains demo completion.
  await navigateInApp(page, '/letters/demo-tax');
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await expect(page.getByText('Your checkmarks are saved with this letter in the archive.')).toBeVisible();
  expect(writes).toEqual([]);
});

test('demo call metadata and terminal events cannot leak into normal monitoring', async ({ page }) => {
  await page.route('**/api/documents*', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    (window as unknown as { eventSources: string[] }).eventSources = [];
    class FakeEventSource {
      static CLOSED = 2; readyState = 1;
      onmessage?: (event: { data: string }) => void; onopen?: () => void;
      constructor(url: string) {
        (window as unknown as { eventSources: string[] }).eventSources.push(url);
        setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ state: 'dialing', at: new Date().toISOString() }) }); }, 20);
      }
      close() { this.readyState = 2; }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeEventSource });
    // Old leaked demo storage must never be treated as a real call context.
    sessionStorage.setItem('appella.call', JSON.stringify({ id: 'demo-call', senderName: 'Leaked demo sender', toNumber: '+490000000', purpose: 'demo', reference: '', letterId: 'demo-tax', demo: true }));
  });
  await page.goto('/');
  await expect(page.getByText('Call in progress', { exact: true })).not.toBeVisible();
  await navigateInApp(page, '/letters/demo-tax?demo=1');
  await page.getByRole('button', { name: 'Hold the line for me', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start the call', exact: true }).click();
  await page.getByLabel('Try a call status').selectOption('ended');
  await expect(page.getByRole('heading', { name: 'Call ended', exact: true })).toBeVisible();
  await navigateInApp(page, '/');
  await expect(page.getByText('Call in progress', { exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { eventSources: string[] }).eventSources)).toEqual([]);
  await navigateInApp(page, '/calls/demo-call');
  await expect(page.getByRole('status').filter({ hasText: 'Dialling…' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Call ended', exact: true })).not.toBeVisible();
  await expect(page.getByText(sample.sender_name, { exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { eventSources: string[] }).eventSources)).toEqual(['/api/calls/demo-call/events']);
});

test('leaving a demo restores real call metadata and monitoring without cancelling it', async ({ page }) => {
  await page.route('**/api/documents*', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    (window as unknown as { sources: string[] }).sources = [];
    class FakeEventSource {
      static CLOSED = 2; readyState = 1;
      onmessage?: (event: { data: string }) => void; onopen?: () => void;
      constructor(url: string) {
        (window as unknown as { sources: string[] }).sources.push(url);
        setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ state: 'on_hold', at: new Date().toISOString() }) }); }, 20);
      }
      close() { this.readyState = 2; }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeEventSource });
    sessionStorage.setItem('appella.call', JSON.stringify({ id: 'real-call', senderName: 'Saved real sender', toNumber: '+490000000', purpose: 'synthetic', reference: '', letterId: 'real-letter' }));
  });
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Saved real sender', exact: true })).toBeVisible();
  await navigateInApp(page, '/calls/demo-call?demo=1');
  await page.getByLabel('Try a call status').selectOption('ended');
  await navigateInApp(page, '/');
  await expect(page.getByRole('heading', { name: 'Saved real sender', exact: true })).toBeVisible();
  await expect(page.getByText('On hold', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { sources: string[] }).sources)).toEqual(['/api/calls/real-call/events', '/api/calls/real-call/events']);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('appella.call')!).id)).toBe('real-call');
  expect(writes).toEqual([]);
});

test('Undo reload failure keeps last-confirmed state until an authoritative read', async ({ page }) => {
  const docs = await mockApi(page, 'en');
  await page.goto(`/letters/${sample.id}`);
  const check = page.getByRole('checkbox').first();
  await check.click();
  await expect(check).toBeChecked();
  await expect(check).toBeEnabled();
  await page.route(`**/api/documents/${sample.id}`, route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your change was saved');
  expect(docs[0].analysis.action_items[0].done).toBe(false);
  await expect(check).toBeChecked();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).not.toBeVisible();
  await page.unroute(`**/api/documents/${sample.id}`);
  await page.getByRole('button', { name: 'Reload letter', exact: true }).click();
  await expect(check).not.toBeChecked();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

test('a lost save response offers an authoritative reload instead of inventing completion', async ({ page }) => {
  const docs = await mockApi(page, 'en');
  await page.route('**/api/documents/*/todos/*', route => {
    docs[0].analysis.action_items[0].done = true;
    return route.abort('failed');
  });
  await page.goto(`/letters/${sample.id}`);
  const check = page.getByRole('checkbox').first();
  await check.click();
  await expect(page.getByRole('alert')).toContainText('couldn’t save or confirm');
  await expect(check).not.toBeChecked();
  await page.getByRole('button', { name: 'Reload letter', exact: true }).click();
  await expect(check).toBeChecked();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).not.toBeVisible();
});

for (const lang of ['de', 'en'] as const) {
  test(`payment fields are copyable, safely wrap and do not initiate payment in ${lang}`, async ({ page, context }, testInfo) => {
    const docs = await mockApi(page, lang);
    await page.addInitScript(value => localStorage.setItem('appella.language', value), lang);
    await page.setViewportSize({ width: 375, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const payment = { recipient: 'Synthetic Test Recipient ' + 'Name'.repeat(15), iban: 'DE89 3704 0044 0532 0130 00', purpose: 'TEST-REFERENCE-' + '1234567890'.repeat(8) };
    docs[0].analysis.payment = payment;
    const writes: string[] = [];
    page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
    await page.goto(`/letters/${docs[0].id}`);
    const labels = lang === 'de' ? ['Zahlungsempfänger kopieren', 'IBAN kopieren', 'Verwendungszweck kopieren'] : ['Copy Payment recipient', 'Copy IBAN', 'Copy Payment reference'];
    for (const [index, value] of [payment.recipient, payment.iban, payment.purpose].entries()) {
      await page.getByRole('button', { name: labels[index], exact: true }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
    }
    await assertLayout(page);
    await page.getByRole('heading', { name: lang === 'de' ? 'Zahlungsangaben' : 'Payment details', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath(`payment-${lang}-375.png`) });
    expect(writes).toEqual([]);
    docs[0].analysis.payment.iban = null;
    await page.reload();
    await expect(page.getByRole('button', { name: labels[1], exact: true })).not.toBeVisible();
    await expect(page.getByText(lang === 'de' ? 'Nicht im Schreiben erkannt' : 'Not found in the letter', { exact: true })).toBeVisible();
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Denied'); } }, configurable: true }));
    await page.reload();
    await page.getByRole('button', { name: labels[0], exact: true }).click();
    await expect(page.getByRole('status')).toContainText(lang === 'de' ? 'Kopieren nicht möglich' : 'Copying didn’t work');
    docs[0].analysis.payment = null;
    await page.reload();
    await expect(page.getByRole('heading', { name: lang === 'de' ? 'Zahlungsangaben' : 'Payment details', exact: true })).not.toBeVisible();
  });
}

const uploadFailures = [
  { status: 503, message: 'Gemini is not configured. Set GEMINI_API_KEY in .env.', text: { en: 'isn’t set up correctly', de: 'nicht richtig konfiguriert' } },
  { status: 401, message: 'private-api-key', text: { en: 'isn’t set up correctly', de: 'nicht richtig konfiguriert' } },
  { status: 429, message: 'private-api-key', retry: '30', text: { en: 'limiting requests', de: 'begrenzt gerade' } },
  { status: 502, message: 'The model returned an invalid analysis response.', text: { en: 'valid analysis', de: 'gültige Analyse' } },
  { status: 502, message: 'The model returned an empty response.', text: { en: 'valid analysis', de: 'gültige Analyse' } },
  { status: 503, message: 'private-api-key', text: { en: 'unavailable right now', de: 'gerade nicht erreichbar' } },
  { status: 502, message: 'private-api-key', text: { en: 'couldn’t finish reading', de: 'Analyse ist fehlgeschlagen' } }
];
for (const lang of ['de', 'en'] as const) {
  test(`upload errors are actionable, localized and never reveal provider messages in ${lang}`, async ({ page }) => {
    await mockApi(page, lang);
    await page.clock.install();
    await page.addInitScript(value => localStorage.setItem('appella.language', value), lang);
    await page.goto('/');
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
    const analyze = page.getByRole('button', { name: lang === 'de' ? '1 Seite jetzt analysieren' : 'Explain this page', exact: true });
    for (const failure of uploadFailures) {
      await page.route('**/api/analyze', route => route.fulfill({ status: failure.status, headers: failure.retry ? { 'Retry-After': failure.retry } : {}, json: { message: failure.message } }));
      await analyze.click();
      await expect(page.getByRole('alert')).toContainText(failure.text[lang]);
      await expect(page.getByRole('alert')).toContainText(lang === 'de' ? 'ausgewählten Seiten bleiben' : 'selected pages are still here');
      await expect(page.locator('main img')).toHaveCount(1);
      await expect(page.locator('body')).not.toContainText('private-api-key');
      if (failure.retry) {
        await expect(page.getByRole('alert')).toContainText('30');
        await page.clock.fastForward(31000);
      }
      await page.unroute('**/api/analyze');
    }
    await page.route('**/api/analyze', route => route.fulfill({ status: 200, contentType: 'application/json', body: 'not-json' }));
    await analyze.click();
    await expect(page.getByRole('alert')).toContainText(lang === 'de' ? 'gültige Analyse' : 'valid analysis');
    await page.unroute('**/api/analyze');
    await page.route('**/api/analyze', route => route.abort('failed'));
    await analyze.click();
    await expect(page.getByRole('alert')).toContainText(lang === 'de' ? 'Verbindung zum Server' : 'connection to the server');
    await expect(page).toHaveURL('/');
  });
}

for (const lang of ['de', 'en'] as const) {
  test(`subtle whole-case deletion requires review and removes all its letters in ${lang}`, async ({ page }, testInfo) => {
    const docs = await mockApi(page, lang);
    await page.addInitScript(value => localStorage.setItem('appella.language', value), lang);
    await page.setViewportSize({ width: 375, height: 900 });
    const caseId = 'delete-test-case';
    const members = [docs[0], docs[3]];
    const title = 'Synthetic case ' + 'Long-title-'.repeat(5);
    members.forEach(doc => { doc.case_id = caseId; doc.case = { id: caseId, title, status: 'open' }; });
    let deletes = 0;
    await page.route(`**/api/cases/${caseId}`, route => {
      if (route.request().method() !== 'DELETE') return route.fulfill({ json: { id: caseId, title, letters: members } });
      deletes++;
      expect(route.request().postDataJSON().letter_ids.sort()).toEqual(members.map(doc => doc.id).sort());
      for (const member of members) docs.splice(docs.findIndex(doc => doc.id === member.id), 1);
      return route.fulfill({ json: { id: caseId, deleted_letters: members.map(doc => doc.id), cleanup_pending: false } });
    });
    const labels = lang === 'de'
      ? { option: 'Akte löschen…', confirm: 'Akte endgültig löschen', cancel: 'Abbrechen', warning: 'alle 2 zugehörigen Briefe', success: 'Die Akte und ihre Briefe wurden gelöscht.' }
      : { option: 'Delete case…', confirm: 'Permanently delete case', cancel: 'Cancel', warning: 'all 2 linked letters', success: 'The case and its letters were deleted.' };
    await page.goto(`/letters/${members[0].id}`);
    const option = page.getByRole('button', { name: labels.option, exact: true });
    await expect(option).toHaveClass(/text-outline/);
    await option.click();
    let sheet = page.getByRole('dialog');
    await expect(sheet).toContainText(labels.warning);
    await expect(sheet.locator('li')).toHaveCount(2);
    await expect(sheet.getByRole('button', { name: labels.confirm, exact: true })).toBeDisabled();
    await sheet.getByRole('button', { name: labels.cancel, exact: true }).click();
    expect(deletes).toBe(0);
    await option.click();
    sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('checkbox')).not.toBeChecked();
    await sheet.getByRole('checkbox').check();
    await assertLayout(page);
    expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`delete-case-${lang}-375.png`) });
    await sheet.getByRole('button', { name: labels.confirm, exact: true }).click();
    await expect(page).toHaveURL('/archive?deleted=1');
    await expect(page.getByRole('status').filter({ hasText: labels.success })).toBeVisible();
    await expect(page.locator('.letter-card')).toHaveCount(2);
    expect(deletes).toBe(1);
  });
}

test('case deletion handles changed membership and failures without silently deleting', async ({ page }) => {
  const docs = await mockApi(page, 'en');
  docs[0].case_id = 'case-delete';
  let members = [docs[0]];
  let outcome = 409;
  let deletes = 0;
  await page.route('**/api/cases/case-delete', route => {
    if (route.request().method() !== 'DELETE') return route.fulfill({ json: { id: 'case-delete', title: 'Test case', letters: members } });
    deletes++;
    return route.fulfill({ status: outcome, json: { message: 'secret-server-path' } });
  });
  await page.goto(`/letters/${docs[0].id}`);
  await page.getByRole('button', { name: 'Delete case…', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('checkbox').check();
  members = [docs[0], docs[3]];
  await sheet.getByRole('button', { name: 'Permanently delete case', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('letters in this case have changed');
  await expect(sheet.getByRole('button', { name: 'Permanently delete case', exact: true })).toBeDisabled();
  await expect(page).toHaveURL(`/letters/${docs[0].id}`);
  await sheet.getByRole('button', { name: 'Reload case', exact: true }).click();
  await expect(sheet.locator('li')).toHaveCount(2);
  await expect(sheet.getByRole('checkbox')).not.toBeChecked();
  outcome = 500;
  await sheet.getByRole('checkbox').check();
  await sheet.getByRole('button', { name: 'Permanently delete case', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('couldn’t confirm deletion');
  await expect(page.locator('body')).not.toContainText('secret-server-path');
  await expect(page).toHaveURL(`/letters/${docs[0].id}`);
  expect(deletes).toBe(2);
});

test('case deletion is unavailable without a case or in demo mode', async ({ page }) => {
  const docs = await mockApi(page, 'en');
  await page.goto(`/letters/${docs[0].id}`);
  await expect(page.getByRole('heading', { name: docs[0].document_type, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete case…', exact: true })).not.toBeVisible();
  docs[0].case_id = 'real-case';
  await navigateInApp(page, '/letters/demo-tax?demo=1');
  await expect(page.getByRole('button', { name: 'Delete case…', exact: true })).not.toBeVisible();
});

test('selected pages survive reloads and explicit discard clears the tab draft', async ({ page }) => {
  await mockApi(page, 'en');
  await page.goto('/');
  await expect(page.locator('.letter-card').first()).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
  await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '{}').phase, draftKey)).toBe('ready');
  await page.reload();
  await expect(page.getByText('Your pages (1)', { exact: true })).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Explain this page', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Discard selected pages', exact: true }).click();
  expect(await page.evaluate(key => sessionStorage.getItem(key), draftKey)).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Explain my letter', exact: true })).toBeDisabled();
  await expect(page.locator('main img')).toHaveCount(0);
});

test('reload during analysis restores pages and warns instead of automatically submitting again', async ({ page }, testInfo) => {
  await mockApi(page, 'en');
  let calls = 0;
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => finish = resolve);
  await page.route('**/api/analyze', async route => {
    calls++;
    await waiting;
    await route.fulfill({ json: { id: sample.id, analysis: sample.analysis, related: sample.related } }).catch(() => {});
  });
  await page.goto('/');
  await expect(page.locator('.letter-card').first()).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
  await page.getByRole('button', { name: 'Explain this page', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '{}').phase, draftKey)).toBe('sending');
  await page.reload();
  finish();
  await expect(page.getByRole('alert')).toContainText('interrupted the analysis');
  await expect(page.getByRole('alert')).toContainText('Nothing will be resubmitted automatically');
  await expect(page.getByText('Your pages (1)', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Check the archive first', exact: true })).toBeVisible();
  const retry = await page.getByRole('button', { name: 'Explain this page', exact: true }).boundingBox();
  const nav = await page.locator('nav').boundingBox();
  expect(retry!.y + retry!.height).toBeLessThan(nav!.y);
  await expect(page).toHaveURL('/');
  expect(calls).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('interrupted-upload-390.png'), fullPage: true });
});

test('structured analysis errors and safe request references survive reloads', async ({ page }) => {
  await mockApi(page, 'en');
  const requestId = 'd2766911-7c22-4819-9bb0-80973564a6d3';
  await page.route('**/api/analyze', route => route.fulfill({ status: 503, json: { code: 'unavailable', message: 'secret-key-and-provider-body', request_id: requestId } }));
  await page.goto('/');
  await expect(page.locator('.letter-card').first()).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
  await page.getByRole('button', { name: 'Explain this page', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('unavailable right now');
  await expect(page.getByRole('alert')).toContainText(requestId);
  await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '{}').phase, draftKey)).toBe('error');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('unavailable right now');
  await expect(page.getByRole('alert')).toContainText(requestId);
  await expect(page.locator('body')).not.toContainText('secret-key-and-provider-body');
  await expect(page.getByText('Your pages (1)', { exact: true })).toBeVisible();
});

test('a saved result remains accessible after a failed detail load without another analysis', async ({ page }) => {
  await mockApi(page, 'en');
  let calls = 0;
  await page.route('**/api/analyze', route => { calls++; return route.fulfill({ json: { id: sample.id, analysis: sample.analysis, related: sample.related } }); });
  await page.route(`**/api/documents/${sample.id}`, route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/');
  await expect(page.locator('.letter-card').first()).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
  await page.getByRole('button', { name: 'Explain this page', exact: true }).click();
  await expect(page).toHaveURL(`/letters/${sample.id}`);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).resultId, draftKey)).toBe(sample.id);
  await navigateInApp(page, '/');
  await expect(page.getByRole('alert')).toContainText('analysis was saved');
  await expect(page.getByRole('link', { name: 'Open saved result', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explain this page', exact: true })).not.toBeVisible();
  await page.unroute(`**/api/documents/${sample.id}`);
  await page.getByRole('link', { name: 'Open saved result', exact: true }).click();
  await expect(page).toHaveURL(`/letters/${sample.id}`);
  await expect(page.getByRole('heading', { name: getMockDocuments('en')[0].document_type, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), draftKey)).toBeNull();
  expect(calls).toBe(1);
});

test('rate limits enforce a retry cooldown without automatically calling the provider', async ({ page }) => {
  await mockApi(page, 'en');
  await page.clock.install();
  let calls = 0;
  await page.route('**/api/analyze', route => { calls++; return route.fulfill({ status: 429, headers: { 'Retry-After': '30' }, json: { code: 'rate_limit', message: 'safe' } }); });
  await page.goto('/');
  await expect(page.locator('.letter-card').first()).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
  await page.getByRole('button', { name: 'Explain this page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry in 30s', exact: true })).toBeDisabled();
  await page.clock.fastForward(31000);
  await expect(page.getByRole('button', { name: 'Explain this page', exact: true })).toBeEnabled();
  expect(calls).toBe(1);
});

test('recovery storage failures are visible and demo captures cannot replace a real draft', async ({ page }) => {
  await mockApi(page, 'en');
  await page.goto('/');
  await expect(page.locator('.letter-card').first()).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'real-synthetic.png', mimeType: 'image/png', buffer: tinyPng });
  await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '{}').pages?.[0]?.name, draftKey)).toBe('real-synthetic.png');
  await navigateInApp(page, '/?demo=1');
  await page.locator('input[type=file][multiple]').setInputFiles([
    { name: 'demo-1.png', mimeType: 'image/png', buffer: tinyPng },
    { name: 'demo-2.png', mimeType: 'image/png', buffer: tinyPng }
  ]);
  await expect(page.getByText('Your pages (2)', { exact: true })).toBeVisible();
  await navigateInApp(page, '/');
  await expect(page.getByText('Your pages (1)', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!).pages[0].name, draftKey)).toBe('real-synthetic.png');
  await page.getByRole('button', { name: 'Discard selected pages', exact: true }).click();
  await page.evaluate(key => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Quota exceeded', 'QuotaExceededError'); return set.call(this, name, value); };
  }, draftKey);
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.getByRole('status').filter({ hasText: 'reload recovery is unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explain this page', exact: true })).toBeEnabled();
});

for (const lang of ['de', 'en'] as const) {
  test(`uploaded-page UI stays focused and keeps technical notices collapsed in ${lang}`, async ({ page }, testInfo) => {
    await mockApi(page, lang);
    await page.addInitScript(value => localStorage.setItem('appella.language', value), lang);
    await page.goto('/');
    await expect(page.locator('.letter-card').first()).toBeVisible();
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: tinyPng });
    const explain = page.getByRole('button', { name: lang === 'de' ? '1 Seite jetzt analysieren' : 'Explain this page', exact: true });
    await expect(explain).toBeEnabled();
    await expect(page.locator('.letter-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: lang === 'de' ? 'Kamera öffnen' : 'Take a photo', exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: lang === 'de' ? 'Bilder auswählen' : 'Choose images', exact: true })).not.toBeVisible();
    await expect(page.getByRole('status')).not.toBeVisible();
    await expect(page.getByRole('alert')).not.toBeVisible();
    const info = page.locator('details').filter({ hasText: lang === 'de' ? 'Über diesen Upload' : 'About this upload' });
    await expect(info).not.toHaveAttribute('open');
    await expect(info.locator('div')).not.toBeVisible();
    await assertLayout(page);
    const bounds = await explain.boundingBox();
    const nav = await page.locator('nav').boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(nav!.y);
    await page.screenshot({ path: testInfo.outputPath(`focused-upload-${lang}-390.png`) });
    await page.route('**/api/analyze', route => route.fulfill({ status: 503, json: { code: 'configuration', message: 'private-key', request_id: 'd2766911-7c22-4819-9bb0-80973564a6d3' } }));
    await explain.click();
    const error = page.getByRole('alert');
    await expect(error.locator(':scope > p')).toHaveText(lang === 'de' ? 'Der KI-Dienst muss eingerichtet werden.' : 'Your AI service needs setting up.');
    await expect(error.locator('details')).not.toHaveAttribute('open');
    await expect(error.locator('details > div')).not.toBeVisible();
    await expect(page.locator('body')).not.toContainText('private-key');
    await error.locator('summary').click();
    await expect(error.locator('details > div')).toBeVisible();
    await expect(error).toContainText('GEMMA_PROVIDER');
  });
}

for (const lang of ['de', 'en'] as const) {
  test(`home and archive agree on completed tasks, including Undo in ${lang}`, async ({ page }) => {
    const docs = await mockApi(page, lang);
    const doc = docs[0];
    doc.analysis.amount_due = '250,00 EUR';
    doc.analysis.action_items.forEach(action => action.done = true);
    await page.addInitScript(value => localStorage.setItem('appella.language', value), lang);
    await page.clock.setFixedTime(new Date('2026-10-13T10:00:00Z'));
    await page.goto('/');
    const card = page.locator('.letter-card').filter({ hasText: doc.document_type });
    await expect(card).toContainText(lang === 'de' ? 'Erledigt' : 'Completed');
    await expect(card).not.toContainText('250,00 EUR');
    await expect(card).not.toContainText('23');
    await expect(card.locator('.text-error')).toHaveCount(0);
    await card.click();
    await expect(page.getByText('250,00 EUR', { exact: true })).toBeVisible();
    const check = page.getByRole('checkbox').first();
    await check.click();
    await expect(check).not.toBeChecked();
    await navigateInApp(page, '/');
    await expect(card).toContainText('250,00 EUR');
    await expect(card).toContainText(lang === 'de' ? 'Noch 23 Tage' : '23 days left');
    await navigateInApp(page, '/archive');
    await page.getByRole('button', { name: lang === 'de' ? /^Erledigt/ : /^Completed/ }).click();
    await expect(page.locator('.letter-card')).toHaveCount(0);
    await navigateInApp(page, `/letters/${doc.id}`);
    await check.click();
    await expect(check).toBeChecked();
    await page.getByRole('button', { name: lang === 'de' ? 'Rückgängig' : 'Undo', exact: true }).click();
    await expect(check).not.toBeChecked();
    await navigateInApp(page, '/');
    await expect(card).toContainText('250,00 EUR');
    expect(doc.analysis.amount_due).toBe('250,00 EUR');
  });
}

for (const lang of ['de', 'en'] as const) {
  test(`completed payments become neutral while separate open deadlines remain visible in ${lang}`, async ({ page }, testInfo) => {
    const docs = await mockApi(page, lang);
    const doc = docs[0];
    doc.analysis.amount_due = '250,00 EUR';
    doc.analysis.action_items.slice(1).forEach(action => action.done = true);
    await page.addInitScript(value => localStorage.setItem('appella.language', value), lang);
    await page.clock.setFixedTime(new Date('2026-10-13T10:00:00Z'));
    await page.goto(`/letters/${doc.id}`);
    const amount = page.getByText('250,00 EUR', { exact: true });
    await expect(amount).toHaveClass(/text-error/);
    await page.getByRole('checkbox').first().click();
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    await expect(amount).toHaveClass(/text-primary/);
    await expect(amount).not.toHaveClass(/text-error|text-headline-xl-mobile/);
    await expect(page.getByText(lang === 'de' ? 'Zahlung als erledigt markiert' : 'Payment marked complete', { exact: true })).toBeVisible();
    await expect(page.getByText(lang === 'de' ? 'Ursprüngliche Frist' : 'Original deadline', { exact: true })).toBeVisible();
    await expect(page.getByText(lang === 'de' ? 'Noch 23 Tage' : '23 days left', { exact: true })).not.toBeVisible();
    await expect(page.getByText(lang === 'de' ? 'Dringend' : 'Urgent', { exact: true })).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`payment-completed-${lang}.png`) });
    await page.getByRole('button', { name: lang === 'de' ? 'Rückgängig' : 'Undo', exact: true }).click();
    await expect(amount).toHaveClass(/text-error/);
    // A call/reply due on the same date is still open: completing payment must not hide its deadline.
    doc.analysis.action_items[0].done = true;
    doc.analysis.action_items[2].done = false;
    await page.reload();
    await expect(amount).toHaveClass(/text-primary/);
    await expect(page.getByText(lang === 'de' ? 'Noch 23 Tage' : '23 days left', { exact: true })).toBeVisible();
    await expect(page.getByText(lang === 'de' ? 'Zahlung als erledigt markiert' : 'Payment marked complete', { exact: true })).toBeVisible();
    expect(doc.analysis.amount_due).toBe('250,00 EUR');
  });
}

test('double-clicking cannot zoom the page or graph, but explicit graph zoom still works', async ({ page }) => {
  await page.goto('/graph?demo=1');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await expect(page.locator('html')).toHaveCSS('touch-action', 'manipulation');
  await expect(page.locator('body')).toHaveCSS('touch-action', 'manipulation');
  await expect(page.locator('meta[name=viewport]')).not.toHaveAttribute('content', /user-scalable=no|maximum-scale=1/);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const canvas = page.locator('canvas').first();
  const fingerprint = () => canvas.evaluate(async element => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((element as HTMLCanvasElement).toDataURL()));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
  const before = await fingerprint();
  const scale = await page.evaluate(() => visualViewport?.scale ?? 1);
  await canvas.dblclick({ position: { x: 8, y: 8 } });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await fingerprint()).toBe(before);
  expect(await page.evaluate(() => visualViewport?.scale ?? 1)).toBe(scale);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(fingerprint).not.toBe(before);
});
