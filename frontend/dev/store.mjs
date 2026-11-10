import {
  createFixture,
  labelFormats,
  locales,
  makeCode,
  scenarios,
  translations,
} from './fixtures.mjs';

export class MockError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const requireValue = (condition, message, status = 400) => {
  if (!condition) throw new MockError(message, status);
};
const pick = (value, keys) =>
  Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]]));
const quantity = (value, minimum = 0) => {
  requireValue(
    Number.isSafeInteger(value) && value >= minimum && value <= 100000000,
    'Invalid quantity'
  );
  return value;
};
const usable = item =>
  item.type !== 'unassigned' &&
  item.status !== 'consumed' &&
  !item.checkout &&
  !item.pending_operation &&
  !item.pending_handoff;

/** UI fixtures only. Production stock rules continue to live in PHP and C#. */
export class MockStore {
  constructor() {
    this.reset();
  }

  reset({ scenario = 'populated', locale = 'en_US', latency = 0 } = {}) {
    requireValue(scenarios.includes(scenario), 'Unknown mock scenario');
    requireValue(locales.includes(locale), 'Unknown locale');
    requireValue(
      Number.isInteger(latency) && latency >= 0 && latency <= 3000,
      'Latency must be between 0 and 3000 ms'
    );
    this.settings = { scenario, locale, latency };
    this.data = createFixture(scenario);
  }

  permissions() {
    const write = this.settings.scenario !== 'read-only';
    return {
      manage: write,
      stock: write,
      admin: write,
      orders: true,
      locations: true,
      users: write,
      references: { salesorder: true, production: write, shipment: write },
    };
  }

  item(code) {
    const item = this.data.state.items[code];
    requireValue(item, 'Unknown QR label', 404);
    return item;
  }

  itemName(item) {
    return (
      item.label ||
      (item.type === 'generic' ? this.data.products[item.product_id]?.label : '') ||
      item.code
    );
  }

  warehouse(id) {
    requireValue(this.data.warehouses[id], 'Unknown warehouse');
    return Number(id);
  }

  location(id, levels = {}) {
    this.warehouse(id);
    const values = {};
    const parts = [];
    for (const level of this.data.levels) {
      const value = levels[level.id];
      if (value === undefined || value === '') continue;
      const text = level.options.length
        ? level.options.find(option => option.id === Number(value))?.value
        : String(value);
      requireValue(text !== undefined && text.length <= 64, 'Invalid location value');
      values[level.id] = value;
      parts.push(text);
    }
    return {
      warehouse_id: Number(id),
      bin: parts.join('-'),
      bin_key: Object.values(values).join('/'),
      bin_values: values,
    };
  }

  read(resource, params) {
    const data = this.data;
    const query = (params.get('q') || '').toLowerCase();
    const matching = rows => rows.filter(row => row.text.toLowerCase().includes(query));
    if (resource === 'bootstrap') {
      const references = this.consumptionReferences();
      const users = this.permissions().users
        ? data.users
        : data.users[8]
          ? { 8: data.users[8] }
          : {};
      return {
        state: this.browserState(users, references),
        products: data.products,
        warehouses: data.warehouses,
        users,
        label_formats: labelFormats,
        consumption_references: references,
        permissions: this.permissions(),
        token: 'local-mock-token',
        csrf: 'local-mock-csrf',
        locale: this.settings.locale,
        translations: translations(this.settings.locale),
      };
    }
    if (resource === 'products')
      return matching(
        Object.entries(data.products).map(([id, product]) => ({
          id: Number(id),
          text: `${product.ref} — ${product.label}`,
        }))
      );
    if (resource === 'orders') return matching(data.orders.map(({ id, text }) => ({ id, text })));
    if (resource === 'references') return matching(data.references[params.get('type')] || []);
    if (resource === 'levels') {
      this.warehouse(params.get('warehouse_id'));
      return data.levels;
    }
    if (resource === 'serial-check') {
      const product = Number(params.get('product_id'));
      const serial = (params.get('serial') || '').toLowerCase();
      const associated = Object.values(data.state.items).some(
        item =>
          item.product_id === product && (item.serial || item.native_batch).toLowerCase() === serial
      );
      return {
        exists:
          associated ||
          data.lots.some(lot => lot.product_id === product && lot.serial.toLowerCase() === serial),
        associated,
      };
    }
    if (resource === 'locations')
      return this.locations(this.warehouse(params.get('warehouse_id')), params.get('bin') || '');
    if (resource === 'picking') {
      const warehouse = this.warehouse(params.get('warehouse_id'));
      const order = data.orders.find(row => row.id === Number(params.get('order_id')));
      requireValue(order, 'Unknown customer order');
      return order.lines.flatMap(line => {
        let remaining = line.qty;
        const rows = [];
        for (const item of Object.values(data.state.items).sort((a, b) =>
          a.bin.localeCompare(b.bin)
        )) {
          if (
            remaining <= 0 ||
            item.product_id !== line.product_id ||
            item.warehouse_id !== warehouse ||
            !usable(item) ||
            item.qty === null
          )
            continue;
          const take = Math.min(remaining, item.qty);
          if (take > 0) rows.push({ ...item, product: data.products[item.product_id], take });
          remaining -= take;
        }
        return rows;
      });
    }
    throw new MockError('Unknown resource', 404);
  }

  browserState(users, references) {
    const state = structuredClone(
      pick(this.data.state, [
        'schema',
        'revision',
        'items',
        'batches',
        'personal_warehouses',
        'binloc_label_settings',
        'pending_native',
      ])
    );
    state.history = [];
    for (const [code, raw] of Object.entries(state.items)) {
      const item = pick(raw, [
        'code',
        'type',
        'label',
        'product_id',
        'warehouse_id',
        'qty',
        'serial',
        'native_batch',
        'product_lot_id',
        'details',
        'created_at',
        'updated_at',
        'status',
        'consumed_units',
        'bin',
        'bin_key',
        'bin_values',
      ]);
      for (const key of ['pending_operation', 'pending_handoff'])
        if (raw[key]) item[key] = pick(raw[key], ['id', 'kind', 'at']);
      if (raw.checkout)
        item.checkout = users[raw.checkout.user_id]
          ? pick(raw.checkout, ['user_id', 'reason', 'at', 'origin_warehouse_id'])
          : {};
      item.consumption_log = (raw.consumption_log || []).map(entry => {
        const log = pick(entry, ['at', 'kind', 'quantity', 'reason', 'stock_posted']);
        if (entry.reference_type && entry.reference_id) {
          if (references[`${entry.reference_type}:${entry.reference_id}`])
            Object.assign(log, pick(entry, ['reference_type', 'reference_id']));
          else log.reason = '';
        }
        return log;
      });
      state.items[code] = item;
    }
    state.personal_warehouses = Object.fromEntries(
      Object.entries(state.personal_warehouses).filter(([id]) => users[id])
    );
    if (state.pending_native)
      state.pending_native = pick(state.pending_native, ['id', 'action', 'at']);
    return state;
  }

  locations(warehouse, bin) {
    const items = Object.values(this.data.state.items).filter(
      item => item.warehouse_id === warehouse && item.type !== 'unassigned'
    );
    const totals = {};
    const qr = {};
    const native = {};
    for (const item of items) {
      qr[item.product_id] ||= { known: 0, unknown: 0 };
      if (item.qty === null) qr[item.product_id].unknown++;
      else qr[item.product_id].known += item.qty;
      native[item.product_id] ||= {};
      native[item.product_id][warehouse] = qr[item.product_id].known;
      if (item.bin !== bin || item.type === 'tracked') continue;
      const row = (totals[item.product_id] ||= {
        product_id: item.product_id,
        product: this.data.products[item.product_id],
        generic: 0,
        box: 0,
        unknown_boxes: 0,
        codes: [],
      });
      row.codes.push(item.code);
      if (item.type === 'box' && item.qty === null) row.unknown_boxes++;
      else row[item.type === 'box' ? 'box' : 'generic'] += item.qty || 0;
    }
    return {
      bins: [...new Set(items.map(item => item.bin).filter(Boolean))].sort(),
      qr,
      native,
      summary: {
        tracked: items
          .filter(item => item.type === 'tracked' && item.bin === bin)
          .map(item => ({ ...item, _product: this.data.products[item.product_id] })),
        totals: Object.values(totals),
      },
    };
  }

  consumptionReferences() {
    const references = {};
    const routes = {
      production: '/mrp/mo_card.php',
      shipment: '/expedition/card.php',
      salesorder: '/commande/card.php',
    };
    for (const item of Object.values(this.data.state.items)) {
      for (const entry of item.consumption_log || []) {
        const type = entry.reference_type;
        if (!this.permissions().manage && type !== 'salesorder') continue;
        const record = this.data.references[type]?.find(row => row.id === entry.reference_id);
        if (record && routes[type])
          references[`${type}:${record.id}`] = {
            type,
            id: record.id,
            ref: record.text,
            url: `${routes[type]}?id=${record.id}`,
          };
      }
    }
    return references;
  }

  fields(payload, code, existing) {
    const type = payload.type || 'generic';
    requireValue(['unassigned', 'generic', 'tracked', 'box'].includes(type), 'Unknown QR type');
    const item = {
      code,
      type,
      label: String(payload.label || '').trim(),
      product_id: Number(payload.product_id || 0),
      qty:
        type === 'box'
          ? payload.qty === null
            ? null
            : quantity(payload.qty)
          : type === 'unassigned'
            ? 0
            : 1,
      serial: String(payload.label_as_serial ? payload.label || '' : payload.serial || '').trim(),
      native_batch: '',
      details: String(payload.details || ''),
      warehouse_id: 0,
      bin: '',
      bin_key: '',
      bin_values: {},
      created_at: existing?.created_at || new Date().toISOString(),
    };
    if (type === 'unassigned') return item;
    requireValue(
      Buffer.byteLength(item.label, 'utf8') <= (type === 'box' ? 100 : 140),
      'Item label is too long'
    );
    if (type === 'box') requireValue(item.label, 'Enter a box name / Dolibarr lot');
    requireValue(this.data.products[item.product_id], 'Choose a product');
    Object.assign(item, this.location(payload.warehouse_id, payload.levels));
    if (existing && payload.keep_legacy)
      Object.assign(item, {
        bin: existing.bin,
        bin_key: existing.bin_key,
        bin_values: existing.bin_values,
      });
    if (type === 'tracked' || type === 'box') {
      if (type === 'tracked')
        requireValue(Buffer.byteLength(item.serial, 'utf8') <= 100, 'Serial number is too long');
      item.serial = type === 'tracked' ? item.serial || `MOCK-SERIAL-${code}` : '';
      item.native_batch = type === 'tracked' ? item.serial : item.label;
      const collision = Object.values(this.data.state.items).some(
        row =>
          row.code !== code &&
          row.product_id === item.product_id &&
          row.native_batch.toLowerCase() === item.native_batch.toLowerCase()
      );
      requireValue(
        !collision,
        'This native lot or serial is already associated with a QR item',
        409
      );
      const nativeLot = this.data.lots.find(
        lot =>
          lot.product_id === item.product_id &&
          lot.serial.toLowerCase() === item.native_batch.toLowerCase()
      );
      item.product_lot_id = existing?.product_lot_id || nativeLot?.id || ++this.data.sequence;
    }
    return item;
  }

  command(action, payload) {
    requireValue(this.permissions().manage, 'Missing Dolibarr permission', 403);
    requireValue(
      !this.data.state.pending_native || ['native-recover', 'native-cancel'].includes(action),
      'Resolve the pending native synchronization first',
      409
    );
    const snapshot = structuredClone(this.data);
    try {
      const result = this.mutate(action, payload);
      this.data.state.revision++;
      this.data.state.history.push({
        at: new Date().toISOString(),
        user_id: 8,
        action,
        revision: this.data.state.revision,
      });
      return result;
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  mutate(action, payload) {
    const state = this.data.state;
    if (action === 'native-recover' || action === 'native-cancel') {
      requireValue(state.pending_native, 'No pending synchronization');
      delete state.pending_native;
      return 'Mock synchronization resolved';
    }
    if (action === 'bulk' || action === 'create') {
      const count = action === 'bulk' ? quantity(payload.count, 1) : 1;
      requireValue(count <= 200, 'Maximum 200 labels per batch');
      const namedItems =
        payload.type === 'box' ||
        (payload.type === 'tracked' &&
          (payload.label_as_serial || Object.hasOwn(payload, 'labels')));
      if (action === 'bulk' && namedItems) {
        requireValue(
          Array.isArray(payload.labels) &&
            payload.labels.length === count &&
            payload.labels.every(label => typeof label === 'string' && label.trim()),
          'Enter one label per individual item.'
        );
      }
      if (action === 'bulk' && payload.type === 'tracked')
        requireValue(
          typeof (payload.serial ?? '') === 'string' &&
            Buffer.byteLength(payload.serial || '', 'utf8') <= 100,
          'Serial prefixes must be at most 100 bytes'
        );
      const codes = [];
      for (let index = 0; index < count; index++) {
        const code = makeCode(++this.data.sequence);
        let fields = payload;
        if (action === 'bulk' && ['tracked', 'box'].includes(payload.type)) {
          const label = namedItems ? String(payload.labels[index]).trim() : payload.label;
          const prefix =
            `${this.data.products[payload.product_id]?.ref}-${payload.serial || label || 'SN'}`
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, '-')
              .slice(0, 60);
          const serial =
            payload.type === 'box' || payload.label_as_serial
              ? String(payload.labels[index]).trim()
              : `${prefix}-${code}`;
          requireValue(
            serial && Buffer.byteLength(serial, 'utf8') <= 100,
            'Invalid or too long serial'
          );
          requireValue(
            !this.data.lots.some(
              lot =>
                lot.product_id === payload.product_id &&
                lot.serial.toLowerCase() === serial.toLowerCase()
            ),
            'A serial number in this batch already exists in Dolibarr: ' + serial
          );
          fields = {
            ...payload,
            serial,
            label,
            label_as_serial: false,
          };
        }
        state.items[code] = this.fields(fields, code);
        codes.push(code);
      }
      if (action === 'create') return codes[0];
      const id = `MOCK-BATCH-${++this.data.sequence}`;
      state.batches[id] = {
        codes,
        type: payload.type || 'generic',
        created_at: new Date().toISOString(),
      };
      return id;
    }
    if (action === 'register') {
      requireValue(
        Array.isArray(payload.codes) && payload.codes.length > 0 && payload.codes.length <= 200,
        'Select QR labels'
      );
      for (const code of payload.codes) {
        const item = this.item(code);
        requireValue(item.type === 'unassigned', 'QR label is already registered', 409);
        state.items[code] = this.fields(payload, code, item);
        if (payload.thumbnail) this.data.thumbnails[code] = payload.thumbnail;
      }
      return { codes: payload.codes, warning: '' };
    }
    if (action === 'update') {
      const item = this.item(payload.code);
      requireValue(
        !item.pending_operation && !item.pending_handoff,
        'Reconcile the pending operation first',
        409
      );
      state.items[payload.code] = {
        ...item,
        ...this.fields(payload, payload.code, item),
        updated_at: new Date().toISOString(),
      };
      return payload.code;
    }
    if (action === 'count') {
      const item = this.item(payload.code);
      requireValue(item.type === 'box', 'Only containers have a count');
      item.qty = quantity(payload.quantity);
      return item.code;
    }
    if (action === 'box-transfer') {
      const source = this.item(payload.from);
      const destination = this.item(payload.to);
      const units = quantity(payload.quantity, 1);
      requireValue(
        source !== destination && source.type === 'box' && destination.type === 'box',
        'Choose two different containers'
      );
      requireValue(
        usable(source) && usable(destination) && source.qty !== null && destination.qty !== null,
        'Both containers must have known, available quantities'
      );
      requireValue(
        source.product_id === destination.product_id &&
          source.warehouse_id === destination.warehouse_id,
        'Containers must have the same product and warehouse'
      );
      requireValue(source.qty >= units, 'Not enough units in source container');
      source.qty -= units;
      destination.qty += units;
      return true;
    }
    if (action === 'mapping') {
      requireValue(this.data.users[payload.user_id], 'Choose an employee');
      if (!payload.warehouse_id) delete state.personal_warehouses[payload.user_id];
      else state.personal_warehouses[payload.user_id] = this.warehouse(payload.warehouse_id);
      return true;
    }
    if (action === 'label-settings') {
      this.warehouse(payload.warehouse_id);
      state.binloc_label_settings[payload.warehouse_id] = { ...payload.format, enabled: true };
      return true;
    }
    if (action === 'reconcile') {
      const item = this.item(payload.code);
      requireValue(item.pending_operation || item.pending_handoff, 'No pending operation');
      delete item.pending_operation;
      delete item.pending_handoff;
      return 'Mock pending operation reconciled';
    }
    if (action === 'workflow') {
      requireValue(
        Array.isArray(payload.codes) && payload.codes.length > 0,
        'Scan at least one QR label'
      );
      return payload.codes.map(code => {
        const snapshot = structuredClone(this.data);
        try {
          this.workflow(this.item(code), payload);
          return { code, ok: true, message: 'Completed' };
        } catch (error) {
          this.data = snapshot;
          return { code, ok: false, message: error.message };
        }
      });
    }
    throw new MockError('Unknown action', 404);
  }

  workflow(item, payload) {
    const kind = payload.kind;
    requireValue(
      ['move', 'consume', 'return', 'correct', 'checkout', 'checkin'].includes(kind),
      'Unknown workflow'
    );
    requireValue(
      item.type !== 'unassigned' && !item.pending_operation && !item.pending_handoff,
      'Item is not available'
    );
    const units = quantity(payload.quantities?.[item.code] ?? 1, kind === 'correct' ? 0 : 1);
    if (kind === 'move') Object.assign(item, this.location(payload.warehouse_id, payload.levels));
    if (kind === 'consume') {
      requireValue(
        !item.checkout && item.qty !== null && item.qty >= units,
        'Insufficient available quantity'
      );
      item.qty -= units;
      item.consumed_units = (item.consumed_units || 0) + units;
      item.status = item.qty ? 'in_stock' : 'consumed';
    }
    if (kind === 'return') {
      requireValue((item.consumed_units || 0) >= units, 'Quantity exceeds consumed units');
      item.qty = (item.qty || 0) + units;
      item.consumed_units -= units;
      item.status = 'in_stock';
      Object.assign(item, this.location(payload.warehouse_id, payload.levels));
    }
    if (kind === 'correct') {
      requireValue(item.type === 'box', 'Only containers support quantity correction');
      item.qty = units;
    }
    if (kind === 'checkout') {
      requireValue(
        usable(item) && this.data.users[payload.person_id],
        'Choose an available item and employee'
      );
      let warehouse = this.data.state.personal_warehouses[payload.person_id];
      if (!warehouse) {
        warehouse = Math.max(...Object.keys(this.data.warehouses).map(Number)) + 1;
        this.data.warehouses[warehouse] = {
          ref: `PERSONAL-${payload.person_id}`,
          label: this.data.users[payload.person_id],
        };
      }
      this.data.state.personal_warehouses[payload.person_id] = warehouse;
      item.checkout = {
        user_id: payload.person_id,
        reason: payload.reason || '',
        at: new Date().toISOString(),
        origin_warehouse_id: item.warehouse_id,
      };
      Object.assign(item, this.location(warehouse));
    }
    if (kind === 'checkin') {
      requireValue(item.checkout, 'Item is not checked out');
      Object.assign(item, this.location(item.checkout.origin_warehouse_id));
      delete item.checkout;
    }
    item.updated_at = new Date().toISOString();
    if (['consume', 'return', 'correct'].includes(kind)) {
      item.consumption_log ||= [];
      item.consumption_log.push({
        at: item.updated_at,
        kind,
        quantity: units,
        reason: payload.reason || '',
        stock_posted: !!item.product_lot_id || !!payload.post_stock,
        reference_type: payload.reference_type || '',
        reference_id: Number(payload.reference_id || 0),
      });
    }
  }
}
