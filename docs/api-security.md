# API endpoint categorization

INSA Enforcer Phase 5.3. This app has no conventional REST API layer of its
own — PostgREST auto-generates the table-level REST surface directly from
the RLS-protected schema (see [`docs/openapi.yaml`](./openapi.yaml) for the
note on that). What _is_ hand-written is six Edge Functions and a handful of
RPCs invoked directly by the client. Every one of them is categorized below.

| Endpoint / RPC                   | Kind                          | Category                  | Rationale                                                                                                                                                                                                   |
| -------------------------------- | ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sign-credential`                | Edge Function                 | **Private**               | Requires a valid JWT; caller must be `active` in the target woreda and hold `credential.print` (or be `super_admin`). Mutates a legally significant credential.                                             |
| `invite-tenant-user`             | Edge Function                 | **Private**               | Requires an `active` `tenant_admin` of the target woreda, or `super_admin`. Cannot self-provision `tenant_admin`/`super_admin`.                                                                             |
| `invite-platform-admin`          | Edge Function                 | **Private**               | Requires an `active` `super_admin`; minting a _new_ `super_admin` additionally requires `console.console_users.manage` — an explicit escalation guard.                                                      |
| `resend-platform-invite`         | Edge Function                 | **Private**               | Requires an `active` `super_admin`.                                                                                                                                                                         |
| `activate-invited-user`          | Edge Function                 | **Private (self-scoped)** | Any authenticated caller may invoke it, but it resolves identity from the caller's own JWT and only ever reads/writes that same row, only while `status = 'pending'`. Cannot be pointed at another account. |
| `record-login`                   | Edge Function                 | **Private (self-scoped)** | Same self-scoping as above; writes only `last_login_at` on the caller's own row. No `audit_log` entry by design (would be per-login noise).                                                                 |
| `current_permissions()`          | RPC (SQL, `SECURITY DEFINER`) | **Private**               | Called once at auth bootstrap (`src/hooks/useAuthBootstrap.ts`) by the newly-signed-in user, for their own permission list only — resolves `auth.uid()` server-side, takes no target-user argument.         |
| `user_has_perm(_perm)`           | RPC (SQL, `SECURITY DEFINER`) | **Internal**              | Not called from route/component code directly — invoked by Edge Functions (e.g. `sign-credential`) carrying the caller's own JWT, and by RLS policies themselves as the authorization primitive.            |
| `user_has_console_perm(_perm)`   | RPC (SQL, `SECURITY DEFINER`) | **Internal**              | Same shape as above, scoped to the console-permission dimension; invoked by `invite-platform-admin` and RLS policies on console-scoped tables (`console_role`, `console_role_permission`).                  |
| `verify_credential_token(token)` | RPC (SQL, `SECURITY DEFINER`) | **Public**                | Deliberately anonymous — called by `src/routes/v.$token.tsx` after a client-side signature check, for live revocation status only. Takes no identity, returns no more than the printed card already shows.  |
| `verify_service_letter(token)`   | RPC (SQL, `SECURITY DEFINER`) | **Public**                | Same shape as above, for issued service letters, called by `src/routes/verify.letter.$token.tsx`.                                                                                                           |
| `/v/:token`                      | Route                         | **Public**                | Header comment in `v.$token.tsx` states the intent directly: reached by scanning a printed QR, no app and no account.                                                                                       |
| `/verify/letter/:token`          | Route                         | **Public**                | Same shape; carries `robots: noindex` in its route meta so it isn't crawled/indexed despite being unauthenticated.                                                                                          |

## What "Private" means here, concretely

Every Private Edge Function requires a bearer JWT and independently derives
the caller's identity via `admin.auth.getUser(jwt)` or
`userClient.auth.getUser()` — never trusting a `user_id` supplied in the
request body for the caller's own identity. This matters because all six
functions run under the Supabase **service-role** key, which bypasses RLS
entirely — RLS's usual backstop does not apply inside them, so the
authorization check has to be written by hand in every one. See
[`docs/openapi.yaml`](./openapi.yaml) for each function's exact request
shape and [`docs/security-functionality.md`](./security-functionality.md)
for the Access Control section this feeds.

## Webhooks

None. This app has no inbound webhooks to categorize or sign — confirmed by
a repo-wide search for webhook handling.

## Rate limiting

Applied in INSA remediation Phase B to the three abuse-prone Private
endpoints — `invite-tenant-user` (20/10 min), `invite-platform-admin` and
`resend-platform-invite` (10/10 min each) — keyed by the **verified caller
`user_id`** (never IP or anything request-supplied) against a fixed-window
Postgres counter (`rate_limit_bucket` + `rate_limit_hit()`, migration
`00000000000022`; helper `supabase/functions/_shared/rateLimit.ts`). The
limiter fails open with a server-side log: a broken counter must never
take invites down for an internal-staff app.

Deliberately not covered: the two Public RPCs above (they rely on
Supabase's project-wide API rate limits — an accepted, documented gap) and
Supabase Auth's own sign-in/OTP limits (a dashboard setting). Both remain
on the operator checklist in [`docs/testing-scope.md`](./testing-scope.md).
