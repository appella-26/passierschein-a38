import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm dev --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  reporter: 'list'
});
