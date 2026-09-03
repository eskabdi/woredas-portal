// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, isDuplicateEmailError, json, safeError } from "../_shared/response.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { getClientIp } from "../_shared/clientIp.ts";

interface Body {
  email: string;
  full_name: string;
  role: string;
  woredaId: string;
  department?: string | null;
  job_title?: string | null;
  reports_to_user_id?: string | null;
  signature_path?: string | null;
  photo_path?: string | null;
}

const ALLOWED_ROLES = new Set([
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
    // Without this the invite link falls back to whichever Site URL happens to
    // be configured in the dashboard -- never guaranteed to be /set-password,
    // and never guaranteed to even be this deploy. Fail loudly rather than
    // silently mailing a link nobody can complete: see docs/rbac-security-
    // forensic-review.md, F2.
    const SITE_URL = Deno.env.get("SITE_URL");
    if (!SITE_URL) return json(req, 500, { error: "SITE_URL is not configured" });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(req, 401, { error: "Unauthorized" });
    const callerId = userData.user.id;

    const body = (await req.json()) as Body;
    const {
      email,
      full_name,
      role,
      woredaId,
      department,
      job_title,
      reports_to_user_id,
      signature_path,
      photo_path,
    } = body ?? ({} as Body);
    if (!email || !full_name || !role || !woredaId) {
      return json(req, 400, { error: "Missing required fields" });
    }

    if (role === "tenant_admin" || role === "super_admin") {
      return json(req, 400, { error: "Cannot provision this role through tenant self-service." });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return json(req, 400, { error: "Invalid role" });
    }

    // Verify caller is an ACTIVE tenant_admin (or super_admin) of the target
    // woreda -- a suspended account's JWT is still live, so status has to be
    // checked explicitly here same as the platform-admin invite function.
    const { data: caller, error: callerErr } = await admin
      .from("app_user")
      .select("role, woreda_id, status")
      .eq("user_id", callerId)
      .maybeSingle();
    if (callerErr || !caller || caller.status !== "active")
      return json(req, 403, { error: "Forbidden" });

    const isSuper = caller.role === "super_admin";
    const isTenantAdmin = caller.role === "tenant_admin" && caller.woreda_id === woredaId;
    if (!isSuper && !isTenantAdmin) return json(req, 403, { error: "Forbidden" });

    // Keyed by the VERIFIED caller (never anything request-supplied), after
    // the authz gate so unauthenticated junk can't spend database writes.
    // 20 invites per 10 minutes comfortably covers onboarding a whole office
    // while capping an abused/leaked admin session's invite spam.
    const { allowed } = await checkRateLimit(admin, `invite-tenant-user:${callerId}`, 20, 600);
    if (!allowed) return json(req, 429, { error: "Too many requests" });

    if (reports_to_user_id) {
      const { data: manager } = await admin
        .from("app_user")
        .select("user_id")
        .eq("user_id", reports_to_user_id)
        .eq("woreda_id", woredaId)
        .maybeSingle();
      if (!manager) return json(req, 400, { error: "Invalid reports-to user" });
    }

    // Send invite
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${SITE_URL}/set-password`,
    });
    if (inviteErr || !invited?.user) {
      return safeError(
        req,
        "invite-tenant-user: inviteUserByEmail",
        inviteErr,
        isDuplicateEmailError(inviteErr) ? "User already registered" : "Failed to send invitation",
        400,
      );
    }
    const newUserId = invited.user.id;

    // Insert app_user row
    const username = email.split("@")[0]?.slice(0, 32) ?? email;
    const { error: insertErr } = await admin.from("app_user").insert({
      user_id: newUserId,
      woreda_id: woredaId,
      role,
      full_name,
      username,
      status: "pending",
      invited_by_user_id: callerId,
      invited_at: new Date().toISOString(),
      department: department || null,
      job_title: job_title || null,
      reports_to_user_id: reports_to_user_id || null,
      signature_path: signature_path || null,
      photo_path: photo_path || null,
    });
    if (insertErr) {
      return safeError(
        req,
        "invite-tenant-user: app_user insert",
        insertErr,
        "Invite sent but profile setup failed",
        400,
      );
    }

    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      woreda_id: woredaId,
      entity_name: "app_user",
      entity_id: newUserId,
      action_type: "USER_INVITED",
      new_value_json: { email, role, full_name },
      source_ip: getClientIp(req),
    });

    return json(req, 200, { success: true, user_id: newUserId });
  } catch (e) {
    return safeError(req, "invite-tenant-user: unhandled", e, "Internal error", 500);
  }
});
