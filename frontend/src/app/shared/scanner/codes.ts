const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function validCode(code: string): boolean {
  if (code.length === 6) {
    let state = 0;
    for (const char of code.slice(0, 5)) {
      const index = alphabet.indexOf(char);
      if (index < 0) return false;
      state = (state * 3 + index + 1) % 31;
    }
    return alphabet[state] === code[5];
  }
  return /^(?:[A-HJ-NP-Z2-9]{10}|(?:ITM|GEN|BOX|QR)-[A-Z0-9_-]{6,48})$/.test(code);
}
/** Accept bare IDs or module URLs; encoded location/bin payloads must retain their original case. */
export function normalizeCode(raw: string): string {
  let value = raw.trim();
  try {
    const url = new URL(value);
    const query = new URLSearchParams(url.hash.split('?')[1] || '');
    value =
      query.get('location') || query.get('physical_bin') || url.searchParams.get('code') || value;
  } catch {
    /* Manual identifiers are not URLs. */
  }
  return /^(QRRLOC|QRRBIN):/.test(value) ? value.trim() : value.trim().toUpperCase();
}

export function locationCode(code: string): boolean {
  return (
    code.length <= 4096 && /^QRRLOC:1:[1-9][0-9]{0,8}:[1-9][0-9]{0,8}:[A-Za-z0-9_-]+$/.test(code)
  );
}
export function physicalBinCode(code: string): boolean {
  return /^QRRBIN:1:[1-9][0-9]{0,8}:[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(code);
}
