import { z } from "zod";

/**
 * Shared handling for every phone-number field in the app. The country code
 * is fixed at +251 (Ethiopia, the only jurisdiction this app operates in)
 * and every stored/collected value is the 9-digit local part after it --
 * never the leading 0 Ethiopian numbers are dialled with locally
 * (0911234567 dialled locally is 911234567 after the country code).
 */
export const PHONE_COUNTRY_CODE = "+251";

const PHONE_DIGITS_ERROR_AM = "ልክ 9 አሃዝ መሆን አለበት";
const PHONE_DIGITS_ERROR_EN = "Must be exactly 9 digits";
/** Bilingual, for the Amharic-primary woreda portal. */
export const PHONE_DIGITS_ERROR = `${PHONE_DIGITS_ERROR_AM} / ${PHONE_DIGITS_ERROR_EN}`;
/** English-only, for the admin console (bilingual labels there are per-page, not a blanket convention). */
export const PHONE_DIGITS_ERROR_EN_ONLY = PHONE_DIGITS_ERROR_EN;

/**
 * Normalizes free-typed or pasted input into the 9-digit local part: strips
 * everything but digits, strips a leading 251 (the country code typed or
 * pasted without its +), then strips a single leading 0 (the local dialling
 * prefix -- 0911234567 -> 911234567). Deliberately does NOT truncate to 9
 * digits -- an overlong result must fail isValidPhoneDigits visibly, not get
 * silently cut down to a different, wrong number.
 */
export function sanitizePhoneDigits(raw: string): string {
  let v = raw.replace(/\D/g, "");
  if (v.startsWith("251")) v = v.slice(3);
  if (v.startsWith("0")) v = v.slice(1);
  return v;
}

/** Empty is valid (every phone field in this app is optional); anything else must be exactly 9 digits. */
export function isValidPhoneDigits(v: string): boolean {
  return v === "" || /^\d{9}$/.test(v);
}

/** Builds the stored/submitted E.164-ish value, or null for an empty field. */
export function phoneDigitsToE164(v: string): string | null {
  return v ? `${PHONE_COUNTRY_CODE}${v}` : null;
}

/** Zod field for the 9-digit local part, reused by every form schema that collects a phone number. */
export function phoneDigitsSchema() {
  return z.string().trim().optional().default("").refine(isValidPhoneDigits, PHONE_DIGITS_ERROR);
}
