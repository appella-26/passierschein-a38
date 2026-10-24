import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 4,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    // Wire the phone assistant to the fake ElevenLabs/Twilio API in tests/agent-api.spec.ts,
    // so no test can ever place a real call. These override anything in .env.
    env: {
      // Keep mock phone credentials out of the generated config watched by a normal dev server.
      APPELLA_TEST_OUT_DIR: '.svelte-kit/playwright',
      ELEVENLABS_API_URL: 'http://127.0.0.1:5199',
      ELEVENLABS_API_KEY: 'test-key',
      ELEVENLABS_AGENT_ID: 'agent_test',
      ELEVENLABS_PHONE_NUMBER_ID: 'phnum_test',
      TWILIO_API_URL: 'http://127.0.0.1:5199',
      TWILIO_ACCOUNT_SID: 'AC_test',
      TWILIO_AUTH_TOKEN: 'test-token',
      WEBHOOK_SECRET: 'test-secret',
      AGENT_LANGUAGE: 'de',
      USER_DISPLAY_NAME: 'Kevin',
      DEMO_TARGET_NUMBER: '',
      CALL_POLL_MS: '250'
    }
  },
  reporter: 'list'
});
