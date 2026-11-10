// Loaded by the local mock HTML only, before Angular requests a camera.
(() => {
  const panel = document.querySelector('#mock-camera-panel');
  const toggle = document.querySelector('#mock-camera-toggle');
  const close = document.querySelector('#mock-camera-close');
  const workspace = document.querySelector('.mock-workspace');
  const canvas = document.querySelector('#mock-camera-preview');
  const context = canvas.getContext('2d');
  const mode = document.querySelector('#mock-camera-mode');
  const fixture = document.querySelector('#mock-camera-fixture');
  const content = document.querySelector('#mock-camera-content');
  const format = document.querySelector('#mock-camera-format');
  const zoom = document.querySelector('#mock-camera-zoom');
  const rotation = document.querySelector('#mock-camera-rotation');
  const show = document.querySelector('#mock-camera-show');
  const status = document.querySelector('#mock-camera-status');
  const error = document.querySelector('#mock-camera-error');
  const mobile = matchMedia('(max-width: 850px)');
  const background = [
    document.querySelector('.mock-topbar'),
    document.querySelector('.mock-controls'),
    document.querySelector('.mock-main'),
  ];
  const tracks = new Set();
  let image;
  let shownContent = '';
  let generation = 0;
  let timer;
  let open = false;

  const savedMode = localStorage.getItem('qrr-mock-camera-mode');
  if ([...mode.options].some(option => option.value === savedMode)) mode.value = savedMode;

  function reportError(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }

  function draw() {
    const { width, height } = canvas;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#596b6b');
    gradient.addColorStop(1, '#303b3f');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#eef3f3';
    context.font = '16px sans-serif';
    context.textAlign = 'left';
    context.fillText(`VIRTUAL CAMERA · ${width} × ${height}`, 20, 30);
    if (image) {
      const size = (Math.min(width, height) * Number(zoom.value)) / 100;
      context.save();
      context.translate(width / 2, height / 2);
      context.rotate((Number(rotation.value) * Math.PI) / 180);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, -size / 2, -size / 2, size, size);
      context.restore();
    }
    context.textAlign = 'center';
    context.fillText(
      image ? shownContent.slice(0, 60) : 'Blank frame — choose a QR label below',
      width / 2,
      height - 24
    );
  }

  function update() {
    draw();
    status.textContent = `${tracks.size} active virtual camera ${tracks.size === 1 ? 'stream' : 'streams'}. ${image ? 'Showing QR code.' : 'Blank frame.'}`;
    if ((open || tracks.size) && !timer) timer = setInterval(draw, 1000 / 12);
    if (!open && !tracks.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  const devices = navigator.mediaDevices;
  const realCamera = devices?.getUserMedia?.bind(devices);
  async function getUserMedia(constraints) {
    if (!constraints?.video || mode.value === 'real') {
      if (realCamera) return realCamera(constraints);
      throw new DOMException('No real camera API is available in this browser.', 'NotFoundError');
    }
    if (mode.value === 'denied')
      throw new DOMException('Permission denied by camera mock.', 'NotAllowedError');
    if (mode.value === 'unavailable')
      throw new DOMException('No camera available in camera mock.', 'NotFoundError');
    if (!canvas.captureStream)
      throw new DOMException(
        'This browser cannot create a virtual camera stream.',
        'NotSupportedError'
      );
    draw();
    const stream = canvas.captureStream(12);
    for (const track of stream.getTracks()) {
      tracks.add(track);
      const stop = track.stop.bind(track);
      track.stop = () => {
        stop();
        tracks.delete(track);
        update();
      };
    }
    update();
    return stream;
  }
  if (devices) {
    Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: getUserMedia });
  } else {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  }

  function resizePanel() {
    panel.setAttribute('role', mobile.matches ? 'dialog' : 'region');
    if (open && mobile.matches) panel.setAttribute('aria-modal', 'true');
    else panel.removeAttribute('aria-modal');
    for (const element of background) element.inert = open && mobile.matches;
    if (open && mobile.matches && !panel.contains(document.activeElement)) panel.focus();
    panel.style.height =
      open && !mobile.matches
        ? `${Math.max(0, innerHeight - Math.max(0, panel.getBoundingClientRect().top))}px`
        : '';
  }

  async function loadFixtures() {
    try {
      const response = await fetch('/__mock/camera/items');
      if (!response.ok) throw new Error('Cannot load mock QR labels.');
      const { items } = await response.json();
      const selected = fixture.value;
      fixture.replaceChildren(new Option('Choose an inventory label', ''));
      for (const item of items)
        fixture.add(new Option(`${item.label || 'Unassigned'} · ${item.code}`, item.code));
      fixture.value = items.some(item => item.code === selected) ? selected : '';
      reportError();
    } catch (failure) {
      reportError(failure.message);
    }
  }

  function setOpen(value) {
    open = value;
    panel.hidden = !open;
    workspace.classList.toggle('camera-controls-open', open);
    document.body.classList.toggle('mock-camera-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    sessionStorage.setItem('qrr-mock-camera-panel', String(open));
    resizePanel();
    update();
    if (open) {
      panel.focus();
      void loadFixtures();
    } else toggle.focus();
    window.dispatchEvent(new Event('resize'));
  }

  toggle.addEventListener('click', () => setOpen(!open));
  close.addEventListener('click', () => setOpen(false));
  window.addEventListener('resize', resizePanel);
  document.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab' && mobile.matches) {
      const focusable = [...panel.querySelectorAll('button, select, textarea, input')].filter(
        element => !element.disabled && element.getClientRects().length
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel)
      ) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  mode.addEventListener('change', () => localStorage.setItem('qrr-mock-camera-mode', mode.value));
  fixture.addEventListener('change', () => {
    if (fixture.value) content.value = fixture.value;
  });
  document
    .querySelector('#mock-camera-refresh')
    .addEventListener('click', () => void loadFixtures());
  document.querySelector('#mock-camera-qr-form').addEventListener('submit', async event => {
    event.preventDefault();
    const value = content.value;
    if (!value.trim()) {
      reportError('Choose a fixture or enter QR content first.');
      return;
    }
    const request = ++generation;
    show.disabled = true;
    reportError();
    try {
      const response = await fetch('/__mock/camera/qr?' + new URLSearchParams({ text: value }));
      if (!response.ok) throw new Error((await response.json()).message);
      const source = URL.createObjectURL(await response.blob());
      const next = new Image();
      try {
        next.src = source;
        await next.decode();
      } finally {
        URL.revokeObjectURL(source);
      }
      if (request !== generation) return;
      image = next;
      shownContent = value;
      update();
    } catch (failure) {
      if (request === generation) reportError(failure.message);
    } finally {
      if (request === generation) {
        show.disabled = false;
        if (open && document.activeElement === document.body) show.focus();
      }
    }
  });
  document.querySelector('#mock-camera-clear').addEventListener('click', () => {
    ++generation;
    show.disabled = false;
    image = undefined;
    shownContent = '';
    reportError();
    update();
  });
  format.addEventListener('change', () => {
    [canvas.width, canvas.height] = format.value.split('x').map(Number);
    update();
  });
  for (const control of [zoom, rotation]) {
    control.addEventListener('input', () => {
      document.querySelector(`#${control.id}-value`).textContent =
        control.value + (control === zoom ? '%' : '°');
      update();
    });
  }
  window.addEventListener('pagehide', () => {
    open = false;
    for (const track of tracks) track.stop();
    update();
  });
  update();
  resizePanel();
  if (sessionStorage.getItem('qrr-mock-camera-panel') === 'true') setOpen(true);
})();
