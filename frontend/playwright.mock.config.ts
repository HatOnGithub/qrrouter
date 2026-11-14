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
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: {
          // Fresh test contexts can classify localhost as a bounce tracker before
          // the first automated click on slow runners. This is a first-party mock.
          firefoxUserPrefs: { 'privacy.bounceTrackingProtection.mode': 0 },
        },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    // Component HMR adds asynchronous imports that can be cancelled by navigation/reload.
    // E2E runs need stable application modules; interactive development keeps HMR enabled.
    command: 'node dev/start-mock.mjs --port 4300 --no-hmr --no-live-reload',
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
