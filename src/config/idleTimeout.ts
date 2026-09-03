// INSA Enforcer Phase 3 requires an explicit inactivity timeout in the
// 15-30 minute band. 20 idle minutes shows a warning toast with a "stay
// signed in" action; 25 idle minutes forces sign-out. Hardcoded for v1 --
// a per-tenant, woreda_settings-driven value would need a schema and
// settings-UI change and is deliberately out of scope (noted in the INSA
// remediation plan as a future enhancement).
export const IDLE_WARNING_MS = 20 * 60 * 1000;
export const IDLE_LOGOUT_MS = 25 * 60 * 1000;

/** How often the idle check runs. Timer callbacks don't fire while a laptop
 * sleeps or a tab is frozen, so an absolute-timestamp check on a short
 * interval (rather than one long setTimeout armed at the deadline) is what
 * makes an expired session get caught promptly on wake/return. */
export const IDLE_CHECK_INTERVAL_MS = 15 * 1000;

/** localStorage key sharing "last activity" across this origin's tabs, so an
 * idle background tab doesn't sign out a user actively working in another
 * tab -- supabase-js broadcasts SIGNED_OUT to every open tab, so one tab's
 * idle timer firing would otherwise end all of them. */
export const IDLE_LAST_ACTIVITY_STORAGE_KEY = "woredas.idle.lastActivityAt";
