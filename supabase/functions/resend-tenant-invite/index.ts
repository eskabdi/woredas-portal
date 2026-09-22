// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, isDuplicateEmailError, json, safeError } from "../_shared/response.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { getClientIp } from "../_shared/clientIp.ts";

// Same shape as resend-platform-invite, scoped to a tenant_admin's own
// woreda. app_user has no email column (it lives on auth.users) and
// app_user.username is deliberately just the local part of the email
// (email.split("@")[0], truncated to 32 chars) -- a client trying to
// reconstruct the address from it can only ever send GoTrue an invalid,
// domain-less string (the exact bug resend-platform-invite and
// invite-tenant-user's UI call site both had). So this function takes only
// a user_id and resolves the real email server-side via getUserById.
//
// Same six-role allowlist invite-tenant-user and send-password-reset-link
// both use for a tenant_admin caller -- an allowlist rather than excluding
// tenant_admin/super_admin by name, so a role added later fails closed here
// by default instead of silently becoming a permitted resend target.
const ALLOWED_TARGET_ROLES = new Set([
  "registry_clerk",
  "civil_registrar",
  "finance_clerk",
  "supervisor",
  "auditor",
  "viewer",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(req, 401, { error: "Missing authorization header" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Same F2 rule as every invite function: fail loudly rather than mail a
    // link built from whatever Site URL happens to be configured.
    const SITE_URL = Deno.env.get("SITE_URL");
    if (!SITE_URL) return json(req, 500, { error: "SITE_URL is not configured" });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(req, 401, { error: "Unauthorized" });
    const callerId = userData.user.id;

    const { user_id } = (await req.json()) as { user_id?: string };
    if (!user_id) return json(req, 400, { error: "user_id is required" });

    // Verify caller is an ACTIVE tenant_admin (or super_admin) -- a suspended
    // account's JWT is still live, so status is checked explicitly, same as
    // invite-tenant-user and send-password-reset-link.
    const { data: caller, error: callerErr } = await admin
      .from("app_user")
      .select("role, woreda_id, status")
      .eq("user_id", callerId)
      .maybeSingle();
    if (callerErr || !caller || caller.status !== "active")
      return json(req, 403, { error: "Forbidden" });

    const isSuper = caller.role === "super_admin";
    const isTenantAdmin = caller.role === "tenant_admin";
    if (!isSuper && !isTenantAdmin) return json(req, 403, { error: "Forbidden" });
    if (isTenantAdmin && !caller.woreda_id) return json(req, 403, { error: "Forbidden" });

    // Keyed by the VERIFIED caller, after the authz gate -- 10 per 10 minutes,
    // matching send-password-reset-link's budget: this is a per-target resend,
    // not bulk onboarding, so it doesn't need invite-tenant-user's larger
    // 20-per-10-min allowance.
    const { allowed } = await checkRateLimit(admin, `resend-tenant-invite:${callerId}`, 10, 600);
    if (!allowed) return json(req, 429, { error: "Too many requests" });

    // Target's woreda is re-derived from its own row, never taken from the
    // request -- the woreda filter is folded into this query, not applied
    // afterward, so a cross-tenant id and a nonexistent one both come back
    // "not found" for a tenant_admin, same as send-password-reset-link.
    let targetQuery = admin
      .from("app_user")
      .select("role, status, woreda_id")
      .eq("user_id", user_id);
    if (!isSuper) targetQuery = targetQuery.eq("woreda_id", caller.woreda_id);
    const { data: target, error: targetErr } = await targetQuery.maybeSingle();
    if (targetErr || !target) return json(req, 404, { error: "User not found" });

    // Same staff-only boundary invite-tenant-user and send-password-reset-link
    // both draw for a tenant_admin caller -- a tenant admin manages staff, not
    // peers or platform admins. Use resend-platform-invite for those.
    if (!ALLOWED_TARGET_ROLES.has(target.role)) {
      return json(req, 400, { error: "Cannot resend an invite for this role." });
    }
    if (target.status !== "pending") {
      return json(req, 400, { error: "This user has already completed setup." });
    }

    const {
      data: { user: targetUser },
      error: getUserErr,
    } = await admin.auth.admin.getUserById(user_id);
    if (getUserErr || !targetUser?.email) {
      return safeError(
        req,
        "resend-tenant-invite: getUserById",
        getUserErr,
        "Failed to resend invitation",
        400,
      );
    }
    const email = targetUser.email;

    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${SITE_URL}/set-password`,
    });
    if (inviteErr) {
      // Duplicate here means GoTrue considers the address already confirmed
      // even though app_user.status is still "pending" -- the account
      // clicked the invite link but never finished /set-password. Neither
      // this function nor send-password-reset-link (active-status only) can
      // reach that account from self-service; it needs a manual repair (see
      // CLAUDE.md/the rbac-remediation-tracker note on this exact class of
      // stuck account). Reuse the exact string errorMessages.ts already has
      // reviewed Amharic copy for, rather than a new untranslated one.
      return safeError(
        req,
        "resend-tenant-invite: inviteUserByEmail",
        inviteErr,
        isDuplicateEmailError(inviteErr)
          ? "User already registered"
          : "Failed to resend invitation",
        400,
      );
    }

    // House rule: verify the write actually matched a row rather than
    // inferring success from error === null alone.
    const { data: updated, error: updateErr } = await admin
      .from("app_user")
      .update({ invited_by_user_id: callerId, invited_at: new Date().toISOString() })
      .eq("user_id", user_id)
      .select("user_id")
      .maybeSingle();
    if (updateErr || !updated) {
      return safeError(
        req,
        "resend-tenant-invite: app_user invited_at update",
        updateErr ?? new Error(`app_user ${user_id} update matched no row`),
        "Invite resent but profile update failed",
        400,
      );
    }

    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      woreda_id: target.woreda_id,
      entity_name: "app_user",
      entity_id: user_id,
      action_type: "USER_REINVITED",
      new_value_json: {},
      source_ip: getClientIp(req),
    });

    return json(req, 200, { success: true });
  } catch (e) {
    return safeError(req, "resend-tenant-invite: unhandled", e, "Internal error", 500);
  }
});
