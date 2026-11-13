import type { Item, Product, Warehouse } from '../../core/models/inventory';

export const columns = [
  'code',
  'type',
  'label',
  'product_id',
  'product_ref',
  'product_name',
  'warehouse_id',
  'warehouse_ref',
  'quantity',
  'serial',
  'lot',
  'location',
  'location_values',
  'status',
  'details',
  'import_status',
  'import_message',
] as const;
export type CsvRecord = Partial<Record<(typeof columns)[number], string>>;

// RFC 4180 quoting, with the semicolon delimiter commonly used by European spreadsheets.
export function parseCsv(source: string): string[][] {
  source = source.replace(/^\uFEFF/, '');
  const first = source.split(/\r?\n/, 1)[0];
  const delimiter = first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const field = () => {
    row.push(cell);
    cell = '';
    closed = false;
  };
  const record = () => {
    field();
    if (row.some(value => value !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === delimiter) field();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      record();
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('Invalid CSV quoting');
      cell += char;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length || closed) record();
  return rows;
}

// Protect spreadsheet users while keeping exports reversible, including literal apostrophes.
const safe = (value: string) =>
  /^\s*[=+\-@\t\r\n]/.test(value) || value.startsWith("'") ? "'" + value : value;
const unsafe = (value: string) =>
  value.startsWith("'") && (value[1] === "'" || /^[\s]*[=+\-@\t\r\n]/.test(value.slice(1)))
    ? value.slice(1)
    : value;
export function writeCsv(rows: string[][]): string {
  return (
    '\uFEFF' +
    rows
      .map(row => row.map(value => '"' + safe(value).replace(/"/g, '""') + '"').join(','))
      .join('\r\n') +
    '\r\n'
  );
}
export function readRecords(source: string): CsvRecord[] {
  if (new TextEncoder().encode(source).length > 1024 * 1024)
    throw new Error('CSV files must be at most 1 MiB');
  const [rawHeaders, ...rows] = parseCsv(source);
  if (!rawHeaders) throw new Error('CSV file is empty');
  const headers = rawHeaders.map(value => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV column');
  for (const header of headers)
    if (!(columns as readonly string[]).includes(header))
      throw new Error('Unknown CSV column: ' + header);
  if (!headers.includes('type')) throw new Error('CSV needs a type column');
  if (!rows.length || rows.length > 200) throw new Error('Import between 1 and 200 CSV rows');
  return rows.map((row, index) => {
    if (row.length !== headers.length)
      throw new Error(`Row ${index + 2}: incorrect number of columns`);
    return Object.fromEntries(headers.map((header, i) => [header, unsafe(row[i])])) as CsvRecord;
  });
}
export function recordsCsv(records: CsvRecord[]): string {
  return writeCsv([
    [...columns],
    ...records.map(record => columns.map(column => record[column] || '')),
  ]);
}
export function inventoryRecord(
  item: Item,
  products: Record<string, Product>,
  warehouses: Record<string, Warehouse>
): CsvRecord {
  return {
    code: item.code,
    type: item.type,
    label: item.label,
    product_id: String(item.product_id || ''),
    product_ref: products[item.product_id]?.ref || '',
    product_name: products[item.product_id]?.label || '',
    warehouse_id: String(item.warehouse_id || ''),
    warehouse_ref: warehouses[item.warehouse_id]?.ref || '',
    quantity: item.qty === null ? '' : String(item.qty),
    serial: item.serial,
    lot: item.native_batch,
    location: item.bin,
    location_values: JSON.stringify(item.bin_values || {}),
    status: item.status || '',
    details: item.details,
  };
}
export function inventoryCsv(
  items: Item[],
  products: Record<string, Product>,
  warehouses: Record<string, Warehouse>
): string {
  return recordsCsv(items.map(item => inventoryRecord(item, products, warehouses)));
}

export function downloadCsv(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
