import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './dev/e2e',
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4300',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node dev/start-mock.mjs --port 4300',
    url: 'http://127.0.0.1:4300',
    env: { QRR_MOCK_PORT: '0' },
    reuseExistingServer: false,
    timeout: 60000,
  },
  outputDir: 'test-results/mock',
  reporter: 'list',
  timeout: 20000,
});
