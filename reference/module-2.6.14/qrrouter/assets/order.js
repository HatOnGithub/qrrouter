(function () {
  'use strict';
const tr = s => (typeof window !== 'undefined' && window.QRR_UI?.[s]) || s;
  const script = document.currentScript;
  const form = document.getElementById('qrr-pick-form');
  if (!form) return;
  const search = document.getElementById('qrr-order-search');
  const list = document.getElementById('qrr-order-results');
  const id = document.getElementById('qrr-order-id');
  const status = document.getElementById('qrr-order-status');
  let ticket = 0;
  let timer = 0;

  function hideResults() { list.hidden = true; list.replaceChildren(); }
  async function lookup() {
    const seq = ++ticket;
    status.textContent = tr('Searching…');
    try {
      const url = new URL(script.dataset.orderUrl, location.href);
      url.searchParams.set('q', search.value.trim());
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Unable to search customer orders');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Invalid customer order response');
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
          search.value = row.text;
          hideResults();
          status.textContent = tr('Selected: ') + row.text;
        });
        list.appendChild(option);
      }
      list.hidden = rows.length === 0;
      status.textContent = rows.length
        ? rows.length + tr(' customer order(s). Scroll and click one to select it.')
        : tr('No matching customer orders.');
    } catch (error) {
      if (seq !== ticket) return;
      hideResults();
      status.textContent = error.message;
    }
  }
  search.addEventListener('focus', lookup);
  search.addEventListener('input', () => {
    id.value = '';
    ++ticket;
    clearTimeout(timer);
    hideResults();
    timer = setTimeout(lookup, 180);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !list.hidden && list.firstElementChild) {
      event.preventDefault();
      list.firstElementChild.focus();
    }
    if (event.key === 'Escape') hideResults();
  });
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { hideResults(); search.focus(); }
  });
  form.addEventListener('submit', (event) => {
    if (!Number(id.value)) {
      event.preventDefault();
      status.textContent = tr('Select a customer order from the scrollable results.');
      search.focus();
    }
  });
})();
