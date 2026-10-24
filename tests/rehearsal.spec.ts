// Browser rehearsal page (/rehearsal). The ElevenLabs SDK is replaced with a fake module, so no
// microphone, WebRTC session or ElevenLabs request is involved: the test plays the agent's
// report_browser_status calls and transcript messages itself.
import { test, expect, type Page } from '@playwright/test';

const FAKE_SDK = `
export const Conversation = {
  async startSession(options) {
    window.__rehearsal = { options, ended: false };
    options.onModeChange?.({ mode: 'listening' });
    return { endSession: async () => { window.__rehearsal.ended = true; } };
  }
};
`;

async function fakeRehearsal(page: Page, ready = true) {
	const posts: string[] = [];
	await page.route(/\/@elevenlabs_client\.js/, (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }));
	await page.route('**/api/rehearsal', (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ json: { ready, missing: ready ? [] : ['ELEVENLABS_BROWSER_AGENT_ID'] } });
		posts.push(route.request().method());
		return ready
			? route.fulfill({ json: { conversationToken: 'token_test' } })
			: route.fulfill({ status: 503, json: { message: 'not set up', code: 'configuration' } });
	});
	return posts;
}

const tool = (page: Page, params: unknown) =>
	page.evaluate((args) => (window as any).__rehearsal.options.clientTools.report_browser_status(args), params); // eslint-disable-line @typescript-eslint/no-explicit-any
const say = (page: Page, role: 'agent' | 'user', message: string) =>
	page.evaluate(({ role, message }) => (window as any).__rehearsal.options.onMessage({ role, message, source: role === 'agent' ? 'ai' : 'user', event_id: 1 }), { role, message }); // eslint-disable-line @typescript-eslint/no-explicit-any

test('menu, hold and a human answering lead to "Take over here", which ends the AI session', async ({ page }) => {
	const posts = await fakeRehearsal(page);
	await page.goto('/rehearsal');
	await expect(page.getByText('Rehearsal only: no number is dialled')).toBeVisible();
	await expect(page.getByText('Willkommen beim Finanzamt. Für Fragen zu Ihrem Bescheid wählen Sie die Eins.')).toBeVisible();
	await expect(page.locator('nav.app-bottom-nav')).toHaveCount(0);

	await page.getByRole('button', { name: 'Start rehearsal' }).click();
	await expect(page.getByRole('heading', { name: 'The assistant is listening' })).toBeVisible();
	expect(posts).toEqual(['POST']);
	const token = await page.evaluate(() => (window as any).__rehearsal.options.conversationToken); // eslint-disable-line @typescript-eslint/no-explicit-any
	expect(token).toBe('token_test');

	const progress = page.getByRole('list', { name: 'Progress' });
	await expect(progress.locator('[data-reached="true"]')).toHaveCount(0);

	expect(await tool(page, { state: 'ivr', note: 'Menü: für Bescheide die Eins' })).toBe('ok');
	await say(page, 'user', 'Willkommen beim Finanzamt.');
	await say(page, 'agent', 'Die Eins, bitte.');
	await expect(progress.locator('[data-state="ivr"]')).toHaveAttribute('data-reached', 'true');
	await expect(progress.getByText('Menü: für Bescheide die Eins')).toBeVisible();
	await expect(page.getByText('Die Eins, bitte.')).toBeVisible();

	// Unknown phases and repeats are ignored; each phase shows once.
	await tool(page, { state: 'transferred' });
	await tool(page, { state: 'ivr', note: 'again' });
	await tool(page, { state: 'on_hold' });
	await expect(progress.locator('li')).toHaveCount(3);
	await expect(progress.getByText('again')).toHaveCount(0);
	await expect(progress.locator('[data-state="on_hold"]')).toHaveAttribute('data-reached', 'true');

	const takeOver = page.getByRole('button', { name: 'Take over here' });
	await expect(takeOver).toBeVisible();
	await tool(page, { state: 'human_detected', note: 'Herr Müller, Finanzamt' });
	await expect(page.getByRole('heading', { name: 'Someone answered. Take over the conversation now.' })).toBeVisible();

	await takeOver.click();
	await expect(page.getByRole('heading', { name: 'Your turn' })).toBeVisible();
	await expect(page.getByText('Talk to the person in the room directly.')).toBeVisible();
	expect(await page.evaluate(() => (window as any).__rehearsal.ended)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test('voicemail ends the rehearsal without a hand-over', async ({ page }) => {
	await fakeRehearsal(page);
	await page.goto('/rehearsal');
	await page.getByRole('button', { name: 'Start rehearsal' }).click();
	await expect(page.getByRole('button', { name: 'Take over here' })).toBeVisible();
	await tool(page, { state: 'voicemail', note: 'Außerhalb der Sprechzeiten' });
	await page.evaluate(() => (window as any).__rehearsal.options.onDisconnect({ reason: 'agent' })); // eslint-disable-line @typescript-eslint/no-explicit-any
	await expect(page.getByRole('heading', { name: 'Rehearsal ended' })).toBeVisible();
	await expect(page.getByText('Reached voicemail. The assistant hung up without leaving a message.')).toBeVisible();
	await expect(page.getByRole('list', { name: 'Progress' }).locator('[data-state="voicemail"]')).toHaveAttribute('data-reached', 'true');
	await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible();
});

test('an unconfigured rehearsal says which settings are missing and never starts', async ({ page }) => {
	const posts = await fakeRehearsal(page, false);
	await page.goto('/rehearsal');
	await expect(page.getByRole('alert')).toContainText('ELEVENLABS_BROWSER_AGENT_ID');
	await expect(page.getByRole('button', { name: 'Start rehearsal' })).toHaveCount(0);
	expect(posts).toEqual([]);
});
