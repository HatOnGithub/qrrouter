import { expect, test, type Page } from '@playwright/test';
import type { Bootstrap } from '../../src/app/core/models/inventory';

const browserWarnings = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, request }) => {
  const warnings: string[] = [];
  browserWarnings.set(page, warnings);
  page.on('console', message => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const response = await request.post('/__mock/reset', { data: {} });
  expect(response.ok()).toBeTruthy();
});

test.afterEach(async ({ page }) => {
  expect(browserWarnings.get(page)).toEqual([]);
});

test('the current Angular app runs in the local Dolibarr shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/inventory');
  await expect(page.getByText('LOCAL MOCK', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  const navigationIcon = page.locator('.module-navigation fa-icon svg').first();
  await expect(navigationIcon).toBeVisible();
  await expect(navigationIcon).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByText('Workshop drill', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Scan QR', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Warehouse operations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Register items', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('edits persist across refresh and real QR label previews open', async ({ page }) => {
  await page.goto('/#/labels');
  await page.getByRole('spinbutton', { name: /Number of QR codes/ }).fill('3');
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Print', exact: true }).first().click();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading', { name: 'QR label batch' })).toBeVisible();
  await expect(popup.locator('svg')).toHaveCount(3);
  await popup.close();
});

test('the 3.4 serial check and warehouse move work through the dev proxy', async ({
  page,
  request,
}) => {
  const bootstrap: Bootstrap = await (
    await request.get('/custom/qrrouter/api.php?resource=bootstrap')
  ).json();
  const drill = Object.values(bootstrap.state.items).find(item => item.type === 'tracked')!;
  await page.goto('/#/workflow/move?code=' + drill.code);
  await page.getByRole('combobox', { name: 'Destination warehouse', exact: true }).click();
  await page.getByRole('option', { name: 'OTHER', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm operation', exact: true }).click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  const updated = await (await request.get('/custom/qrrouter/api.php?resource=bootstrap')).json();
  expect(updated.state.items[drill.code].warehouse_id).toBe(2);
  const check = await (
    await request.get(
      '/custom/qrrouter/api.php?resource=serial-check&product_id=2&serial=DRILL-001'
    )
  ).json();
  expect(check).toEqual({ exists: true, associated: true });
});

test('scenario controls exercise empty, unavailable and translated dark states', async ({
  page,
}) => {
  await page.goto('/#/inventory');
  await page.getByLabel('Mock scenario').selectOption('empty');
  await page.getByRole('button', { name: 'Reset and apply' }).click();
  await expect(page.getByText('No matching items', { exact: true })).toBeVisible();
  await page.getByLabel('Mock scenario').selectOption('unavailable');
  await page.getByRole('button', { name: 'Reset and apply' }).click();
  await expect(page.getByRole('alert')).toContainText('Mock Dolibarr service unavailable');
  await page.getByLabel('Mock scenario').selectOption('populated');
  await page.getByLabel('Mock theme').selectOption('dark');
  await page.getByLabel('Mock language').selectOption('nl_NL');
  await page.getByRole('button', { name: 'Reset and apply' }).click();
  await expect(page.getByRole('heading', { name: 'Voorraad', exact: true })).toBeVisible();
  await expect(page.locator('qrr-root')).toHaveCSS('color', 'rgb(238, 238, 238)');
});

test('registration uses the current selection/details flow and existing serial warning', async ({
  page,
  request,
}) => {
  const bootstrap: Bootstrap = await (
    await request.get('/custom/qrrouter/api.php?resource=bootstrap')
  ).json();
  const blank = Object.values(bootstrap.state.items).find(item => item.type === 'unassigned')!;
  await page.goto(`/#/register?code=${blank.code}&mode=unique&input=manual`);
  await page.getByRole('button', { name: 'Assign details', exact: true }).click();
  await expect(page).toHaveURL(/register\/details/);
  await page
    .getByRole('textbox', { name: 'Item name / label', exact: true })
    .fill('Registered mock drill');
  await page.getByRole('combobox', { name: 'Dolibarr product', exact: true }).fill('DRILL');
  await page.getByRole('option', { name: 'DRILL-18V — Cordless drill', exact: true }).click();
  await page.getByRole('combobox', { name: 'Warehouse', exact: true }).click();
  await page.getByRole('option', { name: 'MAIN', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Dolibarr serial number', exact: true })
    .fill('EXISTING-DRILL-01');
  await expect(
    page.getByText(
      'This serial number already exists in Dolibarr and can be assigned without adding stock.',
      { exact: true }
    )
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Registered mock drill', exact: true })
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp('/items/' + blank.code));
});
