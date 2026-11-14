/** Public PHP projection only; private service snapshots, native proofs and patches stay server-side. */
export type ItemType = 'unassigned' | 'tracked' | 'generic' | 'box';
export interface Loan {
  user_id?: number;
  reason?: string;
  at?: string;
  origin_warehouse_id?: number;
}
/** Original requested values, not confirmation of native commit or a command to replay. */
export interface PendingDetail {
  code: string;
  field: string;
  before: string | null;
  after: string | null;
}
export interface Pending {
  id: string;
  kind: string;
  at: string;
  details?: PendingDetail[];
}
export interface ConsumptionEntry {
  at: string;
  kind: string;
  quantity: number;
  reason: string;
  stock_posted: boolean;
  reference_type?: string;
  reference_id?: number;
  inventorycode?: string;
}
export interface ConsumptionReference {
  type: string;
  id: number;
  ref: string;
  url: string;
}
export interface Item {
  physical_bin_id?: string;
  pending_bin_move?: string;
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
  consumption_log?: ConsumptionEntry[];
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
/** Normal bootstrap leaves history empty; operation screens query the permission-checked page API. */
export interface InventoryState {
  pending_native?: { id: string; action: string; at: string; details?: PendingDetail[] };
  schema: number;
  revision: number;
  items: Record<string, Item>;
  batches: Record<string, Batch>;
  personal_warehouses: Record<string, number>;
  location_label_settings?: Record<string, LabelSettings>;
  history: { at: string; user_id: number; action: string; revision: number }[];
}
export interface Warehouse {
  ref: string;
  label: string;
}
export interface Product {
  ref: string;
  label: string;
  serial_prefix?: string;
  tags?: string[];
  extrafields?: Record<string, { label: string; value: string }>;
}
export interface Lookup {
  id: number;
  text: string;
  label?: string;
  ref?: string;
}
export interface Level {
  id: number;
  label: string;
  datatype: string;
  options: { id: number; value: string }[];
}
export interface Bootstrap {
  consumption_references?: Record<string, ConsumptionReference>;
  label_formats: { id: string; width: number; height: number; level: number }[];
  barcode_formats: { id: string; label: string; layout: 'matrix' | 'linear' }[];
  state: InventoryState;
  warehouses: Record<string, Warehouse>;
  users: Record<string, string>;
  products: Record<string, Product>;
  permissions: {
    use: boolean;
    create: boolean;
    modify: boolean;
    delete: boolean;
    move: boolean;
    consume: boolean;
    return: boolean;
    adjust: boolean;
    loans: boolean;
    picking: boolean;
    print: boolean;
    recover: boolean;
    manage: boolean;
    stock: boolean;
    admin: boolean;
    history: boolean;
    orders: boolean;
    locations?: boolean;
    users?: boolean;
    references?: { salesorder: boolean; production: boolean; shipment: boolean };
  };
  csrf: string;
  token: string;
  locale: string;
  translations: Record<string, string>;
  location_import_available?: boolean;
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
export interface PickList {
  order_id: number;
  warehouse_id: number;
  status: 'open' | 'in_progress' | 'completed' | 'manually_completed';
  created_at: string;
  created_by: number;
  completed_at?: string;
  completed_by?: number;
  completion_reason?: string;
  lines: {
    product_id: number;
    requested: number;
    picked: number;
    pending: number;
    manual: number;
    remaining: number;
  }[];
}
export interface BinSummary {
  scope?: string;
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
export interface LocationScan {
  pending_count?: number;
  warehouse_id: number;
  levels: Record<string, string | number>;
  bin: string;
  label: string;
  summary: BinSummary;
  updated_at: string;
}
export interface PhysicalBin {
  id: string;
  label: string;
  warehouse_id: number;
  bin: string;
  bin_key: string;
  bin_values: Record<string, string | number>;
  codes: string[];
  qr: string;
  pending_move?: {
    target: { warehouse_id: number; bin: string; bin_values: Record<string, string | number> };
    codes: string[];
  };
}
export interface ActionEntry {
  source_warehouse_id: number;
  source_location: string;
  id: number;
  at: string;
  user_id: number;
  revision: number;
  action: string;
  operation: string;
  status: string;
  codes: string[];
  reason: string;
  quantity: number | null;
  warehouse_id: number;
  location: string;
  label: string;
  order_id: number;
  bin_id: string;
  record_id: string;
}
export interface ActionHistoryPage {
  entries: ActionEntry[];
  total: number;
  page: number;
  page_size: number;
}
export function available(item: Item): boolean {
  return (
    item.type !== 'unassigned' &&
    item.status !== 'consumed' &&
    !item.checkout &&
    !item.pending_handoff &&
    !item.pending_operation &&
    !item.pending_bin_move
  );
}
