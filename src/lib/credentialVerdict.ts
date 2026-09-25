/**
 * One verdict for a scanned residence ID card, shared by the public page
 * (`/v/$token`) and the staff scanner (`HararildScanner`).
 *
 * A valid signature proves who issued the card and that it was not altered;
 * only the registry knows whether it is still in force. The rule, from the
 * 2026-09-24 security audit (WP-CRY-001/002), is fail closed: green only when
 * the registry positively answers `active` and the card is not past its
 * expiry. Everything else is amber (genuine, but not a card in force, or
 * status unknown) or red (withdrawn, or not a card the registry knows).
 * Previously "no row" and "registry unreachable" both fell through to green.
 */

export type CredentialVerdict =
  /** Signature invalid or token malformed. Red. */
  | "invalid_signature"
  /** Registry answered `active`, card not expired. The only green verdict. */
  | "verified"
  /** Registry lists the card as revoked/suspended/replaced (or `invalid` to
   *  an anonymous caller). Red. */
  | "withdrawn"
  /** Genuine signature, but the registry has no such card. Red. */
  | "not_found"
  /** Prepared but not yet printed or handed over. Amber. */
  | "not_issued"
  /** Printed, not yet collected by its holder. Amber. */
  | "printed_not_collected"
  /** Past its expiry date (signed payload or registry). Amber. */
  | "expired"
  /** Genuine signature; the registry could not be reached (offline, network
   *  error, rate limit) or returned a status this code does not know. Amber. */
  | "status_unknown";

export type VerdictTone = "green" | "amber" | "red";

export interface VerdictInput {
  signatureValid: boolean;
  /** Expired according to the signed payload's own expiry date. */
  payloadExpired: boolean;
  /** true once the registry answered (with a row or with no row). */
  registryAnswered: boolean;
  /** The row's status, or null when the registry answered with no row. */
  registryStatus: string | null;
}

const WITHDRAWN = new Set(["revoked", "suspended", "replaced"]);

export function credentialVerdict(input: VerdictInput): CredentialVerdict {
  if (!input.signatureValid) return "invalid_signature";
  if (!input.registryAnswered) {
    // Status unknown. An expired card is still flagged as expired -- that
    // much the signed payload proves on its own -- but never as verified.
    return input.payloadExpired ? "expired" : "status_unknown";
  }
  const status = input.registryStatus;
  if (status === null) return "not_found";
  // A real withdrawn status (staff see it) outranks expiry: a revoked card is
  // red even after its date passes. The anonymous path collapses every
  // withdrawn status and `expired` into one `invalid`; there the signed
  // payload's own expiry decides whether that means "expired" (amber) or
  // "withdrawn" (red).
  if (WITHDRAWN.has(status)) return "withdrawn";
  if (input.payloadExpired || status === "expired") return "expired";
  if (status === "invalid") return "withdrawn";
  if (status === "ready_to_print" || status === "printing") return "not_issued";
  if (status === "printed") return "printed_not_collected";
  if (status === "active") return "verified";
  return "status_unknown";
}

export function verdictTone(verdict: CredentialVerdict): VerdictTone {
  switch (verdict) {
    case "verified":
      return "green";
    case "invalid_signature":
    case "withdrawn":
    case "not_found":
      return "red";
    default:
      return "amber";
  }
}
