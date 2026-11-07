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
export function normalizeCode(raw: string): string {
  let value = raw.trim();
  try {
    const url = new URL(value);
    value = url.searchParams.get('code') || value;
  } catch {
    /* Manual identifiers are not URLs. */
  }
  return value.trim().toUpperCase();
}
