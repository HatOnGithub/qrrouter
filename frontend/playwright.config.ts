import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env['QRR_E2E_URL'],
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  reporter: 'list',
  outputDir: 'test-results',
  timeout: 20000,
});
