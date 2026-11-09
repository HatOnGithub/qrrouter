export type ItemType = 'unassigned' | 'tracked' | 'generic' | 'box';
export interface Loan {
  user_id: number;
  reason: string;
  at: string;
  origin_warehouse_id: number;
}
export interface Pending {
  id: string;
  kind: string;
  at: string;
}
export interface Item {
  code: string;
  type: ItemType;
  label: string;
  product_id: number;
  warehouse_id: number;
  bin: string;
  bin_key: string;
  bin_values: Record<string, string | number>;
  qty: number | null;
  status?: string;
  consumed_units?: number;
  serial: string;
  native_batch: string;
  product_lot_id?: number;
  details: string;
  created_at: string;
  updated_at?: string;
  checkout?: Loan;
  pending_operation?: Pending;
  pending_handoff?: Pending;
  consumption_log?: {
    at: string;
    kind: string;
    quantity: number;
    reason: string;
    stock_posted: boolean;
  }[];
}
export interface Batch {
  created_at: string;
  codes: string[];
  type: ItemType;
}
export interface LabelSettings {
  enabled: boolean;
  show: Record<string, number>;
  separator: Record<string, string>;
  show_warehouse: boolean;
}
export interface InventoryState {
  pending_native?: { id: string; action: string; at: string };
  schema: number;
  revision: number;
  items: Record<string, Item>;
  batches: Record<string, Batch>;
  personal_warehouses: Record<string, number>;
  binloc_label_settings?: Record<string, LabelSettings>;
  history: { at: string; user_id: number; action: string; revision: number }[];
}
export interface Warehouse {
  ref: string;
  label: string;
}
export interface Product {
  ref: string;
  label: string;
}
export interface Lookup {
  id: number;
  text: string;
}
export interface Level {
  id: number;
  label: string;
  datatype: string;
  options: { id: number; value: string }[];
}
export interface Bootstrap {
  label_formats: { id: string; width: number; height: number; level: number }[];
  state: InventoryState;
  warehouses: Record<string, Warehouse>;
  users: Record<string, string>;
  products: Record<string, Product>;
  permissions: { manage: boolean; stock: boolean; admin: boolean; orders: boolean };
  csrf: string;
  token: string;
  locale: string;
  translations: Record<string, string>;
}
export interface OperationResult {
  code: string;
  ok: boolean;
  message: string;
}
export interface PickRow {
  bin: string;
  code: string;
  label: string;
  product: Product;
  take: number;
  type: string;
}
export interface BinSummary {
  tracked: (Item & { _product: Product })[];
  totals: {
    product_id: number;
    product: Product;
    generic: number;
    box: number;
    unknown_boxes: number;
    codes: string[];
  }[];
}
export function available(item: Item): boolean {
  return (
    item.type !== 'unassigned' &&
    item.status !== 'consumed' &&
    !item.checkout &&
    !item.pending_handoff &&
    !item.pending_operation
  );
}
