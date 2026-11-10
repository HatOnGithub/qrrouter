import { test, expect, Page } from '@playwright/test';

import { validCode } from '../src/app/shared/scanner/codes';
import { writeFile } from 'node:fs/promises';

async function open(page: Page, route: string): Promise<void> {
  await page.goto('index.php#/' + route);
  await expect(page.locator('qrr-root router-outlet')).toBeAttached();
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

async function scannerScreenshot(page: Page, path: string): Promise<void> {
  await page.locator('.scanner-page').screenshot({
    path,
    // Expand the nested scroll container only while capturing the complete screen.
    style:
      'qrr-root .app-shell, qrr-root main, qrr-root .content { display: block !important; height: auto !important; max-height: none !important; overflow: visible !important; }',
  });
}

test('inventory searches native tags and readable extra fields', async ({ page }) => {
  const { state } = await (await page.request.get('api.php?resource=bootstrap')).json();
  await open(page, 'inventory');
  const search = page.getByRole('textbox', { name: 'Search inventory', exact: true });
  for (const [query, productId] of [
    ['HYDRAULICS', 4],
    ['Electrical', 3],
    ['stainless steel', null],
    ['Supplier code', null],
    ['ACME-204', null],
    ['heat resistant', null],
  ] as const) {
    await search.fill(query);
    const expected = Object.values(state.items).filter((item: any) =>
      productId ? item.product_id === productId : [3, 4].includes(item.product_id)
    );
    await expect(page.locator('tbody tr')).toHaveCount(expected.length);
    for (const item of expected as any[])
      await expect(page.locator(`a[href="#/items/${item.code}"]`)).toBeVisible();
  }
  await search.fill('EXTRA_PASSWORD_SECRET');
  await expect(page.getByText('No matching items', { exact: true })).toBeVisible();
});

test('native product and Binloc-adjacent warehouse tabs open the related QR entries', async ({
  page,
}) => {
  const code = process.env['QRR_E2E_BOX']!;
  const bootstrap = await (await page.request.get('api.php?resource=bootstrap')).json();
  const item = bootstrap.state.items[code];
  await page.goto('native.php?kind=product&id=' + item.product_id);
  await expect(
    page.locator('[data-native-tabs]').getByRole('link', { name: 'QR entries', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Binloc locations', exact: true })).toHaveAttribute(
    'href',
    /binloc\/tab_product_locations\.php/
  );
  await expect(page.locator('a[href$="#/items/' + code + '"]')).toHaveAttribute(
    'href',
    new RegExp('#/items/' + code + '$')
  );
  await page.goto('native.php?kind=warehouse&id=' + item.warehouse_id);
  await page.getByRole('combobox', { name: 'Binloc locations' }).selectOption(item.bin_key);
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('bin_key='));
  await page.locator('a[href$="#/items/' + code + '"]').click();
  await expect(page.getByRole('heading', { name: item.label, exact: true })).toBeVisible();
});
test('DYMO labels add details and preserve physical dimensions at every size', async ({ page }) => {
  const code = process.env['QRR_E2E_ITEM']!;
  // The native QR endpoint needs TCPDF/GD, absent in the Dolibarr-shaped fixture.
  // Stub only its image response; label identity, metadata, CSS and pagination stay real.
  await page.route('**/qr.php?code=*', route =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=',
        'base64'
      ),
    })
  );
  await page.goto('label.php?code=' + code + '&format=dymo-25x54');
  await expect(page.getByRole('button', { name: 'Print DYMO labels', exact: true })).toBeEnabled();
  await expect(page.locator('.qrr-label-detail')).toHaveCount(3);
  expect(
    await page
      .locator('.qrr-label-detail')
      .evaluateAll(fields => fields.map(field => field.getAttribute('data-kind')))
  ).toEqual(['serial', 'name', 'ref']);
  await expect(page.locator('.qrr-label-detail.serial')).toContainText('SN-REGISTER');
  await expect(page.locator('.qrr-id-code')).toHaveText(code);
  await expect(page.locator('.qrr-qr-column img')).toHaveAttribute(
    'src',
    new RegExp('qr.php\\?code=' + code)
  );
  const size = await page.locator('.qrr-thermal-label').boundingBox();
  expect(size!.width).toBeCloseTo((54 * 96) / 25.4, 0);
  expect(size!.height).toBeCloseTo((25 * 96) / 25.4, 0);
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
  });
  const pdfText = pdf.toString('latin1');
  expect((pdfText.match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
  const dimensions = pdfText.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/)!;
  expect(Number(dimensions[1])).toBeCloseTo((54 * 72) / 25.4, 0);
  expect(Number(dimensions[2])).toBeCloseTo((25 * 72) / 25.4, 0);
  await writeFile('../artifacts/dymo-label-layout-test.pdf', pdf);
  // Even very long serials and names remain within their allotted rows; the QR ID is never fitted away.
  await page.locator('.qrr-label-detail span').evaluateAll(fields =>
    fields.forEach(field => {
      field.textContent = 'Very long detail '.repeat(12);
      (field as HTMLElement).dataset['original'] = field.textContent;
    })
  );
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  expect(
    await page.locator('.qrr-label-detail').evaluateAll(fields =>
      fields.every(field => {
        const span = field.querySelector('span')!;
        return (
          span.scrollWidth <= field.clientWidth + 1 && span.scrollHeight <= field.clientHeight + 1
        );
      })
    )
  ).toBe(true);
  await expect(page.locator('.qrr-id-code')).toHaveText(code);

  let previousDetails = 2;
  for (const [format, width, height] of [
    ['dymo-25x54', 54, 25],
    ['dymo-32x57', 57, 32],
    ['dymo-36x89', 89, 36],
    ['dymo-54x101', 101, 54],
  ] as const) {
    await page.goto('label.php?code=' + code + '&format=' + format);
    await expect(
      page.getByRole('button', { name: 'Print DYMO labels', exact: true })
    ).toBeEnabled();
    const count = await page.locator('.qrr-label-detail').count();
    expect(count).toBeGreaterThanOrEqual(previousDetails);
    previousDetails = count;
    await expect(page.locator('.qrr-id-code')).toHaveText(code);
    const label = await page.locator('.qrr-thermal-label').boundingBox();
    expect(label!.width).toBeCloseTo((width * 96) / 25.4, 0);
    expect(label!.height).toBeCloseTo((height * 96) / 25.4, 0);
    const sheet = (
      await page.pdf({ preferCSSPageSize: true, displayHeaderFooter: false })
    ).toString('latin1');
    expect((sheet.match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
    const box = sheet.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/)!;
    expect(Number(box[1])).toBeCloseTo((width * 72) / 25.4, 0);
    expect(Number(box[2])).toBeCloseTo((height * 72) / 25.4, 0);
    expect(
      await page.locator('.qrr-label-detail').evaluateAll(fields =>
        fields.every(field => {
          const span = field.querySelector('span')!;
          return (
            span.scrollWidth <= field.clientWidth + 1 && span.scrollHeight <= field.clientHeight + 1
          );
        })
      )
    ).toBe(true);
  }
  await page.getByRole('combobox', { name: 'Label size' }).selectOption('dymo-32x57');
  await page.getByRole('button', { name: 'Apply size' }).click();
  await expect(page).toHaveURL(new RegExp('code=' + code));
  await expect(page.getByRole('combobox', { name: 'Label size' })).toHaveValue('dymo-32x57');

  await open(page, 'labels');
  await page.getByRole('spinbutton', { name: 'Number of QR codes (1–200)' }).fill('2');
  const batchCount = await page.locator('tbody tr').count();
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(batchCount + 1);
  const printLink = page.getByRole('link', { name: 'Print', exact: true }).first();
  await expect(printLink).toHaveAttribute('href', /format=dymo-25x54/);
  await page.goto((await printLink.getAttribute('href'))!);
  await expect(page.getByRole('button', { name: 'Print DYMO labels', exact: true })).toBeEnabled();
  await expect(page.locator('.qrr-thermal-label')).toHaveCount(2);
  await expect(page.locator('.qrr-label-detail')).toHaveCount(0);
  await expect(page.locator('.qrr-id-code')).toHaveCount(2);
  const batchUrl = page.url();
  const blankCode = await page.locator('.qrr-id-code').first().innerText();
  for (const format of ['dymo-25x54', 'dymo-32x57', 'dymo-36x89', 'dymo-54x101']) {
    const url = new URL(batchUrl);
    url.searchParams.set('format', format);
    await page.goto(url.href);
    await expect(page.locator('.qrr-label-detail')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Print DYMO labels', exact: true })
    ).toBeEnabled();
    const batchPdf = await page.pdf({ preferCSSPageSize: true, displayHeaderFooter: false });
    expect((batchPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBe(2);
  }
  await page.goto(
    new URL('label.php?' + new URLSearchParams({ code: blankCode, format: 'a4' }), batchUrl).href
  );
  await expect(page.locator('.qrr-qr-label')).toHaveText(blankCode);
  await expect(page.locator('.qrr-qr-label img')).toHaveCount(1);
  await page.goto(
    new URL('label.php?' + new URLSearchParams({ code, format: 'a4' }), batchUrl).href
  );
  await page.locator('.qrr-printed-name').evaluate(element => {
    element.textContent = 'Long item name '.repeat(50);
  });
  const a4Label = (await page.locator('.qrr-qr-label').boundingBox())!;
  const a4Image = (await page.locator('.qrr-qr-label img').boundingBox())!;
  expect(a4Label.width).toBeCloseTo((65 * 96) / 25.4, 0);
  expect(a4Label.height).toBeCloseTo((65 * 96) / 25.4, 0);
  expect(a4Image.y + a4Image.height).toBeLessThan(a4Label.y + a4Label.height);
  await page.goto(batchUrl);
  await page.unroute('**/qr.php?code=*');
  await page.route('**/qr.php?code=*', route =>
    route.fulfill({ status: 500, body: 'QR renderer unavailable' })
  );
  await page.reload();
  await expect(page.getByRole('status')).toContainText('QR image failed to load');
  await expect(page.getByRole('button', { name: 'Print DYMO labels', exact: true })).toBeDisabled();
});

test('scanner workstation shows product context and touch quantity controls on mobile', async ({
  page,
}) => {
  const code = process.env['QRR_E2E_BOX']!;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new Error('Camera unavailable. Manual and USB scanning remain ready.');
        },
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'scan?input=camera');
  await page.getByRole('button', { name: 'Manual / USB entry', exact: true }).click();
  await page.getByRole('textbox', { name: 'QR identifiers' }).fill(code);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await page.getByRole('link', { name: 'Review selected items', exact: true }).click();
  await expect(page.locator('.scanned-product')).toContainText('Fixture box');
  await expect(page.locator('.scan-product-facts')).toContainText('Dolibarr lot/serial');
  expect(
    await page.locator('qrr-root .content').evaluate(el => el.scrollWidth <= el.clientWidth)
  ).toBe(true);
  await scannerScreenshot(page, '../artifacts/scanner-mobile.png');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await scannerScreenshot(page, '../artifacts/scanner-desktop.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'workflow/correct?code=' + code);
  const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true });
  const initial = Number(await quantity.inputValue());
  await page.getByRole('button', { name: 'Increase quantity ' + code, exact: true }).click();
  await expect(quantity).toHaveValue(String(initial + 1));
  await expect(page.locator('.quantity-difference')).toContainText('+1');
  await page.getByRole('button', { name: 'Decrease quantity ' + code, exact: true }).click();
  await expect(quantity).toHaveValue(String(initial));
  await quantity.fill('0');
  await expect(
    page.getByRole('button', { name: 'Decrease quantity ' + code, exact: true })
  ).toBeDisabled();
  await expect(page.locator('.scanner-steps [aria-current="step"]')).toContainText(
    'Review and confirm'
  );
  await expect(page.locator('.review-product')).toHaveCSS('display', 'grid');
  expect(
    await page.locator('qrr-root .content').evaluate(el => el.scrollWidth <= el.clientWidth)
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Confirm operation', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Confirm operation', exact: true })).toBeVisible();
  await scannerScreenshot(page, '../artifacts/scanner-count-mobile.png');
});

test('product results remain selectable outside a clipping form container', async ({ page }) => {
  await open(page, 'create');
  await page.locator('qrr-lookup').evaluate(host => {
    const wrapper = document.createElement('div');
    wrapper.style.height = host.getBoundingClientRect().height + 'px';
    wrapper.style.overflow = 'hidden';
    host.parentElement!.insertBefore(wrapper, host);
    wrapper.appendChild(host);
  });

  const input = page.getByRole('combobox', { name: 'Dolibarr product', exact: true });
  await input.fill('Fixture');
  const result = page.getByRole('option', { name: 'PART-003 — Fixture Part', exact: true });
  await expect(result).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('PART-003 — Fixture Part');
  await expect(page.locator('qrr-lookup small')).toContainText('PART-003 — Fixture Part');
  await expect(result).not.toBeVisible();
});

test('product lookup failures are visible and do not leave stale results', async ({ page }) => {
  await page.route('**/api.php?resource=products&**', route =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Product lookup unavailable for test' }),
    })
  );
  await open(page, 'create');
  await page.getByRole('combobox', { name: 'Dolibarr product', exact: true }).fill('Fixture');
  await expect(page.getByRole('alert')).toHaveText('Product lookup unavailable for test');
  await expect(page.getByRole('option')).toHaveCount(0);
});

test('pages scroll below navigation and expand fully for printing', async ({ page }) => {
  await open(page, 'create');
  const content = page.locator('qrr-root .content');
  await content.evaluate(element => {
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    spacer.textContent = 'Long page content';
    element.appendChild(spacer);
  });
  await expect(content).toHaveCSS('overflow-y', 'auto');
  expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const navigationTop = await page
    .locator('qrr-root nav')
    .evaluate(element => element.getBoundingClientRect().top);
  await content.evaluate(element => (element.scrollTop = element.scrollHeight));
  expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(
    await page.locator('qrr-root nav').evaluate(element => element.getBoundingClientRect().top)
  ).toBe(navigationTop);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect
    .poll(async () => (await content.boundingBox())!.y + (await content.boundingBox())!.height)
    .toBeLessThanOrEqual(700);
  await page.emulateMedia({ media: 'print' });
  await expect(content).toHaveCSS('overflow-y', 'visible');
  expect(await content.evaluate(element => element.clientHeight >= element.scrollHeight)).toBe(
    true
  );
});

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
  await open(page, 'scan?input=camera');
  await expect(page.getByRole('alert')).toHaveText('Camera denied for test');
  await expect(page.locator('.camera-placeholder')).toHaveText('Camera is off');
  await expect(page.locator('.camera-placeholder')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Manual / USB entry', exact: true }).click();
  await expect(page.locator('.camera-preview')).toBeHidden();
  await page.getByRole('textbox', { name: 'QR identifiers' }).fill('bad-code');
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid identifier');
  const code = process.env['QRR_E2E_ITEM']!;
  expect(validCode(code)).toBeTruthy();
  await page.getByRole('textbox', { name: 'QR identifiers' }).fill(code + '\n' + code);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove ' + code, exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'QR camera', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Camera denied for test');
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeEnabled();
});

test('register a container using the product lookup and native warehouse selection', async ({
  page,
}) => {
  const code = await blank(page);
  await open(page, 'register?code=' + code + '&mode=box&input=manual');
  await expect(
    page.getByRole('textbox', { name: 'Box name / Dolibarr lot', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Assign details', exact: true }).click();
  await expect(page).toHaveURL(/register\/details/);
  await page
    .getByRole('textbox', { name: 'Box name / Dolibarr lot', exact: true })
    .fill('Browser container');
  await page.getByRole('button', { name: 'Change selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove ' + code, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Assign details', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Box name / Dolibarr lot', exact: true })
  ).toHaveValue('Browser container');
  await page.getByRole('combobox', { name: 'Dolibarr product', exact: true }).fill('Fixture');
  await page.getByRole('option', { name: 'SERIAL-004 — Tracked Part', exact: true }).click();
  await choose(page, 'Warehouse', 'MAIN');
  await page.getByRole('spinbutton', { name: 'Dolibarr lot quantity', exact: true }).fill('7');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser container', exact: true })).toBeVisible();
  const state = (await (await page.request.get('api.php?resource=bootstrap')).json()).state;
  expect(state.items[code].qty).toBe(7);
  expect(state.items[code].type).toBe('box');
});

test('create a named Dolibarr serial with an independent QR identity and Binloc location', async ({
  page,
}) => {
  await open(page, 'create');
  await choose(page, 'QR type', 'Tracked Individual');
  await page.getByRole('textbox', { name: 'Item name / label', exact: true }).fill('Browser tool');
  await page
    .getByRole('textbox', { name: 'Dolibarr serial number', exact: true })
    .fill('BROWSER-SERIAL');
  await page.getByRole('combobox', { name: 'Dolibarr product', exact: true }).fill('Tracked');
  await page.getByRole('option', { name: 'SERIAL-004 — Tracked Part', exact: true }).click();
  await choose(page, 'Warehouse', 'MAIN');
  await page.getByRole('textbox', { name: 'Shelf', exact: true }).fill('Tool shelf');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser tool', exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'Dolibarr lot/serial: BROWSER-SERIAL', exact: true });
  await expect(link).toHaveAttribute('href', /productlot_card.php\?id=\d+/);
  const state = (await (await page.request.get('api.php?resource=bootstrap')).json()).state;
  const item = Object.values(state.items).find(
    (item: any) => item.native_batch === 'BROWSER-SERIAL'
  ) as any;
  expect(item.product_lot_id).toBeGreaterThan(0);
  expect(item.code).not.toBe(item.serial);
  expect(item.bin_values).toEqual({ '1': 'Tool shelf' });
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

for (const destination of [
  { type: 'salesorder', id: 39, ref: 'SO-0039', path: '/commande/card.php?id=39' },
  { type: 'production', id: 19, ref: 'MO-0019', path: '/mrp/mo_card.php?id=19' },
]) {
  test(`consumption defaults to customer orders and supports ${destination.type}`, async ({
    page,
  }) => {
    const code = await blank(page);
    const bootstrap = await (await page.request.get('api.php?resource=bootstrap')).json();
    const created = await page.request.post('api.php?action=update', {
      form: {
        token: bootstrap.token,
        qrr_token: bootstrap.csrf,
        payload: JSON.stringify({
          type: 'box',
          code,
          label: 'Consumption ' + code,
          product_id: 4,
          warehouse_id: 1,
          qty: 3,
        }),
      },
    });
    expect(created.ok()).toBeTruthy();
    await open(page, 'workflow/consume?code=' + code);
    const referenceType = page.getByRole('combobox', {
      name: 'Transaction reference',
      exact: true,
    });
    const record = page.getByRole('combobox', { name: 'Select an exact record', exact: true });
    const confirm = page.getByRole('button', { name: 'Confirm operation', exact: true });
    await expect(referenceType).toContainText('Customer order');
    await expect(confirm).toBeDisabled();
    await record.fill('SO');
    await page.getByRole('option', { name: /SO-0039/ }).click();
    await expect(confirm).toBeEnabled();
    if (destination.type === 'production') {
      await choose(page, 'Transaction reference', 'Manufacturing order');
      await expect(record).toHaveValue('');
      await expect(confirm).toBeDisabled();
      await expect(page.locator('qrr-lookup').getByRole('link', { name: /SO-0039/ })).toHaveCount(
        0
      );
      await record.fill('MO');
      await page.getByRole('option', { name: 'MO-0019', exact: true }).click();
    }
    await confirm.click();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    const updated = await (await page.request.get('api.php?resource=bootstrap')).json();
    const item = updated.state.items[code];
    expect(item.qty).toBe(2);
    expect(item.consumed_units).toBe(1);
    expect(item.consumption_log.at(-1)).toMatchObject({
      kind: 'consume',
      quantity: 1,
      reference_type: destination.type,
      reference_id: destination.id,
    });
    await open(page, 'items/' + code);
    await expect(
      page.getByRole('link', { name: destination.ref, exact: true }).first()
    ).toHaveAttribute('href', new RegExp(destination.path.replace('?', '\\?') + '$'));
  });
}

test('picking preview uses native order lookup and server allocation', async ({ page }) => {
  await open(page, 'inventory');
  await page.locator('nav').getByRole('link', { name: 'Picking', exact: true }).click();
  await page.getByRole('combobox', { name: 'Customer order', exact: true }).fill('SO');
  await page.getByRole('option', { name: /SO-0039/ }).click();
  await choose(page, 'Warehouse', 'MAIN');
  await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Print / Save as PDF', exact: true })
  ).toBeEnabled();
});

test('box transfer is available from navigation and updates both container quantities', async ({
  page,
}) => {
  const source = await blank(page);
  const destination = await blank(page);
  const bootstrap = await (await page.request.get('api.php?resource=bootstrap')).json();
  for (const code of [source, destination]) {
    const response = await page.request.post('api.php?action=update', {
      form: {
        token: bootstrap.token,
        qrr_token: bootstrap.csrf,
        payload: JSON.stringify({
          type: 'box',
          code,
          label: 'Transfer ' + code,
          product_id: 4,
          warehouse_id: 1,
          qty: 5,
        }),
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  await open(page, 'scan');
  await expect(
    page.locator('.module-navigation').getByRole('link', { name: 'Move items', exact: true })
  ).toHaveCount(0);
  await page
    .locator('nav')
    .getByRole('link', { name: 'Transfer contents between containers', exact: true })
    .click();
  await page.getByRole('button', { name: 'Manual / USB entry', exact: true }).click();
  await page.getByRole('textbox', { name: 'QR identifiers' }).fill(source + '\n' + destination);
  await page.getByRole('button', { name: 'Add codes', exact: true }).click();
  await page.getByRole('button', { name: 'Review selected items', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).first().fill('2');
  await page.getByRole('button', { name: 'Confirm operation', exact: true }).click();
  await expect(
    page.getByText('Contents transferred between Dolibarr lots; warehouse total unchanged').first()
  ).toBeVisible();
  const state = (await (await page.request.get('api.php?resource=bootstrap')).json()).state;
  expect(state.items[source].qty).toBe(3);
  expect(state.items[destination].qty).toBe(7);
});

test('bin printouts open from locations and return to the selected warehouse', async ({ page }) => {
  await open(page, 'inventory');
  await page.locator('nav').getByRole('link', { name: 'Bins and locations', exact: true }).click();
  await choose(page, 'Warehouse', 'MAIN');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Print bin inventory', exact: true }).click();
  const printout = await popupPromise;
  await expect(
    printout.getByRole('heading', { name: 'Bin content sheets', exact: true })
  ).toBeVisible();
  await expect(printout.locator('#id-left')).toHaveCount(0);
  await printout.getByRole('link', { name: 'Back to bins', exact: true }).click();
  await expect(
    printout.getByRole('heading', { name: 'Bins and locations', exact: true })
  ).toBeVisible();
  await expect(printout.getByRole('combobox', { name: 'Warehouse', exact: true })).toContainText(
    'MAIN'
  );
  await expect(
    printout.getByRole('link', { name: 'Print bin inventory', exact: true })
  ).toBeVisible();
  await printout.close();
});

test('responsive navigation inherits the host styling', async ({ page }) => {
  await open(page, 'inventory');
  await expect(page.locator('#id-left')).toHaveCount(0);
  const nativePage = await page.request.get('../../native.php');
  expect(await nativePage.text()).toContain('id="id-left"');
  await expect(page.locator('qrr-card article').first()).toHaveCSS('background-image', 'none');
  await expect(page.locator('qrr-card article').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await expect(page.locator('qrr-root')).toHaveCSS('font-family', 'Arial, sans-serif');
  await page.screenshot({ path: '../artifacts/angular-inventory.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#id-left')).toHaveCount(0);
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

test('camera auto-starts on scanning pages and stops when leaving them', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__cameraRequests = 0;
    (window as any).__stoppedTracks = 0;
    HTMLMediaElement.prototype.play = async () => {};
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          (window as any).__cameraRequests++;
          const stream = new MediaStream();
          stream.getTracks = () =>
            [{ stop: () => (window as any).__stoppedTracks++ }] as unknown as MediaStreamTrack[];
          return stream;
        },
      },
    });
  });
  await open(page, 'scan?input=camera');
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
  const content = (await page.locator('qrr-root .content').boundingBox())!;
  const capture = (await page.locator('.scanner-page').boundingBox())!;
  expect(Math.abs(capture.height - content.height)).toBeLessThanOrEqual(1);
  const preview = (await page.locator('.camera-preview').boundingBox())!;
  await page.setViewportSize({ width: 1600, height: 1200 });
  await expect
    .poll(async () => (await page.locator('.camera-preview').boundingBox())!.height)
    .toBeGreaterThan(preview.height + 100);
  expect((await page.locator('.scanner-page').boundingBox())!.width).toBe(1160);
  expect(await page.evaluate(() => (window as any).__cameraRequests)).toBe(1);
  const runningPreview = (await page.locator('.camera-preview').boundingBox())!;
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeEnabled();
  await expect(page.locator('.camera-placeholder')).toHaveText('Camera is off');
  await expect(page.locator('.camera-placeholder')).toBeVisible();
  await expect(page.locator('.camera-preview video')).toBeHidden();
  const stoppedPreview = (await page.locator('.camera-preview').boundingBox())!;
  expect(Math.abs(stoppedPreview.height - runningPreview.height)).toBeLessThanOrEqual(1);
  expect(stoppedPreview.width).toBe(runningPreview.width);
  expect(await page.evaluate(() => (window as any).__stoppedTracks)).toBe(1);
  expect(await page.evaluate(() => (window as any).__cameraRequests)).toBe(1);
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
  await expect(page.locator('.camera-placeholder')).toHaveCount(0);
  await page.locator('nav').getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__stoppedTracks)).toBe(2);
  for (const label of [
    'Register items',
    'Move items',
    'Consume items',
    'Check out items',
    'Check in items',
  ]) {
    await page
      .locator('.module-navigation')
      .getByRole('link', { name: 'Scan QR', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Warehouse operations' })
      .getByRole('link', { name: new RegExp('^' + label) })
      .click();
    await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
    await page.locator('nav').getByRole('link', { name: 'Inventory', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => (window as any).__cameraRequests)).toBe(7);
  expect(await page.evaluate(() => (window as any).__stoppedTracks)).toBe(7);
});

test('a camera granted after leaving the scanning page is released immediately', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__stoppedTracks = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise(resolve => {
            (window as any).__grantCamera = () => {
              const stream = new MediaStream();
              stream.getTracks = () =>
                [
                  { stop: () => (window as any).__stoppedTracks++ },
                ] as unknown as MediaStreamTrack[];
              resolve(stream);
            };
          }),
      },
    });
  });
  await open(page, 'scan?input=camera');
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__grantCamera))
    .toBe('function');
  await expect(page.locator('.camera-placeholder')).toHaveText('Starting camera…');
  await expect(page.locator('.camera-placeholder')).toBeVisible();
  await page.locator('nav').getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.locator('qrr-scanner')).toHaveCount(0);
  await page.evaluate(() => (window as any).__grantCamera());
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

test('navigation decodes repeated HTML entities from the translation response', async ({
  page,
}) => {
  await page.route('**/api.php?resource=bootstrap', async route => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    bootstrap.translations.Inventory =
      'Inventory &amp; tools &amp;hellip; &amp;mdash; &quot;quoted&quot;';
    bootstrap.translations['Scan QR'] =
      '&amp;lt;img src=&amp;quot;entity-regression&amp;quot; ' +
      'onerror=&amp;quot;window.__entityExecuted=true&amp;quot;&amp;gt;';
    await route.fulfill({ response, json: bootstrap });
  });
  await open(page, 'inventory');

  const expected = 'Inventory & tools … — "quoted"';
  await expect(page.getByRole('heading', { name: expected, exact: true })).toBeVisible();
  await expect(
    page.locator('nav').getByRole('link', { name: expected, exact: true })
  ).toBeVisible();
  await expect(page.locator('nav').getByText('&amp;', { exact: false })).toHaveCount(0);
  await expect(page.locator('nav img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__entityExecuted)).toBeUndefined();
});

test('scan selection and camera pages fit mobile portrait without page scrolling', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 240;
          return canvas.captureStream();
        },
      },
    });
  });
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    for (const route of [
      'scan',
      'scan?input=camera',
      'register?input=camera',
      'workflow/move?input=camera',
      'scan?input=manual',
      'register?input=manual',
    ]) {
      await open(page, route);
      if (route.includes('camera')) {
        await expect(page.getByRole('button', { name: 'Stop camera', exact: true })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'QR identifiers' })).toHaveCount(0);
        const content = (await page.locator('qrr-root .content').boundingBox())!;
        const capture = (await page.locator('.scanner-page').boundingBox())!;
        expect(Math.abs(capture.height - content.height), route).toBeLessThanOrEqual(1);
        const frame = (await page.locator('.viewfinder').boundingBox())!;
        expect(Math.abs(frame.width - frame.height), route).toBeLessThanOrEqual(1);
      }
      if (route.includes('manual')) {
        await page
          .getByRole('textbox', { name: 'QR identifiers' })
          .fill(process.env['QRR_E2E_ITEM']!);
        await page.getByRole('button', { name: 'Add codes', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Remove ' + process.env['QRR_E2E_ITEM'], exact: true })
        ).toBeVisible();
      }
      const bounds = await page.locator('qrr-root .content').evaluate(el => ({
        width: el.clientWidth,
        scrollWidth: el.scrollWidth,
        height: el.clientHeight,
        scrollHeight: el.scrollHeight,
      }));
      const context = `${route} at ${size.width} × ${size.height}`;
      expect(bounds.scrollWidth, context).toBeLessThanOrEqual(bounds.width);
      expect(bounds.scrollHeight, context).toBeLessThanOrEqual(bounds.height + 1);
    }
  }
});

test('entered existing serial warns before save and automatic serial uses entered context', async ({
  page,
}) => {
  await open(page, 'create');
  await choose(page, 'QR type', 'Tracked Individual');
  await page
    .getByRole('textbox', { name: 'Item name / label', exact: true })
    .fill('Auto browser tool');
  await page.getByRole('combobox', { name: 'Dolibarr product', exact: true }).fill('Tracked');
  await page.getByRole('option', { name: /SERIAL-004.*Tracked Part/ }).click();
  await choose(page, 'Warehouse', 'MAIN');
  await page
    .getByRole('textbox', { name: 'Dolibarr serial number', exact: true })
    .fill('USER-SERIAL-01');
  await expect(
    page.getByRole('status').filter({ hasText: 'already associated with a QR item' })
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Dolibarr serial number', exact: true }).fill('');
  await expect(
    page.getByText('This serial number is already associated with a QR item.', {
      exact: true,
    })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Auto browser tool', exact: true })).toBeVisible();
  const state = (await (await page.request.get('api.php?resource=bootstrap')).json()).state;
  const item = Object.values(state.items).find(
    (item: any) => item.label === 'Auto browser tool'
  ) as any;
  expect(item.serial).toMatch(/^PART-003-AUTO-BROWSER-TOOL-[A-F0-9]{24}$/);
  expect(item.serial).not.toBe(item.code);
});
