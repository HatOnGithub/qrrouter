import { expect, test } from './fixtures';
import type { Bootstrap } from '../../src/app/core/models/inventory';

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

test('inventory embeds borrowers and consumption references in statuses and links metadata', async ({
  page,
}) => {
  await page.goto('/#/inventory');
  const loan = page.locator('tbody tr').filter({ hasText: 'Loaned cable' });
  await expect(loan.locator('.inventory-status')).toContainText('On loan');
  await expect(
    loan.locator('.inventory-status').getByRole('link', { name: 'Alex Operator' })
  ).toHaveAttribute('href', '/user/card.php?id=8');
  const consumed = page.locator('tbody tr').filter({ hasText: 'Consumed cable' });
  await expect(
    consumed.locator('.inventory-status').getByRole('link', { name: 'MO-0019' })
  ).toHaveAttribute('href', '/mrp/mo_card.php?id=19');
  await expect(page.locator('.inventory-summary qrr-card')).toHaveCount(0);
  const drill = page.locator('tbody tr').filter({ hasText: 'Workshop drill' });
  await expect(drill.getByRole('link', { name: 'DRILL-18V', exact: true })).toHaveAttribute(
    'href',
    '/product/card.php?id=2'
  );
  await expect(drill.getByRole('link', { name: 'MAIN', exact: true })).toHaveAttribute(
    'href',
    '/product/stock/card.php?id=1'
  );
  await consumed.getByRole('link', { name: 'Consumed cable', exact: true }).click();
  await expect(page.getByText('Latest consumption destination', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'MO-0019', exact: true })).toHaveCount(2);
  await page.getByRole('link', { name: 'MO-0019', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'MO-0019', exact: true })).toBeVisible();
});

test('restricted readers receive no manufacturing references or internal audit payloads', async ({
  page,
  request,
}) => {
  await request.post('/__mock/reset', { data: { scenario: 'read-only' } });
  const response: Bootstrap = await (
    await request.get('/custom/qrrouter/api.php?resource=bootstrap')
  ).json();
  expect(response.state.history).toEqual([]);
  const consumed = Object.values(response.state.items).find(
    item => item.label === 'Consumed cable'
  )!;
  expect(consumed.consumption_log?.[0].reference_id).toBeUndefined();
  expect(consumed.consumption_log?.[0].reason).toBe('');
  expect(response.consumption_references).not.toHaveProperty('production:19');
  expect(response.users).not.toHaveProperty('9');
  await page.goto('/#/inventory');
  await expect(page.getByRole('link', { name: 'MO-0019', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Consumed cable', exact: true }).click();
  await expect(page.getByRole('link', { name: /MO-0019|Production order #19/ })).toHaveCount(0);
  await expect(page.locator('.content')).not.toContainText('MO-0019');
});

test('virtual camera decodes fixtures and custom URLs through the real scanner', async ({
  page,
  request,
}) => {
  const bootstrap: Bootstrap = await (
    await request.get('/custom/qrrouter/api.php?resource=bootstrap')
  ).json();
  const drill = Object.values(bootstrap.state.items).find(item => item.label === 'Workshop drill')!;
  const box = Object.values(bootstrap.state.items).find(item => item.label === 'Bolts box A')!;
  await page.goto('/#/inventory');
  await page.getByRole('button', { name: 'Camera mock', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Camera mock', exact: true });
  await expect(panel).toBeVisible();
  const app = (await page.locator('.mock-main').boundingBox())!;
  const controls = (await panel.boundingBox())!;
  expect(controls.x).toBeGreaterThanOrEqual(app.x + app.width);
  await page.getByLabel('Fixture QR code', { exact: true }).selectOption(drill.code);
  await page.getByRole('button', { name: 'Show QR code', exact: true }).click();
  await expect(page.locator('#mock-camera-status')).toContainText('Showing QR code');
  await page
    .locator('.module-navigation')
    .getByRole('link', { name: 'Scan QR', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Warehouse operations' })
    .getByRole('link', { name: 'QR camera', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Remove ' + drill.code, exact: true })
  ).toBeVisible();
  await expect(page.locator('#mock-camera-status')).toContainText(
    '1 active virtual camera stream.'
  );
  await page.getByRole('button', { name: 'Clear frame', exact: true }).click();
  await expect(page.locator('#mock-camera-status')).toContainText('Blank frame');
  await page.getByLabel('Camera format', { exact: true }).selectOption('480x640');
  await page.getByRole('slider', { name: /QR size/ }).fill('60');
  await page.getByRole('slider', { name: /Rotation/ }).fill('30');
  await page
    .getByLabel('QR content', { exact: true })
    .fill('https://example.test/scan.php?code=' + box.code);
  await page.getByRole('button', { name: 'Show QR code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove ' + box.code, exact: true })).toBeVisible();
  await expect(page.locator('.codes button')).toHaveCount(2);
  await page.screenshot({ path: '../artifacts/camera-mock-desktop.png' });
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
  await expect(page.locator('#mock-camera-status')).toContainText(
    '0 active virtual camera streams.'
  );
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.locator('#mock-camera-status')).toContainText(
    '1 active virtual camera stream.'
  );
  await expect(page.locator('.codes button')).toHaveCount(2);
  await page
    .locator('.module-navigation')
    .getByRole('link', { name: 'Inventory', exact: true })
    .click();
  await expect(page.locator('#mock-camera-status')).toContainText(
    '0 active virtual camera streams.'
  );
});

test('mobile camera controls fill the screen, trap focus and return to scanning', async ({
  page,
  request,
}) => {
  const bootstrap: Bootstrap = await (
    await request.get('/custom/qrrouter/api.php?resource=bootstrap')
  ).json();
  const code = Object.keys(bootstrap.state.items)[0];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/scan?input=camera');
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Camera mock', exact: true });
  await toggle.click();
  const panel = page.getByRole('dialog', { name: 'Camera mock', exact: true });
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  expect(await page.locator('.mock-main').evaluate(element => (element as HTMLElement).inert)).toBe(
    true
  );
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('slider', { name: /Rotation/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Close camera controls', exact: true })
  ).toBeFocused();
  await page.getByLabel('Fixture QR code', { exact: true }).selectOption(code);
  await page.getByRole('button', { name: 'Show QR code', exact: true }).click();
  await expect(page.locator('#mock-camera-status')).toContainText('Showing QR code');
  await page.screenshot({ path: '../artifacts/camera-mock-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(await page.locator('.mock-main').evaluate(element => (element as HTMLElement).inert)).toBe(
    false
  );
  await expect(page.getByRole('button', { name: 'Remove ' + code, exact: true })).toBeVisible();
});

test('virtual camera is the default and failure modes never request a physical camera', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__physicalCameraRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        (window as any).__physicalCameraRequests++;
        throw new Error('No physical camera for test');
      },
    });
  });
  await page.goto('/#/scan?input=camera');
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Camera mock', exact: true }).click();
  await page.getByLabel('Camera source', { exact: true }).selectOption('denied');
  await page.getByRole('button', { name: 'Restart camera', exact: true }).click();
  await expect(page.locator('qrr-scanner [role="alert"]')).toHaveText(
    'Permission denied by camera mock.'
  );
  await expect(page.locator('.camera-placeholder')).toBeVisible();
  await expect(page.locator('#mock-camera-status')).toContainText(
    '0 active virtual camera streams.'
  );
  await page.getByLabel('Camera source', { exact: true }).selectOption('unavailable');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.locator('qrr-scanner [role="alert"]')).toHaveText(
    'No camera available in camera mock.'
  );
  expect(await page.evaluate(() => (window as any).__physicalCameraRequests)).toBe(0);
  await page.getByLabel('Camera source', { exact: true }).selectOption('real');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.locator('qrr-scanner [role="alert"]')).toHaveText(
    'No physical camera for test'
  );
  expect(await page.evaluate(() => (window as any).__physicalCameraRequests)).toBe(1);
  await page.getByLabel('Camera source', { exact: true }).selectOption('virtual');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark']) {
  test(`${theme} controls keep native backgrounds, compact dimensions and consistent spacing`, async ({
    page,
    request,
  }) => {
    await request.post('/__mock/reset', { data: { scenario: 'pending' } });
    await page.addInitScript(value => localStorage.setItem('qrr-mock-theme', value), theme);
    await page.route('**/', async route => {
      const response = await route.fetch();
      const css = `<style>
        :root { --mock-input: rgb(240, 241, 242); }
        :root[data-mock-theme='dark'] { --mock-input: rgb(47, 52, 57); }
        input, textarea { background: white; box-shadow: inset 0 0 0 100px white; }
        input { padding: 5px 8px 9px; margin-bottom: 3px; line-height: normal; }
        .butAction { background: rgb(97, 74, 52); color: rgb(253, 252, 251); }
      </style>`;
      await route.fulfill({
        response,
        body: (await response.text()).replace('</head>', css + '</head>'),
      });
    });
    await page.goto('/#/inventory');
    const expectedBackground = theme === 'dark' ? 'rgb(47, 52, 57)' : 'rgb(240, 241, 242)';
    const input = page.getByRole('textbox', { name: 'Search inventory', exact: true });
    const field = page
      .locator('mat-form-field')
      .filter({ has: input })
      .locator('.mat-mdc-text-field-wrapper');
    await expect(field).toHaveCSS('background-color', expectedBackground);
    await expect(input).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(input).toHaveCSS('background-image', 'none');
    await expect(input).toHaveCSS('box-shadow', 'none');
    await input.fill('Workshop');
    const inputBox = (await input.boundingBox())!;
    const fieldBox = (await field.boundingBox())!;
    expect(
      Math.abs(inputBox.y + inputBox.height / 2 - fieldBox.y - fieldBox.height / 2)
    ).toBeLessThanOrEqual(1);
    await expect(input).toHaveCSS('padding', '0px');
    await expect(input).toHaveCSS('margin', '0px');
    await input.clear();
    expect((await field.boundingBox())!.height).toBeLessThanOrEqual(40);
    await expect(field).toHaveCSS('border-top-left-radius', '8px');
    const statusColors = await page
      .locator('.inventory-status')
      .evaluateAll(elements => [
        ...new Set(elements.map(element => getComputedStyle(element).backgroundColor)),
      ]);
    expect(statusColors).toHaveLength(5);
    expect(statusColors).not.toContain('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `../artifacts/inventory-${theme}-theme.png` });
    await page.goto('/#/labels');
    const create = page.getByRole('button', { name: 'Create batch', exact: true });
    await expect(create).toHaveCSS('background-color', 'rgb(97, 74, 52)');
    const padded = async (selector: string) =>
      page.locator(selector).evaluate(element => {
        const css = getComputedStyle(element);
        return parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
      });
    const padding = await padded('.batch-form button');
    expect(await padded('.toolbar button[mat-stroked-button]')).toBe(padding);
    expect(await padded('.menu-toggle')).toBe(padding);
    const numberField = await page.locator('.batch-form mat-form-field').boundingBox();
    const createBox = await create.boundingBox();
    expect(createBox!.x - numberField!.x - numberField!.width).toBeGreaterThanOrEqual(12);
    const numberInput = page.getByRole('spinbutton', { name: /Number of QR codes/ });
    const numberInputBox = (await numberInput.boundingBox())!;
    expect(
      Math.abs(
        numberInputBox.y + numberInputBox.height / 2 - numberField!.y - numberField!.height / 2
      )
    ).toBeLessThanOrEqual(1);
    const bootstrap: Bootstrap = await (
      await request.get('/custom/qrrouter/api.php?resource=bootstrap')
    ).json();
    const code = Object.keys(bootstrap.state.items)[0];
    await page.goto('/#/scan?input=manual');
    const textarea = page.getByRole('textbox', { name: 'QR identifiers' });
    await expect(textarea).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await textarea.fill(code);
    await page.getByRole('button', { name: 'Add codes', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Review selected items', exact: true })).toHaveCSS(
      'background-color',
      'rgb(97, 74, 52)'
    );
  });
}
