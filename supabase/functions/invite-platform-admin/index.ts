// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// F10 (docs/rbac-security-forensic-review.md): "*" admitted cross-origin
// requests from any page unconditionally. Harmless given the bearer-token
// (not cookie) auth model -- CORS can't leak or forge that token to a third
// party -- but inconsistent with the narrow, explicit allow-list this app
// already applies to Supabase Auth redirect URLs. SITE_URL is the same
// secret F2 introduced; localhost:5173 covers local dev against the real
// project (this repo has no staging project).
const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("SITE_URL"), "http://localhost:5173"]
    .filter((o): o is string => !!o)
    .map((o) => o.trim().replace(/\/+$/, "")),
);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

interface Body {
  email: string;
  full_name: string;
  role: "super_admin" | "tenant_admin";
  woredaId?: string | null;
}

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
    const { email, full_name, role } = body ?? ({} as Body);
    const woredaId = body?.woredaId ?? null;

    if (!email || !full_name || !role) {
      return json(req, 400, { error: "Missing required fields" });
    }
    if (role !== "super_admin" && role !== "tenant_admin") {
      return json(req, 400, { error: "Invalid role. Must be 'super_admin' or 'tenant_admin'." });
    }
    if (role === "tenant_admin" && !woredaId) {
      return json(req, 400, { error: "woredaId is required for tenant_admin role." });
    }
    if (role === "super_admin" && woredaId) {
      return json(req, 400, { error: "super_admin must not be tied to a woreda." });
    }

    // Verify caller is an ACTIVE super_admin -- a suspended super_admin's
    // JWT is still live (suspension doesn't revoke it), and is_super_admin()
    // now requires status = 'active' too (00000000000011), so this must
    // match or a suspended caller could still mint new admin accounts.
    const { data: caller, error: callerErr } = await admin
      .from("app_user")
      .select("role, status")
      .eq("user_id", callerId)
      .maybeSingle();
    if (callerErr || !caller) return json(req, 403, { error: "Forbidden" });
    if (caller.role !== "super_admin" || caller.status !== "active") {
      return json(req, 403, {
        error: "Forbidden: only an active super_admin can call this function.",
      });
    }
    // Minting a NEW super_admin is exactly the escalation
    // 00000000000012_enforce_console_rbac.sql closes for existing rows (a
    // scoped admin can't grant themselves console.console_users.manage or
    // clear their own console_role_id) -- without this check here, the same
    // scoped admin could route around all of that by simply inviting a
    // second, unrestricted super_admin account for themselves. Evaluated via
    // userClient (carries the caller's own JWT) so auth.uid() inside
    // user_has_console_perm() resolves to the actual caller, not this
    // function's service-role identity.
    if (role === "super_admin") {
      const { data: canManageConsole, error: permErr } = await userClient.rpc(
        "user_has_console_perm",
        { _perm: "console.console_users.manage" },
      );
      if (permErr || !canManageConsole) {
        return json(req, 403, {
          error: "Forbidden: inviting a new super_admin requires console.console_users.manage.",
        });
      }
    }

    // Warn if the woreda already has an active tenant_admin
    let warning: string | null = null;
    if (role === "tenant_admin" && woredaId) {
      const { data: existing } = await admin
        .from("app_user")
        .select("full_name, status")
        .eq("woreda_id", woredaId)
        .eq("role", "tenant_admin")
        .neq("status", "suspended")
        .maybeSingle();
      if (existing) {
        warning = `This woreda already has an active Tenant Admin: ${existing.full_name}`;
      }
    }

    // Send invite
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${SITE_URL}/set-password`,
    });
    if (inviteErr || !invited?.user) {
      return json(req, 400, { error: inviteErr?.message ?? "Failed to send invitation" });
    }
    const newUserId = invited.user.id;

    const username = email.split("@")[0]?.slice(0, 32) ?? email;
    const { error: insertErr } = await admin.from("app_user").insert({
      user_id: newUserId,
      woreda_id: role === "super_admin" ? null : woredaId,
      role,
      full_name,
      username,
      status: "pending",
      invited_by_user_id: callerId,
      invited_at: new Date().toISOString(),
    });
    if (insertErr) {
      return json(req, 400, {
        error: `Invite sent but profile setup failed: ${insertErr.message}`,
      });
    }

    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      woreda_id: role === "super_admin" ? null : woredaId,
      entity_name: "app_user",
      entity_id: newUserId,
      action_type: "PLATFORM_ADMIN_INVITED",
      new_value_json: { email, role, woreda_id: role === "super_admin" ? null : woredaId },
    });

    return json(req, 200, { success: true, user_id: newUserId, warning });
  } catch (e) {
    return json(req, 500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
