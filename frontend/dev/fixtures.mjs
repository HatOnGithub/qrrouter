import { readFileSync } from 'node:fs';

export const scenarios = [
  'populated',
  'empty',
  'no-employees',
  'read-only',
  'history-reader',
  'pending',
  'unavailable',
];
export const locales = ['en_US', 'nl_NL', 'fr_FR'];
const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const moduleRoot = new URL('../../dolibarr/qrrouter/', import.meta.url);

export function makeCode(index) {
  let payload = '';
  for (let digit = 0; digit < 5; digit++) {
    payload = alphabet[index % 31] + payload;
    index = Math.floor(index / 31);
  }
  let check = 0;
  for (const symbol of payload) check = (check * 3 + alphabet.indexOf(symbol) + 1) % 31;
  return payload + alphabet[check];
}

export function translations(locale) {
  const load = language =>
    Object.fromEntries(
      readFileSync(new URL(`langs/${language}/qrrouter.lang`, moduleRoot), 'utf8')
        .split(/\r?\n/)
        .filter(line => line.startsWith('QRRUI_') && line.includes('='))
        .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
    );
  const english = load('en_US');
  const translated = load(locale);
  const result = Object.fromEntries(
    Object.entries(english).map(([key, text]) => [text, translated[key] || text])
  );
  if (locale !== 'en_US') {
    Object.assign(
      result,
      JSON.parse(readFileSync(new URL(`langs/${locale.slice(0, 2)}.spa.json`, moduleRoot), 'utf8'))
    );
  }
  return result;
}

export const labelFormats = JSON.parse(
  readFileSync(new URL('assets/label-profiles.json', moduleRoot), 'utf8')
);
export const barcodeFormats = JSON.parse(
  readFileSync(new URL('assets/barcode-formats.json', moduleRoot), 'utf8')
);

export function createFixture(scenario = 'populated') {
  const at = new Date().toISOString();
  const fixture = {
    sequence: 100,
    state: {
      schema: 2,
      revision: 0,
      items: {},
      batches: {},
      personal_warehouses: { 8: 3 },
      location_label_settings: {},
      history: [],
    },
    products: {
      1: {
        ref: 'BOLT-M8',
        label: 'M8 stainless bolt',
        tags: ['Fasteners', 'Workshop supplies'],
        extrafields: {
          material: { label: 'Material', value: 'Stainless steel' },
          diameter: { label: 'Diameter', value: '8 mm' },
        },
      },
      2: {
        ref: 'DRILL-18V',
        label: 'Cordless drill',
        tags: ['Power tools', 'Maintenance'],
        extrafields: {
          voltage: { label: 'Voltage', value: '18 V' },
          brand: { label: 'Brand', value: 'Makita' },
        },
      },
      3: {
        ref: 'CABLE-CAT6',
        label: 'Network patch cable',
        tags: ['Networking', 'Electrical'],
        extrafields: {
          cable_category: { label: 'Cable category', value: 'Cat6' },
          length: { label: 'Length', value: '2 m' },
        },
      },
    },
    warehouses: {
      1: { ref: 'MAIN', label: 'Main warehouse' },
      2: { ref: 'OTHER', label: 'Workshop' },
      3: { ref: 'PERSONAL-8', label: 'Alex Operator' },
    },
    users: { 8: 'Alex Operator', 9: 'Taylor Technician' },
    levels: [
      {
        id: 1,
        label: 'Aisle',
        datatype: 'list',
        options: [
          { id: 101, value: 'A' },
          { id: 102, value: 'B' },
        ],
      },
      { id: 2, label: 'Shelf', datatype: 'number', options: [] },
    ],
    orders: [
      {
        id: 39,
        text: 'SO-0039 — Example customer',
        lines: [
          { product_id: 1, qty: 12 },
          { product_id: 2, qty: 1 },
        ],
      },
    ],
    references: {
      production: [{ id: 19, text: 'MO-0019' }],
      shipment: [{ id: 29, text: 'SHP-0029' }],
      salesorder: [{ id: 39, text: 'SO-0039' }],
    },
    manufacturing_orders: [
      {
        id: 19,
        text: 'MO-0019',
        lines: [
          { product_id: 1, qty: 6, role: 'toconsume' },
          { product_id: 3, qty: 1, role: 'toconsume' },
          { product_id: 2, qty: 1, role: 'toproduce' },
          { product_id: 1, qty: 2, role: 'consumed' },
        ],
      },
    ],
    // Existing serial available for registration without creating a new lot.
    lots: [{ id: 900, product_id: 2, serial: 'EXISTING-DRILL-01', warehouse_id: 1, qty: 1 }],
    thumbnails: {},
  };
  const add = (index, values) => {
    const code = makeCode(index);
    fixture.state.items[code] = {
      code,
      type: 'generic',
      label: '',
      product_id: 1,
      warehouse_id: 1,
      bin: 'A-1',
      bin_key: '101/1',
      bin_values: { 1: 101, 2: '1' },
      qty: 1,
      serial: '',
      native_batch: '',
      details: '',
      created_at: at,
      ...values,
    };
    return code;
  };
  add(1, {
    type: 'tracked',
    label: 'Workshop drill',
    product_id: 2,
    serial: 'DRILL-001',
    native_batch: 'DRILL-001',
    product_lot_id: 501,
  });
  add(2, {
    type: 'box',
    label: 'Bolts box A',
    qty: 25,
    native_batch: 'Bolts box A',
    product_lot_id: 502,
  });
  add(3, {
    type: 'box',
    label: 'Bolts box B',
    qty: 10,
    native_batch: 'Bolts box B',
    product_lot_id: 503,
  });
  add(4, {
    label: 'Network cable',
    product_id: 3,
    bin: 'B-2',
    bin_key: '102/2',
    bin_values: { 1: 102, 2: '2' },
  });
  add(5, { type: 'box', label: 'Uncounted container', qty: null });
  // No QR-specific override: the UI and print previews follow the product short name.
  add(11, { type: 'generic', product_id: 1, label: '' });
  add(6, {
    label: 'Consumed cable',
    product_id: 3,
    qty: 0,
    status: 'consumed',
    consumed_units: 1,
    consumption_log: [
      {
        at,
        kind: 'consume',
        quantity: 1,
        reason: 'Repair job',
        stock_posted: true,
        reference_type: 'production',
        reference_id: 19,
      },
    ],
  });
  if (scenario !== 'no-employees') {
    add(7, {
      label: 'Loaned cable',
      product_id: 3,
      warehouse_id: 3,
      bin: '',
      bin_key: '',
      bin_values: {},
      checkout: { user_id: 8, reason: 'Site visit', at, origin_warehouse_id: 1 },
    });
  }
  const blanks = [8, 9, 10].map(index =>
    add(index, {
      type: 'unassigned',
      product_id: 0,
      warehouse_id: 0,
      bin: '',
      bin_key: '',
      bin_values: {},
      qty: 0,
    })
  );
  fixture.state.batches['MOCK-BATCH-1'] = { created_at: at, type: 'unassigned', codes: blanks };
  if (scenario === 'pending') {
    fixture.state.pending_native = {
      id: 'mock-sync-1',
      action: 'create',
      at: new Date(Date.now() - 60000).toISOString(),
      changes: {
        [makeCode(99)]: {
          before: null,
          after: {
            ...fixture.state.items[makeCode(4)],
            code: makeCode(99),
            label: 'Pending cable',
            qty: 1,
          },
        },
      },
    };
    fixture.state.items[makeCode(4)].pending_operation = {
      id: 'mock-move-1',
      kind: 'move',
      at,
      patch: { warehouse_id: 2, bin: 'B-02' },
      effects: [
        { warehouse_id: 1, delta: -1 },
        { warehouse_id: 2, delta: 1 },
      ],
    };
  }
  if (scenario === 'empty') {
    fixture.state.items = {};
    fixture.state.batches = {};
    fixture.state.personal_warehouses = {};
    fixture.users = {};
  }
  if (scenario === 'no-employees') {
    fixture.users = {};
    fixture.state.personal_warehouses = {};
  }
  return fixture;
}
