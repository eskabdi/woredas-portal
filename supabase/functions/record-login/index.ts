import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, json, safeError } from "../_shared/response.ts";

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
    if (updateErr)
      return safeError(
        req,
        "record-login: update last_login_at",
        updateErr,
        "Failed to record login",
        500,
      );
    if (!updated) return json(req, 404, { error: "No app_user profile found" });

    return json(req, 200, { success: true });
  } catch (e) {
    return safeError(req, "record-login: unhandled", e, "Internal error", 500);
  }
});
