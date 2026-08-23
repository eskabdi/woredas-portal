/**
 * Origin the receipt's QR points at. Deliberately NOT `window.location.origin`
 * -- same reasoning as CREDENTIAL_VERIFY_ORIGIN in credentialCryptoConfig.ts:
 * a receipt printed from a laptop on localhost would otherwise carry a QR
 * nobody else can open. Kept as its own small constant rather than importing
 * the credential one, since receipts and credentials are unrelated document
 * types that happen to need the same origin lookup.
 */
export const RECEIPT_VERIFY_ORIGIN = (
  import.meta.env.VITE_PUBLIC_SITE_URL || "https://woredas-portal.vercel.app"
).replace(/\/+$/, "");

/** Full URL encoded into a receipt's QR for a given verification token. */
export function receiptVerifyUrl(token: string): string {
  return `${RECEIPT_VERIFY_ORIGIN}/verify/receipt/${token}`;
}
