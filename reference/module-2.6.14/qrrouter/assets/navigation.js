/* QR Router navigation v2.6.9.
 * Portal open menus to document.body. Dolibarr themes can clip absolutely
 * positioned descendants or hide them behind headers, tabs, and cards.
 */
(function () {
  'use strict';
  let nextId = 0;

  function init(nav) {
    if (!nav || nav.dataset.qrrNavReady === '1') return;
    nav.dataset.qrrNavReady = '1';

    const disclosures = Array.from(nav.querySelectorAll('details.qrr-nav-dropdown, details.qrr-nav-mobile-menu'));
    const menus = new Map();
    disclosures.forEach(function (details) {
      const panel = details.querySelector('.qrr-nav-popover, .qrr-nav-mobile-panel');
      const summary = details.querySelector('summary');
      if (!panel || !summary) return;
      panel.id = panel.id || 'qrr-nav-panel-' + (++nextId);
      summary.setAttribute('aria-controls', panel.id);
      summary.setAttribute('aria-expanded', 'false');
      menus.set(details, { panel: panel, summary: summary, mobile: details.classList.contains('qrr-nav-mobile-menu') });
    });

    function view() {
      const vv = window.visualViewport;
      return vv ? {
        left: vv.offsetLeft, top: vv.offsetTop,
        width: vv.width, height: vv.height
      } : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }

    function position(details) {
      const menu = menus.get(details);
      if (!menu || !details.open || !menu.panel.classList.contains('qrr-nav-floating')) return;
      const panel = menu.panel;
      const anchor = menu.summary.getBoundingClientRect();
      // When the breakpoint changes, a desktop summary can become hidden.
      // Do not leave its detached menu floating without an anchor.
      if (anchor.width < 1 || anchor.height < 1) { close(details); return; }
      const v = view();
      const margin = 10;
      const gap = 7;
      const availableWidth = Math.max(140, v.width - margin * 2);
      panel.style.right = 'auto'; // override native desktop/mobile CSS right:0
      panel.style.maxWidth = availableWidth + 'px';
      if (menu.mobile) {
        const navRect = nav.getBoundingClientRect();
        panel.style.width = Math.min(navRect.width, availableWidth) + 'px';
        panel.style.minWidth = '0';
      } else {
        panel.style.width = 'max-content';
        panel.style.minWidth = Math.min(205, availableWidth) + 'px';
      }

      // Measure after setting the width: wrapping can change the popup height.
      const heightBelow = v.top + v.height - anchor.bottom - gap - margin;
      const heightAbove = anchor.top - v.top - gap - margin;
      const placeAbove = heightBelow < 175 && heightAbove > heightBelow;
      const freeHeight = Math.max(48, placeAbove ? heightAbove : heightBelow);
      const maxHeight = Math.min(menu.mobile ? 650 : 440, Math.max(48, v.height - 2 * margin), freeHeight);
      panel.style.maxHeight = maxHeight + 'px';
      panel.style.minHeight = Math.min(48, maxHeight) + 'px';

      const panelWidth = panel.getBoundingClientRect().width;
      const idealLeft = menu.mobile ? nav.getBoundingClientRect().left : anchor.right - panelWidth;
      const left = Math.min(Math.max(idealLeft, v.left + margin), v.left + v.width - margin - panelWidth);
      const actualHeight = panel.getBoundingClientRect().height;
      const idealTop = placeAbove ? anchor.top - gap - actualHeight : anchor.bottom + gap;
      const top = Math.min(Math.max(idealTop, v.top + margin), v.top + v.height - margin - actualHeight);
      panel.style.left = Math.round(left) + 'px';
      panel.style.top = Math.round(top) + 'px';
      panel.dataset.qrrPlacement = placeAbove ? 'above' : 'below';
    }

    function undock(details) {
      const menu = menus.get(details);
      if (!menu) return;
      const panel = menu.panel;
      if (panel.parentNode !== details) details.appendChild(panel);
      panel.classList.remove('qrr-nav-floating');
      ['top', 'left', 'right', 'width', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'].forEach(function (prop) {
        panel.style[prop] = '';
      });
      delete panel.dataset.qrrPlacement;
      menu.summary.setAttribute('aria-expanded', 'false');
    }

    function close(details) {
      details.open = false;
      undock(details);
    }

    function activate(details) {
      const menu = menus.get(details);
      if (!menu) return;
      disclosures.forEach(function (other) { if (other !== details) close(other); });
      const panel = menu.panel;
      if (panel.parentNode !== document.body) document.body.appendChild(panel);
      panel.classList.add('qrr-nav-floating');
      menu.summary.setAttribute('aria-expanded', 'true');
      position(details);
    }

    disclosures.forEach(function (details) {
      details.addEventListener('toggle', function () {
        if (details.open) activate(details);
        else undock(details);
      });
    });

    document.addEventListener('pointerdown', function (event) {
      const isInside = nav.contains(event.target) || Array.from(menus.values()).some(function (entry) {
        return entry.panel.contains(event.target);
      });
      if (!isInside) disclosures.forEach(close);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      const active = disclosures.find(function (details) { return details.open; });
      if (!active) return;
      disclosures.forEach(close);
      event.preventDefault();
      menus.get(active).summary.focus();
    });

    // Reposition for narrow viewports, mobile browser toolbars and page scrolling.
    let queued = false;
    function reposition() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        disclosures.forEach(function (details) { if (details.open) position(details); });
      });
    }
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', reposition);
      window.visualViewport.addEventListener('scroll', reposition);
    }
  }

  function ready() { document.querySelectorAll('.qrr-nav').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
