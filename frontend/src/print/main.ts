import { details, name, serial, PrintItem, Product, Profile } from './model.js';

interface PrintData {
  items: PrintItem[];
  products: Record<string, Product>;
  warehouses: Record<string, { ref: string }>;
  profiles: Profile[];
  format: string;
  title: string;
  base: string;
  back: string;
  a4: string;
  selection: Record<string, string | number>;
  batch: boolean;
  translations: Record<string, string>;
}
const data: PrintData = JSON.parse(document.getElementById('qrr-print-data')!.textContent!);
const t = (value: string) => data.translations[value] || value;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = '') => {
  const node = document.createElement(tag);
  node.className = css;
  node.textContent = text;
  return node;
};
const link = (title: string, href: string) => {
  const node = element('a', '', t(title));
  node.href = href;
  return node;
};
const profile = data.profiles.find(option => option.id === data.format);
const thermal = data.format !== 'a4';
if (thermal && !profile) throw new Error('Unknown label format');
document.title = t(data.title);
const style = element('style');
style.textContent = profile
  ? `@page{size:${profile.width}mm ${profile.height}mm;margin:0}:root{--label-width:${profile.width}mm;--label-height:${profile.height}mm;--qr-size:${profile.qr}mm;--detail-font:${profile.font}pt;--min-detail-font:${profile.font - 2.5}pt}`
  : '@page{size:A4;margin:7mm}';
document.head.append(style);
document.body.dataset['detailLevel'] = String(profile?.level || 0);
const controls = element('header', 'qrr-print-controls qrr-noprint');
controls.append(element('h1', '', t(thermal ? 'DYMO 550 labels' : data.title)));
if (profile) controls.append(element('p', '', `${profile.height} × ${profile.width} mm`));
controls.append(
  element(
    'p',
    '',
    t(
      'Select your printer and matching label paper in the print dialog. Use landscape orientation, 100% scale, no margins, and turn off headers and footers.'
    )
  )
);
const button = element('button', '', t(thermal ? 'Print DYMO labels' : 'Print / Save as PDF'));
button.id = 'qrr-print';
button.disabled = true;
controls.append(button, link('Back to QR Router', data.back));
if (thermal) controls.append(link('A4 layout', data.a4));
const status = element('p', '', t(data.items.length ? 'Loading QR images…' : 'No labels to print'));
status.id = 'qrr-print-status';
status.setAttribute('role', 'status');
controls.append(status);
const form = element('form', 'qrr-format-selector');
form.method = 'get';
const label = element('label', '', t('Label size'));
label.htmlFor = 'qrr-label-size';
const select = element('select');
select.id = 'qrr-label-size';
select.name = 'format';
for (const option of data.profiles) {
  const choice = element('option', '', `${option.height} × ${option.width} mm`);
  choice.value = option.id;
  choice.selected = option.id === data.format;
  select.append(choice);
}
if (!thermal) {
  const option = element('option', '', 'A4');
  option.value = 'a4';
  option.selected = true;
  select.append(option);
}
form.append(label, select);
for (const [key, value] of Object.entries(data.selection)) {
  const input = element('input');
  input.type = 'hidden';
  input.name = key;
  input.value = String(value);
  form.append(input);
}
const apply = element('button', '', t('Apply size'));
apply.type = 'submit';
form.append(apply);
controls.append(form);
const main = element('main', thermal ? 'qrr-roll' : data.batch ? 'qrr-batch' : '');
const prefixes: Record<string, string> = {
  serial: 'SN',
  ref: 'REF',
  lot: 'Lot',
  warehouse: 'Warehouse',
  bin: 'Bin',
  qty: 'Quantity',
  location: 'Location',
  item: 'Item',
  type: 'Type',
  status: 'Status',
  details: 'Details',
};
for (const item of data.items) {
  const product = data.products[String(item.product_id)] || {};
  const image = element('img');
  image.src = data.base + 'qr.php?' + new URLSearchParams({ code: item.code });
  image.alt = 'QR ' + item.code;
  image.className = 'qrr-print-image';
  image.width = 240;
  image.height = 240;
  const article = element(
    'article',
    thermal ? 'qrr-thermal-label' : 'qrr-qr-label' + (data.batch ? ' qrr-batchlabel' : '')
  );
  if (item.type === 'unassigned') article.classList.add('qrr-label-id-only');
  if (item.code.length > 16) article.classList.add('long-id');
  article.setAttribute('aria-label', t('QR label') + ' ' + item.code);
  if (profile) {
    const qr = element('div', 'qrr-qr-column');
    qr.append(image, element('strong', 'qrr-id-code', item.code));
    const fields = details(
      item,
      product,
      profile,
      data.warehouses[String(item.warehouse_id)]?.ref,
      t
    );
    const content = element('div', 'qrr-label-details');
    content.dataset['detailCount'] = String(fields.length);
    const primary = fields.filter(field => ['name', 'serial', 'ref'].includes(field.kind)).length;
    const notes = fields.some(field => field.kind === 'details');
    content.style.setProperty(
      '--detail-rows',
      String(
        profile.level >= 2
          ? primary + Math.ceil((fields.length - primary - Number(notes)) / 2) + (notes ? 2 : 0)
          : fields.length
      )
    );
    for (const field of fields) {
      const row = element(
        'div',
        'qrr-label-detail ' + field.kind + (field.missing ? ' missing' : '')
      );
      row.dataset['kind'] = field.kind;
      row.title = field.value;
      row.append(
        element(
          'span',
          '',
          (!field.missing && prefixes[field.kind] ? t(prefixes[field.kind]) + ' ' : '') +
            field.value
        )
      );
      content.append(row);
    }
    article.append(qr, content);
  } else {
    const heading = element('header');
    heading.append(
      element(
        'span',
        'qrr-printed-name',
        item.type === 'unassigned' ? item.code : name(item, product) || item.code
      )
    );
    if (item.type !== 'unassigned' && serial(item))
      heading.append(element('small', 'qrr-printed-serial', 'SN ' + serial(item)));
    const qr = element('div');
    qr.append(image);
    article.append(heading, qr);
    if (item.type !== 'unassigned')
      article.append(element('small', 'qrr-printed-code', 'QR ' + item.code));
  }
  main.append(article);
}
document.body.append(controls, main);

function fitDetails(): void {
  const minimum =
    ((parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--min-detail-font')
    ) || 5.5) *
      96) /
    72;
  for (const field of document.querySelectorAll<HTMLElement>('.qrr-label-detail')) {
    const text = field.querySelector<HTMLElement>('span')!;
    text.dataset['original'] ??= text.textContent || '';
    text.textContent = text.dataset['original'];
    text.style.removeProperty('font-size');
    let size = parseFloat(getComputedStyle(text).fontSize);
    const fits = () =>
      text.scrollHeight <= field.clientHeight + 1 && text.scrollWidth <= field.clientWidth + 1;
    while (!fits() && size > minimum) {
      size = Math.max(minimum, size - 0.5);
      text.style.fontSize = `${size}px`;
    }
    if (!fits()) {
      const letters = Array.from(text.textContent || '');
      let low = 0;
      let high = letters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        text.textContent = letters.slice(0, middle).join('') + '…';
        if (fits()) low = middle;
        else high = middle - 1;
      }
      text.textContent = letters.slice(0, low).join('') + '…';
    }
  }
}
const images = [...document.querySelectorAll<HTMLImageElement>('.qrr-print-image')];
void Promise.all(
  images.map(image =>
    image.complete
      ? Promise.resolve(image.naturalWidth > 0)
      : new Promise<boolean>(resolve => {
          image.addEventListener('load', () => resolve(true), { once: true });
          image.addEventListener('error', () => resolve(false), { once: true });
        })
  )
).then(results => {
  fitDetails();
  const okay = results.length > 0 && results.every(Boolean);
  button.disabled = !okay;
  status.textContent = t(
    okay
      ? 'Labels ready. Long details may be shortened; the QR ID is always complete.'
      : results.length
        ? 'QR image failed to load. Refresh before printing.'
        : 'No labels to print'
  );
});
window.addEventListener('beforeprint', fitDetails);
button.addEventListener('click', () => {
  if (!button.disabled) {
    fitDetails();
    window.print();
  }
});
