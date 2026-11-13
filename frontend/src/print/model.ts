export interface PrintItem {
  code: string;
  type: string;
  label?: string;
  serial?: string;
  native_batch?: string;
  product_id?: number;
  warehouse_id?: number;
  bin?: string;
  qty?: number | null;
  details?: string;
  checkout?: unknown;
  status?: string;
}
export interface Product {
  label?: string;
  ref?: string;
}
export interface Profile {
  id: string;
  width: number;
  height: number;
  level: number;
  detail_limit: number;
  qr: number;
  font: number;
}
export interface Detail {
  kind: string;
  value: string;
  missing: boolean;
}
export type Translate = (value: string) => string;
export const serial = (item: PrintItem): string =>
  item.serial?.trim() || (item.type === 'tracked' ? item.native_batch?.trim() || '' : '');
export const name = (item: PrintItem, product: Product): string =>
  item.label?.trim() || product.label?.trim() || '';

export function details(
  item: PrintItem,
  product: Product,
  profile: Profile,
  warehouse = '',
  t: Translate = value => value
): Detail[] {
  if (item.type === 'unassigned') return [];
  const result: Detail[] = [];
  const add = (kind: string, value: unknown, missing = false) => {
    const text = String(value ?? '').trim();
    if (text) result.push({ kind, value: text, missing });
  };
  add('name', name(item, product));
  add('serial', serial(item));
  add('ref', product.ref);
  if (result.length < 2 && !name(item, product)) add('name', t('Product not assigned'), true);
  if (result.length < 2) add('ref', t('Reference not assigned'), true);
  if (profile.level >= 1) {
    if (item.native_batch !== serial(item)) add('lot', item.native_batch);
    if (profile.level === 1) add('location', [warehouse, item.bin].filter(Boolean).join(' / '));
    else {
      add('warehouse', warehouse);
      add('bin', item.bin);
    }
    if (item.qty !== null && item.qty !== undefined) add('qty', item.qty);
  }
  if (profile.level >= 2 && product.label?.trim() !== name(item, product))
    add('item', product.label);
  if (profile.level >= 3) {
    add(
      'type',
      t(
        (
          {
            tracked: 'Tracked Individual',
            generic: 'Tracked Generic',
            box: 'Counted Container',
          } as Record<string, string>
        )[item.type] || ''
      )
    );
    add(
      'status',
      t(item.checkout ? 'On loan' : item.status === 'consumed' ? 'Consumed' : 'In stock')
    );
    add('details', item.details);
  }
  return result.slice(0, profile.detail_limit);
}
