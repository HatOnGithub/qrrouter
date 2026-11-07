/* QR Router camera engine. Native BarcodeDetector when available; otherwise
 * getUserMedia + jsQR (pixel decoding in the browser, never uploaded).
 * jsQR 1.4.0 is loaded only as needed and version-pinned.
 */
(function(root) {
'use strict';
const tr = s => root.QRR_UI?.[s] || s;
const DECODER_URL = root.QRR_JSQR_URL || 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
let jsqrLoading = null;
function loadJsQR() {
  if (typeof root.jsQR === 'function') return Promise.resolve(root.jsQR);
  if (jsqrLoading) return jsqrLoading;
  jsqrLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = DECODER_URL;
    const timer = setTimeout(() => reject(new Error(tr('QR decoder loading timed out. Check the network or use a hardware scanner.'))), 12000);
    script.onload = () => {
      clearTimeout(timer);
      typeof root.jsQR === 'function' ? resolve(root.jsQR) : reject(new Error(tr('QR decoder library is unavailable')));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(tr('Cannot load QR decoder library. Check internet access or Content-Security-Policy.')));
    };
    document.head.appendChild(script);
  }).catch(err => { jsqrLoading = null; throw err; });
  return jsqrLoading;
}
class QRRCameraScanner {
  constructor(video, options) {
    this.video = video;
    this.options = options || {};
    this.active = false;
    this.starting = false;
    this.stream = null;
    this.detector = null;
    this.decoder = null;
    this.canvas = null;
    this.context = null;
    this.raf = 0;
    this.generation = 0;
    this.lastValue = '';
    this.lastTime = 0;
    this.lastFrame = 0;
  }
  status(msg) { if (typeof this.options.onStatus === 'function') this.options.onStatus(msg); }
  state(value) { if (typeof this.options.onState === 'function') this.options.onState(value); }
  async start() {
    if (this.active || this.starting) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error(tr('Camera API unavailable. Open this page over HTTPS and allow camera access.'));
    }
    this.starting = true;
    const generation = ++this.generation;
    try {
      this.detector = null;
      this.decoder = null;
      if (typeof root.BarcodeDetector === 'function') {
        try { this.detector = new root.BarcodeDetector({formats:['qr_code']}); } catch (_) { this.detector = null; }
      }
      // Ask for the camera directly from the user's click. In particular, on
      // Firefox do not postpone the permission request until an optional
      // decoder script has completed loading over the network.
      this.status(tr('Requesting camera permission…'));
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false});
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.video.srcObject = stream;
      this.video.style.display = 'block';
      await this.video.play();
      if (generation !== this.generation) return;
      if (!this.detector) {
        this.status(tr('Camera ready. Loading JavaScript QR decoder…'));
        this.decoder = await loadJsQR();
        if (generation !== this.generation) return;
      }
      this.active = true;
      this.lastValue = '';
      this.lastTime = 0;
      this.lastFrame = 0;
      this.state(true);
      this.status(this.detector ? tr('Camera active (native QR detection)') : tr('Camera active (JavaScript QR detection). Point at a label.'));
      this.schedule(generation);
    } catch(err) {
      if (generation === this.generation) this.stop();
      throw err;
    } finally { this.starting = false; }
  }
  stop() {
    ++this.generation;
    this.active = false;
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video.style.display = 'none';
    }
    this.state(false);
  }
  schedule(generation) {
    if (this.active && generation === this.generation) this.raf = requestAnimationFrame(() => this.tick(generation));
  }
  decodeFrame() {
    const video = this.video;
    if (!video.videoWidth || !video.videoHeight) return [];
    const ratio = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * ratio));
    const height = Math.max(1, Math.round(video.videoHeight * ratio));
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext('2d', {willReadFrequently:true});
    }
    if (!this.context) throw new Error('Canvas pixel access is not available');
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.drawImage(video, 0, 0, width, height);
    const pixels = this.context.getImageData(0, 0, width, height);
    const result = this.decoder(pixels.data, width, height, {inversionAttempts:'attemptBoth'});
    if (!result) return [];
    let boundingBox;
    if (result.location) {
      const pts = ['topLeftCorner','topRightCorner','bottomLeftCorner','bottomRightCorner'].map(k => result.location[k]).filter(Boolean);
      if (pts.length === 4) {
        const xs = pts.map(p => p.x / ratio), ys = pts.map(p => p.y / ratio);
        const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
        boundingBox = {x, y, width:Math.max(...xs)-x, height:Math.max(...ys)-y};
      }
    }
    return [{rawValue:result.data, boundingBox}];
  }
  async tick(generation) {
    if (!this.active || generation !== this.generation) return;
    // Software decoding is CPU-intensive; limit it to roughly 8fps.
    const now = Date.now();
    if (now - this.lastFrame < (this.detector ? 80 : 125)) { this.schedule(generation); return; }
    this.lastFrame = now;
    try {
      if (this.video.readyState >= 2) {
        const hits = this.detector ? await this.detector.detect(this.video) : this.decodeFrame();
        if (!this.active || generation !== this.generation) return;
        for (const hit of hits) {
          const value = String(hit.rawValue || '').trim().toUpperCase();
          if (!value || (value === this.lastValue && now - this.lastTime < 1200)) continue;
          this.lastValue = value;
          this.lastTime = now;
          if (typeof this.options.onDecode === 'function' && this.options.onDecode(value, hit) === true) break;
          if (!this.active || generation !== this.generation) return;
        }
      }
    } catch(err) {
      if (!this.active || generation !== this.generation) return;
      if (this.detector) {
        // A browser can expose BarcodeDetector but fail at runtime.
        this.detector = null;
        this.lastFrame = 0;
        this.status(tr('Native QR detection failed; switching to JavaScript decoder…'));
        try {
          this.decoder = await loadJsQR();
          if (!this.active || generation !== this.generation) return;
          this.status(tr('Camera active (JavaScript QR detection).'));
        } catch(loadError) {
          this.status(loadError.message);
          this.stop();
          return;
        }
      } else {
        this.status(tr('QR decoder error: ') + (err.message || String(err)));
        this.stop();
        return;
      }
    }
    this.schedule(generation);
  }
}
root.QRRCameraScanner = QRRCameraScanner;
})(window);
