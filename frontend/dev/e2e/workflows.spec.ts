import { expect, test } from './fixtures';

test('print blank labels, register one through the virtual camera and preserve its draft and thumbnail @virtual-camera', async ({
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
  test(`camera consumption against ${destination.type} saves its reference and can be returned @virtual-camera`, async ({
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

test('mobile camera checkout creates an employee warehouse and checkin restores the original stock @virtual-camera', async ({
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

test('camera container transfer rejects excess quantity without changes, then conserves the total @virtual-camera', async ({
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

test('an unknown container can be counted and later corrected with an audit reason @virtual-camera', async ({
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

test('camera warehouse moves appear in bin printouts and picking previews without further mutations @virtual-camera', async ({
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
  const allocated = await page.locator('tbody tr:has(a) td:last-child').allTextContents();
  expect(allocated.reduce((sum, quantity) => sum + Number(quantity), 0)).toBe(12);
  await mock.select('Warehouse', 'OTHER');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(page.locator('tbody tr:has(a)')).toHaveCount(1);
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
  await expect(
    page.getByText('Permission required for this QR action', { exact: true })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm operation', exact: true })).toHaveCount(0);
  expect((await mock.bootstrap()).state).toEqual(before);
});

test('an installation without employees blocks camera checkout without changing stock @virtual-camera', async ({
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
  const synchronization = page.locator('qrr-pending-details').first();
  await expect(synchronization.getByRole('table')).toBeHidden();
  await synchronization.locator('summary').click();
  await expect(
    synchronization.getByRole('table', { name: 'Requested synchronization changes' })
  ).toBeVisible();
  await expect(synchronization.getByRole('row').filter({ hasText: 'Pending cable' })).toBeVisible();
  await synchronization.locator('summary').click();
  await expect(synchronization.getByRole('table')).toBeHidden();
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
  const operation = page.locator('qrr-pending-details');
  await operation.locator('summary').click();
  await expect(operation.getByRole('row').filter({ hasText: 'Warehouse' })).toContainText('OTHER');
  await expect(operation.getByRole('row').filter({ hasText: '+1 (OTHER)' })).toBeVisible();
  await page.getByRole('button', { name: 'Reconcile pending operation', exact: true }).click();
  await expect(
    page
      .locator('qrr-root')
      .getByRole('status')
      .filter({ hasText: 'Mock pending operation reconciled' })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Move', exact: true })).toBeVisible();
  const recovered = (await mock.bootstrap()).state;
  expect(recovered.items[item.code].pending_operation).toBeUndefined();
  expect(recovered.items[item.code].qty).toBe(item.qty);
  expect(recovered.history).toEqual([]);
  expect(recovered.revision).toBe(before.revision + 2);
});

test('pending synchronization details remain readable without recovery permission', async ({
  page,
  mock,
}) => {
  await mock.reset('pending');
  let emptyDetails = false;
  await page.route('**/api.php?resource=bootstrap', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.permissions.recover = false;
    data.permissions.admin = false;
    if (emptyDetails) delete data.state.pending_native.details;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/#/inventory');
  const details = page.locator('qrr-pending-details').first();
  await details.locator('summary').click();
  await expect(details.getByRole('table')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Recover synchronization', exact: true })
  ).toHaveCount(0);
  emptyDetails = true;
  await page.reload();
  await details.locator('summary').click();
  await expect(
    details.getByText('No additional details are available with your current permissions.')
  ).toBeVisible();
  await expect(details.getByRole('table')).toHaveCount(0);
});

test('workflow scanning rejects unrelated labels and enforces loaded pick quantities', async ({
  page,
  mock,
}) => {
  const drill = await mock.item('Network cable');
  const box = await mock.item('Bolts box A');
  await page.goto('/#/workflow/consume?input=manual');
  await mock.lookup('Customer order', 'SO', /SO-0039/);
  await mock.select('Pick from warehouse', 'MAIN');
  await page.getByRole('button', { name: 'Load pick list', exact: true }).click();
  await expect(page.locator('qrr-card').filter({ hasText: 'Pick list safeguards' })).toContainText(
    box.code
  );
  const entry = page.getByRole('textbox', { name: 'QR identifiers', exact: true });
  await entry.fill(drill.code);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Item is not on the loaded pick list');
  await expect(
    page.getByRole('button', { name: 'Review selected items', exact: true })
  ).toBeDisabled();
  await entry.fill(box.code);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await page.getByRole('button', { name: 'Review selected items', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('13');
  await page.getByRole('button', { name: 'Confirm operation', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Quantity exceeds the pick list' })
  ).toBeVisible();
  expect((await mock.bootstrap()).state.items[box.code].qty).toBe(box.qty);
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('2');
  await mock.confirm();
  expect((await mock.bootstrap()).state.items[box.code].qty).toBe(box.qty! - 2);
});

for (const kind of ['correct', 'transfer', 'checkin', 'return']) {
  test(`${kind} rejects a scanned item that does not belong to the workflow`, async ({
    page,
    mock,
  }) => {
    const drill = await mock.item('Workshop drill');
    await page.goto('/#/workflow/' + kind + '?input=manual');
    await page.getByRole('textbox', { name: 'QR identifiers', exact: true }).fill(drill.code);
    await page.getByRole('button', { name: 'Add codes', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Review selected items', exact: true })
    ).toBeDisabled();
  });
}

test('unfinished pick lists survive navigation and can be completed manually without changing stock', async ({
  page,
  mock,
}) => {
  await page.goto('/#/picking');
  await mock.lookup('Customer order', 'SO', /SO-0039/);
  await mock.select('Warehouse', 'MAIN');
  await page.getByRole('button', { name: 'Save pick list', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Order #39/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Order #39/ })).toBeVisible();
  const before = (await mock.bootstrap()).state.items;
  await page.getByRole('button', { name: 'Complete manually', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm manual completion', exact: true })
  ).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Manual completion reason', exact: true })
    .fill('Remaining units supplied from untracked stock');
  await page.getByRole('button', { name: 'Confirm manual completion', exact: true }).click();
  await expect(page.getByText(/Remaining units supplied from untracked stock/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Resume picking', exact: true })).toHaveCount(0);
  expect((await mock.bootstrap()).state.items).toEqual(before);
});

async function inventoryCommand(
  request: import('@playwright/test').APIRequestContext,
  action: string,
  payload: unknown
) {
  const bootstrap = await (await request.get('/custom/qrrouter/api.php?resource=bootstrap')).json();
  const response = await request.post('/custom/qrrouter/api.php?action=' + action, {
    form: { token: bootstrap.token, qrr_token: bootstrap.csrf, payload: JSON.stringify(payload) },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).result;
}

test('scanning a location QR opens current contents and refreshes after stock changes', async ({
  page,
  request,
  mock,
}) => {
  const box = await mock.item('Bolts box A');
  const levels = { 1: 101, 2: '1' };
  await inventoryCommand(request, 'workflow', {
    kind: 'move',
    codes: [box.code],
    warehouse_id: 1,
    levels,
  });
  const qr = locationQr(1, levels);
  await page.goto('/#/scan?input=manual');
  await page.getByRole('textbox', { name: 'QR identifiers', exact: true }).fill(qr);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(page).toHaveURL(/locations/);
  await expect(page.locator('tbody').nth(1)).toContainText('25');
  await inventoryCommand(request, 'workflow', {
    kind: 'consume',
    codes: [box.code],
    quantities: { [box.code]: 3 },
    post_stock: true,
  });
  await page.getByRole('button', { name: 'Refresh contents', exact: true }).click();
  await expect(page.locator('tbody').nth(1)).toContainText('22');
});

test('move workflow scans a destination location and shows its current contents', async ({
  page,
  request,
  mock,
}) => {
  const item = await mock.item('Workshop drill');
  const levels = { 1: 102, 2: '2' };
  const qr = locationQr(2, levels);
  await page.goto('/#/workflow/move?input=manual&code=' + item.code);
  await page.getByRole('button', { name: 'Scan destination bin', exact: true }).click();
  await page.getByRole('textbox', { name: 'QR identifiers', exact: true }).fill(qr);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Destination contents: B-2', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Destination warehouse', exact: true })
  ).toContainText('OTHER');
  await mock.confirm();
  expect((await mock.bootstrap()).state.items[item.code]).toMatchObject({
    warehouse_id: 2,
    bin: 'B-2',
  });
});

test('physical bins pack items and move their contents to a scanned location with a permanent QR', async ({
  page,
  request,
  mock,
}) => {
  const first = await mock.item('Bolts box A');
  const second = await mock.item('Bolts box B');
  const source = { 1: 101, 2: '1' };
  const target = { 1: 102, 2: '2' };
  await inventoryCommand(request, 'workflow', {
    kind: 'move',
    codes: [first.code, second.code],
    warehouse_id: 1,
    levels: source,
  });
  const qr = locationQr(2, target);
  await page.goto('/#/bins?input=manual');
  await page.getByRole('textbox', { name: 'Physical bin name', exact: true }).fill('Blue tote');
  await mock.select('Current warehouse', 'MAIN');
  await mock.select('Aisle', 'A');
  await page.getByRole('spinbutton', { name: 'Shelf', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Create physical bin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Blue tote', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pack or unpack items', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'QR identifiers', exact: true })
    .fill(first.code + ' ' + second.code);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await page.getByRole('button', { name: 'Pack selected items', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  const binBefore = (
    await (await request.get('/custom/qrrouter/api.php?resource=physical-bins')).json()
  )[0];
  await page.getByRole('button', { name: 'Scan destination bin', exact: true }).click();
  await page.getByRole('textbox', { name: 'QR identifiers', exact: true }).fill(qr);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Destination contents: B-2', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirm bin move', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Physical bin and contents moved' })
  ).toBeVisible();
  const items = (await mock.bootstrap()).state.items;
  expect(items[first.code]).toMatchObject({
    warehouse_id: 2,
    bin: 'B-2',
    qty: 25,
    physical_bin_id: binBefore.id,
  });
  expect(items[second.code]).toMatchObject({
    warehouse_id: 2,
    bin: 'B-2',
    qty: 10,
    physical_bin_id: binBefore.id,
  });
  const binAfter = (
    await (await request.get('/custom/qrrouter/api.php?resource=physical-bins')).json()
  )[0];
  expect(binAfter.qr).toBe(binBefore.qr);
  await page.goto('/#/scan?input=manual');
  await page.getByRole('textbox', { name: 'QR identifiers', exact: true }).fill(binAfter.qr);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Blue tote', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('virtual camera reads a printed location URL and opens its current report @virtual-camera', async ({
  page,
  request,
  mock,
}) => {
  const levels = { 1: 101, 2: '1' };
  const qr = locationQr(1, levels);
  await page.goto('/#/scan?input=camera');
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Camera mock', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'QR content', exact: true })
    .fill(
      'https://example.invalid/custom/qrrouter/index.php#/locations?location=' +
        encodeURIComponent(qr)
    );
  await page.getByRole('button', { name: 'Show QR code', exact: true }).click();
  await expect(page).toHaveURL(/locations/);
  await page.getByRole('button', { name: 'Close camera controls', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Bin', exact: true })).toContainText('A-1');
  await mock.expectCameraReleased();
});

test('action history retains performed work and filters by item and operation', async ({
  page,
  request,
  mock,
}) => {
  const item = await mock.item('Workshop drill');
  await inventoryCommand(request, 'workflow', {
    kind: 'move',
    codes: [item.code],
    warehouse_id: 2,
    levels: { 1: 102, 2: '4' },
    reason: 'Audit destination verification',
  });
  await page.goto('/#/history');
  await expect(page.getByRole('heading', { name: 'Action history', exact: true })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('Audit destination verification');
  await expect(
    page.locator('tbody').getByRole('link', { name: item.label, exact: true })
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search actions, items or reasons', exact: true })
    .fill(item.code);
  await mock.select('Recorded action', 'Move items');
  await page.getByRole('button', { name: 'Apply filters / Refresh', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('tbody')).toContainText('Audit destination verification');
  await page
    .getByRole('textbox', { name: 'Search actions, items or reasons', exact: true })
    .fill('no-matching-history-event');
  await page.getByRole('button', { name: 'Apply filters / Refresh', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('No recorded actions match these filters');
});

test('action history blocks direct access without the history permission', async ({
  page,
  request,
  mock,
}) => {
  await mock.reset('read-only');
  await page.goto('/#/history');
  await expect(
    page.getByText('Operation history permission required', { exact: true })
  ).toBeVisible();
  const response = await request.get('/custom/qrrouter/api.php?resource=history');
  expect(response.status()).toBe(403);
});

function locationQr(warehouse: number, levels: Record<string, string | number>): string {
  return `QRRLOC:1:1:${warehouse}:${Buffer.from(JSON.stringify(levels)).toString('base64url')}`;
}

test('history permission lets a reader see QR movement history and its separate page', async ({
  page,
  request,
  mock,
}) => {
  const item = await mock.item('Workshop drill');
  const other = await mock.item('Bolts box A');
  await inventoryCommand(request, 'workflow', {
    kind: 'move',
    codes: [item.code],
    warehouse_id: 2,
    levels: { 1: 102, 2: '4' },
    reason: 'Visible movement record',
  });
  await inventoryCommand(request, 'workflow', {
    kind: 'move',
    codes: [other.code],
    warehouse_id: 2,
    levels: { 1: 102, 2: '4' },
    reason: 'Other QR movement',
  });
  // Grant read-only history access without replacing the recorded state.
  await page.route('**/api.php?resource=bootstrap', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.permissions = {
      ...data.permissions,
      admin: false,
      manage: false,
      stock: false,
      history: true,
      create: false,
      modify: false,
      delete: false,
      move: false,
      consume: false,
      return: false,
      adjust: false,
      loans: false,
      picking: false,
      recover: false,
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto('/#/items/' + item.code);
  const history = page
    .locator('qrr-card')
    .filter({ has: page.getByRole('heading', { name: 'Movement history', exact: true }) });
  await expect(history).toContainText('Visible movement record');
  await expect(history).not.toContainText('Other QR movement');
  await expect(page.getByRole('link', { name: 'Edit metadata', exact: true })).toHaveCount(0);
  await history.getByRole('link', { name: 'Open operation history page', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('history\\?code=' + item.code));
  await expect(page.locator('tbody')).toContainText('Visible movement record');
  await expect(page.locator('tbody')).not.toContainText('Other QR movement');
  await page.getByRole('link', { name: 'All QR entries', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('Other QR movement');
});

test('read-only history permission is enforced by the API and does not grant stock changes', async ({
  page,
  request,
  mock,
}) => {
  await mock.reset('history-reader');
  const context = await mock.bootstrap();
  expect(context.permissions.history).toBe(true);
  expect(context.permissions.admin).toBe(false);
  expect(context.permissions.manage).toBe(false);
  await page.goto('/#/history');
  await expect(page.getByRole('heading', { name: 'Action history', exact: true })).toBeVisible();
  await expect(
    page.getByText('Operation history permission required', { exact: true })
  ).toHaveCount(0);
  expect((await request.get('/custom/qrrouter/api.php?resource=history')).ok()).toBe(true);
  const rejected = await request.post('/custom/qrrouter/api.php?action=bulk', {
    form: {
      token: context.token,
      qrr_token: context.csrf,
      payload: JSON.stringify({ type: 'unassigned', count: 1 }),
    },
  });
  expect(rejected.status()).toBe(403);
});
