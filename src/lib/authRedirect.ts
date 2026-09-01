/**
 * Parses the shapes Supabase's GoTrue server can put on an auth email link's
 * landing URL, once the classic hash-fragment flow (`#access_token=…`,
 * handled automatically by supabase-js's `detectSessionInUrl`) is ruled out:
 *
 *  - a rejected link: `error` / `error_description` in the query or the hash
 *    (expired, already used, malformed token) -- GoTrue redirects here
 *    instead of a session, and nothing in this app surfaced it before.
 *  - a `token_hash` + `type=invite` confirmation link -- the flow shape
 *    Supabase's dashboard email templates use when they link straight to
 *    `{{ .SiteURL }}` with `{{ .TokenHash }}` rather than the older
 *    `{{ .ConfirmationURL }}` redirect-through-GoTrue link. Nothing in this
 *    app called `verifyOtp()` for this shape before, so a project or
 *    template configured this way silently never established a session --
 *    the invite always resolved to "not signed in" and landed on /login.
 *  - a `token_hash` + `type=recovery` link -- the same dashboard-template
 *    shape, for a self-service password reset (F12,
 *    docs/rbac-security-forensic-review.md). Distinguished from `invite` so
 *    the caller can route an already-active user straight to /set-password
 *    without the invite flow's `status === 'pending'` assumption applying.
 *
 * Pure function -- no `window` access -- so it doesn't need a browser to test.
 */
export type AuthRedirectOutcome =
  | { kind: "none" }
  | { kind: "invite"; tokenHash: string }
  | { kind: "recovery"; tokenHash: string }
  | { kind: "error"; description: string };

export function parseAuthRedirect(search: string, hash: string): AuthRedirectOutcome {
  const params = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.replace(/^#/, ""));

  const description =
    params.get("error_description") ??
    hashParams.get("error_description") ??
    params.get("error") ??
    hashParams.get("error");
  if (description) return { kind: "error", description };

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type === "invite") return { kind: "invite", tokenHash };
  if (tokenHash && type === "recovery") return { kind: "recovery", tokenHash };

  return { kind: "none" };
}
