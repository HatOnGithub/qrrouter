/* No printer SDK is required: the installed DYMO driver handles the system print dialog. */
(() => {
  'use strict';
  const button = document.getElementById('qrr-print');
  const status = document.getElementById('qrr-print-status');
  const images = [...document.querySelectorAll('.qrr-thermal-label img')];
  const fitDetails = () => {
    const minimumSize =
      ((parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--min-detail-font')
      ) || 5.5) *
        96) /
      72;
    for (const field of document.querySelectorAll('.qrr-label-detail')) {
      const text = field.querySelector('span');
      if (!text.dataset.original) text.dataset.original = text.textContent;
      text.textContent = text.dataset.original;
      text.style.removeProperty('font-size');
      let size = parseFloat(getComputedStyle(text).fontSize);
      const fits = () =>
        text.scrollHeight <= field.clientHeight + 1 && text.scrollWidth <= field.clientWidth + 1;
      while (!fits() && size > minimumSize) {
        size = Math.max(minimumSize, size - 0.5);
        text.style.fontSize = `${size}px`;
      }
      const letters = Array.from(text.textContent);
      if (!fits()) {
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
  };
  const ready = images.map(img =>
    img.complete
      ? Promise.resolve(img.naturalWidth > 0)
      : new Promise(resolve => {
          img.addEventListener('load', () => resolve(true), { once: true });
          img.addEventListener('error', () => resolve(false), { once: true });
        })
  );
  Promise.all(ready).then(results => {
    fitDetails();
    const okay = results.length > 0 && results.every(Boolean);
    button.disabled = !okay;
    status.textContent = okay
      ? `${results.length} ${status.dataset.ready}`
      : results.length
        ? status.dataset.error
        : status.textContent;
  });
  window.addEventListener('beforeprint', fitDetails);
  button.addEventListener('click', () => {
    if (!button.disabled) {
      fitDetails();
      window.print();
    }
  });
})();
