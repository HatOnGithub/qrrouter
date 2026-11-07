(function () {
  'use strict';
const tr = s => (typeof window !== 'undefined' && window.QRR_UI?.[s]) || s;
  const script = document.currentScript;
  const form = document.getElementById('qrr-manage');
  if (!form) return;
  const kind = document.getElementById('qrr-reference-type');
  const query = document.getElementById('qrr-reference-query');
  const id = document.getElementById('qrr-reference-id');
  const list = document.getElementById('qrr-reference-results');
  const status = document.getElementById('qrr-reference-status');
  let timer = 0;
  let ticket = 0;

  function hideResults() {
    list.hidden = true;
    list.replaceChildren();
  }
  function invalidate() {
    id.value = '0';
    ++ticket; // Discard responses for a previous query or transaction type.
    clearTimeout(timer);
    hideResults();
  }
  async function lookup() {
    const seq = ++ticket;
    if (!kind.value) {
      hideResults();
      status.textContent = tr('Select a transaction type to browse recent records.');
      return;
    }
    status.textContent = tr('Searching…');
    try {
      const url = new URL(script.dataset.url, location.href);
      url.searchParams.set('type', kind.value);
      url.searchParams.set('q', query.value.trim()); // Empty = latest records, scrollable.
      const response = await fetch(url, { credentials: 'same-origin' });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || 'Reference lookup unavailable');
      if (!Array.isArray(rows)) throw new Error('Invalid reference lookup response');
      if (seq !== ticket) return;
      hideResults();
      for (const row of rows) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'qrr-lookup-option';
        option.setAttribute('role', 'option');
        option.textContent = row.text;
        option.addEventListener('click', () => {
          id.value = String(row.id);
          query.value = row.text;
          hideResults();
          status.textContent = tr('Selected: ') + row.text;
        });
        list.appendChild(option);
      }
      list.hidden = rows.length === 0;
      status.textContent = rows.length
        ? rows.length + tr(' result(s). Scroll and click a record to select it.')
        : tr('No matching records. Try entering a different reference.');
    } catch (error) {
      if (seq !== ticket) return;
      hideResults();
      status.textContent = error.message;
    }
  }
  kind.addEventListener('change', () => {
    invalidate();
    query.value = '';
    const posted = form.querySelector('[name=stock_mode][value=already_posted]');
    const native = form.querySelector('[name=stock_mode][value=native]');
    if (kind.value === 'shipment' || kind.value === 'production') {
      if (posted) posted.checked = true;
    } else if (native) native.checked = true;
    lookup();
  });
  query.addEventListener('focus', () => { if (kind.value) lookup(); });
  query.addEventListener('input', () => {
    invalidate();
    timer = setTimeout(lookup, 180);
  });
  query.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !list.hidden && list.firstElementChild) {
      event.preventDefault();
      list.firstElementChild.focus();
    }
    if (event.key === 'Escape') hideResults();
  });
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { hideResults(); query.focus(); }
  });
  form.addEventListener('submit', (event) => {
    if (kind.value && Number(id.value) < 1) {
      event.preventDefault();
      status.textContent = tr('Select an exact record from the scrollable results.');
      query.focus();
    }
  });
})();
