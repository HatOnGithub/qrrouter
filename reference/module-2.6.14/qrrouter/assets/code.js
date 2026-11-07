/* QR Router short-code verification shared by the two camera views.
 * New labels: 5 base-31 symbols and one modulo-31 check symbol.
 * Legacy 10-character and prefixed codes remain valid unchanged.
 */
(function (root) {
  'use strict';
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  function normalize(value) { return String(value == null ? '' : value).trim().toUpperCase(); }
  function check(payload) {
    if (payload.length !== 5) return null;
    let state = 0;
    for (const c of payload) {
      const index = alphabet.indexOf(c);
      if (index === -1) return null;
      state = (state * 3 + index + 1) % 31;
    }
    return alphabet[state];
  }
  function valid(code) {
    if (typeof code !== 'string') return false;
    if (code.length === 6) return check(code.slice(0, 5)) === code[5];
    return /^(?:[A-HJ-NP-Z2-9]{10}|(?:ITM|GEN|BOX|QR)-[A-Z0-9_-]{6,48})$/.test(code);
  }
  root.QRRCode = Object.freeze({ normalize, valid, check });
})(window);
