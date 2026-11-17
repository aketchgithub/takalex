// Phone numbers for SMS codes (password reset, verifying a number). Pure
// TypeScript, tested by phoneNumber.test.ts.
//
// Supabase Auth wants E.164 ("+254712345678"). People in Kenya type local
// forms, so these are accepted and converted:
//   0712 345 678 · 0112 345 678 · 712345678 · 254712345678 · +254 712 345 678
// Any other country: the full international number starting with "+".

export type PhoneResult = { ok: true; e164: string } | { ok: false; message: string };

export const PHONE_HINT = "Enter a mobile number like 0712 345 678, or an international number starting with +.";

export function normalisePhone(input: string): PhoneResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, message: "Enter your phone number." };

  const compact = trimmed.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return { ok: false, message: PHONE_HINT };

  const plus = compact.startsWith("+");
  const digits = plus ? compact.slice(1) : compact;

  // Kenyan mobile numbers: 9 digits after the country code, starting 7 or 1.
  const kenyan = (national: string): PhoneResult =>
    /^[71]\d{8}$/.test(national) ? { ok: true, e164: `+254${national}` } : { ok: false, message: PHONE_HINT };

  if (plus) {
    if (digits.startsWith("254")) return kenyan(digits.slice(3));
    // E.164: at most 15 digits; no country code starts with 0.
    return /^[1-9]\d{7,14}$/.test(digits) ? { ok: true, e164: `+${digits}` } : { ok: false, message: PHONE_HINT };
  }
  if (digits.startsWith("254") && digits.length === 12) return kenyan(digits.slice(3));
  if (digits.startsWith("0") && digits.length === 10) return kenyan(digits.slice(1));
  if (digits.length === 9) return kenyan(digits);
  return { ok: false, message: PHONE_HINT };
}

// For display. Auth returns the number without "+" (e.g. "254712345678").
export function formatPhone(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const digits = stored.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("254") && digits.length === 12) {
    return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  return `+${digits}`;
}

// Whether two numbers (in any accepted form) are the same.
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/\D/g, "") === b.replace(/\D/g, "");
}
