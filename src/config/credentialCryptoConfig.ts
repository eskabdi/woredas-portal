/**
 * Public half of the credential signing keypair — ECDSA P-256 (ES256).
 *
 * The private half lives only as the `HARARI_EC_PRIVATE_KEY` secret of the
 * `sign-credential` Edge Function. The two halves move together: replacing one
 * without the other silently invalidates every card already in circulation,
 * because a signature made by the old key will not verify against the new one.
 *
 * ES256 rather than RS256 is a physical constraint, not a preference. An ECDSA
 * signature is 64 bytes where RSA-2048's is 256; that difference is part of what
 * keeps the printed QR under the module density a 300 dpi card printer can
 * actually resolve. See the card design notes before changing the algorithm.
 */
export const CREDENTIAL_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEPnAkpBqKuVOgv0NnZ8xH3CuyMfcf
PQjjUuRx3PyjEz7mUCtgH2jO9FatfaUCG3kPcWTk9jn5PaXqtVFa+C8wvw==
-----END PUBLIC KEY-----`;

/** WebCrypto parameters for import; shared by the signer and every verifier. */
export const CREDENTIAL_KEY_IMPORT_PARAMS = {
  name: "ECDSA",
  namedCurve: "P-256",
} as const;

/** WebCrypto parameters for sign/verify. */
export const CREDENTIAL_SIGN_PARAMS = {
  name: "ECDSA",
  hash: "SHA-256",
} as const;

/**
 * Origin the card's QR points at.
 *
 * Deliberately NOT `window.location.origin`: a card printed from a laptop on
 * localhost would otherwise carry a QR nobody else can open, and the mistake
 * only surfaces once the cards are physically printed. Override per environment
 * with VITE_PUBLIC_SITE_URL.
 */
export const CREDENTIAL_VERIFY_ORIGIN = (
  import.meta.env.VITE_PUBLIC_SITE_URL || "https://woredas-portal.vercel.app"
).replace(/\/+$/, "");

/** Full URL encoded into the QR for a given signed token. */
export function credentialVerifyUrl(token: string): string {
  return `${CREDENTIAL_VERIFY_ORIGIN}/v/${token}`;
}
