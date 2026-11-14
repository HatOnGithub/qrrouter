import { test, expect } from './fixtures';

test('independent action grants control QR details, direct workflows and printing', async ({
  page,
  mock,
}) => {
  const item = await mock.item('Workshop drill');
  const unused = Object.values((await mock.bootstrap()).state.items).find(
    item => item.type === 'unassigned'
  )!;
  let grants = new Set(['modify']);
  await page.route('**/api.php?resource=bootstrap', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const key of [
      'create',
      'modify',
      'delete',
      'move',
      'consume',
      'return',
      'adjust',
      'loans',
      'picking',
      'print',
      'recover',
      'manage',
      'history',
    ])
      data.permissions[key] = grants.has(key);
    data.permissions.admin = false;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/#/items/' + item.code);
  await expect(page.getByRole('link', { name: 'Edit metadata', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Move', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Consume', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Print label', exact: true })).toHaveCount(0);

  grants = new Set(['delete']);
  await page.goto('/#/items/' + unused.code);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Delete unassigned QR code', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Register item', exact: true })).toHaveCount(0);

  grants = new Set(['consume']);
  await page.goto('/#/scan');
  await page.reload();
  await expect(page.getByRole('link', { name: /Consume items/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Move items/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Register items', exact: true })).toHaveCount(0);
  await page.goto('/#/workflow/move?input=manual');
  await expect(
    page.getByText('Permission required for this QR action', { exact: true })
  ).toBeVisible();

  grants = new Set(['print']);
  await page.goto('/#/labels');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create batch', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Print', exact: true }).first()).toBeVisible();
});
