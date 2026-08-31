/**
 * Maps the exact strings the six Edge Functions (and GoTrue, on their behalf)
 * throw to friendly, user-facing copy.
 *
 * English-only for now — Amharic-first copy is F9's job, once a native
 * speaker has reviewed it (see docs/rbac-security-forensic-review.md §3.4).
 * Deliberately a single flat lookup consulted only by `translateError()`, so
 * F9 can swap each value for bilingual copy later without touching
 * `invokeEdgeFunction()` or any of its six call sites.
 */

const GENERIC_FALLBACK = "Something went wrong. Please try again in a moment.";

const ERROR_MESSAGES: Record<string, string> = {
  // Auth / session
  "Missing authorization header": "You're not signed in. Please refresh and sign in again.",
  "Missing authorization": "You're not signed in. Please refresh and sign in again.",
  Unauthorized: "Your session has expired. Please sign in again.",
  "Invalid session": "Your session has expired. Please sign in again.",

  // Authorization
  Forbidden: "You don't have permission to do this.",
  "Forbidden: only an active super_admin can call this function.":
    "Only an active platform administrator can do this.",
  "Forbidden: inviting a new super_admin requires console.console_users.manage.":
    "You don't have permission to invite a new platform administrator.",
  "Forbidden: only an active super_admin can resend platform invites.":
    "Only an active platform administrator can resend this invite.",
  "Cannot provision this role through tenant self-service.":
    "This role can't be assigned this way — ask your tenant administrator.",

  // Validation
  "Invalid role": "Please choose a valid role.",
  "Invalid role. Must be 'super_admin' or 'tenant_admin'.": "Please choose a valid role.",
  "Invalid reports-to user": 'The selected "Reports To" user is not valid.',
  "Missing required fields": "Please fill in all required fields.",
  "Missing fields": "Please fill in all required fields.",
  "woredaId is required for tenant_admin role.": "Please select a woreda for this role.",
  "super_admin must not be tied to a woreda.":
    "A platform administrator can't also be assigned to a woreda.",
  "email is required": "Please enter an email address.",
  "Target is not a platform admin.": "This user is not a platform administrator.",

  // Invite flow
  "No app_user profile found": "This user's profile could not be found.",
  "User already registered": "This email is already registered.",
  "Failed to send invitation": "Failed to send the invitation. Please try again.",

  // Credential signing
  "Signing key not configured": "The credential signing key is not configured. Contact support.",
  "User not registered": "Your account isn't registered in this system.",
  "Woreda mismatch": "This account doesn't belong to this woreda.",
  "Credential lookup failed": "Could not look up this credential. Please try again.",
  "Credential not found": "This credential could not be found.",
  "Credential woreda mismatch": "This credential doesn't belong to this woreda.",
  "Credential already signed": "This credential has already been signed.",
  "Resident lookup failed": "Could not look up this resident. Please try again.",
  "Resident not found": "This resident could not be found.",

  // Deploy/config issues -- not user-actionable, but shouldn't leak raw text
  "SITE_URL is not configured": "The server is misconfigured. Contact support.",

  // A user should never see either of these verbatim (F1's own root cause)
  "Method not allowed": GENERIC_FALLBACK,
  "Edge Function returned a non-2xx status code": GENERIC_FALLBACK,
};

/** Translates a raw Edge Function/GoTrue error string into user-facing copy. */
export function translateError(raw: string | null | undefined): string {
  if (!raw) return GENERIC_FALLBACK;
  return ERROR_MESSAGES[raw] ?? GENERIC_FALLBACK;
}
