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

interface Body {
  email: string;
  full_name: string;
  role: "super_admin" | "tenant_admin";
  woredaId?: string | null;
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

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(401, { error: "Unauthorized" });
    const callerId = userData.user.id;

    const body = (await req.json()) as Body;
    const { email, full_name, role } = body ?? ({} as Body);
    const woredaId = body?.woredaId ?? null;

    if (!email || !full_name || !role) {
      return json(400, { error: "Missing required fields" });
    }
    if (role !== "super_admin" && role !== "tenant_admin") {
      return json(400, { error: "Invalid role. Must be 'super_admin' or 'tenant_admin'." });
    }
    if (role === "tenant_admin" && !woredaId) {
      return json(400, { error: "woredaId is required for tenant_admin role." });
    }
    if (role === "super_admin" && woredaId) {
      return json(400, { error: "super_admin must not be tied to a woreda." });
    }

    // Verify caller is super_admin
    const { data: caller, error: callerErr } = await admin
      .from("app_user")
      .select("role")
      .eq("user_id", callerId)
      .maybeSingle();
    if (callerErr || !caller) return json(403, { error: "Forbidden" });
    if (caller.role !== "super_admin") {
      return json(403, { error: "Forbidden: only super_admin can call this function." });
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
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteErr || !invited?.user) {
      return json(400, { error: inviteErr?.message ?? "Failed to send invitation" });
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
      return json(400, { error: `Invite sent but profile setup failed: ${insertErr.message}` });
    }

    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      woreda_id: role === "super_admin" ? null : woredaId,
      entity_name: "app_user",
      entity_id: newUserId,
      action_type: "PLATFORM_ADMIN_INVITED",
      new_value_json: { email, role, woreda_id: role === "super_admin" ? null : woredaId },
    });

    return json(200, { success: true, user_id: newUserId, warning });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
