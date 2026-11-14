import { Injectable, inject } from '@angular/core';
import { InventoryService } from '@services/inventory.service';
import { Item, ItemType, Level, Lookup } from '@core/models/inventory';
import { validCode } from '@shared/scanner/codes';
import { CsvRecord } from './csv';

export interface ImportRow {
  line: number;
  source: CsvRecord;
  code: string;
  action: 'create' | 'register' | 'update' | 'skip';
  status: 'ready' | 'unchanged' | 'invalid' | 'done' | 'failed';
  message: string;
  payload: Record<string, unknown>;
}
const requireValue = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const bytes = (value: string) => new TextEncoder().encode(value).length;
const sameLevels = (a: Record<string, string | number>, b: Record<string, string | number>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * Preview/classify CSV rows against a refreshed public snapshot, then apply ordinary gateway
 * commands. Preview is advisory; grants and native constraints are still enforced server-side.
 */
@Injectable()
export class CsvImportService {
  private api = inject(InventoryService);
  private revision = -1;

  async preview(records: CsvRecord[]): Promise<ImportRow[]> {
    await this.api.refresh();
    requireValue(!this.api.error(), this.api.error());
    const context = this.api.context()!;
    requireValue(
      context.permissions.create || context.permissions.modify,
      'Missing Dolibarr permission'
    );
    requireValue(!context.state.pending_native, 'Resolve the pending native synchronization first');
    this.revision = context.state.revision;
    const products = new Map<string, Promise<Lookup[]>>();
    const definitions = new Map<number, Promise<Level[]>>();
    const duplicates = new Set<string>();
    const seenCodes = new Set<string>();
    for (const record of records) {
      const code = record.code?.trim().toUpperCase();
      if (code && seenCodes.has(code)) duplicates.add(code);
      if (code) seenCodes.add(code);
    }
    const nativeIdentities = new Set<string>();
    const rows: ImportRow[] = [];
    for (const [index, source] of records.entries()) {
      const row: ImportRow = {
        line: index + 2,
        source,
        code: source.code?.trim().toUpperCase() || '',
        action: 'skip',
        status: 'invalid',
        message: '',
        payload: {},
      };
      try {
        requireValue(!row.code || validCode(row.code), 'Invalid QR identifier');
        requireValue(!duplicates.has(row.code), 'Duplicate QR identifier in this file');
        const current = row.code ? context.state.items[row.code] : undefined;
        requireValue(
          !row.code || current,
          'QR ID is unknown or inaccessible; leave code blank to create a new QR'
        );
        const type = (source.type?.trim() || current?.type || '') as ItemType;
        requireValue(
          ['unassigned', 'generic', 'tracked', 'box'].includes(type),
          'Type must be unassigned, generic, tracked or box'
        );
        const label = source.label === undefined ? current?.label || '' : source.label.trim();
        const details =
          source.details === undefined ? current?.details || '' : source.details.trim();
        requireValue(
          bytes(label) <= (type === 'box' ? 100 : 140) && bytes(details) <= 2000,
          'Label or details exceed their UTF-8 byte limit'
        );
        requireValue(
          type === 'tracked' || details === '',
          'Details are supported only for tracked individuals'
        );
        if (type === 'unassigned') {
          requireValue(
            !current || current.type === 'unassigned',
            'Assigned items cannot be made unassigned'
          );
          requireValue(
            !label &&
              !details &&
              !source.serial?.trim() &&
              !source.lot?.trim() &&
              !source.product_ref?.trim() &&
              !Number(source.product_id) &&
              !source.warehouse_ref?.trim() &&
              !Number(source.warehouse_id) &&
              !source.location?.trim() &&
              (!source.location_values?.trim() ||
                JSON.stringify(JSON.parse(source.location_values)) === '{}') &&
              (!source.quantity?.trim() || source.quantity.trim() === '0'),
            'Unassigned rows cannot contain inventory data'
          );
          requireValue(
            !source.status?.trim() || source.status.trim() === (current?.status || 'unassigned'),
            'Status is read-only; use the warehouse workflows'
          );
          row.payload = { type: 'unassigned' };
          row.action = current ? 'skip' : 'create';
          row.status = current ? 'unchanged' : 'ready';
          row.message = current ? 'Unchanged' : 'Create a blank QR label';
          rows.push(row);
          continue;
        }
        const reference = source.product_ref?.trim();
        let productId = Number(source.product_id || 0);
        requireValue(Number.isSafeInteger(productId) && productId >= 0, 'Invalid product ID');
        if (reference) {
          if (!products.has(reference))
            products.set(reference, this.api.lookup('products', reference));
          const matches = (await products.get(reference)!).filter(
            product => product.ref === reference && (!productId || product.id === productId)
          );
          requireValue(
            matches.length === 1,
            'Product reference is unknown, inaccessible or ambiguous'
          );
          productId = matches[0].id;
        } else if (!productId && current) productId = current.product_id;
        requireValue(
          productId > 0 && (reference || context.products[productId]),
          'Provide a product reference (and ID if ambiguous)'
        );
        let warehouseId = Number(source.warehouse_id || 0);
        requireValue(Number.isSafeInteger(warehouseId) && warehouseId >= 0, 'Invalid warehouse ID');
        if (source.warehouse_ref?.trim()) {
          const matches = Object.entries(context.warehouses).filter(
            ([id, warehouse]) =>
              warehouse.ref === source.warehouse_ref!.trim() &&
              (!warehouseId || +id === warehouseId)
          );
          requireValue(
            matches.length === 1,
            'Warehouse reference is unknown, inaccessible or ambiguous'
          );
          warehouseId = +matches[0][0];
        } else if (!warehouseId && current) warehouseId = current.warehouse_id;
        const updating = !!current && current.type !== 'unassigned';
        requireValue(
          (warehouseId > 0 && context.warehouses[warehouseId]) ||
            (updating && !current!.warehouse_id && !warehouseId),
          'Choose an accessible warehouse'
        );
        const serial = source.serial === undefined ? current?.serial || '' : source.serial.trim();
        const lot = source.lot === undefined ? current?.native_batch || '' : source.lot.trim();
        const quantity = source.quantity?.trim()
          ? Number(source.quantity)
          : updating
            ? current!.qty
            : type === 'box'
              ? null
              : 1;
        requireValue(
          quantity === null ||
            (Number.isSafeInteger(quantity) && quantity >= 0 && quantity <= 100000000),
          'Quantity must be a nonnegative whole number'
        );
        requireValue(
          updating || type === 'box' || quantity === 1,
          'Individuals and generic QR entries each represent one unit'
        );
        requireValue(
          type !== 'box' || quantity !== null || updating,
          'New containers require a known quantity'
        );
        requireValue(
          type !== 'box' || (label && (!lot || lot === label)),
          'Container label must match its lot name'
        );
        requireValue(type === 'tracked' || !serial, 'Only individuals have serial numbers');
        requireValue(type !== 'generic' || !lot, 'Generic rows cannot contain a lot');
        requireValue(
          type !== 'tracked' || !lot || lot === serial,
          'Individual lot must match its serial; leave both blank for automatic generation'
        );
        requireValue(bytes(serial) <= 100, 'Serial exceeds 100 UTF-8 bytes');
        if (updating) {
          requireValue(
            type === current!.type &&
              productId === current!.product_id &&
              warehouseId === current!.warehouse_id,
            'Use the native workflows to change an assigned item type, product or warehouse'
          );
          requireValue(
            quantity === current!.qty &&
              serial === current!.serial &&
              lot === current!.native_batch,
            'CSV updates cannot change stock quantities or serial/lot identities'
          );
          requireValue(
            type !== 'box' || label === current!.label,
            'Container lot names cannot be renamed through CSV'
          );
        } else if (serial) {
          const availability = await this.api.read<{ exists: boolean; associated: boolean }>(
            'serial-check',
            { product_id: productId, serial }
          );
          requireValue(
            availability.exists && !availability.associated,
            'Serial must already exist and have no QR association; leave serial blank for automatic generation'
          );
        }
        if (source.status?.trim())
          requireValue(
            source.status.trim() === (current?.status || 'in_stock'),
            'Status is read-only; use the warehouse workflows'
          );
        if (
          updating &&
          label === current!.label &&
          details === current!.details &&
          this.unchangedLocation(source, current!)
        ) {
          row.action = 'skip';
          row.status = 'unchanged';
          row.message = 'Unchanged';
          rows.push(row);
          continue;
        }
        let levels = { ...(current?.bin_values || {}) };
        let keepLegacy = !!current?.bin && !Object.keys(levels).length;
        if (source.location_values?.trim() || source.location?.trim()) {
          if (!definitions.has(warehouseId))
            definitions.set(warehouseId, this.api.levels(warehouseId));
          const config = await definitions.get(warehouseId)!;
          const raw = source.location_values?.trim() ? JSON.parse(source.location_values) : {};
          requireValue(
            raw && typeof raw === 'object' && !Array.isArray(raw),
            'location_values must be a JSON object'
          );
          levels = raw;
          keepLegacy = false;
          if (!Object.keys(levels).length && source.location?.trim()) {
            if (
              current &&
              source.location.trim() === current.bin &&
              !Object.keys(current.bin_values).length
            )
              keepLegacy = true;
            else {
              requireValue(
                config.length === 1,
                'Multilevel locations require location_values JSON'
              );
              const level = config[0];
              const option = level.options.find(option => option.value === source.location!.trim());
              levels = {
                [level.id]: ['list', 'letter'].includes(level.datatype)
                  ? (option?.id ?? -1)
                  : source.location.trim(),
              };
            }
          }
          this.validateLevels(levels, config);
        }
        const unchanged =
          updating &&
          label === current!.label &&
          details === current!.details &&
          (keepLegacy || sameLevels(levels, current!.bin_values));
        if (updating && !unchanged)
          requireValue(
            !current!.pending_handoff &&
              !current!.pending_operation &&
              !current!.checkout &&
              current!.status !== 'consumed',
            'Return or reconcile this item before changing it'
          );
        row.payload = {
          type,
          label,
          product_id: productId,
          warehouse_id: warehouseId,
          qty: quantity,
          serial,
          details,
          levels,
          keep_legacy: keepLegacy,
        };
        row.action = unchanged ? 'skip' : updating ? 'update' : current ? 'register' : 'create';
        requireValue(
          row.action === 'skip' || this.api.can(row.action === 'update' ? 'modify' : 'create'),
          'Missing QR Router permission for this row'
        );
        row.status = unchanged ? 'unchanged' : 'ready';
        row.message = unchanged
          ? 'Unchanged'
          : updating
            ? 'Update metadata and location'
            : type === 'tracked' && !serial
              ? 'Create individual with an automatic serial; receives one unit'
              : type === 'box'
                ? 'Create container using its native lot and quantity'
                : serial
                  ? 'Link the existing native serial'
                  : 'Create QR entry';
        if (current) row.payload['code'] = current.code;
        if (row.action === 'register') row.payload['codes'] = [current!.code];
        if (!updating && (serial || type === 'box')) {
          const key = `${productId}:${(serial || label).toLowerCase()}`;
          requireValue(!nativeIdentities.has(key), 'Duplicate serial or container lot in this CSV');
          nativeIdentities.add(key);
        }
      } catch (error) {
        row.status = 'invalid';
        row.message = this.api.message(error);
      }
      rows.push(row);
    }
    return rows;
  }

  private unchangedLocation(source: CsvRecord, current: Item): boolean {
    if (source.location?.trim() && source.location.trim() !== current.bin) return false;
    if (!source.location_values?.trim()) return true;
    const values = JSON.parse(source.location_values);
    return (
      values &&
      typeof values === 'object' &&
      !Array.isArray(values) &&
      sameLevels(values, current.bin_values)
    );
  }

  private validateLevels(values: Record<string, string | number>, levels: Level[]): void {
    requireValue(
      Object.entries(values).every(
        ([id, value]) =>
          levels.some(level => String(level.id) === id) &&
          ['string', 'number'].includes(typeof value)
      ),
      'Unknown or invalid location level'
    );
    let gap = false;
    for (const level of levels) {
      const value = String(values[level.id] ?? '').trim();
      if (!value) {
        gap = true;
        continue;
      }
      requireValue(
        !gap && bytes(value) <= (levels.length === 1 ? 100 : 64) && !/[\p{Cc}<>]/u.test(value),
        'Invalid location value or gap between levels'
      );
      if (['list', 'letter'].includes(level.datatype))
        requireValue(
          level.options.some(option => String(option.id) === value),
          'Unknown location option'
        );
      if (level.datatype === 'number')
        requireValue(Number.isFinite(Number(value)), 'Numeric location required');
    }
  }

  /** Reject a stale preview, preserve completed rows and stop at the first uncertain failure. */
  async apply(
    rows: ImportRow[],
    progress: () => void,
    active: () => boolean = () => true
  ): Promise<void> {
    requireValue(
      !rows.some(row => row.status === 'invalid'),
      'Correct every invalid row before importing'
    );
    await this.api.refresh();
    requireValue(!this.api.error(), this.api.error());
    requireValue(
      this.api.context()!.state.revision === this.revision,
      'Inventory changed; preview the CSV again before importing'
    );
    for (const row of rows) {
      if (!active()) break;
      if (row.status !== 'ready') continue;
      try {
        const result = await this.api.command<string | null | { codes: string[] }>(
          row.action,
          row.payload
        );
        if (typeof result === 'string') row.code = result;
        else if (result && typeof result === 'object') row.code = result.codes[0];
        row.status = 'done';
        row.message = 'Imported';
      } catch (error) {
        row.status = 'failed';
        row.message = this.api.message(error);
        progress();
        break;
      }
      progress();
    }
    await this.api.refresh();
  }
}
