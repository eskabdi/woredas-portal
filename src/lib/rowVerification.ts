/**
 * Shown when an admin-facing mutation's `.update().select().maybeSingle()`
 * comes back with no row -- RLS silently filtered the target rather than the
 * database raising an error. See docs/rbac-security-forensic-review.md, F6,
 * and the house rule in CLAUDE.md this message exists to make visible.
 */
export const ROW_VERIFICATION_FAILURE_MESSAGE =
  "This user could no longer be found, or you may no longer have permission for this — refresh and try again.";

/** Same failure mode, for mutations targeting a role rather than a user. */
export const ROLE_ROW_VERIFICATION_FAILURE_MESSAGE =
  "This role could no longer be found, or you may no longer have permission for this — refresh and try again.";
