import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, json, safeError } from "../_shared/response.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { getClientIp } from "../_shared/clientIp.ts";
import { CONSOLE_PERM, hasAnyConsolePerm } from "../_shared/consolePerm.ts";

// P0-4 (WP-DB-001 / WP-AUTH-002). Suspending a user used to be a plain
// client-side app_user.status update: the database stopped answering their
// queries (migration 97), but their GoTrue session and refresh token kept
// working. This function is now the one path that changes a staff or
// platform-admin account's status, and it bans / unbans the auth user in the
// same call so a suspended account cannot mint a new access token either.
//
// Caller is resolved from their own JWT, never the request body. A tenant
// admin may change staff in their own woreda only; a super_admin may change
// anyone but themselves, with a console key (P1-7): Tenants or Users for
// staff, Users for tenant_admin / super_admin targets.

interface Body {
  user_id?: string;
  status?: string;
}

const STAFF_ROLES = new Set([
  "registry_clerk",
  "civil_registrar",
  "finance_clerk",
  "supervisor",
  "auditor",
  "viewer",
  "print_officer",
  "custom",
]);
const PLATFORM_ADMIN_ROLES = new Set(["tenant_admin", "super_admin"]);
const TARGET_STATUSES = new Set(["active", "suspended", "inactive"]);
// ~100 years: GoTrue's ban is a duration, not a flag. "none" lifts it.
const BAN_DURATION = "876000h";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(req, 401, { error: "Missing authorization header" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(req, 401, { error: "Unauthorized" });
    const callerId = userData.user.id;

    const { user_id, status } = ((await req.json().catch(() => ({}))) ?? {}) as Body;
    if (typeof user_id !== "string" || !UUID_RE.test(user_id)) {
      return json(req, 400, { error: "user_id is required" });
    }
    if (typeof status !== "string" || !TARGET_STATUSES.has(status)) {
      return json(req, 400, { error: "Invalid status" });
    }
    if (user_id === callerId) {
      return json(req, 400, { error: "You cannot change the status of your own account." });
    }

    const { data: caller, error: callerErr } = await admin
      .from("app_user")
      .select("role, woreda_id, status")
      .eq("user_id", callerId)
      .maybeSingle();
    if (callerErr || !caller || caller.status !== "active") {
      return json(req, 403, { error: "Forbidden" });
    }
    const isSuper = caller.role === "super_admin";
    const isTenantAdmin = caller.role === "tenant_admin" && !!caller.woreda_id;
    if (!isSuper && !isTenantAdmin) return json(req, 403, { error: "Forbidden" });

    const { allowed } = await checkRateLimit(admin, `set-staff-status:${callerId}`, 30, 600);
    if (!allowed) return json(req, 429, { error: "Too many requests" });

    // A tenant admin's lookup is folded into the woreda filter, so another
    // tenant's user and a nonexistent id both read "not found" (same rule as
    // send-password-reset-link).
    let targetQuery = admin
      .from("app_user")
      .select("role, status, woreda_id")
      .eq("user_id", user_id);
    if (!isSuper) targetQuery = targetQuery.eq("woreda_id", caller.woreda_id);
    const { data: target, error: targetErr } = await targetQuery.maybeSingle();
    if (targetErr || !target) return json(req, 404, { error: "User not found" });

    const targetIsAdmin = PLATFORM_ADMIN_ROLES.has(target.role);
    if (!STAFF_ROLES.has(target.role) && !targetIsAdmin) {
      return json(req, 400, { error: "Cannot change the status of this role." });
    }
    if (targetIsAdmin && !isSuper) return json(req, 403, { error: "Forbidden" });
    if (isSuper) {
      const keys = targetIsAdmin
        ? [CONSOLE_PERM.USERS_MANAGE]
        : [CONSOLE_PERM.TENANTS_MANAGE, CONSOLE_PERM.USERS_MANAGE];
      if (!(await hasAnyConsolePerm(userClient, keys))) {
        return json(req, 403, { error: "Forbidden" });
      }
    }

    // A pending account has never set a password; activate-invited-user is
    // the only way it becomes active.
    if (target.status === "pending" && status === "active") {
      return json(req, 400, { error: "This invitation has not been accepted yet." });
    }
    const disabling = status !== "active";

    // Re-applying the current status is not a no-op for the session side: an
    // account suspended before this function existed was never banned, so
    // the ban (or unban) is still applied and only the row update is skipped.
    if (target.status === status) {
      const { error: banErr } = await admin.auth.admin.updateUserById(user_id, {
        ban_duration: disabling ? BAN_DURATION : "none",
      });
      if (banErr) {
        return safeError(req, "set-staff-status: re-ban", banErr, "Status update failed", 500);
      }
      return json(req, 200, { ok: true, status, unchanged: true });
    }

    // Order is chosen so a partial failure always leaves the safer state:
    // disabling flips the DB status first (access stops at once), then bans;
    // re-enabling unbans first, then flips the status.
    if (!disabling) {
      const { error: unbanErr } = await admin.auth.admin.updateUserById(user_id, {
        ban_duration: "none",
      });
      if (unbanErr) {
        return safeError(req, "set-staff-status: unban", unbanErr, "Status update failed", 500);
      }
    }

    const { data: updated, error: updErr } = await admin
      .from("app_user")
      .update({ status })
      .eq("user_id", user_id)
      .eq("status", target.status)
      .select("user_id, status")
      .maybeSingle();
    if (updErr) {
      // prevent_last_super_admin_lockout raises here for the last active
      // super_admin; the generic message still fits.
      return safeError(req, "set-staff-status: update", updErr, "Status update failed", 400);
    }
    if (!updated) return json(req, 409, { error: "This user was changed by someone else." });

    if (disabling) {
      const { error: banErr } = await admin.auth.admin.updateUserById(user_id, {
        ban_duration: BAN_DURATION,
      });
      if (banErr) {
        // The database already denies this account; report the failure so the
        // admin knows the session was not cut, and leave the row suspended.
        return safeError(req, "set-staff-status: ban", banErr, "Status update failed", 500);
      }
    }

    const action = targetIsAdmin
      ? disabling
        ? "PLATFORM_ADMIN_SUSPENDED"
        : "PLATFORM_ADMIN_REACTIVATED"
      : status === "active"
        ? "USER_REACTIVATED"
        : status === "inactive"
          ? "USER_DEACTIVATED"
          : "USER_SUSPENDED";
    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      woreda_id: target.woreda_id,
      entity_name: "app_user",
      entity_id: user_id,
      action_type: action,
      old_value_json: { status: target.status },
      new_value_json: { status, role: target.role, session_revoked: disabling },
      source_ip: getClientIp(req),
    });

    return json(req, 200, { ok: true, status });
  } catch (e) {
    return safeError(req, "set-staff-status: unhandled", e, "Status update failed", 500);
  }
});
