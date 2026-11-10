import { defineConfig } from '@playwright/test';
import process from 'node:process';

export default defineConfig({
  testDir: './dev/e2e',
  workers: process.env['CI'] ? 2 : 4,
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4300',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: { args: ['--autoplay-policy=user-gesture-required'] },
      },
    },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'node dev/start-mock.mjs --port 4300',
    url: 'http://127.0.0.1:4300',
    env: { QRR_MOCK_PORT: '0' },
    reuseExistingServer: false,
    timeout: 60000,
  },
  outputDir: 'test-results/mock',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/mock', open: 'never' }],
    ['junit', { outputFile: 'test-results/mock/results.xml' }],
  ],
  timeout: process.env['CI'] ? 60000 : 20000,
});
