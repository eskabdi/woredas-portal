/**
 * Origin a civil certificate's QR points at. Deliberately NOT
 * window.location.origin -- a certificate printed from a laptop on localhost
 * would otherwise carry a QR nobody else can open (same reasoning as
 * receiptVerify.ts and credentialCryptoConfig.ts).
 */
export const CERTIFICATE_VERIFY_ORIGIN = (
  import.meta.env.VITE_PUBLIC_SITE_URL || "https://woredas-portal.vercel.app"
).replace(/\/+$/, "");

/** Full URL encoded into a certificate's QR for its verification token. */
export function certificateVerifyUrl(token: string): string {
  return `${CERTIFICATE_VERIFY_ORIGIN}/verify/certificate/${encodeURIComponent(token)}`;
}
