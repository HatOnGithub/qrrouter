import { expect, test } from './fixtures';

test('print blank labels, register one through the virtual camera and preserve its draft and thumbnail', async ({
  page,
  request,
  mock,
}) => {
  await mock.reset('empty');
  await page.goto('/#/labels');
  await page.getByRole('spinbutton', { name: /Number of QR codes/ }).fill('2');
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  const created = await mock.bootstrap();
  const [code, unused] = Object.keys(created.state.items);
  expect(created.state.items[code].type).toBe('unassigned');
  await mock.operation('Register items');
  await mock.scan(code);
  await page.getByRole('button', { name: 'Assign details', exact: true }).click();
  await expect(page).toHaveURL(/register\/details/);
  await mock.expectCameraReleased();
  await page
    .getByRole('textbox', { name: 'Item name / label', exact: true })
    .fill('Camera-registered cable');
  await mock.lookup('Dolibarr product', 'CABLE', /CABLE-CAT6/);
  await mock.select('Warehouse', 'MAIN');
  await mock.select('Aisle', 'A');
  await page.getByRole('spinbutton', { name: 'Shelf', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Change selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove ' + code, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Assign details', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Item name / label', exact: true })).toHaveValue(
    'Camera-registered cable'
  );
  await expect(page.getByRole('combobox', { name: 'Warehouse', exact: true })).toContainText(
    'MAIN'
  );
  await expect(page.getByRole('spinbutton', { name: 'Shelf', exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Camera-registered cable', exact: true })
  ).toBeVisible();
  const saved = await mock.bootstrap();
  expect(saved.state.items[code]).toMatchObject({
    type: 'generic',
    product_id: 3,
    warehouse_id: 1,
    qty: 1,
    bin: 'A-3',
  });
  expect(saved.state.items[unused].type).toBe('unassigned');
  const thumbnail = await request.get('/custom/qrrouter/thumbnail.php?code=' + code);
  expect(thumbnail.ok()).toBeTruthy();
  expect(thumbnail.headers()['content-type']).toBe('image/jpeg');
  expect((await thumbnail.body()).length).toBeGreaterThan(100);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Camera-registered cable', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'CABLE-CAT6', exact: true })).toHaveAttribute(
    'href',
    /product\/card.php\?id=3$/
  );
});

for (const destination of [
  { type: 'salesorder', id: 39, ref: 'SO-0039', label: 'Network cable', units: 1, original: 1 },
  { type: 'production', id: 19, ref: 'MO-0019', label: 'Bolts box A', units: 3, original: 25 },
]) {
  test(`camera consumption against ${destination.type} saves its reference and can be returned`, async ({
    page,
    mock,
  }) => {
    const item = await mock.item(destination.label);
    await page.goto('/#/scan');
    await mock.operation('Consume items');
    await mock.scan(item.code);
    await mock.review();
    const reference = page.getByRole('combobox', { name: 'Transaction reference', exact: true });
    await expect(reference).toContainText('Customer order');
    await expect(
      page.getByRole('button', { name: 'Confirm operation', exact: true })
    ).toBeDisabled();
    await mock.lookup('Select an exact record', 'SO', /SO-0039/);
    if (destination.type === 'production') {
      await mock.select('Transaction reference', 'Manufacturing order');
      await expect(
        page.getByRole('combobox', { name: 'Select an exact record', exact: true })
      ).toHaveValue('');
      await expect(
        page.getByRole('button', { name: 'Confirm operation', exact: true })
      ).toBeDisabled();
      await mock.lookup('Select an exact record', 'MO', /MO-0019/);
    }
    await page
      .getByRole('spinbutton', { name: 'Quantity', exact: true })
      .fill(String(destination.units));
    await page.getByRole('textbox', { name: 'Reason / purpose', exact: true }).fill('Assembly job');
    await mock.confirm();
    const consumed = (await mock.bootstrap()).state.items[item.code];
    expect(consumed.qty).toBe(destination.original - destination.units);
    expect(consumed.consumed_units).toBe(destination.units);
    expect(consumed.consumption_log?.at(-1)).toMatchObject({
      kind: 'consume',
      quantity: destination.units,
      reason: 'Assembly job',
      reference_type: destination.type,
      reference_id: destination.id,
      stock_posted: true,
    });
    await mock.navigate('Inventory');
    if (destination.units === item.qty) await mock.select('Status', 'Consumed');
    const row = page.locator('tbody tr').filter({ hasText: destination.label });
    if (destination.type === 'salesorder') {
      await expect(row.locator('.inventory-status')).toContainText('Consumed');
      await expect(
        row.locator('.inventory-status').getByRole('link', { name: destination.ref })
      ).toBeVisible();
    }
    await row.getByRole('link', { name: destination.label, exact: true }).click();
    await expect(page.getByText('Latest consumption destination', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: destination.ref, exact: true })).toHaveCount(2);
    await page.getByRole('link', { name: 'Return', exact: true }).click();
    await mock.select('Destination warehouse', 'MAIN');
    await mock.select('Aisle', 'A');
    await page.getByRole('spinbutton', { name: 'Shelf', exact: true }).fill('4');
    await page
      .getByRole('spinbutton', { name: 'Quantity', exact: true })
      .fill(String(destination.units));
    await page
      .getByRole('textbox', { name: 'Reason / purpose', exact: true })
      .fill('Unused material returned');
    await mock.confirm();
    await page.reload();
    const returned = (await mock.bootstrap()).state.items[item.code];
    expect(returned).toMatchObject({
      qty: destination.original,
      consumed_units: 0,
      status: 'in_stock',
      warehouse_id: 1,
      bin: 'A-4',
    });
    expect(returned.consumption_log?.map(entry => entry.kind)).toEqual(['consume', 'return']);
    expect(returned.consumption_log?.at(-1)).toMatchObject({
      reason: 'Unused material returned',
      quantity: destination.units,
    });
  });
}

test('mobile camera checkout creates an employee warehouse and checkin restores the original stock', async ({
  page,
  mock,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const item = await mock.item('Network cable');
  await page.goto('/#/scan');
  await mock.operation('Check out items');
  await mock.scan(item.code);
  await mock.review();
  await mock.select('Employee', 'Taylor Technician');
  await page.getByRole('textbox', { name: 'Reason / purpose', exact: true }).fill('Site repair');
  await mock.confirm();
  const loaned = await mock.bootstrap();
  const personal = loaned.state.personal_warehouses['9'];
  expect(personal).not.toBe(loaned.state.personal_warehouses['8']);
  expect(loaned.state.items[item.code]).toMatchObject({
    warehouse_id: personal,
    qty: item.qty,
    checkout: { user_id: 9, origin_warehouse_id: item.warehouse_id, reason: 'Site repair' },
  });
  await mock.navigate('Loans');
  const row = page.locator('tbody tr').filter({ hasText: item.label });
  await expect(row.locator('.inventory-status')).toContainText('Taylor Technician');
  await row.getByRole('link', { name: item.label, exact: true }).click();
  await page.getByRole('link', { name: 'Check in', exact: true }).click();
  await mock.confirm();
  const returned = await mock.bootstrap();
  expect(returned.state.items[item.code].checkout).toBeUndefined();
  expect(returned.state.items[item.code].warehouse_id).toBe(item.warehouse_id);
  expect(returned.state.items[item.code].qty).toBe(item.qty);
  expect(returned.state.personal_warehouses['9']).toBe(personal);
  await mock.navigate('Loans');
  await expect(page.locator('tbody tr').filter({ hasText: item.label })).toHaveCount(0);
});

test('camera container transfer rejects excess quantity without changes, then conserves the total', async ({
  page,
  mock,
}) => {
  const source = await mock.item('Bolts box A');
  const destination = await mock.item('Bolts box B');
  await page.goto('/#/scan');
  await mock.operation('Transfer contents between containers');
  await mock.scan(source.code, destination.code);
  await mock.review();
  const quantities = page.getByRole('spinbutton', { name: 'Quantity', exact: true });
  await expect(quantities.nth(1)).toBeDisabled();
  await quantities.first().fill('26');
  const before = (await mock.bootstrap()).state;
  await page.getByRole('button', { name: 'Confirm operation', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Not enough units in source container');
  expect((await mock.bootstrap()).state).toEqual(before);
  await quantities.first().fill('3');
  await page.getByRole('button', { name: 'Confirm operation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operation results', exact: true })).toBeVisible();
  const after = (await mock.bootstrap()).state;
  expect(after.items[source.code].qty).toBe(22);
  expect(after.items[destination.code].qty).toBe(13);
  expect(after.items[source.code].qty! + after.items[destination.code].qty!).toBe(
    source.qty! + destination.qty!
  );
  expect(after.revision).toBe(before.revision + 1);
});

test('an unknown container can be counted and later corrected with an audit reason', async ({
  page,
  mock,
}) => {
  const item = await mock.item('Uncounted container');
  expect(item.qty).toBeNull();
  await page.goto('/#/scan');
  await mock.operation('Correct container quantity');
  await mock.scan(item.code);
  await mock.review();
  await expect(
    page.getByText(
      'This establishes an unknown QR container count only. Native stock will not change.',
      { exact: true }
    )
  ).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('9');
  await page.getByRole('textbox', { name: 'Reason / purpose', exact: true }).fill('Opening count');
  await page.getByRole('button', { name: 'Confirm operation', exact: true }).click();
  await expect(
    page.getByText('QR count established; native stock unchanged', { exact: true })
  ).toBeVisible();
  expect((await mock.bootstrap()).state.items[item.code].qty).toBe(9);
  await page.locator('tbody').getByRole('link', { name: item.label, exact: true }).click();
  await page.getByRole('link', { name: 'Correct quantity', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('6');
  await page
    .getByRole('textbox', { name: 'Reason / purpose', exact: true })
    .fill('Counted damaged units');
  await mock.confirm();
  const corrected = (await mock.bootstrap()).state.items[item.code];
  expect(corrected.qty).toBe(6);
  expect(corrected.consumption_log?.at(-1)).toMatchObject({
    kind: 'correct',
    quantity: 6,
    reason: 'Counted damaged units',
  });
});

test('camera warehouse moves appear in bin printouts and picking previews without further mutations', async ({
  page,
  mock,
}) => {
  const drill = await mock.item('Workshop drill');
  await page.goto('/#/scan');
  await mock.operation('Move items');
  await mock.scan(drill.code);
  await mock.review();
  await mock.select('Destination warehouse', 'OTHER');
  await mock.select('Aisle', 'B');
  await page.getByRole('spinbutton', { name: 'Shelf', exact: true }).fill('4');
  await mock.confirm();
  const moved = (await mock.bootstrap()).state;
  expect(moved.items[drill.code]).toMatchObject({
    warehouse_id: 2,
    bin: 'B-4',
    qty: 1,
    serial: drill.serial,
  });
  await mock.navigate('Bins and locations');
  await mock.select('Warehouse', 'OTHER');
  await mock.select('Bin', 'B-4');
  await expect(page.getByRole('link', { name: drill.label, exact: true })).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Print bin inventory', exact: true }).click();
  const print = await popupPromise;
  await expect(
    print.getByRole('heading', { name: 'Bin content sheets', exact: true })
  ).toBeVisible();
  await expect(print.locator('tbody tr')).toContainText([drill.label]);
  await expect(print.getByRole('link', { name: 'Back to bins', exact: true })).toHaveAttribute(
    'href',
    /warehouse_id=2&bin=B-4/
  );
  await print.close();
  await mock.navigate('Picking');
  await mock.lookup('Customer order', 'SO', /SO-0039/);
  await mock.select('Warehouse', 'MAIN');
  await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Print / Save as PDF', exact: true })
  ).toBeEnabled();
  await expect(page.locator('tbody')).toContainText('BOLT-M8');
  await expect(
    page.locator('tbody').getByRole('link', { name: drill.label, exact: true })
  ).toHaveCount(0);
  const allocated = await page.locator('tbody tr td:last-child').allTextContents();
  expect(allocated.reduce((sum, quantity) => sum + Number(quantity), 0)).toBe(12);
  await mock.select('Warehouse', 'OTHER');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText([drill.label]);
  expect((await mock.bootstrap()).state).toEqual(moved);
});

test('read-only operators can inspect stock but cannot open management workflows', async ({
  page,
  mock,
}) => {
  await mock.reset('read-only');
  const before = (await mock.bootstrap()).state;
  await page.goto('/#/inventory');
  await page.getByRole('link', { name: 'Workshop drill', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Print label', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit metadata', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Consume', exact: true })).toHaveCount(0);
  await mock.navigate('Scan QR');
  await expect(
    page
      .getByRole('navigation', { name: 'Warehouse operations' })
      .getByRole('link', { name: /Consume items/ })
  ).toHaveCount(0);
  await page.goto('/#/workflow/consume');
  await expect(page.getByText('QR management permission required', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm operation', exact: true })).toHaveCount(0);
  expect((await mock.bootstrap()).state).toEqual(before);
});

test('an installation without employees blocks camera checkout without changing stock', async ({
  page,
  mock,
}) => {
  await mock.reset('no-employees');
  const item = await mock.item('Network cable');
  const before = (await mock.bootstrap()).state;
  await page.goto('/#/scan');
  await mock.operation('Check out items');
  await mock.scan(item.code);
  await mock.review();
  await expect(
    page.getByText(
      'No employees yet. Create active employee users in Dolibarr before checking out items.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm operation', exact: true })).toBeDisabled();
  await mock.navigate('Personal warehouses');
  await expect(
    page.getByText(
      'No employees yet. Create active employee users in Dolibarr before assigning warehouses.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save mapping', exact: true })).toBeDisabled();
  expect((await mock.bootstrap()).state).toEqual(before);
});

test('pending synchronization blocks writes until recovery and item reconciliation complete', async ({
  page,
  mock,
}) => {
  await mock.reset('pending');
  const item = await mock.item('Network cable');
  const before = (await mock.bootstrap()).state;
  await page.goto('/#/labels');
  await page.getByRole('spinbutton', { name: /Number of QR codes/ }).fill('2');
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Resolve the pending native synchronization first' })
  ).toHaveText('Resolve the pending native synchronization first');
  expect((await mock.bootstrap()).state).toEqual(before);
  await page.getByRole('button', { name: 'Recover synchronization', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Recover synchronization', exact: true })
  ).toHaveCount(0);
  expect((await mock.bootstrap()).state.pending_native).toBeUndefined();
  await mock.navigate('Inventory');
  const row = page.locator('tbody tr').filter({ hasText: item.label });
  await expect(row.locator('.inventory-status')).toHaveText('Pending');
  await row.getByRole('link', { name: item.label, exact: true }).click();
  await page.getByRole('button', { name: 'Reconcile pending operation', exact: true }).click();
  await expect(page.locator('qrr-root').getByRole('status')).toContainText(
    'Mock pending operation reconciled'
  );
  await expect(page.getByRole('link', { name: 'Move', exact: true })).toBeVisible();
  const recovered = (await mock.bootstrap()).state;
  expect(recovered.items[item.code].pending_operation).toBeUndefined();
  expect(recovered.items[item.code].qty).toBe(item.qty);
  expect(recovered.history).toEqual([]);
  expect(recovered.revision).toBe(before.revision + 2);
});
