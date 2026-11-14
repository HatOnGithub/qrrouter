import { randomBytes } from 'node:crypto';
import {
  createFixture,
  labelFormats,
  barcodeFormats,
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
  !item.pending_handoff &&
  !item.pending_bin_move;

const pendingChangeDetails = (code, before, after, products, warehouses) => {
  const fields = {
    label: 'Label',
    type: 'Type',
    product_id: 'Product',
    warehouse_id: 'Warehouse',
    qty: 'Quantity',
    serial: 'Serial',
    native_batch: 'Lot / serial',
    status: 'Status',
    bin: 'Location',
  };
  return Object.entries(fields).flatMap(([key, field]) => {
    const values = [before, after].map(item => {
      const value = item?.[key];
      if (key === 'product_id' && value > 0) return products[value]?.ref || String(value);
      if (key === 'warehouse_id' && value > 0) return warehouses[value]?.ref || String(value);
      return value == null || value === '' ? null : String(value);
    });
    return values[0] === values[1] ? [] : [{ code, field, before: values[0], after: values[1] }];
  });
};

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
    this.data.state.physical_bins = {};
  }

  permissions() {
    const write = !['read-only', 'history-reader'].includes(this.settings.scenario);
    return {
      use: true,
      ...Object.fromEntries(
        [
          'create',
          'modify',
          'delete',
          'move',
          'consume',
          'return',
          'adjust',
          'loans',
          'picking',
          'recover',
        ].map(key => [key, write])
      ),
      print: true,
      manage: write,
      stock: write,
      admin: write,
      history: write || this.settings.scenario === 'history-reader',
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
    let gap = false;
    for (const level of this.data.state.location_levels?.[id] || this.data.levels) {
      const value = levels[level.id];
      if (value === undefined || value === '') {
        gap = true;
        continue;
      }
      requireValue(!gap, 'Choose location levels in order, without gaps');
      const text = ['list', 'letter'].includes(level.datatype)
        ? level.options.find(option => option.id === Number(value))?.value
        : String(value);
      requireValue(text !== undefined && text.length <= 64, 'Invalid location value');
      if (level.datatype === 'number')
        requireValue(
          /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value)) &&
            Number.isFinite(Number(value)),
          'Numeric location required'
        );
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
    if (resource === 'print-translations') {
      const locale = params.get('lang') || this.settings.locale;
      requireValue(locales.includes(locale), 'Unsupported print language');
      return translations(locale);
    }
    const data = this.data;
    if (resource === 'history') {
      requireValue(this.permissions().history, 'Operation history permission required', 403);
      const page = Math.max(1, Number(params.get('page')) || 1);
      const q = (params.get('q') || '').toLowerCase();
      const rows = data.state.history
        .map((row, index) => ({
          ...row.summary,
          id: index + 1,
          at: row.at,
          user_id: row.user_id,
          revision: row.revision,
          action: row.action,
        }))
        .filter(
          row =>
            (!params.get('code') || row.codes?.includes(params.get('code'))) &&
            (!params.get('event') ||
              row.action === params.get('event') ||
              row.operation === params.get('event')) &&
            (!Number(params.get('user_id')) || row.user_id === Number(params.get('user_id'))) &&
            (!params.get('from') || Date.parse(row.at) >= Date.parse(params.get('from'))) &&
            (!params.get('to') || Date.parse(row.at) < Date.parse(params.get('to'))) &&
            (!q || JSON.stringify(row).toLowerCase().includes(q))
        )
        .reverse();
      return {
        entries: rows.slice((page - 1) * 50, page * 50),
        total: rows.length,
        page,
        page_size: 50,
      };
    }
    if (resource === 'physical-bins')
      return Object.values(data.state.physical_bins).map(bin => ({
        ...bin,
        qr: 'QRRBIN:1:1:' + bin.id,
        codes: Object.values(data.state.items)
          .filter(item => item.physical_bin_id === bin.id)
          .map(item => item.code),
      }));
    if (resource === 'location-qr') {
      const match = /^QRRLOC:1:1:([1-9][0-9]*):([A-Za-z0-9_-]+)$/.exec(params.get('payload') || '');
      requireValue(match, 'Invalid location QR');
      const levels = JSON.parse(Buffer.from(match[2], 'base64url').toString());
      const location = this.location(Number(match[1]), levels);
      requireValue(location.bin, 'Location has no levels');
      return {
        ...location,
        levels,
        label: location.bin,
        summary: this.locations(Number(match[1]), location.bin).summary,
        updated_at: new Date().toISOString(),
      };
    }
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
        barcode_formats: barcodeFormats,
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
          label: product.label,
          ref: product.ref,
        }))
      );
    if (resource === 'orders') return matching(data.orders.map(({ id, text }) => ({ id, text })));
    if (resource === 'manufacturing-orders') {
      requireValue(
        this.permissions().references.production,
        'Missing manufacturing order permission'
      );
      return matching(data.manufacturing_orders.map(({ id, text }) => ({ id, text })));
    }
    if (resource === 'references') return matching(data.references[params.get('type')] || []);
    if (resource === 'levels') {
      this.warehouse(params.get('warehouse_id'));
      return data.state.location_levels?.[params.get('warehouse_id')] || data.levels;
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
      return this.locations(
        this.warehouse(params.get('warehouse_id')),
        params.get('bin') || '',
        Number(params.get('level_id')),
        params.get('level_value') || ''
      );
    if (resource === 'picking') {
      const warehouse = this.warehouse(params.get('warehouse_id'));
      const type = params.get('order_type') || 'salesorder';
      requireValue(['salesorder', 'production'].includes(type), 'Unsupported picking source');
      requireValue(
        type !== 'production' || this.permissions().references.production,
        'Missing manufacturing order permission'
      );
      const order = (type === 'production' ? data.manufacturing_orders : data.orders).find(
        row => row.id === Number(params.get('order_id'))
      );
      requireValue(order, 'Unknown order');
      const saved = type === 'salesorder' ? data.state.pick_lists?.[order.id] : null;
      if (saved?.status === 'manually_completed') return [];
      const used = new Map();
      if (type === 'salesorder') {
        for (const item of Object.values(data.state.items)) {
          const logs = [...(item.consumption_log || [])];
          if (item.pending_operation?.kind === 'consume')
            logs.push({ ...item.pending_operation, quantity: item.pending_operation.amount });
          for (const log of logs) {
            if (log.reference_type === 'salesorder' && log.reference_id === order.id)
              used.set(item.product_id, (used.get(item.product_id) || 0) + log.quantity);
          }
        }
      }
      const available = Object.values(data.state.items)
        .sort((a, b) => a.bin.localeCompare(b.bin))
        .filter(
          item =>
            usable(item) &&
            item.bin &&
            item.qty !== null &&
            !item.checkout &&
            !item.pending_handoff &&
            !item.pending_operation
        )
        .map(item => ({ item, remaining: item.qty }));
      return (saved?.lines || order.lines)
        .filter(line => type !== 'production' || line.role === 'toconsume')
        .flatMap(line => {
          const deducted = Math.min(line.qty, used.get(line.product_id) || 0);
          used.set(line.product_id, (used.get(line.product_id) || 0) - deducted);
          let remaining = line.qty - deducted;
          const rows = [];
          for (const allocation of available) {
            const item = allocation.item;
            if (
              remaining <= 0 ||
              item.product_id !== line.product_id ||
              item.warehouse_id !== warehouse ||
              !usable(item) ||
              item.qty === null
            )
              continue;
            const take = Math.min(remaining, allocation.remaining);
            if (take > 0) rows.push({ ...item, product: data.products[item.product_id], take });
            remaining -= take;
            allocation.remaining -= take;
          }
          if (remaining > 0)
            rows.push({
              bin: 'NOT ALLOCATED',
              code: '',
              label: '',
              product: data.products[line.product_id],
              take: remaining,
              type: 'missing',
            });
          return rows;
        });
    }
    if (resource === 'pick-lists')
      return Object.values(data.state.pick_lists || {}).map(list => this.pickProgress(list));
    throw new MockError('Unknown resource', 404);
  }

  pickProgress(list) {
    const lines = list.lines.map(line => {
      const picked = Object.values(this.data.state.items)
        .filter(item => item.product_id === line.product_id)
        .flatMap(item => item.consumption_log || [])
        .filter(
          entry =>
            entry.kind === 'consume' &&
            entry.reference_type === 'salesorder' &&
            entry.reference_id === list.order_id
        )
        .reduce((sum, entry) => sum + entry.quantity, 0);
      const manual =
        list.status === 'manually_completed'
          ? list.manual_lines.find(row => row.product_id === line.product_id)?.remaining || 0
          : 0;
      return {
        product_id: line.product_id,
        requested: line.qty,
        picked,
        pending: 0,
        manual,
        remaining: Math.max(0, line.qty - picked - manual),
      };
    });
    const status =
      list.status === 'manually_completed'
        ? list.status
        : lines.every(line => !line.remaining)
          ? 'completed'
          : lines.some(line => line.picked)
            ? 'in_progress'
            : 'open';
    return { ...list, lines, status };
  }

  browserState(users, references) {
    const state = structuredClone(
      pick(this.data.state, [
        'schema',
        'revision',
        'items',
        'batches',
        'personal_warehouses',
        'location_label_settings',
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
        'physical_bin_id',
        'pending_bin_move',
        'bin',
        'bin_key',
        'bin_values',
      ]);
      for (const key of ['pending_operation', 'pending_handoff'])
        if (raw[key]) {
          const pending = raw[key];
          const after = {
            ...raw,
            ...pending.patch,
            ...(pending.to ? { warehouse_id: pending.to } : {}),
          };
          item[key] = {
            ...pick(pending, ['id', 'kind', 'at']),
            details: pendingChangeDetails(
              code,
              raw,
              after,
              this.data.products,
              this.data.warehouses
            ),
          };
          for (const effect of pending.effects || []) {
            if (effect.delta && this.data.warehouses[effect.warehouse_id])
              item[key].details.push({
                code,
                field: 'Stock movement',
                before: null,
                after: `${effect.delta > 0 ? '+' : ''}${effect.delta} (${this.data.warehouses[effect.warehouse_id].ref})`,
              });
          }
        }
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
    if (state.pending_native) {
      const pending = state.pending_native;
      const details = Object.entries(pending.changes || {}).flatMap(([code, change]) =>
        pendingChangeDetails(
          code,
          change.before,
          change.after,
          this.data.products,
          this.data.warehouses
        )
      );
      if (details.length)
        details.push({
          code: '',
          field: 'Native synchronization',
          before: null,
          after: pending.link_existing ? 'Link existing stock' : 'Apply stock changes',
        });
      state.pending_native = { ...pick(pending, ['id', 'action', 'at']), details };
    }
    return state;
  }

  locations(warehouse, bin, levelId = 0, levelValue = '') {
    levelValue = levelValue.trim();
    const level = (this.data.state.location_levels?.[warehouse] || this.data.levels).find(
      level => level.id === levelId
    );
    requireValue(!levelId || level, 'Unknown report location level');
    requireValue(!levelValue || levelId, 'Choose a report location level');
    let label = levelValue;
    if (levelValue && ['list', 'letter'].includes(level.datatype)) {
      const option = level.options.find(option => String(option.id) === levelValue);
      requireValue(option, 'Location option is unavailable');
      label = option.value;
    }
    const matches = item =>
      (!bin || item.bin === bin) &&
      (!levelValue ||
        String(item.bin_values?.[levelId] ?? '')
          .trim()
          .toLowerCase() === levelValue.toLowerCase());
    const items = Object.values(this.data.state.items).filter(
      item =>
        item.warehouse_id === warehouse &&
        item.type !== 'unassigned' &&
        item.status !== 'consumed' &&
        !item.pending_handoff &&
        !item.pending_operation
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
      if (!matches(item) || item.type === 'tracked') continue;
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
      bins: [...new Set([...items.map(item => item.bin).filter(Boolean)])].sort(),
      qr,
      native,
      summary: {
        scope: levelValue ? `${level.label}: ${label}` : '',
        tracked: items
          .filter(item => item.type === 'tracked' && matches(item))
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
      serial: String(payload.serial || '').trim(),
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
      const linkedLot = [...this.data.lots, ...Object.values(this.data.state.items)].find(
        lot =>
          lot.product_id === item.product_id &&
          item.serial &&
          lot.serial?.toLowerCase() === item.serial.toLowerCase()
      );
      const prefix =
        String(this.data.products[item.product_id].serial_prefix || '').trim() || 'SN-';
      if (type === 'tracked' && !existing?.product_lot_id && !linkedLot) {
        requireValue(
          Buffer.byteLength(prefix, 'utf8') <= 76 && !/[\s\p{Cc}<>]/u.test(prefix),
          'Serial prefix must be at most 76 UTF-8 bytes without whitespace or markup'
        );
      }
      item.serial =
        type !== 'tracked'
          ? ''
          : existing?.product_lot_id
            ? existing.serial
            : linkedLot
              ? linkedLot.serial
              : `${prefix}${randomBytes(12).toString('hex').toUpperCase()}`;
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
    const permissions = this.permissions();
    const required =
      {
        create: 'create',
        bulk: 'create',
        register: 'create',
        update: 'modify',
        'delete-unassigned': 'delete',
        count: 'adjust',
        'box-transfer': 'adjust',
        'physical-bin-create': 'create',
        'physical-bin-assign': 'modify',
        'physical-bin-move': 'move',
        'pick-list-save': 'picking',
        'pick-list-complete': 'picking',
        'native-recover': 'recover',
        'native-cancel': 'recover',
        reconcile: 'recover',
        workflow:
          { correct: 'adjust', checkout: 'loans', checkin: 'loans' }[payload.kind] || payload.kind,
      }[action] || 'manage';
    requireValue(permissions.use && permissions[required], 'Missing QR Router permission', 403);
    requireValue(
      !this.data.state.pending_native || ['native-recover', 'native-cancel'].includes(action),
      'Resolve the pending native synchronization first',
      409
    );
    const snapshot = structuredClone(this.data);
    try {
      const result = this.mutate(action, payload);
      if (action === 'workflow' && result.every(row => !row.ok)) return result;
      this.data.state.revision++;
      this.data.state.history.push({
        at: new Date().toISOString(),
        user_id: 8,
        action,
        revision: this.data.state.revision,
        summary: {
          operation:
            action === 'physical-bin-assign'
              ? payload.remove
                ? 'physical-bin-unpack'
                : 'physical-bin-pack'
              : payload.kind || action,
          status: 'Completed',
          codes: [
            ...new Set([
              ...(action === 'workflow'
                ? result.filter(row => row.ok).map(row => row.code)
                : payload.codes || []),
              ...[payload.code, payload.from, payload.to].filter(Boolean),
              ...(action === 'create'
                ? [result]
                : action === 'bulk'
                  ? this.data.state.batches[result]?.codes || []
                  : []),
            ]),
          ],
          reason: payload.reason || '',
          quantity:
            payload.quantity ?? payload.qty ?? Object.values(payload.quantities || {})[0] ?? null,
          source_warehouse_id:
            snapshot.state.items[payload.code || payload.codes?.[0]]?.warehouse_id || 0,
          source_location: snapshot.state.items[payload.code || payload.codes?.[0]]?.bin || '',
          warehouse_id: payload.warehouse_id || 0,
          location:
            result?.bin ||
            (payload.warehouse_id && payload.levels
              ? this.location(payload.warehouse_id, payload.levels).bin
              : ''),
          label: payload.label || '',
          order_id: payload.order_id || 0,
          bin_id: payload.bin_id || '',
          record_id: result?.id || '',
        },
      });
      return result;
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  mutate(action, payload) {
    const state = this.data.state;
    if (action === 'delete-unassigned') {
      const item = this.item(payload.code);
      requireValue(
        item.type === 'unassigned' &&
          !item.product_id &&
          !item.warehouse_id &&
          !item.product_lot_id &&
          !item.serial &&
          !item.native_batch &&
          !item.qty &&
          !item.consumed_units &&
          !item.checkout &&
          !item.pending_operation &&
          !item.pending_handoff,
        'Only unassigned QR codes without inventory or pending operations can be deleted',
        409
      );
      delete state.items[payload.code];
      for (const [id, batch] of Object.entries(state.batches)) {
        batch.codes = batch.codes.filter(code => code !== payload.code);
        if (!batch.codes.length) delete state.batches[id];
      }
      return null;
    }
    if (action === 'physical-bin-create') {
      requireValue(payload.label?.trim(), 'Enter a physical bin name');
      const id = makeCode(6000 + Object.keys(state.physical_bins).length);
      return (state.physical_bins[id] = {
        id,
        label: payload.label.trim(),
        ...this.location(payload.warehouse_id, payload.levels),
      });
    }
    if (action === 'physical-bin-assign') {
      const bin = state.physical_bins[payload.bin_id];
      requireValue(bin, 'Physical bin unavailable');
      for (const code of payload.codes) {
        const item = this.item(code);
        requireValue(
          usable(item) && item.warehouse_id === bin.warehouse_id && item.bin_key === bin.bin_key,
          'Item is unavailable or outside this physical bin location'
        );
        if (payload.remove) {
          requireValue(item.physical_bin_id === bin.id, 'Item is not in the bin');
          delete item.physical_bin_id;
        } else {
          requireValue(
            !item.physical_bin_id || item.physical_bin_id === bin.id,
            'Item is already packed elsewhere'
          );
          item.physical_bin_id = bin.id;
        }
      }
      return true;
    }
    if (action === 'physical-bin-move') {
      const bin = state.physical_bins[payload.bin_id];
      requireValue(bin, 'Physical bin unavailable');
      const members = Object.values(state.items).filter(item => item.physical_bin_id === bin.id);
      requireValue(
        members.every(item => usable(item)),
        'Every packed item must be available'
      );
      const target = this.location(payload.warehouse_id, payload.levels);
      const results = members.map(item => {
        Object.assign(item, target);
        return { code: item.code, ok: true, message: 'Completed' };
      });
      Object.assign(bin, target);
      return { complete: true, results };
    }
    if (action === 'native-recover' || action === 'native-cancel') {
      requireValue(state.pending_native, 'No pending synchronization');
      delete state.pending_native;
      return 'Mock synchronization resolved';
    }
    if (action === 'bulk' || action === 'create') {
      const count = action === 'bulk' ? quantity(payload.count, 1) : 1;
      requireValue(count <= 200, 'Maximum 200 labels per batch');
      const namedItems =
        payload.type === 'box' || (payload.type === 'tracked' && Object.hasOwn(payload, 'labels'));
      if (action === 'bulk' && namedItems) {
        requireValue(
          Array.isArray(payload.labels) &&
            payload.labels.length === count &&
            payload.labels.every(label => typeof label === 'string' && label.trim()),
          'Enter one label per individual item.'
        );
      }
      const codes = [];
      for (let index = 0; index < count; index++) {
        const code = makeCode(++this.data.sequence);
        let fields = payload;
        if (action === 'bulk' && ['tracked', 'box'].includes(payload.type)) {
          const label = namedItems ? String(payload.labels[index]).trim() : payload.label;
          fields = { ...payload, label, serial: '' };
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
    if (action === 'location-configure') {
      this.warehouse(payload.warehouse_id);
      requireValue(
        !Object.values(state.items).some(item => item.pending_operation || item.pending_handoff),
        'Resolve pending stock operations before changing location definitions'
      );
      const old = state.location_levels?.[payload.warehouse_id] || this.data.levels;
      requireValue(
        Array.isArray(payload.names) && payload.names.length > 0 && payload.names.length <= 8,
        'Configure between one and eight location levels'
      );
      requireValue(
        !Object.values(state.items).some(
          item => item.warehouse_id === payload.warehouse_id && item.bin
        ) || payload.names.length >= old.length,
        'Cannot remove location levels while locations are in use'
      );
      const names = payload.names.map(name => String(name).trim());
      requireValue(
        names.every(name => name && Buffer.byteLength(name, 'utf8') <= 64) &&
          new Set(names.map(name => name.toLowerCase())).size === names.length,
        'Location level names must be nonempty and unique'
      );
      requireValue(
        payload.datatypes == null ||
          (Array.isArray(payload.datatypes) && payload.datatypes.length === names.length),
        'Choose one datatype per location level'
      );
      requireValue(
        payload.option_additions == null ||
          (Array.isArray(payload.option_additions) &&
            payload.option_additions.length === names.length),
        'Invalid location option additions'
      );
      const configured = names.map((label, index) => {
        const level = structuredClone(
          old[index] || {
            id: Math.max(...old.map(level => level.id)) + index - old.length + 1,
            datatype: 'text',
            options: [],
          }
        );
        level.label = label;
        const datatype = payload.datatypes?.[index] ?? level.datatype;
        requireValue(
          ['text', 'number', 'letter', 'list'].includes(datatype),
          'Unsupported location datatype'
        );
        if (old[index] && datatype !== level.datatype)
          requireValue(
            !Object.values(state.items).some(
              item =>
                item.warehouse_id === payload.warehouse_id &&
                (String(item.bin_values?.[level.id] ?? '') !== '' ||
                  (item.bin && !Object.keys(item.bin_values || {}).length))
            ),
            'Cannot change the datatype of a level with saved assignments'
          );
        level.datatype = datatype;
        const additions = payload.option_additions?.[index] ?? payload.options?.[level.id] ?? [];
        requireValue(Array.isArray(additions), 'Invalid location option additions');
        if (['list', 'letter'].includes(level.datatype)) {
          if (datatype === 'letter' && !level.options.length) {
            level.options = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (value, index) => ({
              id: index + 1,
              value,
            }));
          }
          for (const raw of additions) {
            let value = String(raw)
              .replace(/<[^>]*>/g, '')
              .trim();
            requireValue(
              value && Buffer.byteLength(value, 'utf8') <= 64,
              'Invalid location option'
            );
            if (datatype === 'letter') {
              requireValue(/^[A-Za-z]+$/.test(value), 'Letter options must contain letters only');
              value = value.toUpperCase();
            }
            if (!level.options.some(option => option.value.toLowerCase() === value.toLowerCase())) {
              level.options.push({
                id: Math.max(0, ...level.options.map(option => option.id)) + 1,
                value,
              });
            }
          }
          if (datatype === 'letter')
            requireValue(
              level.options.every(option => /^[A-Za-z]+$/.test(option.value)),
              'Letter options must contain letters only'
            );
        }
        return level;
      });
      state.location_levels ||= {};
      state.location_levels[payload.warehouse_id] = configured;
      return state.location_levels[payload.warehouse_id];
    }
    if (action === 'label-settings') {
      this.warehouse(payload.warehouse_id);
      state.location_label_settings[payload.warehouse_id] = { ...payload.format, enabled: true };
      return true;
    }
    if (action === 'pick-list-save' || action === 'pick-list-complete') {
      const order = this.data.orders.find(order => order.id === Number(payload.order_id));
      requireValue(order, 'Unknown customer order');
      this.data.state.pick_lists ||= {};
      if (action === 'pick-list-save') {
        this.warehouse(payload.warehouse_id);
        this.data.state.pick_lists[order.id] ||= {
          order_id: order.id,
          warehouse_id: payload.warehouse_id,
          lines: structuredClone(order.lines),
          status: 'open',
          created_at: new Date().toISOString(),
          created_by: 7,
        };
      } else {
        const list = this.data.state.pick_lists[order.id];
        requireValue(list, 'Save the pick list first');
        requireValue(
          ['open', 'in_progress'].includes(this.pickProgress(list).status),
          'Pick list is already complete'
        );
        requireValue(
          payload.reason?.trim() && payload.reason.length <= 200,
          'Enter a reason for manual completion'
        );
        Object.assign(list, {
          status: 'manually_completed',
          completion_reason: payload.reason.trim(),
          completed_at: new Date().toISOString(),
          completed_by: 7,
          manual_lines: this.pickProgress(list).lines,
        });
      }
      return this.pickProgress(this.data.state.pick_lists[order.id]);
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
    if (payload.pick_order_id) {
      requireValue(kind === 'consume', 'Pick lists require consumption');
      const rows = this.read(
        'picking',
        new URLSearchParams({
          order_id: payload.pick_order_id,
          warehouse_id: payload.pick_warehouse_id,
        })
      );
      const limit = rows
        .filter(row => row.code === item.code)
        .reduce((sum, row) => sum + row.take, 0);
      requireValue(
        units <= limit,
        'Item or quantity is outside the remaining pick list; reload the pick list'
      );
      payload = { ...payload, reference_type: 'salesorder', reference_id: payload.pick_order_id };
    }
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
