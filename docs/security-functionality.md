# Security functionality document

INSA Enforcer Phase 4. Existing documentation already covers two of the five
sections in depth for other reasons — this document links to those rather
than duplicating them, and fills in the three that had no dedicated write-up.

## Access control (RBAC/ABAC)

Covered in depth by [`docs/rbac-security-forensic-review.md`](./rbac-security-forensic-review.md)
(findings F1–F11) and [`docs/rbac-remediation-tracker.md`](./rbac-remediation-tracker.md).
Summary for this document's purposes:

Two independent gates, both have to be right:

1. **Client-side**: `<PermissionGate permission={P.X}>` gates UI and route
   access, reading `hasPermission` off the zustand auth store
   (`src/stores/authStore.ts`), populated at sign-in by the
   `current_permissions()` RPC.
2. **Database-side**: `user_has_perm(_perm)` gates what a query can actually
   return — this is the real enforcement point; the client-side gate is UX,
   not security.

Both resolve the same three-layer chain, in order: a per-user
`user_permission_override` (wins in both directions), then a per-tenant
`role_permission` override, then the compiled `default_role_perms()`
baseline. See [`docs/permissions-matrix.md`](./permissions-matrix.md) for
the generated, always-current compiled matrix, and
[`docs/erd.md`](./erd.md#tenancy--rbac) for the tables involved.

A second, independent dimension (`console_role`/`console_role_permission`)
scopes what an individual `super_admin` can do inside `/admin` — see the
same ERD section.

## Input validation strategy

Two independent layers, consistently applied:

1. **Client-side — Zod schemas via React Hook Form** (`zodResolver`), used
   in 14 route files: `login.tsx`, `set-password.tsx`,
   `woreda.residents.new.tsx`, `woreda.residents.$residentId.edit.tsx`,
   `woreda.households.new.tsx`, `woreda.households.$householdId.edit.tsx`,
   `woreda.credentials.new.tsx`, `woreda.rental-houses.new.tsx`,
   `woreda.rental-houses.$houseId.edit.tsx`,
   `woreda.settings.woreda-configuration.tsx`, and the four civil-event forms
   (`woreda.civil.birth.new.tsx`, `.death.new.tsx`, `.divorce.new.tsx`,
   `.marriage.new.tsx`). Representative examples:
   - `login.tsx`: `email: z.string().email(...)`, `password: z.string().min(6, ...)`.
   - `woreda.credentials.new.tsx`: `resident_id: z.string().uuid(...)`,
     `request_type`/`credential_type` constrained to `z.enum([...])`,
     `notes: z.string().max(2000).optional().nullable()`.
2. **Database-side — CHECK constraints and enums**, independent of and not
   reliant on the client ever running (a direct PostgREST call bypasses the
   form entirely). Every workflow `status` column is a `CHECK ... = ANY
(ARRAY[...])` enum (see [`docs/erd.md`](./erd.md) for the exhaustive
   list per table); `resident.email` has a regex format check
   (`resident_email_format`); `payment.amount` and `rental_occupancy.rent_amount`
   both require `> 0`.

Both layers are allow-list validation (enums, regex, explicit type/format),
matching the Enforcer's requirement — nothing here is a deny-list/blocklist
approach.

## Session & cookie logic

- **Transport**: bearer JWT via the `Authorization` header, not a cookie.
  `src/integrations/supabase/client.ts` configures `auth.storage: localStorage`,
  `persistSession: true`, `autoRefreshToken: true`. No `Set-Cookie` header is
  ever issued by this app (confirmed — `src/server.ts` and
  `src/lib/security-headers.ts` set no cookies; the app's one `document.cookie`
  use, in `src/components/ui/sidebar.tsx`, is a UI preference, unrelated to
  auth).
- **Why CSRF tokens are correctly absent**: a cookie-based session is sent
  automatically by the browser on every request to the cookie's origin,
  which is what makes a forged cross-site request dangerous. A bearer token
  in an explicit header is not attached automatically by the browser to any
  request this app didn't itself construct, so there is no ambient
  credential for a forged request to ride on.
- **Session regeneration**: handled entirely by Supabase Auth's own
  refresh-token rotation (`autoRefreshToken`); this app does not implement
  its own token-regeneration logic.
- **Idle/inactivity timeout** (shipped in INSA remediation Phase B): 20
  idle minutes shows a warning toast with a "stay signed in" action, 25
  idle minutes forces sign-out — within the Enforcer's 15–30 minute band.
  Implemented by `src/hooks/useIdleTimeout.ts` (constants in
  `src/config/idleTimeout.ts`), mounted once per portal in
  `WoredaShell.tsx`/`AdminShell.tsx`, reusing each shell's existing
  sign-out path. Mechanics worth knowing: activity is an absolute
  timestamp checked on a 15-second interval (so a laptop waking from
  sleep past the limit is caught immediately, where a long `setTimeout`
  would never have fired), reading with scroll/wheel counts as activity
  (capture-phase listeners — the shells' scroll containers don't bubble),
  and the last-activity timestamp is shared across tabs via
  `localStorage`, so an idle background tab cannot end a session someone
  is actively using in another tab (supabase-js broadcasts sign-out to
  every tab). Timeout length is compiled-in for v1; a per-tenant
  `woreda_settings` value remains a future enhancement.

## Encryption in transit

Covered by [`docs/security-hardening.md`](./security-hardening.md): TLS 1.2+
enforced end to end, Vercel auto-provisions and renews certificates, and
`Strict-Transport-Security` (2 years, `includeSubDomains`) is set on every
response by `src/lib/security-headers.ts`.

## Logging

**What is logged:**

- Generic error logging (`console.error`) in a small, fixed set of files —
  `src/integrations/supabase/client.ts`, `client.server.ts`,
  `auth-middleware.ts`, `src/server.ts`, `src/start.ts`,
  `src/routes/__root.tsx` — all configuration/SSR error-boundary logging,
  none of it logging credentials, tokens, or form payloads.
- `audit_log` table entries, written explicitly by 5 of the 6 Edge Functions
  on state-changing actions (`sign-credential`, `invite-tenant-user`,
  `invite-platform-admin`, `resend-platform-invite`, `activate-invited-user`)
  — actor, entity, action type, and a narrow before/after JSON diff.
  `record-login` deliberately does **not** write an audit row for every
  login (would be pure noise against an admin-action-focused trail); it
  only updates `app_user.last_login_at`.
- Supabase's own platform-level logs (Edge Function invocation logs, Auth
  logs) — operated by Supabase, not this repo.

**What is never logged, by design:**

- Passwords, in any form — this app never sees a plaintext password outside
  the browser's own request to Supabase Auth; nothing in application code
  handles or logs one.
- Full PII payloads — `audit_log.new_value_json`/`old_value_json` carry
  narrow, action-specific fields (e.g. `{ email, role, full_name }` on an
  invite), not a full resident/household record dump.
- Raw JWTs or the Supabase service-role key — read from environment
  variables at call time, never printed; see CLAUDE.md's credential-hygiene
  rules, which this section follows for logging the same way that document's
  rules govern deploy tokens.
- Raw driver/exception text in HTTP response bodies — since Phase B, every
  Edge Function error path routes through `safeError()`
  (`supabase/functions/_shared/response.ts`), which logs the real error
  server-side (Supabase captures function logs) and returns only a fixed
  string from the client-side translation table.

One logging addition from Phase B: `audit_log.source_ip` — a column that
existed since the baseline but was never written — is now populated
best-effort by all five audit-writing Edge Functions via
`_shared/clientIp.ts`. It is informational only (forwarded-for headers are
spoofable by a direct caller), which is also why the rate limiter below
keys on the verified caller identity, never on IP.

**Gap closed (INSA finding 3.6, Phase B)**: fourteen error paths across the
six Edge Functions used to interpolate raw driver/exception text (Postgres
error messages, GoTrue rejections, caught `.message` strings) into their
JSON response bodies, plus one 409 that echoed a status enum value. All now
return fixed strings via `safeError()`; the one deliberately-preserved
distinction is GoTrue's duplicate-email rejection, mapped to the existing
reviewed `"User already registered"` copy so an admin can still tell "this
person already has an account" apart from "sending failed". The three
invite functions additionally answer `429 Too many requests` past a
per-caller budget (20 or 10 calls per 10 minutes, keyed by verified
`user_id` against `rate_limit_bucket` — migration `00000000000022`).

## Related documents

- [`docs/rbac-security-forensic-review.md`](./rbac-security-forensic-review.md) — full access-control history and closed escalation paths.
- [`docs/permissions-matrix.md`](./permissions-matrix.md) — the generated, current permission matrix.
- [`docs/security-hardening.md`](./security-hardening.md) — transport and header-level controls.
- [`docs/api-security.md`](./api-security.md) — per-endpoint authentication/authorization detail.
- [`docs/erd.md`](./erd.md) — the tables and constraints referenced above.
