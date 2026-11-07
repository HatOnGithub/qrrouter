'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(scriptName, datasets, responses) {
  const controls = new Map();
  function control(id) {
    if (!controls.has(id)) {
      const c = {
        id, value: '', hidden: true, checked: false, textContent: '', children: [], listeners: {},
        addEventListener(type, callback) { this.listeners[type] = callback; },
        appendChild(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
        get firstElementChild() { return this.children[0] || null; },
        focus() { this.focused = true; },
        setAttribute(name, value) { this[name] = value; }
      };
      controls.set(id, c);
    }
    return controls.get(id);
  }
  const form = control(scriptName === 'order.js' ? 'qrr-pick-form' : 'qrr-manage');
  const radios = { native: { checked: false }, already_posted: { checked: false } };
  form.querySelector = (s) => s.includes('already_posted') ? radios.already_posted : radios.native;
  const script = { dataset: datasets };
  const seen = [];
  const document = { currentScript: script, getElementById: control, createElement: () => {
    return { listeners: {}, addEventListener(k, cb) { this.listeners[k] = cb; }, setAttribute(k, v) { this[k] = v; }, focus() { this.focused = true; } };
  }};
  const sandbox = {
    document, location: { href: 'http://localhost/qrrouter/' }, URL,
    fetch: async (url) => { seen.push(String(url)); return { ok: true, json: async () => responses(url) }; },
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {}, console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/', scriptName), 'utf8'), sandbox, { filename: scriptName });
  return { control, form, seen, radios };
}
async function settle() { await new Promise(resolve => setImmediate(resolve)); }
(async () => {
  const references = setup('references.js', { url: 'reference_lookup.php' }, (url) => {
    const kind = url.searchParams.get('type');
    return kind === 'production'
      ? [{ id: 11, text: 'MO-011' }, { id: 12, text: 'MO-012' }]
      : kind === 'salesorder' ? [{ id: 41, text: 'CO-041' }] : [{ id: 31, text: 'SHIP-031' }];
  });
  const kind = references.control('qrr-reference-type');
  kind.value = 'production'; kind.listeners.change(); await settle();
  const list = references.control('qrr-reference-results');
  assert.equal(list.hidden, false, 'MRP list must open automatically on transaction type selection');
  assert.equal(list.children.length, 2, 'MRP results must be offered without a search query');
  assert(references.seen[0].includes('q='));
  assert.equal(references.radios.already_posted.checked, true);
  list.children[1].listeners.click();
  assert.equal(references.control('qrr-reference-id').value, '12');
  assert.equal(list.hidden, true);
  kind.value = 'salesorder'; kind.listeners.change(); await settle();
  assert.equal(references.control('qrr-reference-id').value, '0', 'Change of kind must clear old reference');
  assert.equal(list.children[0].textContent, 'CO-041');
  list.children[0].listeners.click();
  assert.equal(references.control('qrr-reference-id').value, '41');
  const search = references.control('qrr-reference-query');
  search.value = 'CO-'; search.listeners.input(); await settle();
  assert.equal(references.control('qrr-reference-id').value, '0', 'Editing query clears previous selection');
  let blocked = false;
  references.form.listeners.submit({ preventDefault() { blocked = true; } });
  assert.equal(blocked, true, 'Must select an exact reference');

  const picks = setup('order.js', { orderUrl: 'order_lookup.php' }, () => [{ id: 5, text: 'CO-005 — Customer' }, { id: 6, text: 'CO-006 — Customer' }]);
  const orderSearch = picks.control('qrr-order-search');
  orderSearch.listeners.focus(); await settle();
  const orderResults = picks.control('qrr-order-results');
  assert.equal(orderResults.hidden, false, 'Customer order list should appear on focus');
  assert.equal(orderResults.children.length, 2);
  orderResults.children[1].listeners.click();
  assert.equal(picks.control('qrr-order-id').value, '6');
  assert.equal(orderResults.hidden, true);
  orderSearch.value = 'other'; orderSearch.listeners.input(); await settle();
  assert.equal(picks.control('qrr-order-id').value, '');
  console.log('Order and manufacturing-reference lookup UI tests passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
