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

// Called from useAuthBootstrap.ts on the SIGNED_IN auth event. app_user has
// no self-write RLS policy at all (by design -- see CLAUDE.md), so a
// client-side .update() can never touch last_login_at on its own row; this
// bridges that gap the same way activate-invited-user bridges the
// "no self-write for status" gap, via the service-role client.
//
// Only ever writes the CALLER's own row (resolved from their own JWT, never a
// user_id in the request body) -- this cannot be pointed at another account.
// No audit_log entry: a row per login would be pure noise against the
// admin-action-focused audit trail, and CLAUDE.md's console-scoped default
// view is not the place for it.
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

    const { error: updateErr } = await admin
      .from("app_user")
      .update({ last_login_at: new Date().toISOString() })
      .eq("user_id", callerId);
    if (updateErr) return json(500, { error: updateErr.message });

    return json(200, { success: true });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
