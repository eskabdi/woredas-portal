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

// Called from login.tsx right after a successful signInWithPassword() --
// deliberately NOT from the ambient onAuthStateChange listener in
// useAuthBootstrap.ts, since that listener's SIGNED_IN event also fires on
// tab-visibility recovery of an existing session (and is broadcast to every
// open tab), which would make "last login" mean "last tab focus" instead.
// app_user has no self-write RLS policy at all (by design -- see CLAUDE.md),
// so a client-side .update() can never touch last_login_at on its own row;
// this bridges that gap the same way activate-invited-user bridges the
// "no self-write for status" gap, via the service-role client.
//
// Only ever writes the CALLER's own row (resolved from their own JWT, never a
// user_id in the request body) -- this cannot be pointed at another account.
// No audit_log entry: a row per login would be pure noise against the
// admin-action-focused audit trail, and CLAUDE.md's console-scoped default
// view is not the place for it.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(req, 401, { error: "Missing authorization header" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json(req, 401, { error: "Unauthorized" });
    const callerId = userData.user.id;

    const { data: updated, error: updateErr } = await admin
      .from("app_user")
      .update({ last_login_at: new Date().toISOString() })
      .eq("user_id", callerId)
      .select("user_id")
      .maybeSingle();
    if (updateErr) return json(req, 500, { error: updateErr.message });
    if (!updated) return json(req, 404, { error: "No app_user profile found" });

    return json(req, 200, { success: true });
  } catch (e) {
    return json(req, 500, { error: e instanceof Error ? e.message : "Internal error" });
  }
});
