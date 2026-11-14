import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { details, serial, name } from '../dist/qrrouter/browser/print/model.js';
const profiles = JSON.parse(
  readFileSync(new URL('../../dolibarr/qrrouter/assets/label-profiles.json', import.meta.url))
);
const product = { label: 'Product short name', ref: 'REF-42' };
const item = {
  code: '23456X',
  type: 'tracked',
  label: 'Named item',
  serial: 'SN-42',
  native_batch: 'SN-42',
  bin: 'Shelf A',
  qty: 0,
  details: 'Inspect annually',
  status: 'in_stock',
};
test('all label sizes prioritize short name, serial and product reference', () => {
  let count = 0;
  for (const profile of profiles) {
    const fields = details(item, product, profile, 'MAIN');
    assert.deepEqual(
      fields.slice(0, 3).map(field => field.kind),
      ['name', 'serial', 'ref']
    );
    assert.equal(fields[0].value, 'Named item');
    assert.ok(fields.length >= count);
    count = fields.length;
    assert.ok(fields.length <= profile.detail_limit);
  }
});
test('unassigned labels contain no descriptive text at any size', () => {
  for (const profile of profiles)
    assert.deepEqual(details({ ...item, type: 'unassigned' }, product, profile, 'MAIN'), []);
});

test('permanent item labels omit mutable warehouse and location fields', () => {
  for (const profile of profiles) {
    const fields = details(item, product, profile, 'MAIN');
    assert.ok(fields.every(field => !['warehouse', 'bin', 'location'].includes(field.kind)));
    assert.ok(
      fields.every(field => !field.value.includes('Shelf A') && !field.value.includes('MAIN'))
    );
  }
});
test('names default to Dolibarr and can be overridden without changing the serial', () => {
  assert.equal(name({ ...item, label: '' }, product), product.label);
  assert.equal(name(item, product), item.label);
  assert.equal(serial({ ...item, serial: '', native_batch: 'EXISTING-SERIAL' }), 'EXISTING-SERIAL');
  assert.equal(serial({ type: 'box', native_batch: 'Box A' }), '');
});
test('large labels preserve zero quantity and add notes while small labels omit extras', () => {
  assert.equal(details(item, product, profiles[0]).length, 3);
  const large = details(item, product, profiles.at(-1), 'MAIN');
  assert.equal(large.find(field => field.kind === 'qty').value, '0');
  assert.equal(large.find(field => field.kind === 'details').value, item.details);
});
