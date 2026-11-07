import { test, expect, Page } from '@playwright/test';
import { validCode } from '../src/app/shared/scanner/codes';

async function open(page: Page, route: string): Promise<void> {
  await page.goto('index.php#/' + route);
  await expect(page.locator('qrr-root nav')).toBeVisible();
}
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function blank(page: Page): Promise<string> {
  const bootstrap = await (await page.request.get('api.php?resource=bootstrap')).json();
  const response = await page.request.post('api.php?action=bulk', {
    form: {
      token: bootstrap.token,
      qrr_token: bootstrap.csrf,
      payload: JSON.stringify({ type: 'unassigned', count: 1 }),
    },
  });
  expect(response.ok()).toBeTruthy();
  const id = (await response.json()).result;
  const updated = await (await page.request.get('api.php?resource=bootstrap')).json();
  return updated.state.batches[id].codes[0];
}

test('inventory and item deep links render the Angular app', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page, 'inventory');
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search inventory' }).fill('does-not-exist');
  await expect(page.getByText('No matching items')).toBeVisible();
  await page.goto('index.php#/items/' + process.env['QRR_E2E_ITEM']);
  await expect(page.getByRole('heading', { name: 'Fixture tracked', exact: true })).toBeVisible();
  expect(page.url()).toContain('#/items/');
  expect(errors).toEqual([]);
});

test('label creation persists a batch and exposes a print link', async ({ page }) => {
  await open(page, 'labels');
  const input = page.getByRole('spinbutton', { name: 'Number of QR codes (1–200)' });
  await input.fill('3');
  const before = await page.locator('tbody tr').count();
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(before + 1);
  await expect(page.getByRole('link', { name: 'Print', exact: true }).first()).toHaveAttribute(
    'href',
    /batch_print.php\?batch=/
  );
});

test('manual scanner rejects invalid input, deduplicates and handles camera denial', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error('Camera denied for test')) },
    })
  );
  await open(page, 'scan');
  await page.getByRole('textbox', { name: 'QR identifiers' }).fill('bad-code');
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid identifier');
  const code = process.env['QRR_E2E_ITEM']!;
  expect(validCode(code)).toBeTruthy();
  await page.getByRole('textbox', { name: 'QR identifiers' }).fill(code + '\n' + code);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove ' + code, exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Camera denied for test');
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeEnabled();
});

test('register a container using the product lookup and native warehouse selection', async ({
  page,
}) => {
  const code = await blank(page);
  await open(page, 'register?code=' + code + '&mode=box');
  await page
    .getByRole('textbox', { name: 'Item name / label', exact: true })
    .fill('Browser container');
  await page.getByRole('textbox', { name: 'Dolibarr product', exact: true }).fill('Fixture');
  await page.getByRole('button', { name: 'PART-003 — Fixture Part', exact: true }).click();
  await choose(page, 'Warehouse', 'MAIN');
  await page
    .getByRole('spinbutton', { name: 'Container quantity (blank = unknown)', exact: true })
    .fill('7');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser container', exact: true })).toBeVisible();
  const state = (await (await page.request.get('api.php?resource=bootstrap')).json()).state;
  expect(state.items[code].qty).toBe(7);
  expect(state.items[code].type).toBe('box');
});

test('move workflow confirms native transfer and refreshes authoritative state', async ({
  page,
}) => {
  const code = process.env['QRR_E2E_BOX']!;
  await open(page, 'workflow/move?code=' + code);
  await expect(page.getByRole('button', { name: 'Confirm operation', exact: true })).toBeVisible();
  await choose(page, 'Destination warehouse', 'OTHER');
  await page.getByRole('button', { name: 'Confirm operation', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  const state = (await (await page.request.get('api.php?resource=bootstrap')).json()).state;
  expect(state.items[code].warehouse_id).toBe(2);
  expect(state.items[code].pending_operation).toBeUndefined();
});

test('picking preview uses native order lookup and server allocation', async ({ page }) => {
  await open(page, 'picking');
  await page.getByRole('textbox', { name: 'Customer order', exact: true }).fill('SO');
  await page.getByRole('button', { name: /SO-0039/ }).click();
  await choose(page, 'Warehouse', 'MAIN');
  await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Print / Save as PDF', exact: true })
  ).toBeEnabled();
});

test('responsive navigation inherits the host styling without DeltaNext branding', async ({
  page,
}) => {
  await open(page, 'inventory');
  await expect(page.locator('qrr-card article').first()).toHaveCSS('background-image', 'none');
  await expect(page.locator('qrr-card article').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await expect(page.locator('qrr-root')).toHaveCSS('font-family', 'Arial, sans-serif');
  await expect(page.getByText('DELTANEXT', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../artifacts/angular-inventory.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.locator('nav').getByRole('link', { name: 'Scan QR', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Scan QR', exact: true })).toBeVisible();
  await expect(page.locator('.module-navigation')).not.toBeVisible();
});

test('fresh install with no employees explains setup and blocks checkout confirmation', async ({
  page,
}) => {
  await page.route('**/api.php?resource=bootstrap', async route => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    bootstrap.users = {};
    await route.fulfill({ response, json: bootstrap });
  });
  await open(page, 'workflow/checkout?code=' + process.env['QRR_E2E_ITEM']);
  await expect(
    page.getByText(
      'No employees yet. Create active employee users in Dolibarr before checking out items.'
    )
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm operation', exact: true })).toBeDisabled();
});

test('camera streams stop when leaving the scanner route', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__stoppedTracks = 0;
    HTMLMediaElement.prototype.play = async () => {};
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const stream = new MediaStream();
          stream.getTracks = () =>
            [{ stop: () => (window as any).__stoppedTracks++ }] as unknown as MediaStreamTrack[];
          return stream;
        },
      },
    });
  });
  await open(page, 'scan');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
  await page.locator('nav').getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__stoppedTracks)).toBe(1);
});

test('a clean inventory renders without seeded items or batches', async ({ page }) => {
  await page.route('**/api.php?resource=bootstrap', async route => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    bootstrap.state.items = {};
    bootstrap.state.batches = {};
    bootstrap.users = {};
    await route.fulfill({ response, json: bootstrap });
  });
  await open(page, 'inventory');
  await expect(page.getByText('No matching items')).toBeVisible();
  await page.locator('nav').getByRole('link', { name: 'Print QR labels', exact: true }).click();
  await expect(page.getByText('No label batches yet')).toBeVisible();
});

test('controls and dropdowns follow a dark Dolibarr host without changing its theme', async ({
  page,
}) => {
  await page.route('**/index.php', async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      '</head>',
      '<style>body{background:rgb(32,33,36);color:rgb(238,238,238)}.flat{background:rgb(45,46,48);color:rgb(238,238,238)}.butAction{background:rgb(85,115,130);color:white}</style></head>'
    );
    await route.fulfill({ response, body: html });
  });
  await open(page, 'inventory');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(32, 33, 36)');
  await expect(page.locator('qrr-root')).toHaveCSS('color', 'rgb(238, 238, 238)');
  await expect(page.getByRole('textbox', { name: 'Search inventory' })).toHaveCSS(
    'color',
    'rgb(238, 238, 238)'
  );
  await page.getByRole('combobox', { name: 'Warehouse', exact: true }).click();
  await expect(page.locator('.mat-mdc-select-panel')).toHaveCSS(
    'background-color',
    'rgb(32, 33, 36)'
  );
});

test('translation entities render as text characters while decoded markup stays inert', async ({
  page,
}) => {
  await page.route('**/api.php?resource=bootstrap', async route => {
    const response = await route.fetch({ url: route.request().url() + '&testentities=1' });
    await route.fulfill({ response });
  });
  await open(page, 'inventory');

  const expected =
    'Tools & parts… — "quoted" \'single\' ' +
    '<img src="entity-regression" onerror="window.__entityExecuted=true">';
  await expect(page.getByRole('heading', { name: expected, exact: true })).toBeVisible();
  await expect(page.locator('qrr-root img[src="entity-regression"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__entityExecuted)).toBeUndefined();
});
