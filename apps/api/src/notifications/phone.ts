// Phone numbers are stored as digits with the country code and no "+", the
// form WhatsApp providers expect, e.g. 6281234567890.

// Normalises what a customer typed: spaces, dashes, dots and brackets are
// ignored, "+62..." and "62..." are kept, and a leading 0 is a local number
// in `countryCode`. Returns null if it can't be a phone number.
export function normalizePhone(
  input: string,
  countryCode = '62',
): string | null {
  const compact = input.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(compact)) {
    return null;
  }
  const digits = compact.startsWith('+')
    ? compact.slice(1)
    : compact.startsWith('0')
      ? countryCode + compact.slice(1)
      : compact;
  // E.164: at most 15 digits, no leading zero.
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

// Enough for a customer to recognise their number, not enough to reveal it.
export const maskPhone = (phone: string) => `••••${phone.slice(-4)}`;
