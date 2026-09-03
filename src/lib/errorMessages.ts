/**
 * Maps the exact strings the six Edge Functions (and GoTrue, on their behalf)
 * throw to friendly, user-facing copy.
 *
 * Deliberately a single flat lookup consulted only by `translateError()`, so
 * F9 could swap values for bilingual copy without touching
 * `invokeEdgeFunction()` or any of its six call sites -- which is exactly
 * what happened below, for four entries (Forbidden, "Cannot provision this
 * role through tenant self-service.", "Missing required fields", "User
 * already registered"). Those four are the report's own §3.4 example table;
 * the Amharic has since been reviewed and approved by a native Amharic
 * speaker (the system owner) and is final copy, not placeholder text.
 * GENERIC_FALLBACK below also carries reviewed Amharic, but it's a separate
 * constant, not a fifth lookup entry. Every other entry stays English-only
 * on purpose:
 * generating Amharic for the rest without the same review risks shipping
 * actively wrong text to the exact Amharic-speaking users this fix exists
 * for.
 *
 * DO NOT add Amharic to another entry here without the same native-speaker
 * review.
 */

const GENERIC_FALLBACK =
  "የስርዓት ስህተት ተከስቷል፣ እባክዎ ቆይተው ይሞክሩ / Something went wrong — please try again in a moment";

const ERROR_MESSAGES: Record<string, string> = {
  // Auth / session
  "Missing authorization header": "You're not signed in. Please refresh and sign in again.",
  "Missing authorization": "You're not signed in. Please refresh and sign in again.",
  Unauthorized: "Your session has expired. Please sign in again.",
  "Invalid session": "Your session has expired. Please sign in again.",

  // Authorization
  Forbidden: "ይህን ለማድረግ ፈቃድ የሎትም / You don't have permission to do this",
  "Forbidden: only an active super_admin can call this function.":
    "Only an active platform administrator can do this.",
  "Forbidden: inviting a new super_admin requires console.console_users.manage.":
    "You don't have permission to invite a new platform administrator.",
  "Forbidden: only an active super_admin can resend platform invites.":
    "Only an active platform administrator can resend this invite.",
  "Cannot provision this role through tenant self-service.":
    "ይህን ሚና በዚህ መንገድ መስጠት አይቻልም — ከወረዳ አስተዳዳሪዎ ይጠይቁ / This role can't be assigned this way — ask your tenant administrator",

  // Validation
  "Invalid role": "Please choose a valid role.",
  "Invalid role. Must be 'super_admin' or 'tenant_admin'.": "Please choose a valid role.",
  "Invalid reports-to user": 'The selected "Reports To" user is not valid.',
  "Missing required fields": "እባክዎ ሁሉንም አስፈላጊ መስኮች ይሙሉ / Please fill in all required fields",
  "Missing fields": "Please fill in all required fields.",
  "woredaId is required for tenant_admin role.": "Please select a woreda for this role.",
  "super_admin must not be tied to a woreda.":
    "A platform administrator can't also be assigned to a woreda.",
  "email is required": "Please enter an email address.",
  "Target is not a platform admin.": "This user is not a platform administrator.",

  // Invite flow
  "No app_user profile found": "This user's profile could not be found.",
  "User already registered": "ይህ ኢሜይል ቀድሞ ተመዝግቧል / This email is already registered",
  "Failed to send invitation": "Failed to send the invitation. Please try again.",
  "Failed to resend invitation": "Failed to resend the invitation. Please try again.",
  "Invite sent but profile setup failed":
    "The invite email was sent, but profile setup failed. Ask an administrator to check this user.",
  "Failed to activate account":
    "Could not activate your account. Please try again, or contact your administrator.",
  "Failed to record login": "Could not record your login time.",

  // Rate limiting (INSA Phase B): the invite functions answer 429 with this
  // fixed string once a caller exhausts their per-user budget.
  "Too many requests": "Too many requests — please wait a few minutes and try again.",

  // Credential signing
  "Signing key not configured": "The credential signing key is not configured. Contact support.",
  "User not registered": "Your account isn't registered in this system.",
  "Account is not active": "Your account isn't active yet. Ask your administrator to activate it.",
  "Forbidden: requires credential.print":
    "You don't have permission to prepare a credential for printing.",
  "Woreda mismatch": "This account doesn't belong to this woreda.",
  "User lookup failed": "Could not look up your account. Please try again.",
  "Credential lookup failed": "Could not look up this credential. Please try again.",
  "Credential not found": "This credential could not be found.",
  "Credential woreda mismatch": "This credential doesn't belong to this woreda.",
  "Credential already signed": "This credential has already been signed.",
  "Credential is not ready to print": "This credential is not ready to print.",
  "Failed to save the signed credential": "Could not save the signed credential. Please try again.",
  "Credential signing failed": "Credential signing failed. Please try again.",
  "Resident lookup failed": "Could not look up this resident. Please try again.",
  "Resident not found": "This resident could not be found.",

  // Deploy/config issues -- not user-actionable, but shouldn't leak raw text
  "SITE_URL is not configured": "The server is misconfigured. Contact support.",

  // A user should never see these verbatim (F1's own root cause; "Internal
  // error" is Phase B's fixed catch-all for genuinely unexpected exceptions,
  // where generic copy is the only honest copy)
  "Method not allowed": GENERIC_FALLBACK,
  "Edge Function returned a non-2xx status code": GENERIC_FALLBACK,
  "Internal error": GENERIC_FALLBACK,
};

/** Translates a raw Edge Function/GoTrue error string into user-facing copy. */
export function translateError(raw: string | null | undefined): string {
  if (!raw) return GENERIC_FALLBACK;
  return ERROR_MESSAGES[raw] ?? GENERIC_FALLBACK;
}
