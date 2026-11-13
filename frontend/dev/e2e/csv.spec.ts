import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { inventoryCsv, readRecords, recordsCsv } from '../../src/app/features/csv/csv';

test('CSV exports the current filtered view and can round-trip all accessible inventory', async ({
  page,
  mock,
}) => {
  await page.goto('/#/inventory');
  await page.getByRole('textbox', { name: 'Search inventory', exact: true }).fill('Cordless');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export current view as CSV', exact: true }).click();
  const exported = readRecords(await readFile((await (await download).path()) as string, 'utf8'));
  expect(exported.length).toBeGreaterThan(0);
  expect(exported.every(row => row.product_ref === 'DRILL-18V')).toBe(true);
  const bootstrap = await mock.bootstrap();
  await page.getByRole('link', { name: 'CSV import and export', exact: true }).click();
  await page.getByLabel('CSV file (UTF-8, up to 200 rows)', { exact: true }).setInputFiles({
    name: 'export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      inventoryCsv(Object.values(bootstrap.state.items), bootstrap.products, bootstrap.warehouses)
    ),
  });
  await expect(page.locator('tbody tr')).toHaveCount(Object.keys(bootstrap.state.items).length);
  await expect(
    page.getByRole('button', { name: 'Confirm CSV import', exact: true })
  ).toBeDisabled();
  await expect(page.locator('tbody tr').filter({ hasText: 'invalid' })).toHaveCount(0);
});

test('CSV creates items, registers a blank QR and updates metadata using the normal APIs', async ({
  page,
  mock,
}) => {
  const initial = await mock.bootstrap();
  const blank = Object.values(initial.state.items).find(item => item.type === 'unassigned')!;
  const generic = Object.values(initial.state.items).find(
    item => item.type === 'generic' && !item.checkout && item.status !== 'consumed'
  )!;
  const rows = [
    {
      type: 'tracked',
      label: 'CSV drill',
      product_ref: 'DRILL-18V',
      warehouse_ref: 'MAIN',
      location_values: JSON.stringify({ 1: 101, 2: '3' }),
    },
    {
      type: 'box',
      label: 'CSV bolts container',
      product_ref: 'BOLT-M8',
      warehouse_ref: 'MAIN',
      quantity: '5',
    },
    {
      type: 'generic',
      label: 'CSV registered cable',
      product_ref: 'CABLE-CAT6',
      warehouse_ref: 'MAIN',
      code: blank.code,
    },
    {
      type: generic.type,
      label: 'CSV edited metadata',
      code: generic.code,
      location_values: JSON.stringify({ 1: 102, 2: '7' }),
    },
  ];
  await page.goto('/#/csv');
  await page.getByLabel('CSV file (UTF-8, up to 200 rows)', { exact: true }).setInputFiles({
    name: 'create.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(recordsCsv(rows)),
  });
  const confirm = page.getByRole('button', { name: 'Confirm CSV import', exact: true });
  await expect(confirm).toBeEnabled();
  expect(
    Object.values((await mock.bootstrap()).state.items).some(item => item.label === 'CSV drill')
  ).toBe(false);
  await confirm.click();
  await expect(page.getByText('CSV import completed', { exact: true })).toBeVisible();
  const state = (await mock.bootstrap()).state;
  const drill = Object.values(state.items).find(item => item.label === 'CSV drill')!;
  expect(drill.serial).toMatch(/^SN-[A-F0-9]{24}$/);
  expect(drill.bin).toBe('A-3');
  expect(
    Object.values(state.items).find(item => item.label === 'CSV bolts container')
  ).toMatchObject({ qty: 5, native_batch: 'CSV bolts container' });
  expect(state.items[blank.code]).toMatchObject({ type: 'generic', label: 'CSV registered cable' });
  expect(state.items[generic.code]).toMatchObject({
    label: 'CSV edited metadata',
    qty: generic.qty,
    bin: 'B-7',
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download import results', exact: true }).click();
  const report = await readFile((await (await download).path()) as string, 'utf8');
  expect(readRecords(report).every(row => row.code && row.import_status === 'done')).toBe(true);
  await page
    .getByLabel('CSV file (UTF-8, up to 200 rows)', { exact: true })
    .setInputFiles({ name: 'results.csv', mimeType: 'text/csv', buffer: Buffer.from(report) });
  await expect(confirm).toBeDisabled();
  await expect(page.locator('tbody tr').filter({ hasText: 'invalid' })).toHaveCount(0);
});

test('CSV rejects duplicate IDs and stock changes before importing, and readers only export', async ({
  page,
  mock,
}) => {
  const bootstrap = await mock.bootstrap();
  const item = Object.values(bootstrap.state.items).find(
    item => item.type === 'tracked' && !item.checkout
  )!;
  await page.goto('/#/csv');
  const csv = recordsCsv([
    { code: item.code, type: item.type, quantity: '2' },
    { code: item.code, type: item.type },
  ]);
  await page
    .getByLabel('CSV file (UTF-8, up to 200 rows)', { exact: true })
    .setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('Duplicate QR identifier in this file', { exact: true })).toHaveCount(
    2
  );
  await expect(
    page.getByRole('button', { name: 'Confirm CSV import', exact: true })
  ).toBeDisabled();
  expect((await mock.bootstrap()).state.revision).toBe(bootstrap.state.revision);
  await page.getByLabel('CSV file (UTF-8, up to 200 rows)', { exact: true }).setInputFiles({
    name: 'stock-change.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(recordsCsv([{ code: item.code, type: item.type, quantity: '2' }])),
  });
  await expect(
    page.getByText('CSV updates cannot change stock quantities or serial/lot identities', {
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm CSV import', exact: true })
  ).toBeDisabled();
  await mock.reset('read-only');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Export all accessible inventory', exact: true })
  ).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});

test('CSV stops on a server error and keeps completed rows in the results', async ({
  page,
  mock,
}) => {
  const item = Object.values((await mock.bootstrap()).state.items).find(
    item => item.type === 'generic' && item.product_id === 1 && !item.checkout
  )!;
  await page.goto('/#/csv');
  await page.getByLabel('CSV file (UTF-8, up to 200 rows)', { exact: true }).setInputFiles({
    name: 'partial.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      recordsCsv([
        { type: 'generic', product_ref: 'BOLT-M8', warehouse_ref: 'MAIN', label: 'CSV success' },
        {
          code: item.code,
          type: 'generic',
          product_ref: 'BOLT-M8',
          warehouse_ref: 'MAIN',
          label: 'CSV fails',
        },
        {
          type: 'generic',
          product_ref: 'BOLT-M8',
          warehouse_ref: 'MAIN',
          label: 'CSV not attempted',
        },
      ])
    ),
  });
  const confirm = page.getByRole('button', { name: 'Confirm CSV import', exact: true });
  await expect(confirm).toBeEnabled();
  let calls = 0;
  await page.route('**/api.php?action=*', async route => {
    if (++calls === 2)
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'CSV simulated failure' }),
      });
    else await route.continue();
  });
  await confirm.click();
  await expect(page.getByText('CSV simulated failure', { exact: true })).toBeVisible();
  expect(calls).toBe(2);
  const labels = Object.values((await mock.bootstrap()).state.items).map(item => item.label);
  expect(labels).toContain('CSV success');
  expect(labels).not.toContain('CSV not attempted');
  await expect(confirm).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download import results', exact: true }).click();
  const results = readRecords(await readFile((await (await download).path()) as string, 'utf8'));
  expect(results[1]).toMatchObject({
    code: item.code,
    label: 'CSV fails',
    import_status: 'failed',
  });
  expect(results[2]).toMatchObject({ label: 'CSV not attempted', import_status: 'ready' });
});

test('CSV requires a fresh preview if inventory changes before confirmation', async ({
  page,
  mock,
  request,
}) => {
  await page.goto('/#/csv');
  await page.getByLabel('CSV file (UTF-8, up to 200 rows)', { exact: true }).setInputFiles({
    name: 'stale.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      recordsCsv([
        {
          type: 'generic',
          product_ref: 'BOLT-M8',
          warehouse_ref: 'MAIN',
          label: 'CSV fresh preview',
        },
      ])
    ),
  });
  const confirm = page.getByRole('button', { name: 'Confirm CSV import', exact: true });
  await expect(confirm).toBeEnabled();
  const bootstrap = await mock.bootstrap();
  expect(
    (
      await request.post('/custom/qrrouter/api.php?action=bulk', {
        form: {
          token: bootstrap.token,
          qrr_token: bootstrap.csrf,
          payload: JSON.stringify({ type: 'unassigned', count: 1 }),
        },
      })
    ).ok()
  ).toBe(true);
  await confirm.click();
  await expect(page.getByRole('alert')).toContainText('Inventory changed');
  expect(
    Object.values((await mock.bootstrap()).state.items).some(
      item => item.label === 'CSV fresh preview'
    )
  ).toBe(false);
  await page.getByRole('button', { name: 'Refresh preview', exact: true }).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText('CSV import completed', { exact: true })).toBeVisible();
});
