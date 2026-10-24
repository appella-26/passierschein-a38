import { test, expect, type Page } from '@playwright/test';
import { getMockDocuments, mockDocuments, mockRows, mockGraph } from '../src/lib/mock/data.ts';

const sample = mockDocuments[0];
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

/** setInputFiles before hydration fires a change event no handler hears, so retry until the page lists it. */
async function addPage(page: Page, listed: string, name = 'sample.png') {
  await expect(async () => {
    await page.locator('input[type=file][multiple]').setInputFiles({ name, mimeType: 'image/png', buffer: tinyPng });
    await expect(page.getByText(listed, { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass();
}

async function mockApi(page: Page, lang: 'de' | 'en' = 'de') {
  await page.route('**/api/documents*', route => route.fulfill({ json: mockRows(new URL(route.request().url()).searchParams.get('q') ?? '', lang) }));
  await page.route('**/api/documents/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const doc = getMockDocuments(lang).find(item => item.id === id);
    return route.fulfill({ status: doc ? 200 : 404, json: doc ?? {} });
  });
  await page.route('**/api/documents/*/pages/*', route => route.fulfill({ contentType: 'image/png', body: tinyPng }));
  await page.route('**/api/graph', route => route.fulfill({ json: mockGraph(lang) }));
}

const workflowCopy = {
  en: {
    pages: 'Your pages (1)', analyzeOne: 'Explain this page', analyzing: 'Reading your letter…', analysisError: 'We couldn’t finish reading this letter.',
    cancelAnalysis: 'Back to your pages', capture: 'Add a letter', completeAction: 'Mark as complete:', copyReference: 'Copy Steuernummer', copied: 'Copied. One less thing to type.',
    waitForMe: 'Hold the line for me', startCall: 'Start the call', phone: 'Phone number', dialing: 'Dialling…', ivr: 'Working through the phone menu',
    waitingTime: 'Time on hold', humanTitle: 'You’re up.', connected: 'You’re connected', voicemail: 'Voicemail reached', cancelCall: 'End call', ended: 'Call ended', failed: 'Call failed',
    taxOffice: /^Tax office/, all: /^All letters/, noResults: 'Nothing turned up.', resetFilters: 'Clear search & filters', zoomIn: 'Zoom in', connections: '2 linked letters',
    previewAnalysis: 'See how it works', demoCallState: 'Try a call status', notConfigured: 'The on-hold assistant isn’t set up yet.',
    hotlineTitle: 'Demo hotline', hotlineLink: 'Demo hotline link', hotlineRinging: 'Incoming call', answerCall: 'Answer call', hotlineUnavailable: /isn’t available any more/,
    other: { button: 'Deutsch', todos: 'Ihre To-Dos', original: 'Original-Scan ansehen', page2: 'Seite 2', originalPage2: 'Original-Scan · Seite 2' }
  },
  de: {
    pages: 'Erfasste Seiten (1)', analyzeOne: '1 Seite jetzt analysieren', analyzing: 'Analyse läuft', analysisError: 'Die Analyse ist fehlgeschlagen.',
    cancelAnalysis: 'Zur Erfassung zurück', capture: 'Brief erfassen', completeAction: 'Als erledigt markieren:', copyReference: 'Steuernummer kopieren', copied: 'In die Zwischenablage kopiert',
    waitForMe: 'In der Warteschleife warten', startCall: 'Anruf starten & Warteschleife übergeben', phone: 'Rufnummer', dialing: 'Nummer wird gewählt', ivr: 'Telefonmenü wird durchlaufen',
    waitingTime: 'Zeit in der Warteschleife', humanTitle: 'Jemand ist für Sie da.', connected: 'Sie sind verbunden', voicemail: 'Anrufbeantworter erreicht', cancelCall: 'Anruf beenden', ended: 'Anruf beendet', failed: 'Anruf fehlgeschlagen',
    taxOffice: /^Finanzamt/, all: /^Alle/, noResults: 'Keine Briefe gefunden', resetFilters: 'Filter zurücksetzen', zoomIn: 'Vergrößern', connections: '2 verknüpfte Briefe',
    previewAnalysis: 'Analyse-Vorschau', demoCallState: 'Demo-Anrufstatus', notConfigured: 'Der Telefon-Assistent ist noch nicht eingerichtet.',
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

test('language and checklist persist, clipboard and original scans work', async ({ page, context }) => {
  await mockApi(page, lang);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/letters/${sample.id}`);
  const check = page.getByRole('checkbox', { name: `${ui.completeAction} ${sample.analysis.action_items[0].title}` });
  await check.check();
  await page.getByRole('button', { name: ui.copyReference }).click();
  await expect(page.getByRole('status')).toHaveText(ui.copied);
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
  await expect(sheet.getByRole('alert')).toContainText(ui.notConfigured);
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
      await page.clock.setFixedTime(new Date('2026-10-24T10:00:00Z'));
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
        if (name === 'graph') await expect(page.getByRole('button', { name: lang === 'de' ? 'Vergrößern' : 'Zoom in' })).toBeEnabled();
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
