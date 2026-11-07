/** Consistent, bounded, scrollable QR Router selectors; native selects remain form controls. */
(function () {
  'use strict';
  const EDGE = 12;
  const MAX_WIDTH = 680;
  const MAX_HEIGHT = 340;
  let active = null;
  let serial = 0;

  const textWidth = (text, element) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) return Math.min(MAX_WIDTH, String(text).length * 9 + 50);
    const style = window.getComputedStyle(element);
    context.font = style.font || `${style.fontSize || '16px'} ${style.fontFamily || 'sans-serif'}`;
    return context.measureText(String(text)).width + 48;
  };

  function positionPopup(anchor, popup, choices, listScroller) {
    if (!anchor.isConnected || popup.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const viewportWidth = Math.max(1, vw - EDGE * 2);
    let ideal = rect.width;
    for (const entry of choices) ideal = Math.max(ideal, textWidth(entry.textContent, anchor));
    const width = Math.min(viewportWidth, MAX_WIDTH, Math.max(rect.width, ideal));
    const left = Math.min(Math.max(EDGE, rect.left), Math.max(EDGE, vw - EDGE - width));
    const below = vh - rect.bottom - EDGE - 5;
    const above = rect.top - EDGE - 5;
    const openAbove = below < 160 && above > below;
    const maxHeight = Math.max(65, Math.min(MAX_HEIGHT, openAbove ? above : below, vh - EDGE * 2));
    popup.style.width = `${width}px`;
    popup.style.left = `${left}px`;
    popup.style.maxHeight = `${maxHeight}px`;
    if (listScroller) {
      const filterHeight = popup.querySelector('.qrr-select-filter')?.offsetHeight || 0;
      listScroller.style.maxHeight = `${Math.max(40, maxHeight - filterHeight - 4)}px`;
    }
    popup.style.top = openAbove
      ? `${Math.max(EDGE, rect.top - 5 - Math.min(popup.getBoundingClientRect().height, maxHeight))}px`
      : `${Math.min(vh - EDGE, rect.bottom + 5)}px`;
  }

  function closeActive() {
    if (!active) return;
    const current = active;
    active = null;
    current.close();
  }
  function openActive(close, anchor, popup, choices, scroller) {
    if (active && active.popup !== popup) closeActive();
    popup.hidden = false;
    active = { close, anchor, popup, choices, scroller };
    positionPopup(anchor, popup, choices(), scroller);
  }
  function syncActive() {
    if (!active) return;
    if (!active.anchor.isConnected) { closeActive(); return; }
    positionPopup(active.anchor, active.popup, active.choices(), active.scroller);
  }

  document.addEventListener('pointerdown', (event) => {
    if (active && !active.anchor.contains(event.target) && !active.popup.contains(event.target)) closeActive();
  }, true);
  document.addEventListener('scroll', syncActive, true);
  window.addEventListener('resize', syncActive);

  function enhanceSelect(select) {
    if (select.dataset.qrrDropdownReady || select.multiple || select.size > 1) return;
    select.dataset.qrrDropdownReady = '1';
    const wrap = document.createElement('span');
    wrap.className = 'qrr-select-wrap';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qrr-select-button qrr-input';
    const description = select.getAttribute('aria-label') || select.labels?.[0]?.textContent || select.parentElement?.parentElement?.querySelector('label')?.textContent || select.name || 'Select option';
    button.setAttribute('aria-label', description.trim());
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-required', select.required ? 'true' : 'false');
    const label = document.createElement('span');
    label.className = 'qrr-select-value';
    const caret = document.createElement('span');
    caret.className = 'qrr-select-caret';
    caret.textContent = '\u25be';
    caret.setAttribute('aria-hidden', 'true');
    button.append(label, caret);
    wrap.appendChild(button);

    const popup = document.createElement('div');
    popup.className = 'qrr-select-popup qrr-floating';
    popup.id = 'qrr-dropdown-' + (++serial);
    popup.hidden = true;
    popup.setAttribute('role', 'presentation');
    button.setAttribute('aria-controls', popup.id);
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'qrr-select-filter';
    filter.placeholder = 'Filter options';
    filter.setAttribute('aria-label', 'Filter ' + description.trim());
    const options = document.createElement('div');
    options.className = 'qrr-select-options';
    options.setAttribute('role', 'listbox');
    options.setAttribute('aria-label', description.trim());
    popup.append(filter, options);
    document.body.appendChild(popup);

    select.classList.add('qrr-select-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    function updateLabel() {
      label.textContent = select.selectedOptions[0]?.textContent || 'Select';
      button.disabled = select.disabled;
      button.classList.toggle('qrr-invalid', select.required && !select.value);
    }
    const allOptions = () => Array.from(select.options).map((option, idx) => ({
      index: idx, text: option.textContent, value: option.value, disabled: option.disabled
    }));
    function visibleButtons() { return Array.from(options.querySelectorAll('.qrr-select-choice:not([disabled])')); }
    function focusChoice(index) {
      const buttons = visibleButtons();
      if (!buttons.length) return;
      const next = buttons[Math.max(0, Math.min(buttons.length - 1, index))];
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    }
    function choose(index) {
      const chosen = select.options[index];
      if (!chosen || chosen.disabled) return;
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      button.focus();
    }
    function render(term) {
      options.replaceChildren();
      const input = term.trim().toLocaleLowerCase();
      for (const opt of allOptions()) {
        if (input && !opt.text.toLocaleLowerCase().includes(input)) continue;
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'qrr-select-choice';
        choice.textContent = opt.text;
        choice.setAttribute('role', 'option');
        choice.setAttribute('aria-selected', select.selectedIndex === opt.index ? 'true' : 'false');
        choice.disabled = opt.disabled;
        choice.addEventListener('click', () => choose(opt.index));
        options.appendChild(choice);
      }
      if (active?.popup === popup) syncActive();
    }
    function close() {
      popup.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (active?.popup === popup) active = null;
    }
    function open() {
      if (button.disabled) return;
      filter.value = '';
      const searchable = select.options.length > 8;
      filter.hidden = !searchable;
      render('');
      openActive(close, button, popup, () => options.querySelectorAll('.qrr-select-choice'), options);
      button.setAttribute('aria-expanded', 'true');
      if (searchable) filter.focus();
      else {
        const selected = Array.from(options.children).findIndex((element) => element.getAttribute('aria-selected') === 'true');
        focusChoice(selected < 0 ? 0 : selected);
      }
    }
    button.addEventListener('click', () => popup.hidden ? open() : close());
    button.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(e.key)) { e.preventDefault(); open(); }
      if (e.key === 'Escape') close();
    });
    filter.addEventListener('input', () => { render(filter.value); options.scrollTop = 0; });
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); button.focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); focusChoice(0); }
    });
    options.addEventListener('keydown', (e) => {
      const buttons = visibleButtons();
      const current = buttons.indexOf(document.activeElement);
      let next;
      if (e.key === 'ArrowDown') next = current + 1;
      else if (e.key === 'ArrowUp') next = current - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      else if (e.key === 'Escape') { e.preventDefault(); close(); button.focus(); return; }
      else if (e.key === 'Tab') { close(); return; }
      else return;
      e.preventDefault();
      focusChoice(next);
    });
    select.addEventListener('change', updateLabel);
    select.addEventListener('invalid', (e) => { e.preventDefault(); button.classList.add('qrr-invalid'); button.focus(); });
    updateLabel();
  }

  function attachLookup(input, list) {
    if (!input || !list || list.dataset.qrrDropdownReady) return;
    list.dataset.qrrDropdownReady = '1';
    list.classList.add('qrr-floating');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-expanded', 'false');
    document.body.appendChild(list); // Avoid clipping by Dolibarr panels and responsive grids.
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      if (active?.popup === list) active = null;
    }
    function update() {
      const open = !list.hidden && list.children.length > 0;
      input.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) { if (active?.popup === list) active = null; return; }
      openActive(close, input, list, () => list.querySelectorAll('.qrr-lookup-option'), list);
    }
    const obs = new MutationObserver(update);
    obs.observe(list, { attributes: true, attributeFilter: ['hidden'], childList: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown' && !list.hidden) {
        e.preventDefault();
        const first = list.querySelector('.qrr-lookup-option');
        if (first) first.focus();
      }
    });
    list.addEventListener('keydown', (e) => {
      const buttons = Array.from(list.querySelectorAll('.qrr-lookup-option'));
      const current = buttons.indexOf(document.activeElement);
      let next;
      if (e.key === 'ArrowDown') next = current + 1;
      else if (e.key === 'ArrowUp') next = current - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      else if (e.key === 'Escape') { e.preventDefault(); close(); input.focus(); return; }
      else if (e.key === 'Tab') { close(); return; }
      else return;
      e.preventDefault();
      if (buttons.length) {
        const target = buttons[Math.max(0, Math.min(buttons.length - 1, next))];
        target.focus();
        target.scrollIntoView({ block: 'nearest' });
      }
    });
    update();
  }

  function enhance(root) {
    const selects = root.matches?.('select.qrr-input') ? [root] : [];
    selects.push(...root.querySelectorAll('select.qrr-input'));
    selects.forEach(enhanceSelect);
    for (const [inputId, listId] of [
      ['qrr-product-search', 'qrr-product-results'],
      ['qrr-order-search', 'qrr-order-results'],
      ['qrr-reference-query', 'qrr-reference-results']
    ]) {
      attachLookup(document.getElementById(inputId), document.getElementById(listId));
    }
  }
  function init() {
    enhance(document);
    const container = document.querySelector('.qrr');
    if (container) {
      const observer = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1) enhance(node);
        }
      });
      observer.observe(container, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
