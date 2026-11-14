import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import bwip from 'bwip-js';
import { BarcodeDecoder } from '../src/app/shared/scanner/barcode-decoder.ts';
import { validCode } from '../src/app/shared/scanner/codes.ts';
import { normalizeCode } from '../src/app/shared/scanner/codes.ts';
import { makeCode } from './fixtures.mjs';

// Independent BWIPP encoders exercise the actual decoder, including orientation and inversion.
function pixels(bcid, text, turns = 0, inverted = false) {
  const raw = bwip.raw({ bcid, text })[0];
  if (raw.sbs) {
    raw.pixx = raw.sbs.reduce((total, width) => total + width, 0);
    raw.pixy = 40;
    raw.pixs = new Uint8Array(raw.pixx * raw.pixy);
    let x = 0;
    raw.sbs.forEach((width, index) => {
      if (index % 2 === 0)
        for (let y = 0; y < raw.pixy; y++)
          raw.pixs.fill(1, y * raw.pixx + x, y * raw.pixx + x + width);
      x += width;
    });
  }
  let width = (raw.pixx + 20) * 4;
  let height = (raw.pixy + 20) * 4;
  let gray = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < raw.pixy; y++)
    for (let x = 0; x < raw.pixx; x++)
      if (raw.pixs[y * raw.pixx + x]) {
        for (let yy = 0; yy < 4; yy++)
          gray.fill(
            0,
            ((y + 10) * 4 + yy) * width + (x + 10) * 4,
            ((y + 10) * 4 + yy) * width + (x + 10) * 4 + 4
          );
      }
  for (let turn = 0; turn < turns; turn++) {
    const rotated = new Uint8ClampedArray(gray.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) rotated[x * height + height - y - 1] = gray[y * width + x];
    [width, height, gray] = [height, width, rotated];
  }
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < gray.length; i++)
    rgba.fill(inverted ? 255 - gray[i] : gray[i], i * 4, i * 4 + 3);
  return [rgba, width, height];
}

for (const bcid of ['qrcode', 'datamatrix', 'code128', 'pdf417']) {
  test(`${bcid} preserves the six-character ID in every orientation and inverted colors`, () => {
    for (const code of [makeCode(198), makeCode(4)]) {
      assert.equal(code.length, 6);
      assert.ok(validCode(code));
      const decoder = new BarcodeDecoder();
      for (let turns = 0; turns < 4; turns++)
        for (const inverted of [false, true])
          assert.equal(
            decoder.decode(...pixels(bcid, code, turns, inverted)),
            code,
            `${bcid}, rotation=${turns * 90}, inverted=${inverted}`
          );
    }
  });
}
test('blank frames do not invent identifiers', () => {
  assert.equal(
    new BarcodeDecoder().decode(new Uint8ClampedArray(160 * 120 * 4).fill(255), 160, 120),
    null
  );
});

test('small Code 128 labels survive video-range levels against a darker surround', () => {
  const code = makeCode(4);
  const [label, lw, lh] = pixels('code128', code);
  const width = 640,
    height = 480,
    targetWidth = 216;
  const targetHeight = Math.round((lh * targetWidth) / lw);
  for (const background of [48, 64, 80, 96]) {
    for (const [black, white] of [
      [0, 255],
      [16, 235],
      [24, 220],
    ]) {
      const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
      for (let i = 0; i < width * height; i++)
        rgba.fill(black + (background * (white - black)) / 255, i * 4, i * 4 + 3);
      for (let y = 0; y < targetHeight; y++)
        for (let x = 0; x < targetWidth; x++) {
          const source =
            (Math.floor((y * lh) / targetHeight) * lw + Math.floor((x * lw) / targetWidth)) * 4;
          const target =
            ((Math.floor((height - targetHeight) / 2) + y) * width +
              (width - targetWidth) / 2 +
              x) *
            4;
          rgba.fill(black + (label[source] * (white - black)) / 255, target, target + 3);
        }
      assert.equal(
        new BarcodeDecoder().decode(rgba, width, height),
        code,
        `background=${background}, black=${black}, white=${white}`
      );
    }
  }
});

test('Code 128 survives the antialiased Linux WebKit camera scanline', () => {
  // Grayscale scanline from our generated 222263 label in the failed Linux camera test.
  // Keep the surrounding video pixels: cropping to the white label hides the failure.
  const row = JSON.parse(
    readFileSync(new URL('./fixtures/code128-video-row.json', import.meta.url))
  );
  const width = row.length,
    height = 120;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value = y >= 40 && y < 80 ? row[x] : 80;
      rgba.fill(value, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  assert.equal(new BarcodeDecoder().decode(rgba, width, height), makeCode(4));
});

for (const bcid of ['qrcode', 'datamatrix']) {
  test(`${bcid} retains case-sensitive location and physical-bin routes`, () => {
    const location =
      'QRRLOC:1:1:1:' + Buffer.from(JSON.stringify({ 1: 'A-b' })).toString('base64url');
    const bin = 'QRRBIN:1:1:' + makeCode(4);
    for (const [route, key, payload] of [
      ['locations', 'location', location],
      ['bins', 'physical_bin', bin],
    ]) {
      const url =
        'https://example.test/custom/qrrouter/index.php#/' +
        route +
        '?' +
        new URLSearchParams({ [key]: payload });
      const decoded = new BarcodeDecoder().decode(...pixels(bcid, url));
      assert.equal(decoded, url);
      assert.equal(normalizeCode(decoded), payload);
    }
  });
}
