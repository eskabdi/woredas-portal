// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Missing authorization header" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Without this the invite link falls back to whichever Site URL happens to
    // be configured in the dashboard -- never guaranteed to be /set-password,
    // and never guaranteed to even be this deploy. Fail loudly rather than
    // silently mailing a link nobody can complete: see docs/rbac-security-
    // forensic-review.md, F2.
    const SITE_URL = Deno.env.get("SITE_URL");
    if (!SITE_URL) return json(500, { error: "SITE_URL is not configured" });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(401, { error: "Unauthorized" });
    const callerId = userData.user.id;

    const { email, user_id } = (await req.json()) as { email?: string; user_id?: string };
    if (!email) return json(400, { error: "email is required" });

    // Verify caller is an ACTIVE super_admin -- a suspended account's JWT is
    // still live, so status has to be checked explicitly.
    const { data: caller } = await admin
      .from("app_user")
      .select("role, status")
      .eq("user_id", callerId)
      .maybeSingle();
    if (!caller || caller.role !== "super_admin" || caller.status !== "active") {
      return json(403, {
        error: "Forbidden: only an active super_admin can resend platform invites.",
      });
    }

    // Target must be a platform admin (super_admin or tenant_admin)
    if (user_id) {
      const { data: target } = await admin
        .from("app_user")
        .select("role, status")
        .eq("user_id", user_id)
        .maybeSingle();
      if (!target || (target.role !== "super_admin" && target.role !== "tenant_admin")) {
        return json(400, { error: "Target is not a platform admin." });
      }
    }

    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${SITE_URL}/set-password`,
    });
    if (inviteErr) return json(400, { error: inviteErr.message });

    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      entity_name: "app_user",
      entity_id: user_id ?? null,
      action_type: "PLATFORM_ADMIN_INVITE_RESENT",
      new_value_json: { email },
    });

    return json(200, { success: true });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
