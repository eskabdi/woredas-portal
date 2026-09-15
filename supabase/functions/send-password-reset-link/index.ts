// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, json, safeError } from "../_shared/response.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { getClientIp } from "../_shared/clientIp.ts";

interface Body {
  user_id: string;
}

// Same boundary invite-tenant-user draws: a tenant admin manages staff, not
// peers or platform admins. Reused here rather than widened, so a tenant
// admin cannot use this to reset a co-admin's or a super_admin's password.
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

    const { user_id } = (await req.json()) as Body;
    if (!user_id) return json(req, 400, { error: "user_id is required" });

    // Verify caller is an ACTIVE tenant_admin or super_admin -- a suspended
    // account's JWT is still live, so status is checked explicitly, same as
    // every other privileged function here.
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
    // A tenant_admin row with no woreda_id shouldn't exist (invite-platform-admin
    // forces one on creation), but nothing enforces that at the database level.
    // Rejecting it here up front means the target query below never has to
    // reason about matching null against null.
    if (isTenantAdmin && !caller.woreda_id) return json(req, 403, { error: "Forbidden" });

    // Keyed by the VERIFIED caller, after the authz gate. Reset links are
    // rarer than invites and this also caps how many recovery emails one
    // admin session can direct at a single target if it were ever misused --
    // 10 per 10 minutes matches resend-platform-invite's budget.
    const { allowed } = await checkRateLimit(
      admin,
      `send-password-reset-link:${callerId}`,
      10,
      600,
    );
    if (!allowed) return json(req, 429, { error: "Too many requests" });

    if (user_id === callerId) {
      return json(req, 400, {
        error: "Use the change-password option for your own account instead.",
      });
    }

    // Target's woreda is re-derived from its own row, never taken from the
    // request, so a tenant admin cannot reach across tenants by supplying a
    // different id -- the same rule every cross-tenant check in this app
    // follows. The woreda filter is folded into THIS query, not applied
    // afterward, so a cross-tenant id and a genuinely nonexistent one both
    // come back "not found" for a tenant_admin -- matching
    // invite-tenant-user's reports_to_user_id check, which does the same for
    // the same reason: a separate 403 after a successful lookup would let a
    // tenant admin holding (or guessing) a UUID learn that it belongs to
    // *some* woreda, just not theirs.
    let targetQuery = admin
      .from("app_user")
      .select("role, status, woreda_id")
      .eq("user_id", user_id);
    if (!isSuper) targetQuery = targetQuery.eq("woreda_id", caller.woreda_id);
    const { data: target, error: targetErr } = await targetQuery.maybeSingle();
    if (targetErr || !target) return json(req, 404, { error: "User not found" });

    if (!ALLOWED_TARGET_ROLES.has(target.role)) {
      return json(req, 400, { error: "Cannot send a reset link for this role." });
    }
    if (target.status === "pending") {
      return json(req, 400, {
        error: "This user has never completed setup. Resend the invitation instead.",
      });
    }
    if (target.status !== "active") {
      return json(req, 400, {
        error: "This account is not active. Reactivate it before sending a reset link.",
      });
    }

    const { data: authUser, error: authUserErr } = await admin.auth.admin.getUserById(user_id);
    const targetEmail = authUser?.user?.email;
    if (authUserErr || !targetEmail) {
      return safeError(
        req,
        "send-password-reset-link: getUserById",
        authUserErr,
        "Could not resolve this user's email address",
        400,
      );
    }

    // A fresh, unauthenticated-scope client for the actual send. This hits
    // GoTrue's public /auth/v1/recover endpoint -- the same one the login
    // page's own "forgot password" flow would use if this app exposed one --
    // which is what makes GoTrue actually deliver the email; admin.generateLink()
    // does not send mail at all, it only returns a link for the caller to
    // deliver by their own means.
    //
    // redirectTo here is threaded as a query parameter by the client library,
    // not nested under a JSON `options` key -- so it is NOT the shape
    // CLAUDE.md warns about for `POST /admin/generate_link`, where the JS
    // client's `options.redirect_to` placement is silently ignored by the
    // server. Verified against this repo's locally pinned auth-js
    // (node_modules/@supabase/auth-js, GoTrueClient.js's resetPasswordForEmail
    // -> lib/fetch.js's qs['redirect_to'] = options.redirectTo). This function
    // imports supabase-js from esm.sh at a floating "@2", same as every other
    // Edge Function in this repo, so that exact source wasn't re-inspected for
    // THIS import -- but inviteUserByEmail (already proven working in
    // production; see docs/rbac-security-forensic-review.md's invite-link
    // notes) goes through the identical `_request(..., { redirectTo })` helper
    // for the same reason, so this isn't a new assumption, just the same one
    // this app already depends on elsewhere.
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { error: resetErr } = await anon.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${SITE_URL}/set-password`,
    });
    if (resetErr) {
      return safeError(
        req,
        "send-password-reset-link: resetPasswordForEmail",
        resetErr,
        "Failed to send the reset link",
        400,
      );
    }

    // Never write the email address itself into the audit row -- the row is
    // evidence that an admin action happened, not a place to duplicate PII.
    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      woreda_id: target.woreda_id,
      entity_name: "app_user",
      entity_id: user_id,
      action_type: "USER_PASSWORD_RESET_LINK_SENT",
      new_value_json: {},
      source_ip: getClientIp(req),
    });

    return json(req, 200, { success: true });
  } catch (e) {
    return safeError(req, "send-password-reset-link: unhandled", e, "Internal error", 500);
  }
});
