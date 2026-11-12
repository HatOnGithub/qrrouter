import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { validCode } from '../src/app/shared/scanner/codes.ts';
import { createMockServer } from './server.mjs';
import { MockStore } from './store.mjs';

const store = new MockStore();
const server = createMockServer(store);
let base;
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
beforeEach(() => store.reset());

const read = async (resource, params = {}) => {
  const response = await fetch(
    `${base}/custom/qrrouter/api.php?${new URLSearchParams({ resource, ...params })}`
  );
  assert.equal(response.status, 200);
  return response.json();
};
const command = (action, payload, tokens = {}) =>
  fetch(`${base}/custom/qrrouter/api.php?action=${action}`, {
    method: 'POST',
    body: new URLSearchParams({
      token: 'local-mock-token',
      qrr_token: 'local-mock-csrf',
      payload: JSON.stringify(payload),
      ...tokens,
    }),
  });

test('parallel mock sessions isolate resets, settings and inventory from each other and manual use', async () => {
  const headers = { 'x-qrr-mock-session': 'isolation-a' };
  const otherHeaders = { 'x-qrr-mock-session': 'isolation-b' };
  const reset = await fetch(`${base}/__mock/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ scenario: 'empty', latency: 17 }),
  });
  assert.equal(reset.status, 200);
  const bootstrap = async sessionHeaders => {
    const response = await fetch(`${base}/custom/qrrouter/api.php?resource=bootstrap`, {
      headers: sessionHeaders,
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const [empty, populated, manual] = await Promise.all([
    bootstrap(headers),
    bootstrap(otherHeaders),
    read('bootstrap'),
  ]);
  assert.equal(Object.keys(empty.state.items).length, 0);
  assert.ok(Object.keys(populated.state.items).length > 0);
  assert.deepEqual(Object.keys(manual.state.items), Object.keys(populated.state.items));
  const settings = async sessionHeaders =>
    (await fetch(`${base}/__mock/state`, { headers: sessionHeaders })).json();
  assert.equal((await settings(headers)).latency, 17);
  assert.equal((await settings(otherHeaders)).latency, 0);
});

test('bootstrap matches the current frontend contract and contains valid sample identifiers', async () => {
  const bootstrap = await read('bootstrap');
  assert.ok(bootstrap.label_formats.some(format => format.id === 'dymo-25x54'));
  assert.ok(bootstrap.permissions.admin);
  assert.equal(bootstrap.consumption_references['production:19'].ref, 'MO-0019');
  assert.ok(Object.values(bootstrap.state.items).some(item => item.product_lot_id));
  assert.ok(Object.values(bootstrap.state.items).some(item => item.qty === null));
  assert.ok(Object.values(bootstrap.state.items).every(item => validCode(item.code)));
  const translated = translations => Object.keys(translations).length > 100;
  assert.ok(translated(bootstrap.translations));
});

test('label creation, serial registration and rejected duplicates preserve state', async () => {
  let response = await command('bulk', { type: 'unassigned', count: 2 });
  assert.equal(response.status, 200);
  const { result: batch } = await response.json();
  const codes = (await read('bootstrap')).state.batches[batch].codes;
  const fields = {
    type: 'tracked',
    label: 'Registered drill',
    product_id: 2,
    warehouse_id: 1,
    qty: 1,
    serial: 'EXISTING-DRILL-01',
    codes: [codes[0]],
  };
  response = await command('register', fields);
  assert.equal(response.status, 200);
  const check = await read('serial-check', { product_id: 2, serial: fields.serial });
  assert.deepEqual(check, { exists: true, associated: true });
  const before = await read('bootstrap');
  assert.equal(before.state.items[codes[0]].product_lot_id, 900);
  response = await command('register', { ...fields, codes: [codes[1]] });
  assert.equal(response.status, 409);
  const after = await read('bootstrap');
  assert.equal(after.state.revision, before.state.revision);
  assert.equal(after.state.items[codes[1]].type, 'unassigned');
});

test('moves, transfers and partial workflow failures return the expected result shapes', async () => {
  const bootstrap = await read('bootstrap');
  const boxes = ['Bolts box A', 'Bolts box B'].map(label =>
    Object.values(bootstrap.state.items).find(item => item.label === label)
  );
  let response = await command('box-transfer', {
    from: boxes[0].code,
    to: boxes[1].code,
    quantity: 2,
  });
  assert.equal(response.status, 200);
  let state = (await read('bootstrap')).state;
  assert.equal(state.items[boxes[0].code].qty, 23);
  assert.equal(state.items[boxes[1].code].qty, 12);
  response = await command('workflow', {
    kind: 'move',
    codes: [boxes[0].code, 'UNKNOWN'],
    warehouse_id: 2,
    levels: { 1: 102, 2: '4' },
  });
  const { result } = await response.json();
  assert.equal(result[0].ok, true);
  assert.equal(result[1].ok, false);
  state = (await read('bootstrap')).state;
  assert.equal(state.items[boxes[0].code].warehouse_id, 2);
  assert.equal(state.items[boxes[0].code].bin, 'B-4');
});

test('checkout and checkin update loans and personal warehouse mappings', async () => {
  const bootstrap = await read('bootstrap');
  const item = Object.values(bootstrap.state.items).find(item => item.label === 'Network cable');
  let response = await command('workflow', {
    kind: 'checkout',
    codes: [item.code],
    person_id: 9,
    reason: 'Service visit',
  });
  assert.equal((await response.json()).result[0].ok, true);
  let state = (await read('bootstrap')).state;
  assert.equal(state.items[item.code].checkout.user_id, 9);
  assert.ok(state.personal_warehouses[9]);
  assert.notEqual(state.personal_warehouses[9], state.personal_warehouses[8]);
  const checkedOut = await read('bootstrap');
  assert.equal(checkedOut.warehouses[state.personal_warehouses[9]].label, 'Taylor Technician');
  response = await command('workflow', { kind: 'checkin', codes: [item.code] });
  assert.equal((await response.json()).result[0].ok, true);
  state = (await read('bootstrap')).state;
  assert.equal(state.items[item.code].warehouse_id, item.warehouse_id);
  assert.equal(state.items[item.code].checkout, undefined);
});

test('lookups, location summaries and picking share the current mock state', async () => {
  assert.equal((await read('products', { q: 'drill' }))[0].id, 2);
  assert.deepEqual(await read('products', { q: 'missing-product' }), []);
  assert.equal((await read('references', { type: 'shipment', q: 'SHP' }))[0].id, 29);
  const locations = await read('locations', { warehouse_id: 1, bin: 'A-1' });
  assert.ok(locations.bins.includes('A-1'));
  assert.ok(locations.summary.tracked[0]._product.ref);
  const picks = await read('picking', { warehouse_id: 1, order_id: 39 });
  assert.ok(picks.some(row => row.product.ref === 'BOLT-M8' && row.take > 0));
});

test('scenarios reset data, enforce read-only access and recover from service errors', async () => {
  for (const scenario of ['empty', 'no-employees', 'read-only', 'pending', 'unavailable']) {
    const reset = await fetch(base + '/__mock/reset', {
      method: 'POST',
      body: JSON.stringify({ scenario, locale: 'nl_NL' }),
    });
    assert.equal(reset.status, 200);
    if (scenario === 'unavailable') {
      assert.equal((await fetch(base + '/custom/qrrouter/api.php?resource=bootstrap')).status, 503);
      continue;
    }
    const bootstrap = await read('bootstrap');
    assert.equal(bootstrap.translations.Inventory, 'Voorraad');
    if (['empty', 'no-employees'].includes(scenario)) assert.deepEqual(bootstrap.users, {});
    if (scenario === 'empty') assert.deepEqual(bootstrap.state.items, {});
    if (scenario === 'read-only')
      assert.equal((await command('bulk', { count: 1, type: 'unassigned' })).status, 403);
    if (scenario === 'pending') {
      assert.ok(bootstrap.state.pending_native);
      assert.equal((await command('native-recover', {})).status, 200);
      assert.equal((await read('bootstrap')).state.pending_native, undefined);
    }
  }
  assert.equal((await fetch(base + '/__mock/reset', { method: 'POST', body: '{}' })).status, 200);
  assert.ok(Object.keys((await read('bootstrap')).state.items).length);
});

test('bad tokens, malformed requests and unsupported endpoints fail without mutations', async () => {
  assert.equal(
    (await command('bulk', { count: 1, type: 'unassigned' }, { token: 'bad' })).status,
    403
  );
  assert.equal((await command('not-an-action', {})).status, 404);
  const malformed = await fetch(base + '/__mock/reset', { method: 'POST', body: '{broken' });
  assert.equal(malformed.status, 400);
  assert.equal((await fetch(base + '/not-a-real-api')).status, 404);
  assert.equal((await read('bootstrap')).state.revision, 0);
});

test('camera controls list current fixtures and generate bounded custom QR payloads', async () => {
  const catalog = await (await fetch(base + '/__mock/camera/items')).json();
  assert.ok(catalog.items.some(item => item.label === 'Workshop drill' && validCode(item.code)));
  const text = 'https://example.test/custom/qrrouter/scan.php?code=' + catalog.items[0].code;
  const response = await fetch(base + '/__mock/camera/qr?' + new URLSearchParams({ text }));
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-type').startsWith('image/svg+xml'));
  assert.ok((await response.text()).includes('<svg'));
  for (const text of ['', 'x'.repeat(1025), 'é'.repeat(513)]) {
    assert.equal(
      (await fetch(base + '/__mock/camera/qr?' + new URLSearchParams({ text }))).status,
      400
    );
  }
  store.reset({ scenario: 'unavailable' });
  assert.ok((await (await fetch(base + '/__mock/camera/items')).json()).items.length);
  store.reset({ scenario: 'empty' });
  assert.deepEqual((await (await fetch(base + '/__mock/camera/items')).json()).items, []);
});

test('generic mock labels follow the product short name until a QR override is supplied', async () => {
  const initial = await read('bootstrap');
  const item = Object.values(initial.state.items).find(
    item => item.type === 'generic' && !item.label
  );
  assert.ok(item, 'The sample inventory includes a generic item without an override');
  const payload = {
    type: 'generic',
    product_id: item.product_id,
    warehouse_id: item.warehouse_id,
    label: 'Bench fasteners',
  };
  const created = await command('create', payload);
  assert.equal(created.status, 200);
  const overrideCode = (await created.json()).result;
  store.data.products[item.product_id].label = 'Updated product short name';
  const catalog = await (await fetch(base + '/__mock/camera/items')).json();
  assert.equal(
    catalog.items.find(row => row.code === item.code).label,
    'Updated product short name'
  );
  assert.equal(catalog.items.find(row => row.code === overrideCode).label, 'Bench fasteners');
  assert.equal((await read('bootstrap')).state.items[item.code].label, '');
  for (const format of ['a4', 'dymo-25x54', 'dymo-32x57', 'dymo-36x89', 'dymo-54x101']) {
    const defaultLabel = await (
      await fetch(`${base}/custom/qrrouter/label.php?code=${item.code}&format=${format}`)
    ).text();
    assert.ok(defaultLabel.includes('<span>Updated product short name</span>'));
    const overrideLabel = await (
      await fetch(`${base}/custom/qrrouter/label.php?code=${overrideCode}&format=${format}`)
    ).text();
    assert.ok(overrideLabel.includes('<span>Bench fasteners</span>'));
    assert.ok(!overrideLabel.includes('Updated product short name'));
  }
  const bins = await (
    await fetch(`${base}/custom/qrrouter/bin_print.php?warehouse_id=${item.warehouse_id}`)
  ).text();
  assert.ok(bins.includes('Updated product short name') && bins.includes('Bench fasteners'));
  assert.equal(
    (await command('update', { ...payload, code: overrideCode, label: '' })).status,
    200
  );
  const cleared = await (
    await fetch(`${base}/custom/qrrouter/label.php?code=${overrideCode}`)
  ).text();
  assert.ok(cleared.includes('<span>Updated product short name</span>'));
});

test('mock bulk individuals keep entered names and generate separate serials for the shared product', async () => {
  const names = ['Workshop pump', 'Spare pump', 'Spare pump'];
  const response = await command('bulk', {
    type: 'tracked',
    product_id: 2,
    warehouse_id: 1,
    labels: names,
    count: names.length,
  });
  assert.equal(response.status, 200);
  const { result: batch } = await response.json();
  const { state } = await read('bootstrap');
  const items = state.batches[batch].codes.map(code => state.items[code]);
  assert.deepEqual(
    items.map(item => item.label),
    names
  );
  assert.equal(new Set(items.map(item => item.serial)).size, names.length);
  assert.ok(
    items.every(
      item =>
        item.product_id === 2 && item.serial !== item.label && item.native_batch === item.serial
    )
  );
});

test('QR images and printable previews stay local and escape labels', async () => {
  const bootstrap = await read('bootstrap');
  const item = Object.values(bootstrap.state.items).find(item => item.type === 'tracked');
  store.data.state.items[item.code].label = '<img src=x onerror=alert(1)>';
  const qr = await fetch(`${base}/custom/qrrouter/qr.php?code=${item.code}`);
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('content-type'), 'image/svg+xml');
  assert.ok((await qr.text()).includes('<svg'));
  const label = await fetch(
    `${base}/custom/qrrouter/label.php?code=${item.code}&format=dymo-25x54`
  );
  const markup = await label.text();
  assert.equal(label.status, 200);
  assert.ok(markup.includes('&lt;img'));
  assert.ok(!markup.includes('<img src=x'));
  assert.ok(markup.includes('<svg'));
});

test('malformed bulk names are rejected without changing state', () => {
  const before = structuredClone(store.data);
  for (const labels of [
    { wrong: 'name' },
    [['nested'], 'B', 'C'],
    [null, 'B', 'C'],
    [' ', 'B', 'C'],
    [],
  ]) {
    assert.throws(
      () =>
        store.command('bulk', {
          type: 'tracked',
          product_id: 2,
          warehouse_id: 1,
          count: 3,
          labels,
        }),
      /Enter one label/
    );
    assert.deepEqual(store.data, before);
  }
});
