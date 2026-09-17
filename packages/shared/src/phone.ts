/**
 * Kyrgyz phone numbers only. National format is 9 digits after the +996 country code.
 * Mobile prefixes in use: 2xx (Beeline), 5xx (MegaCom/O!), 7xx (Beeline/O!), 9xx (MegaCom).
 */
export const KG_COUNTRY_CODE = '+996';
export const KG_PHONE_E164 = /^\+996[2579]\d{8}$/;

/** Strip everything except digits. */
export function digitsOnly(input: string): string {
  return (input || '').replace(/\D+/g, '');
}

/**
 * Normalise any user input to E.164 (+996XXXXXXXXX) or return null if it is not a KG mobile number.
 * Accepts "0555 123 456", "555123456", "+996 555 123 456", "996555123456".
 */
export function normalizeKgPhone(input: string): string | null {
  let d = digitsOnly(input);
  if (d.startsWith('996')) d = d.slice(3);
  if (d.length === 10 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 9) return null;
  const e164 = `${KG_COUNTRY_CODE}${d}`;
  return KG_PHONE_E164.test(e164) ? e164 : null;
}

/** "+996555123456" -> "+996 555 123 456" */
export function formatKgPhone(e164: string): string {
  const d = digitsOnly(e164);
  const local = d.startsWith('996') ? d.slice(3) : d;
  const parts = [local.slice(0, 3), local.slice(3, 6), local.slice(6, 9)].filter(Boolean);
  return `${KG_COUNTRY_CODE} ${parts.join(' ')}`.trim();
}

/** Mask for input widgets: "555 123 456" built progressively from typed digits. */
export function maskKgLocal(localDigits: string): string {
  const d = digitsOnly(localDigits).slice(0, 9);
  const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean);
  return parts.join(' ');
}

/** "+996555123456" -> "+996 555 *** *56" */
export function maskPhoneForDisplay(e164: string): string {
  const d = digitsOnly(e164);
  const local = d.startsWith('996') ? d.slice(3) : d;
  if (local.length !== 9) return e164;
  return `${KG_COUNTRY_CODE} ${local.slice(0, 3)} *** *${local.slice(7)}`;
}
