import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, readRecords, recordsCsv, inventoryCsv } from '../src/app/features/csv/csv.ts';

test('CSV accepts BOM, semicolon, escaped quotes and multiline UTF-8 cells', () => {
  assert.deepEqual(parseCsv('\uFEFFtype;label\r\ngeneric;"Étagère; ""A""\nsecond line"\r\n'), [
    ['type', 'label'],
    ['generic', 'Étagère; "A"\nsecond line'],
  ]);
  assert.deepEqual(readRecords('type,label\ntracked,"A, B"\n'), [
    { type: 'tracked', label: 'A, B' },
  ]);
});
test('CSV rejects malformed quotes, unknown or duplicate headers and wrong row sizes', () => {
  for (const input of [
    'type,label\ngeneric,"bad',
    'type,label\ngeneric,"bad"tail',
    'type,type\ngeneric,generic',
    'type,secret\ngeneric,no',
    'label\nname',
    'type,label\ngeneric',
  ])
    assert.throws(() => readRecords(input));
  assert.throws(() => readRecords('type\n' + 'generic\n'.repeat(201)), /200/);
  assert.throws(() => readRecords('type,label\ngeneric,' + 'x'.repeat(1024 * 1024)), /1 MiB/);
});
test('CSV export protects spreadsheet formulas and preserves literal values on import', () => {
  const values = [
    '=HYPERLINK("https://example.invalid")',
    '+cmd',
    '-value',
    '@SUM(1)',
    ' \t=1',
    "'quoted",
    "'=literal",
    'ordinary',
    'a,b\nc',
  ];
  const source = values.map(label => ({ type: 'generic', label }));
  const encoded = recordsCsv(source);
  assert.ok(encoded.includes('"\'=HYPERLINK'));
  assert.deepEqual(
    readRecords(encoded).map(row => row.label),
    values
  );
});
test('inventory export retains identifiers, quantities and structured locations without internal audit data', () => {
  const result = readRecords(
    inventoryCsv(
      [
        {
          code: 'QR-ABC123',
          type: 'box',
          label: 'Parts',
          product_id: 4,
          warehouse_id: 2,
          qty: 0,
          serial: '',
          native_batch: 'Parts',
          bin: 'A-3',
          bin_values: { 1: 'A', 2: '3' },
          status: 'in_stock',
          details: '',
          pending_operation: { id: 'SECRET', kind: 'move' },
        },
      ],
      { 4: { ref: 'PARTS', label: 'Screws' } },
      { 2: { ref: 'MAIN', label: 'Warehouse' } }
    )
  );
  assert.equal(result[0].quantity, '0');
  assert.equal(result[0].lot, 'Parts');
  assert.deepEqual(JSON.parse(result[0].location_values), { 1: 'A', 2: '3' });
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
