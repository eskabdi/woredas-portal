// Shared response helpers for every Edge Function in this project.
//
// Until INSA remediation Phase B, each of the six functions carried its own
// identical copy of corsHeaders()/json(), and fourteen error paths across
// them interpolated raw driver text (Postgres error messages, GoTrue
// rejections, caught exception .message) straight into the JSON response
// body — invisible in the rendered UI (src/lib/errorMessages.ts falls back
// to generic copy for unknown strings) but fully readable on the wire to
// anyone watching the network tab or calling the function directly
// (INSA finding 3.6). This module is the single place both concerns now
// live: the CORS allow-list, the JSON envelope, and safeError(), which
// keeps the real error server-side (Supabase captures function logs) and
// returns only a fixed string the client-side translation table knows.

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

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

/**
 * Logs the real error server-side and returns only a fixed generic message.
 *
 * `genericMessage` must be a FIXED string, never interpolated from the error
 * -- the whole point is that the HTTP response body carries nothing the
 * database, GoTrue, or the runtime said. Give each distinct failure mode its
 * own distinct fixed string (so the UI can still tell them apart) and a
 * matching entry in src/lib/errorMessages.ts; an unknown string falls back
 * to that table's generic copy, which hides the failure mode from the user
 * entirely.
 */
/**
 * GoTrue's duplicate-email rejection is the one invite failure worth keeping
 * distinguishable: "User already registered" already has native-speaker-
 * reviewed copy in src/lib/errorMessages.ts, and a tenant admin genuinely
 * needs to know "this person already has an account" apart from "sending
 * failed". Matched by code where available, by message shape otherwise
 * (older GoTrue versions phrase it "A user with this email address has
 * already been registered").
 */
export function isDuplicateEmailError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "email_exists") return true;
  return typeof e.message === "string" && /already.*registered/i.test(e.message);
}

export function safeError(
  req: Request,
  logLabel: string,
  err: unknown,
  genericMessage: string,
  status: number,
): Response {
  console.error(logLabel, err);
  return json(req, status, { error: genericMessage });
}
