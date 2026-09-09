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
    // follows.
    const { data: target, error: targetErr } = await admin
      .from("app_user")
      .select("role, status, woreda_id")
      .eq("user_id", user_id)
      .maybeSingle();
    if (targetErr || !target) return json(req, 404, { error: "User not found" });

    if (!isSuper && target.woreda_id !== caller.woreda_id) {
      return json(req, 403, { error: "Forbidden" });
    }
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
    // redirectTo here is threaded as a query parameter by the client library
    // (see node_modules/@supabase/auth-js .../fetch.js), not nested under a
    // JSON `options` key -- so it is NOT the shape CLAUDE.md warns about for
    // `POST /admin/generate_link`, where the JS client's `options.redirect_to`
    // placement is silently ignored by the server. Confirmed against this
    // repo's pinned auth-js before relying on it.
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
