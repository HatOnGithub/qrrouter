import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { labelFormats, locales, scenarios } from './fixtures.mjs';
import { MockError, MockStore } from './store.mjs';

const escape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    symbol => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[symbol]
  );
const appLink = (route = 'inventory', params = {}) =>
  '/#/' + route + '?' + new URLSearchParams(params);
const printCss = readFileSync(new URL('./print.css', import.meta.url), 'utf8');
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
  if (url.pathname.endsWith('/bin_print.php')) {
    const warehouse = store.warehouse(params.get('warehouse_id'));
    const bin = params.get('bin') || '';
    const items = Object.values(store.data.state.items).filter(
      item => item.warehouse_id === warehouse && (!bin || item.bin === bin)
    );
    const rows = items
      .map(
        item =>
          `<tr><td>${escape(item.bin)}</td><td>${escape(item.label || item.code)}</td><td>${escape(store.data.products[item.product_id]?.ref)}</td><td>${escape(item.code)}</td><td>${escape(item.qty ?? '?')}</td></tr>`
      )
      .join('');
    return page(
      'Bin content sheets',
      `<p><a href="${escape(appLink('locations', { warehouse_id: warehouse, bin }))}">Back to bins</a></p><table><thead><tr><th>Bin</th><th>Item</th><th>Product</th><th>QR</th><th>Quantity</th></tr></thead><tbody>${rows}</tbody></table>`
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
      const qr = await QRCode.toString(code, { type: 'svg', margin: 2 });
      const product = store.data.products[item.product_id];
      const details =
        item.type === 'unassigned'
          ? ''
          : `<span>${escape(item.label)}</span><small>${escape(item.serial || item.native_batch)}</small><small>${escape(product?.ref)} ${escape(product?.label)}</small>`;
      return `<section class="label">${qr}<div><strong>${escape(code)}</strong>${details}</div></section>`;
    })
  );
  const css = profile
    ? `@media print{@page{size:${profile.width}mm ${profile.height}mm;margin:0}h1{display:none}.label{box-sizing:border-box;width:${profile.width}mm;height:${profile.height}mm;margin:0;break-after:page}.label svg{width:${Math.min(profile.height - 4, 25)}mm;height:auto}.label strong{font-size:10pt}.label small{font-size:7pt}}`
    : '';
  return page(batch ? 'QR label batch' : 'QR label', labels.join(''), css);
}

export function createMockServer(store = new MockStore()) {
  return createServer(async (request, response) => {
    try {
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
          items: Object.values(store.data.state.items).map(({ code, label, type }) => ({
            code,
            label,
            type,
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
          await QRCode.toString(text, { type: 'svg', margin: 4, width: 512 }),
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
      if (method === 'GET' && url.pathname === '/custom/qrrouter/qr.php') {
        const item = store.item(url.searchParams.get('code'));
        send(
          response,
          200,
          await QRCode.toString(item.code, { type: 'svg', margin: 2 }),
          'image/svg+xml'
        );
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
        ].includes(url.pathname)
      ) {
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
