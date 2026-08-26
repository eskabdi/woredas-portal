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

// Called from set-password.tsx right after a successful password set. app_user
// has no self-write RLS policy at all (by design -- see CLAUDE.md), so a
// client-side .update() can never flip status: pending -> active on its own
// row; this function bridges that gap the same way the three invite functions
// bridge the "no self-insert" gap, via the service-role client.
//
// Only ever reads/writes the CALLER's own row (resolved from their own JWT,
// never a user_id in the request body) -- this cannot be pointed at another
// account. Only flips pending -> active; suspended/inactive accounts are
// deliberately left untouched, since reactivating those stays an
// administrator action by design.
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

    const { data: caller, error: callerErr } = await admin
      .from("app_user")
      .select("status, woreda_id")
      .eq("user_id", callerId)
      .maybeSingle();
    if (callerErr || !caller) return json(404, { error: "No app_user profile found" });

    if (caller.status !== "pending") {
      // Nothing to do -- already active, or suspended/inactive (which this
      // function must never touch). Report the true status either way.
      return json(200, { success: true, status: caller.status });
    }

    const { error: updateErr } = await admin
      .from("app_user")
      .update({ status: "active" })
      .eq("user_id", callerId)
      .eq("status", "pending");
    if (updateErr) return json(500, { error: updateErr.message });

    await admin.from("audit_log").insert({
      actor_user_id: callerId,
      woreda_id: caller.woreda_id,
      entity_name: "app_user",
      entity_id: callerId,
      action_type: "ACTIVATED",
      new_value_json: { status: "active", method: "self_service_password_set" },
    });

    return json(200, { success: true, status: "active" });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
