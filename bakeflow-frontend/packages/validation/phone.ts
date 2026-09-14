/**
 * Phone numbers for invitations and SMS sign-in (AD-026).
 *
 * The database stores invite phones in E.164 (`organization_invites_phone_e164`:
 * `^\+[1-9][0-9]{7,14}$`), and Supabase Auth identifies a phone account by the same digits. People
 * type Nigerian numbers the local way (`0803 123 4567`), so this turns what was typed into E.164
 * before anything is sent. Only unambiguous shapes are converted; anything else is refused rather
 * than guessed.
 */

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Nigeria — the market BakeFlow starts in. */
export const DEFAULT_COUNTRY_CODE = '234';

/**
 * Convert a typed phone number to E.164, or `null` when it cannot be read unambiguously.
 *
 * - `+234 803 123 4567`, `+2348031234567` → kept (separators removed)
 * - `00234 803…` → `+234803…`
 * - `0803 123 4567` (11 digits with a leading 0) → `+2348031234567`
 * - `2348031234567` (country code without +) → `+2348031234567`
 */
export function toE164Phone(raw: string, countryCode: string = DEFAULT_COUNTRY_CODE): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // Only digits, spaces and the usual separators; a letter means it is not a phone number.
  if (!/^[+0-9\s().-]+$/.test(trimmed)) return null;
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');

  let e164: string;
  if (plus) {
    e164 = `+${digits}`;
  } else if (digits.startsWith('00')) {
    e164 = `+${digits.slice(2)}`;
  } else if (digits.startsWith('0') && digits.length === 11 && countryCode === '234') {
    e164 = `+${countryCode}${digits.slice(1)}`;
  } else if (digits.startsWith(countryCode) && digits.length === countryCode.length + 10) {
    e164 = `+${digits}`;
  } else {
    return null;
  }
  return E164.test(e164) ? e164 : null;
}

/** `+2348031234567` → `+234 803 123 4567` for display; other countries are grouped loosely. */
export function formatPhone(e164: string): string {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (m !== null) return `+234 ${m[1]} ${m[2]} ${m[3]}`;
  return e164;
}
