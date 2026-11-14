import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { barcodeFormats, labelFormats, locales, scenarios, translations } from './fixtures.mjs';
import { MockError, MockStore } from './store.mjs';

const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    symbol => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[symbol]
  );
const appLink = (route = 'inventory', params = {}) =>
  '/#/' + route + '?' + new URLSearchParams(params);
const printCss = readFileSync(new URL('./print.css', import.meta.url), 'utf8');
const barcodeFormat = (id = 'QRCODE', compact = false) => {
  const format = barcodeFormats.find(row => row.id === id);
  if (!format || (compact && !['QRCODE', 'DATAMATRIX'].includes(id)))
    throw new MockError('Unsupported barcode format');
  return format;
};
const barcodeSvg = async (text, symbology = 'QRCODE') => {
  barcodeFormat(symbology);
  if (symbology === 'QRCODE') return QRCode.toString(text, { type: 'svg', margin: 4 });
  return bwipjs.toSVG({
    bcid: { DATAMATRIX: 'datamatrix', C128: 'code128', PDF417: 'pdf417' }[symbology],
    text,
    scale: 3,
    padding: 10,
    backgroundcolor: 'FFFFFF',
    ...(symbology === 'C128' ? { height: 12 } : {}),
  });
};
const page = (title, body, css = '') => `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escape(title)}</title>
    <link rel="stylesheet" href="/__mock/print.css">
    <style>${css}</style>
  </head>
  <body>
    <nav>
      <a href="${appLink()}">QR Router</a>
      <button onclick="window.print()">Print / Save as PDF</button>
    </nav>
    <p class="mock-notice">Local Dolibarr mock — sample data only. Print layouts are previews, not the production PHP renderer.</p>
    <h1>${escape(title)}</h1>
    ${body}
  </body>
</html>`;

async function readBody(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 262144) throw new MockError('Request too large', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function jsonBody(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new MockError('Expected a JSON object');
  }
}

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function printPage(store, url) {
  const params = url.searchParams;
  const locale = params.get('lang') || store.settings.locale;
  const symbology = params.get('symbology') || 'QRCODE';
  const barcode = barcodeFormat(
    symbology,
    url.pathname.endsWith('/bin_print.php') || url.pathname.endsWith('/physical_bin_print.php')
  );
  if (!locales.includes(locale)) throw new MockError('Unsupported print language');
  const words = translations(locale);
  const t = text => words[text] || text;
  const controls = `<form class="qrr-noprint" method="get"><label>${escape(t('Output language'))} <select name="lang">${locales.map(id => `<option value="${id}"${id === locale ? ' selected' : ''}>${{ en_US: 'English', nl_NL: 'Nederlands', fr_FR: 'Français' }[id]}</option>`).join('')}</select></label>${[
    ...params,
  ]
    .filter(([key]) => !['lang', 'symbology'].includes(key))
    .map(([key, value]) => `<input type="hidden" name="${escape(key)}" value="${escape(value)}">`)
    .join('')}<label>${escape(t('Barcode format'))} <select name="symbology">${barcodeFormats
    .filter(
      row =>
        (!url.pathname.endsWith('/bin_print.php') &&
          !url.pathname.endsWith('/physical_bin_print.php')) ||
        ['QRCODE', 'DATAMATRIX'].includes(row.id)
    )
    .map(
      row =>
        `<option value="${row.id}"${row.id === symbology ? ' selected' : ''}>${row.label}</option>`
    )
    .join('')}</select></label><button>${escape(t('Apply language'))}</button></form>`;
  if (url.pathname.endsWith('/physical_bin_print.php')) {
    const bin = store
      .read('physical-bins', new URLSearchParams())
      .find(bin => bin.id === params.get('bin_id'));
    if (!bin) throw new MockError('Unknown physical bin');
    return page(
      'Physical bin label',
      `${controls}<section class="label">${await barcodeSvg(bin.qr, symbology)}<strong>${escape(bin.label)}</strong><small>BIN ${escape(bin.id)}</small></section>`
    );
  }
  if (url.pathname.endsWith('/bin_print.php')) {
    const warehouse = store.warehouse(params.get('warehouse_id'));
    const bin = params.get('bin') || '';
    const level_id = Number(params.get('level_id'));
    const level_value = params.get('level_value') || '';
    const summary = store.locations(warehouse, bin, level_id, level_value).summary;
    const codes = new Set([
      ...summary.tracked.map(item => item.code),
      ...summary.totals.flatMap(row => row.codes),
    ]);
    const items = Object.values(store.data.state.items).filter(item => codes.has(item.code));
    const rows = items
      .map(
        item =>
          `<tr><td>${escape(item.bin)}</td><td>${escape(store.itemName(item))}</td><td>${escape(store.data.products[item.product_id]?.ref)}</td><td>${escape(item.code)}</td><td>${escape(item.qty ?? '?')}</td></tr>`
      )
      .join('');
    const example = items.find(item => item.bin_values && Object.keys(item.bin_values).length);
    const values = example?.bin_values;
    const payload = values
      ? `QRRLOC:1:1:${warehouse}:${Buffer.from(JSON.stringify(values)).toString('base64url')}`
      : '';
    const label = payload
      ? `<div class="qrr-location-label">${await barcodeSvg(payload, symbology)}<strong>${escape(bin)}</strong></div>`
      : '';
    return page(
      'Bin content sheets',
      `${controls}${label}<h1>${escape(summary.scope || bin || t('Warehouse inventory'))}</h1><p><a href="${escape(appLink('locations', { warehouse_id: warehouse, bin, level_id, level_value }))}">${escape(t('Back to bins'))}</a></p><table><thead><tr>${['Bin', 'Item', 'Product', 'QR', 'Quantity'].map(text => `<th>${escape(t(text))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
    );
  }
  const batch = params.get('batch');
  const codes = url.pathname.endsWith('/batch_print.php')
    ? store.data.state.batches[batch]?.codes
    : [params.get('code')];
  if (!codes) throw new MockError('Unknown batch', 404);
  const format = params.get('format') || 'a4';
  const profile = labelFormats.find(row => row.id === format);
  if (format !== 'a4' && !profile) throw new MockError('Unknown label format');
  const labels = await Promise.all(
    codes.map(async code => {
      const item = store.item(code);
      const qr = await barcodeSvg(code, symbology);
      const product = store.data.products[item.product_id];
      const details =
        item.type === 'unassigned'
          ? ''
          : `<span>${escape(store.itemName(item))}</span><small>${escape(item.serial || item.native_batch)}</small><small>${escape(product?.ref)}</small>`;
      return `<section class="label">${qr}<div><strong>${escape(code)}</strong>${details}</div></section>`;
    })
  );
  const css = profile
    ? `@media print{@page{size:${profile.width}mm ${profile.height}mm;margin:0}html,body{width:${profile.width}mm;margin:0;padding:0}h1{display:none}.label{display:flex;box-sizing:border-box;width:${profile.width}mm;height:${profile.height}mm;overflow:hidden;margin:0;padding:1mm;gap:1mm;break-after:page}.label:last-child{break-after:auto}.label svg{flex:0 0 ${profile.qr}mm;width:${profile.qr}mm;height:${profile.qr}mm}.label>div{min-width:0;max-height:100%;overflow:hidden}.label strong{font-size:10pt}.label span,.label small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:7pt}}`
    : '';
  return page(
    t(batch ? 'Printable QR batch' : 'Print QR label'),
    controls + labels.join(''),
    css +
      (barcode.layout === 'linear'
        ? '.label{display:flex;flex-direction:column-reverse}.label svg{width:100%;height:12mm;flex:none}'
        : '')
  );
}

export function createMockServer(defaultStore = new MockStore()) {
  const sessions = new Map();
  return createServer(async (request, response) => {
    try {
      // Browser tests share the HTTP server, but never inventory or settings.
      const session = request.headers['x-qrr-mock-session'];
      if (session && !sessions.has(session)) sessions.set(session, new MockStore());
      const store = session ? sessions.get(session) : defaultStore;
      const url = new URL(request.url, 'http://127.0.0.1');
      const method = request.method;
      if (!['GET', 'POST'].includes(method)) throw new MockError('Unsupported method', 405);
      // The development controls and fixtures never forward requests to an ERP server.
      if (method === 'POST' && request.headers['sec-fetch-site'] === 'cross-site')
        throw new MockError('Cross-site mock mutation rejected', 403);
      if (url.pathname === '/__mock/state' && method === 'GET') {
        send(response, 200, { ...store.settings, scenarios, locales });
        return;
      }
      if (url.pathname === '/__mock/reset' && method === 'POST') {
        store.reset(jsonBody(await readBody(request)));
        send(response, 200, store.settings);
        return;
      }
      if (url.pathname === '/__mock/health' && method === 'GET') {
        send(response, 200, { mock: true, ready: true });
        return;
      }
      if (url.pathname === '/__mock/camera/items' && method === 'GET') {
        send(response, 200, {
          items: Object.values(store.data.state.items).map(item => ({
            code: item.code,
            label: item.type === 'unassigned' ? '' : store.itemName(item),
            type: item.type,
          })),
        });
        return;
      }
      if (url.pathname === '/__mock/camera/qr' && method === 'GET') {
        const text = url.searchParams.get('text') || '';
        if (!text.trim() || Buffer.byteLength(text, 'utf8') > 1024)
          throw new MockError('QR content must contain between 1 and 1024 UTF-8 bytes.');
        send(
          response,
          200,
          await barcodeSvg(text, url.searchParams.get('symbology') || 'QRCODE'),
          'image/svg+xml'
        );
        return;
      }
      if (url.pathname === '/__mock/print.css' && method === 'GET') {
        send(response, 200, printCss, 'text/css; charset=utf-8');
        return;
      }
      if (url.pathname === '/custom/qrrouter/api.php') {
        if (store.settings.latency)
          await new Promise(resolve => setTimeout(resolve, store.settings.latency));
        if (store.settings.scenario === 'unavailable')
          throw new MockError(
            'Mock Dolibarr service unavailable. Choose another scenario in the local toolbar.',
            503
          );
        if (method === 'GET')
          send(response, 200, store.read(url.searchParams.get('resource'), url.searchParams));
        else {
          const form = new URLSearchParams(await readBody(request));
          if (
            form.get('token') !== 'local-mock-token' ||
            form.get('qrr_token') !== 'local-mock-csrf'
          )
            throw new MockError('Invalid or expired form token', 403);
          send(response, 200, {
            result: store.command(
              url.searchParams.get('action'),
              jsonBody(form.get('payload') || '')
            ),
          });
        }
        return;
      }
      if (
        method === 'GET' &&
        ['/custom/qrrouter/qr.php', '/custom/qrrouter/barcode.php'].includes(url.pathname)
      ) {
        const payload = url.searchParams.get('location');
        const bin = url.searchParams.get('physical_bin');
        const symbology = url.searchParams.get('symbology') || 'QRCODE';
        barcodeFormat(symbology, !!payload || !!bin);
        let code;
        if (payload) {
          store.read('location-qr', new URLSearchParams({ payload }));
          code = payload;
        } else if (bin) {
          code = store.read('physical-bins', new URLSearchParams()).find(row => row.id === bin)?.qr;
          if (!code) throw new MockError('Unknown physical bin');
        } else code = store.item(url.searchParams.get('code')).code;
        send(response, 200, await barcodeSvg(code, symbology), 'image/svg+xml');
        return;
      }
      if (method === 'GET' && url.pathname === '/custom/qrrouter/thumbnail.php') {
        const item = store.item(url.searchParams.get('code'));
        const thumbnail = store.data.thumbnails[item.code];
        const match =
          typeof thumbnail === 'string' &&
          /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(thumbnail);
        if (!match) throw new MockError('No thumbnail', 404);
        send(response, 200, Buffer.from(match[1], 'base64'), 'image/jpeg');
        return;
      }
      if (
        method === 'GET' &&
        [
          '/custom/qrrouter/label.php',
          '/custom/qrrouter/batch_print.php',
          '/custom/qrrouter/bin_print.php',
          '/custom/qrrouter/physical_bin_print.php',
        ].includes(url.pathname)
      ) {
        if (!store.permissions().print)
          throw new MockError('Missing QR Router print permission', 403);
        send(response, 200, await printPage(store, url), 'text/html; charset=utf-8');
        return;
      }
      if (method === 'GET' && url.pathname === '/product/card.php') {
        const product = store.data.products[url.searchParams.get('id')];
        if (!product) throw new MockError('Unknown product', 404);
        send(
          response,
          200,
          page(
            product.ref,
            `<p>${escape(product.label)}</p><p>Native Dolibarr product card placeholder.</p>`
          ),
          'text/html; charset=utf-8'
        );
        return;
      }
      if (method === 'GET' && url.pathname === '/custom/qrrouter/index.php') {
        response.writeHead(302, { Location: appLink() });
        response.end();
        return;
      }
      const referenceType = {
        '/mrp/mo_card.php': 'production',
        '/expedition/card.php': 'shipment',
        '/commande/card.php': 'salesorder',
      }[url.pathname];
      if (method === 'GET' && referenceType) {
        const record = store.data.references[referenceType]?.find(
          row => row.id === Number(url.searchParams.get('id'))
        );
        if (!record || (!store.permissions().manage && referenceType !== 'salesorder'))
          throw new MockError('Native reference inaccessible', 404);
        send(
          response,
          200,
          page(record.text, '<p>Native Dolibarr reference preview in the local mock.</p>'),
          'text/html; charset=utf-8'
        );
        return;
      }
      if (
        method === 'GET' &&
        [
          '/user/card.php',
          '/product/stock/card.php',
          '/product/stock/productlot_card.php',
        ].includes(url.pathname)
      ) {
        const id = Number(url.searchParams.get('id'));
        const title =
          url.pathname === '/user/card.php'
            ? store.data.users[id]
            : url.pathname === '/product/stock/card.php'
              ? store.data.warehouses[id]?.ref
              : Object.values(store.data.state.items).find(item => item.product_lot_id === id)
                  ?.native_batch;
        if (!title) throw new MockError('Native object not found', 404);
        send(
          response,
          200,
          page(title, '<p>Native Dolibarr object preview in the local mock.</p>'),
          'text/html; charset=utf-8'
        );
        return;
      }
      throw new MockError('Unknown mock endpoint', 404);
    } catch (error) {
      if (!(error instanceof MockError)) console.error(error);
      send(response, error instanceof MockError ? error.status : 500, {
        message:
          error instanceof MockError ? error.message : 'Mock server error; see the terminal.',
      });
    }
  });
}

export async function listenMock(port = 8089) {
  const server = createMockServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const server = await listenMock(Number(process.env.QRR_MOCK_PORT || 8089));
    console.log(`Local Dolibarr mock: http://127.0.0.1:${server.address().port}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  } catch (error) {
    console.error(`Cannot start the Dolibarr mock: ${error.message}`);
    process.exitCode = 1;
  }
}
