import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Bootstrap, Item } from '../../src/app/core/models/inventory';

type Scenario = 'populated' | 'empty' | 'no-employees' | 'read-only' | 'pending' | 'unavailable';

export class MockApplication {
  constructor(
    readonly page: Page,
    readonly request: APIRequestContext
  ) {}

  async reset(scenario: Scenario = 'populated'): Promise<void> {
    const response = await this.request.post('/__mock/reset', { data: { scenario } });
    expect(response.ok()).toBeTruthy();
  }

  async bootstrap(): Promise<Bootstrap> {
    const response = await this.request.get('/custom/qrrouter/api.php?resource=bootstrap');
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async item(label: string): Promise<Item> {
    const item = Object.values((await this.bootstrap()).state.items).find(
      item => item.label === label
    );
    expect(item, `Fixture item: ${label}`).toBeDefined();
    return item!;
  }

  async navigate(label: string): Promise<void> {
    const link = this.page
      .locator('.module-navigation')
      .getByRole('link', { name: label, exact: true });
    if (!(await link.isVisible()))
      await this.page.getByRole('button', { name: 'Menu', exact: true }).click();
    await link.click();
  }

  async operation(label: string): Promise<void> {
    await this.navigate('Scan QR');
    await this.page
      .getByRole('navigation', { name: 'Warehouse operations' })
      .getByRole('link', { name: new RegExp('^' + label) })
      .click();
  }

  async select(label: string, option: string): Promise<void> {
    const panel = this.page.locator('.cdk-overlay-pane [role="listbox"]');
    await expect(panel).toHaveCount(0);
    await this.page.getByRole('combobox', { name: label, exact: true }).click();
    await panel.getByRole('option', { name: option, exact: true }).click();
    await expect(panel).toHaveCount(0);
  }

  async lookup(label: string, query: string, option: RegExp): Promise<void> {
    await this.page.getByRole('combobox', { name: label, exact: true }).fill(query);
    await this.page.getByRole('option', { name: option }).click();
  }

  async scan(...codes: string[]): Promise<void> {
    await expect(this.page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
    for (const code of codes) {
      await this.page.getByRole('button', { name: 'Camera mock', exact: true }).click();
      await this.page.getByLabel('Fixture QR code', { exact: true }).selectOption(code);
      await this.page.getByRole('button', { name: 'Show QR code', exact: true }).click();
      // The app is inert under the mobile controls; observe the real decoder's output in the DOM.
      await expect(this.page.locator('.codes button').filter({ hasText: code })).toHaveCount(1);
      await this.page.getByRole('button', { name: 'Clear frame', exact: true }).click();
      await this.page.getByRole('button', { name: 'Close camera controls', exact: true }).click();
      await expect(
        this.page.getByRole('button', { name: 'Remove ' + code, exact: true })
      ).toBeVisible();
    }
  }

  async review(): Promise<void> {
    await this.page.getByRole('button', { name: 'Review selected items', exact: true }).click();
    await expect(
      this.page.getByRole('heading', { name: 'Review and confirm', exact: true })
    ).toBeVisible();
    await this.expectCameraReleased();
  }

  async confirm(): Promise<void> {
    await this.page.getByRole('button', { name: 'Confirm operation', exact: true }).click();
    await expect(
      this.page.getByRole('heading', { name: 'Operation results', exact: true })
    ).toBeVisible();
    await expect(this.page.getByText('Completed', { exact: true })).toBeVisible();
  }

  async expectCameraReleased(): Promise<void> {
    await expect(this.page.locator('#mock-camera-status')).toContainText(
      '0 active virtual camera streams.'
    );
  }
}

export const test = base.extend<{ mock: MockApplication }>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, info) => {
    await use({
      ...extraHTTPHeaders,
      'x-qrr-mock-session': `${info.workerIndex}-${info.testId}-${info.retry}-${info.repeatEachIndex}`,
    });
  },
  mock: [
    async ({ page, request, context }, use, info) => {
      if (info.tags.includes('@virtual-camera')) {
        const supported = await page.evaluate(
          () => typeof document.createElement('canvas').captureStream === 'function'
        );
        info.skip(!supported, 'This browser build does not support canvas.captureStream.');
      }
      const warnings: string[] = [];
      const errors: string[] = [];
      const watch = (page: Page) => {
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => {
          if (response.request().resourceType() === 'script' && response.status() >= 400)
            errors.push(`Script load failed: ${response.status()} ${response.url()}`);
        });
        page.on('console', message => {
          // Firefox can warn about Playwright's injected popup layout inspection.
          const automationLayoutWarning =
            message.text().includes('Layout was forced before the page was fully loaded.') &&
            message.text().includes('file: "debugger eval code"');
          if (message.type() === 'warning' && !automationLayoutWarning)
            warnings.push(message.text());
          if (message.type() === 'error' && message.text().startsWith('ERROR '))
            errors.push(message.text());
        });
      };
      watch(page);
      context.on('page', watch);
      const mock = new MockApplication(page, request);
      await mock.reset();
      await use(mock);
      if (info.status !== info.expectedStatus) {
        await info.attach('browser-errors', {
          body: JSON.stringify(errors, null, 2),
          contentType: 'application/json',
        });
        const response = await request.get('/custom/qrrouter/api.php?resource=bootstrap');
        await info.attach('mock-state', {
          body: await response.body(),
          contentType: 'application/json',
        });
      }
      expect(errors, 'Uncaught browser errors').toEqual([]);
      expect(warnings, 'Browser warnings').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
