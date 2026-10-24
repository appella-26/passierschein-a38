import { test, expect } from '@playwright/test';

const savedCall = {
  id: 'expired-call', senderName: 'Saved test sender', toNumber: '+4930123456',
  purpose: 'Synthetic test', reference: '', letterId: 'test-letter'
};

test('missing calls return an unavailable event instead of a failed EventSource connection', async ({ request }) => {
  const response = await request.get('/api/calls/expired-call/events');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/event-stream');
  expect(await response.text()).toBe('data: {"type":"unavailable"}\n\n');
});

test('homepage refresh forgets a stale saved call and does not reconnect on later refreshes', async ({ page }) => {
  await page.route('**/api/documents*', route => route.fulfill({ json: [] }));
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/calls/expired-call/events') requests.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByText('Nothing here—yet.', { exact: true })).toBeVisible();
  await page.evaluate(context => sessionStorage.setItem('appella.call', JSON.stringify(context)), savedCall);
  await page.reload();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('appella.call'))).toBeNull();
  await expect(page.getByText('Call in progress', { exact: true })).not.toBeVisible();
  expect(requests).toHaveLength(1);
  await page.reload();
  await expect(page.getByText('Nothing here—yet.', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('temporary stream failures keep the saved call, but unavailable clears it and closes monitoring', async ({ page }) => {
  await page.route('**/api/documents*', route => route.fulfill({ json: [] }));
  await page.addInitScript(context => {
    sessionStorage.setItem('appella.call', JSON.stringify(context));
    class FakeEventSource {
      static CLOSED = 2;
      readyState = 1;
      onmessage?: (event: { data: string }) => void;
      onopen?: () => void;
      onerror?: () => void;
      constructor() {
        Object.assign(window, {
          interruptCall: () => { this.readyState = 0; this.onerror?.(); },
          expireCall: () => this.onmessage?.({ data: '{"type":"unavailable"}' }),
          streamClosed: () => this.readyState === FakeEventSource.CLOSED
        });
        setTimeout(() => {
          this.onopen?.();
          this.onmessage?.({ data: JSON.stringify({ state: 'on_hold', at: new Date().toISOString() }) });
        }, 20);
      }
      close() { this.readyState = FakeEventSource.CLOSED; }
    }
    Object.defineProperty(window, 'EventSource', { value: FakeEventSource });
  }, savedCall);
  await page.goto('/');
  await expect(page.getByText('On hold', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { interruptCall: () => void }).interruptCall());
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('appella.call')!).id)).toBe(savedCall.id);
  await expect(page.getByRole('heading', { name: savedCall.senderName, exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { expireCall: () => void }).expireCall());
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('appella.call'))).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { streamClosed: () => boolean }).streamClosed())).toBe(true);
  await expect(page.getByText('Call in progress', { exact: true })).not.toBeVisible();
});
