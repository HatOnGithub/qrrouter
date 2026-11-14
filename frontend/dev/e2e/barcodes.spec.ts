import { test, expect } from './fixtures';

for (const symbology of ['QRCODE', 'DATAMATRIX', 'C128', 'PDF417']) {
  test(`camera reads ${symbology} without changing its six-character identifier @virtual-camera`, async ({
    page,
    mock,
  }) => {
    test.setTimeout(30000);
    const item = await mock.item('Network cable');
    expect(item.code).toHaveLength(6);
    await page.goto('/#/workflow/move');
    await expect(page.getByText('Camera running', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Camera mock', exact: true }).click();
    await page.getByLabel('Fixture QR code', { exact: true }).selectOption(item.code);
    await page.getByLabel('Barcode format', { exact: true }).selectOption(symbology);
    await page.getByRole('button', { name: 'Show QR code', exact: true }).click();
    await expect(page.locator('#mock-camera-status')).toContainText('Showing QR code');
    await expect(page.locator('.codes button').filter({ hasText: item.code })).toHaveCount(1);
    await page.getByRole('button', { name: 'Close camera controls', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Remove ' + item.code, exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
    await mock.expectCameraReleased();
    expect((await mock.bootstrap()).state.items[item.code].code).toBe(item.code);
  });
}

test('batch print links preserve the selected barcode format and existing IDs', async ({
  page,
  mock,
}) => {
  const before = (await mock.bootstrap()).state;
  await page.goto('/#/labels');
  await mock.select('Barcode format', 'Data Matrix');
  const link = page.getByRole('link', { name: 'Print', exact: true }).first();
  await expect(link).toHaveAttribute('href', /symbology=DATAMATRIX/);
  await page.goto((await link.getAttribute('href'))!);
  await expect(page.getByRole('combobox', { name: 'Barcode format' })).toHaveValue('DATAMATRIX');
  expect((await mock.bootstrap()).state).toEqual(before);
});
