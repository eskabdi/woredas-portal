/**
 * Detects a decrypt-failure anomaly on a Phase C encrypted field: the
 * plaintext column (still present during the stage 1-3 transition) holds a
 * real value, but decrypt_pii_text()/decrypt_pii_numeric() returned NULL for
 * its `_enc` counterpart. This is NOT the "resident has no phone on file"
 * case -- both plaintext and decrypted are null there, a valid state this
 * function does not flag. It is specifically the case where a real value
 * exists but could not be read back (Vault secret rotated/absent, a row
 * whose _enc predates the key, corrupt ciphertext).
 *
 * The `decrypted ?? plaintext` fallback used throughout this codebase (see
 * docs/security-functionality.md's "NULL-decrypt fallback policy") already
 * recovers from this silently -- the value shown/saved is still correct,
 * since the plaintext column is the fallback. What it does not do is signal
 * that anything went wrong. This function adds that signal for the call
 * sites where it matters most: form inputs pre-filled from a decrypted
 * value, where a staff member acting on an unverified value (without
 * knowing it's unverified) is the actual risk -- not data loss, which the
 * fallback already prevents.
 */
export function resolveDecryptedField<T extends string | number>(
  decrypted: T | null | undefined,
  plaintext: T | null | undefined,
): { value: T | null; decryptFailed: boolean } {
  const hasPlaintext = plaintext !== null && plaintext !== undefined && plaintext !== "";
  const hasDecrypted = decrypted !== null && decrypted !== undefined;
  const decryptFailed = hasPlaintext && !hasDecrypted;
  return {
    value: (hasDecrypted ? decrypted : (plaintext ?? null)) as T | null,
    decryptFailed,
  };
}

/** Bilingual warning shown next to a form field whose value could not be
 * cryptographically verified -- see resolveDecryptedField above. */
export const DECRYPT_UNVERIFIED_WARNING = {
  am: "ይህ ዋጋ ማረጋገጥ አልተቻለም — ያለፈውን መረጃ እያሳየን ነው። ችግሩ ከቀጠለ አስተዳዳሪዎን ያነጋግሩ።",
  en: "This value could not be cryptographically verified — showing the last known value. Contact your administrator if this persists.",
};
