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
  role: string;
  woredaId: string;
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
    const { email, full_name, role, woredaId } = body ?? ({} as Body);
    if (!email || !full_name || !role || !woredaId) {
      return json(400, { error: "Missing required fields" });
    }

    if (role === "tenant_admin" || role === "super_admin") {
      return json(400, { error: "Cannot provision this role through tenant self-service." });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return json(400, { error: "Invalid role" });
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
      return json(403, { error: "Forbidden" });

    const isSuper = caller.role === "super_admin";
    const isTenantAdmin = caller.role === "tenant_admin" && caller.woreda_id === woredaId;
    if (!isSuper && !isTenantAdmin) return json(403, { error: "Forbidden" });

    // Send invite
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteErr || !invited?.user) {
      return json(400, { error: inviteErr?.message ?? "Failed to send invitation" });
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
    });
    if (insertErr) {
      return json(400, { error: `Invite sent but profile setup failed: ${insertErr.message}` });
    }

    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      woreda_id: woredaId,
      entity_name: "app_user",
      entity_id: newUserId,
      action_type: "USER_INVITED",
      new_value_json: { email, role, full_name },
    });

    return json(200, { success: true, user_id: newUserId });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
