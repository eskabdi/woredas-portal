# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment credentials never enter the repository

**This is a hard rule, and it has no exceptions for convenience, debugging, or
"just temporarily".** `SUPABASE_ACCESS_TOKEN` (a Personal Access Token with
account-level control-plane rights over every project on the account) and
`VERCEL_TOKEN` (which can deploy, read env vars, and delete projects) are the
two most dangerous strings in this workflow. Neither is scoped to one project,
so a leak is not contained by the blast radius of this repo.

Never do any of the following, at any point, including after a migration or
deploy has succeeded:

- Write either token into a tracked file — no `.env` committed "just this once",
  no value pasted into `.env.example`, `supabase/config.toml`, `vercel.json`,
  a migration, a script under `scripts/`, or a skill under `.claude/`.
- Hard-code a token inside a command that gets committed. Read from the
  environment (`"$SUPABASE_ACCESS_TOKEN"`), never inline the literal.
- Echo, `cat`, `console.log` or otherwise print a token's value. Print a check
  digit of behaviour instead — an HTTP status confirms a token works without
  revealing it:
  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' https://api.supabase.com/v1/projects \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"    # 200 = valid, 401 = revoked
  ```
- Paste a token into a commit message, PR body, code comment, issue, or any
  file that will be pushed.
- Leave one behind in a scratch artifact after the work is done: shell history,
  a `p.json` / `payload.json` payload for the Management API, a `.pem`, a CLI
  cache under `supabase/.temp/` or `.vercel/`, or `.claude/settings.local.json`.
  `.gitignore` covers these paths, but ignored is not the same as absent —
  delete them.

### Where they are supposed to live

Session environment variables, exported from a shell or supplied by the CI/agent
environment, and nowhere else. `.env` (gitignored) is acceptable for the
`VITE_*` and `SUPABASE_*` **project** keys a local build needs; the two
**deploy** tokens above should not be in it, because a local build never needs
them. The `service_role` key is a data-plane secret and follows the same rule as
`.env`: gitignored, never printed, never client-side.

### After every migration or deployment

Finish the job by clearing the credential, not just the task:

```bash
unset SUPABASE_ACCESS_TOKEN VERCEL_TOKEN
rm -f p.json payload.json                   # Management API SQL payloads
git status --porcelain                      # nothing untracked that holds a token
```

Then confirm nothing is staged or committed that carries one:

```bash
git diff --cached -U0 | grep -nE 'sbp_[A-Za-z0-9]{20,}|eyJhbGciOi[A-Za-z0-9_-]{20,}'
```

The `secret-sweep` subagent (`.claude/agents/secret-sweep.md`) runs this sweep
over the working tree, the staged diff and the branch's commits — use it before
any push that followed a deploy.

### If a token does reach a commit

Treat it as disclosed the moment it exists in a commit object, whether or not
that commit was pushed — `git reset` and an amended commit do not remove it from
the object store or from anyone's fetched copy. **Revoke first, clean up second:**
rotate the token in the Supabase or Vercel dashboard, then rewrite or discard the
branch. A rotated token in a public commit is an embarrassment; an unrotated one
is an incident.

## Commands

Package manager is **bun** (`bun.lock`, `bunfig.toml`). A `package-lock.json` used
to also exist alongside it; it was removed (INSA Enforcer 6.3 dependency scan) after
an `npm audit` against it flagged a real advisory (`fast-uri`, pulled in via `ajv@8`,
an npm-only resolution of `@hookform/resolvers`' _optional_ `ajv` peer dependency that
bun never installs) that had zero actual exposure — nothing in the build bun/CI/Vercel
actually run ever touched that path — but the stale file was exactly the kind of drift
that produces a false-positive-shaped finding on a routine scan. `bun audit` is the
one dependency-vulnerability check this repo's build actually reflects.

```bash
bun install
bun run dev              # vite dev, http://localhost:5173
bun run build             # vite build — also regenerates src/routeTree.gen.ts
bun run lint               # eslint .
bun run format             # prettier --write .
npx tsc --noEmit           # typecheck — run `bun run build` first, see below
bun run test                # vitest run — unit tests, jsdom environment
bun run check:role-perms-drift  # fails if permissions.ts and default_role_perms() disagree
bun run check:fee-catalog          # fails if a woreda is missing an active fee_schedule row a fee resolver needs
bun run check:service-type-catalog # fails if woredas' service_type codes drift out of sync with each other
bun run check:definer-tenant-predicate # heuristic ratchet: fails on a new SECURITY DEFINER tenant-table lookup with no tenant anchor
bun run generate:permissions-doc  # --write regenerates docs/permissions-matrix.md from ROLE_PERMISSIONS
```

There's a Vitest unit-test suite (`vitest.config.ts`, `src/test/setup.ts`,
`*.test.ts` files under `__tests__/` next to the code they cover — see
`src/stores/__tests__/authStore.test.ts`, `src/lib/__tests__/*` and
`scripts/__tests__/check-role-perms-drift.test.ts`), added as F13 of
`docs/rbac-security-forensic-review.md` specifically so the report's other
findings had somewhere re-runnable to land rather than being one-time manual
verifications. It's deliberately narrow — unit tests for pure logic
(permission resolution, auth-redirect parsing, error-message translation, the
drift check itself), not component or integration tests — because nothing
here can talk to Supabase or render a real authenticated page without the live
project. `.github/workflows/ci.yml` runs lint, build, typecheck, `bun run
test`, the permissions-drift check, `check:fee-catalog`,
`check:service-type-catalog`, `check:definer-tenant-predicate`, and
`generate-permissions-doc.ts --check` on every PR and push to `main` — all required to pass before a PR is mergeable;
there was no CI at all before F13. The two catalog checks are the same static,
no-DB-connection shape as the drift check (parse `supabase/seed.sql` as text,
since CI has no live database credentials): `check-fee-catalog.ts` guards the
fail-closed fee resolvers below against a woreda missing the `fee_schedule`
row they require, `check-service-type-catalog.ts` guards against a
`service_type` code silently existing in some woredas' seed data but not
others. Verifying a UI change still means running the dev
server and exercising it directly, or writing a throwaway script under
`scripts/` for anything that needs the real Supabase project (see
`scripts/*.sql` for prior examples of one-off checks) — see the `verify` skill.

**Route tree must be rebuilt before typechecking new routes.** `src/routeTree.gen.ts`
is generated by the TanStack Router Vite plugin during `bun run build` (or `bun run dev`),
not by `tsc`. Add or rename a route file, then run `tsc --noEmit` before a build,
and you get "not assignable to type" errors that look like a mistake in the new
route but are really just a stale generated tree.

## Architecture

### Two portals, one multi-tenant database

Each woreda (a Harari regional administrative district) is an isolated tenant.
`src/routes/admin.*` is the super-admin console (English, platform-level:
tenant provisioning, user management, credential template design). `src/routes/woreda.*`
is the per-tenant operating system (Amharic-primary, Ethiopian-calendar dates:
residents, households, credentials, civil registration, service requests,
rental houses, revenue). Tenant isolation is enforced by **RLS**
(`get_user_woreda_id()` in migrations), not by application-level filtering — a
query missing a `woreda_id` filter still can't cross tenants, but conversely,
don't assume an app-level filter is sufficient on its own. `README.md` is the
original Phase 1 scaffold spec — most of it is explicitly marked
**Superseded** in-place, pointing at the current doc instead; treat it as
historical, not authoritative. `docs/architecture.md` is the current
authoritative "why is it built this way" doc — deployment topology, the
shared workflow engine, custom roles, the fee-resolution system, the
governing-brief corrections, and the deploy mechanism of record all live
there with citations back to the specific migration; read it before
`README.md` for anything architectural. `docs/erd.md` and `docs/dfd.md` are
the current entity-relationship and data-flow diagrams (52 tables, live-
enumerated against production, up from 43 the last time this count was
taken and 36 in the baseline migration alone); `docs/api-security.md`,
`docs/security-functionality.md` and `docs/security-hardening.md` are the
INSA Enforcer compliance write-ups (access control, input validation,
session handling, rate limiting, transport security); `docs/tech-stack.md`
and `docs/testing-scope.md` round out that set. `docs/permissions-matrix.md`
is generated by `bun run generate:permissions-doc` — regenerate rather than
hand-edit it. `docs/staging-runbook.md` (INSA Phase 6.1/6.2) is the operator
runbook for provisioning a second Supabase + Vercel project and seeding
synthetic test accounts via `scripts/seed-staging-users.ts` — written and
ready, but no staging project has actually been provisioned yet (real infra
cost, needs a deliberate go-ahead). `docs/go-live-declaration.md` is the
production-readiness declaration (dimension scoreboard, invariant table,
go-live plan, rollback path) — proposed, awaiting the system owner's
signature, not a self-certification.

### Routing

TanStack Start + TanStack Router, file-based. Read `src/routes/README.md`
before adding routes — it documents the naming convention (`$id`, `{-$optional}`,
`$` splat, `_layout`, `__root`) and the Next.js/Remix conventions that do
**not** apply here.

**Every route sets `ssr: false`.** All 67 route files do; only `__root.tsx`
doesn't, because it is the shell. This is load-bearing, not incidental: auth
state is bootstrapped in the browser from `supabase.auth.getSession()`
(`useAuthBootstrap`), so a server-rendered pass has no session, no `app_user`
row and no permissions — the page renders its signed-out or empty state into
the HTML and then flips once hydrated. A new route that omits `ssr: false`
looks fine in isolation and misbehaves only against a real login. TanStack
Start is here for the router, the build and the server entry, not for SSR of
application pages.

### Data layer: client-side queries, no route loaders

There are no `loader`s, no `beforeLoad` guards and no server functions
(`createServerFn`) anywhere in `src/routes`. Every page fetches in the
component with `useQuery`/`useMutation` from TanStack Query, calling
`supabase` (the anon client) directly, and writes go back through
`queryClient.invalidateQueries`. Privileged operations that need to bypass RLS
are **Edge Functions** invoked with `supabase.functions.invoke(...)`, not
server code in this app.

Two RPCs are called from the client for public, unauthenticated verification:
`verify_credential_token` (ID cards) and `verify_service_letter` (issued
letters).

Auth lives in a zustand store, not in React Query: `src/stores/authStore.ts`
holds `user`, `appUser`, `role`, `woredaId` and the derived `permissions`
array, and `useAuthBootstrap` (mounted once in `__root.tsx`) keeps it in sync
with Supabase's session events. `isLoading` starts `true` — gate on it rather
than treating a null `role` as signed out, or every guard flashes its denied
state on first paint.

### Two Supabase clients, and why the split is enforced by lint

- `src/integrations/supabase/client.ts` — anon/publishable key, RLS applies.
  Safe to import anywhere, including client components. This is the one
  essentially everything uses.
- `src/integrations/supabase/client.server.ts` — service role key, **bypasses
  RLS**. Currently imported by nothing; it exists for server-side code that
  doesn't exist yet. If you add such code: only ever import it from another
  `*.server.ts` module or inside a server function body (`await import(...)`),
  never as a top-level import in a route file, since route files ship to the
  client bundle. `eslint.config.js` blocks the Next.js `server-only` package
  specifically to push toward the `*.server.ts` naming convention instead,
  since that's what TanStack Start actually respects; `vite.config.ts` also
  sets `importProtection` to error on it.

Both `client.ts`, `client.server.ts`, `auth-middleware.ts`, and `types.ts` are
marked "automatically generated" — they come from the Supabase integration
tooling, not hand-maintained. `types.ts` in particular is the generated
database types; regenerate it rather than editing it when the schema changes.

### Authorization: compiled default, per-tenant override, per-user override

`src/config/permissions.ts` defines `ROLE_PERMISSIONS`, a `Role -> Permission[]`
compiled-in default over nine built-in roles (`super_admin`, `tenant_admin`,
`civil_registrar`, `registry_clerk`, `finance_clerk`, `supervisor`, `auditor`,
`viewer`, `print_officer`) plus a tenth value, `custom`, that is not a role
with its own compiled defaults — see "Custom roles" below. The database is
the actual source of truth at three layers, and the client resolves the same
chain a query's RLS ultimately enforces:

1. `default_role_perms()` (SQL, baseline migration) — the role's default grant
   set. This is meant to be the same matrix as `ROLE_PERMISSIONS`, and
   `bun run check:role-perms-drift` (`scripts/check-role-perms-drift.ts`, run
   in CI) fails the build the moment the two disagree — see that script's own
   comment for exactly what it does and doesn't compare.
2. `role_permission` — a per-tenant override of the default matrix (seeded in
   `supabase/seed.sql`), populated per-woreda by a trigger
   (`00000000000015_permission_matrix_backfill.sql`) that pre-fills every cell
   from `default_role_perms()` on woreda insert.
3. `user_permission_override` (`00000000000017_user_permission_overrides.sql`,
   hardened further in `00000000000019`) — a per-_user_ grant/deny that wins
   in both directions over the tenant-level default (Open Decision D1(a) in
   `docs/rbac-remediation-tracker.md`). `woreda_id` is never sent by the
   client; a `BEFORE INSERT/UPDATE` trigger re-derives it from the target
   user's own `app_user` row so an override can't be pointed at another
   tenant. `src/lib/userPermissionOverrides.ts` is the client-side CRUD for
   these rows, following the same untyped-client cast pattern as other
   pre-typegen tables until `types.ts` is regenerated post-deploy.

`current_permissions()` (`00000000000016_current_permissions_rpc.sql`) resolves
that same `user_permission_override -> role_permission -> default_role_perms()`
chain server-side and is what `useAuthBootstrap.ts` calls to populate the auth
store's `permissions` array (falling back to the compiled `ROLE_PERMISSIONS`
default on any RPC failure — F7 in the forensic review) — so client-side
`hasPermission()` checks agree with what the database will actually allow,
rather than only reflecting the compiled default. `user_has_perm()` (baseline
migration) is what actually gates a query's RLS, keyed off `app_user.role` /
`app_user.status` and the same override chain.

Two independent gates still have to both be right:

1. Client-side: `<PermissionGate permission={P.X}>` gates UI and route access,
   reading `hasPermission` off the auth store (backed by `current_permissions()`).
2. Database-side: `user_has_perm()` gates what a query can actually return.

### Custom roles: a tenant-defined tenth role value, fail-closed

`app_user.role` has a built-in-role `CHECK` for the nine roles above, plus
`custom` (Task 13). `ROLE_PERMISSIONS.custom` is deliberately `[]` — a custom
role carries no compiled default grant set of its own; its actual grants live
entirely in `tenant_role_permission` (migration
`00000000000038_task13_tenant_role_schema.sql`), keyed by
`app_user.custom_role_id`, resolved by `user_has_perm()`/
`current_permissions()` (migration `00000000000039`), never by
`default_role_perms()` or `role_permission`. Configured from
`/woreda/settings/users-permissions`.

Two guardrails worth knowing if you touch this (named `A5`/`A7` in migration
comments, after an external spec's numbering — no `A1`-`A4`/`A6` exist
anywhere in this repo):

- **A5** — adding `custom` as a role value needed a cross-table,
  same-tenant, `is_active` condition a plain `CHECK` can't express, so
  `app_user_role_check` was dropped and replaced by a trigger,
  `validate_app_user_role()` (migration 39), that enforces the same
  built-in-role whitelist plus the new custom-role rule. This is this
  project's one sanctioned non-additive migration (everywhere else, changing
  a `CHECK` means widening it, never dropping it) — a later hardening pass
  (migration 41) re-added a plain `CHECK` alongside the trigger as a
  value-whitelist backstop for contexts where triggers don't fire (logical
  replication, `pg_restore --disable-triggers`).
- **A7** — `tenant_admin`/`super_admin` are not editable through
  `role_permission` at all: `role_permission_role_name_check` lists only the
  seven non-admin roles. `tenant_admin`'s grant set is fixed at whatever
  `default_role_perms('tenant_admin')` compiles to — no matrix, override, or
  custom role can touch it.

As of the last live enumeration (`docs/architecture.md`), **zero custom
roles exist in production** — the capability is built and covered by
migration-level checks, but has no real usage to test against yet. Don't
assume it's exercised just because it's built.

### Console permissions: a second, separate axis for the super-admin console

`ROLE_PERMISSIONS`/`P` govern the woreda portal. A **second, independent**
dimension — `CP` (`src/config/permissions.ts`), backed by `console_role` /
`console_role_permission` / `user_has_console_perm()`
(`00000000000009_console_roles.sql`) — scopes what an individual
`super_admin` can do _inside_ `/admin` itself (`admin.console-roles.tsx` is
where these named roles are defined and assigned; `<ConsolePermissionGate>`
gates the admin-console UI the same way `<PermissionGate>` gates the woreda
portal). `app_user.console_role_id IS NULL` means **unrestricted** super
admin — the load-bearing default, so a `NULL` console role is not a bug to
fix. `CP` keys must match the migration's `CHECK` constraint exactly, and
there is no drift check for this axis the way there is for `ROLE_PERMISSIONS`
— a new console permission needs the migration's `CHECK` widened by hand.

Adding a _new permission_ (not a per-tenant/per-user override — those are data,
not code) still means editing `ROLE_PERMISSIONS` _and_ adding a migration that
updates `default_role_perms()` — the drift check catches divergence, but
`role_permission`'s own seed data is deliberately allowed to differ from the
default (that's what makes it an override) and is not part of what the check
compares.

A `pending` app_user authenticates fine but `user_has_perm()` requires
`status = 'active'`, so every query comes back empty with nothing in the UI
explaining why — check status before assuming a permission is misconfigured.
RLS also lets a user read their own `app_user` row but not write it, so a
client-side `.update()` can never flip `status` on its own row. Two Edge
Functions are the deliberate exceptions, both service-role and both resolving
the caller from their own JWT only, never a `user_id` in the request body:

- `activate-invited-user` — called right after `set-password.tsx` sets a new
  password, flips `pending -> active` for that same user so an invited user
  doesn't need an administrator to click anything after redeeming their
  invite. It only ever touches `pending` rows — `suspended`/`inactive` stay
  untouched, so reactivating those is still an administrator action.
- `record-login` — called right after a successful `signInWithPassword()` (not
  from the ambient `onAuthStateChange` listener, which also fires on
  tab-visibility session recovery and would make "last login" mean "last tab
  focus") to write `app_user.last_login_at`, which has no self-write RLS
  policy at all.

### Password change is self-service; password reset (locked-out) is admin-initiated, not self-service

F12 in the forensic review flagged that a locked-out user had no path except
an admin re-invite. The system owner's original product call (see "F12
implementation notes" in `docs/rbac-remediation-tracker.md`) deliberately kept
it that way for a while — but the owner later revisited it: `src/routes/login.tsx`
still shows a static "Forgot your password? Contact your administrator."
message, not an interactive reset request from an unauthenticated visitor, but
an administrator now has a real tool to act on that request rather than only a
re-invite.

Two self-service-adjacent paths exist, and it matters which one a given screen
is:

- **Already-signed-in password change** (the original self-service case): a
  user who still remembers their password changes it via
  `src/components/common/ChangePasswordDialog.tsx`
  (`supabase.auth.updateUser({ password })` against the live session — no
  token or email round-trip), reachable from the header avatar dropdown in
  both `WoredaShell.tsx` (Amharic) and `AdminShell.tsx` (English).
- **Admin-initiated reset link** (the locked-out case): a `tenant_admin` (or
  `super_admin`) triggers a password-reset email for a specific staff member
  from `woreda.settings.users-permissions.tsx` → `UsersRolesTab.tsx`'s users
  list, "Send Password Reset Link" in the row's dropdown. The Edge Function
  `send-password-reset-link` verifies the caller is an active tenant admin (or
  super admin) of the target's own woreda, restricts the target to staff roles
  (never `tenant_admin`/`super_admin` — the same boundary
  `invite-tenant-user` draws), and requires the target to be `active` (a
  `pending` account has never set a password at all — resend the invite
  instead; a `suspended` one must be reactivated first, since a reset does not
  undo a suspension). It then calls GoTrue's public `/auth/v1/recover`
  endpoint (`resetPasswordForEmail`) server-side with the target's email
  resolved via `admin.auth.admin.getUserById` — never a client-supplied email
  — so the actual mail delivery is the same tested path GoTrue uses for any
  recovery email, not a hand-rolled one.

  `admin.generateLink({ type: 'recovery' })` was deliberately **not** used for
  this: it only returns a link for the caller to deliver by their own means and
  never sends mail itself, and separately, this project's own note under
  "Auth redirect URLs must be top-level, and allow-listed" documents that its
  `redirectTo` option is nested under `options` by the JS client and silently
  ignored server-side. `resetPasswordForEmail`'s `redirectTo` is threaded as a
  query parameter instead (confirmed against this repo's pinned `auth-js`), so
  it does not hit that failure mode.

The `type=recovery` handling in `src/lib/authRedirect.ts` (`parseAuthRedirect`)
and `src/routes/index.tsx` (`verifyOtp({ type: "recovery" })`, routing to
`/set-password`) predates this feature — it was originally kept only in case a
`type=recovery` link was ever generated by other means (e.g. an administrator
manually sending a reset email from the Supabase dashboard). It is now the
active redemption path for the reset links `send-password-reset-link` sends:
no new client-side route or handler was needed, since a recovery link from
`resetPasswordForEmail` arrives in exactly the shape this code already parsed.

### Idle session timeout

Shipped in INSA remediation Phase B: 20 idle minutes shows a warning toast
with a "stay signed in" action, 25 idle minutes forces sign-out (within the
Enforcer's 15–30 minute band). `src/hooks/useIdleTimeout.ts` (constants in
`src/config/idleTimeout.ts`) is mounted once per portal, in
`WoredaShell.tsx`/`AdminShell.tsx`, reusing each shell's existing sign-out
path. Activity is an absolute timestamp checked on a 15-second interval
(catches a laptop waking from sleep past the limit immediately, where a long
`setTimeout` would never fire), scroll/wheel counts as activity via
capture-phase listeners (the shells' scroll containers don't bubble), and the
last-activity timestamp is shared across tabs via `localStorage` so an idle
background tab can't end a session someone is actively using elsewhere.
Timeout length is compiled-in for v1; a per-tenant `woreda_settings` value is
a possible future enhancement, not a gap to fix opportunistically.

### Audit trail

`audit_log` (generic, polymorphic `(entity_name, entity_id)`, insert-only by
convention but not DB-enforced) is the underlying table behind both
`admin.audit.tsx` (platform-level, gated by `CP.AUDIT_VIEW`) and
`woreda.audit.tsx` (per-tenant, RLS-scoped). Since INSA remediation Phase B,
5 of the 6 Edge Functions populate `source_ip` (`clientIp.ts`, derived from
request headers) on the rows they write — this is best-effort logging
context, **never a security control**, since a request header is
client-supplied and trivially spoofed. `role_permission` writes only land an
audit row once `updated_by` is set and the write is confirmed (see the "house
rule" on verifying mutations below) — an audit entry for a change that didn't
actually happen would be worse than no entry.

### Edge Function errors reach the user's screen, translated — and are sanitized server-side first

`supabase.functions.invoke()` throws `FunctionsHttpError` with a hardcoded
generic message _before_ the response body is read — the function's own
specific rejection reason was previously invisible to every caller (F1).
`src/lib/edgeFunction.ts` (`invokeEdgeFunction()`) reads `error.context` to
recover the real JSON body and runs it through `src/lib/errorMessages.ts`
(`translateError()`), a flat string-to-friendly-copy lookup. Only four entries
in that lookup have Amharic (the report's own reviewed example set,
native-speaker-approved; the file's own header comment says "five," counting
`GENERIC_FALLBACK` — a separate constant, not a lookup entry) — do not add
Amharic to another entry without the same review; everything else stays
English-only on purpose rather than shipping unreviewed machine translation
to Amharic-speaking users.

Before any of that: INSA remediation Phase B centralized every function's
response handling into `supabase/functions/_shared/response.ts`
(`corsHeaders()`, `json()`, `safeError()`). Previously each of the six
functions interpolated raw driver text (Postgres errors, GoTrue rejections, a
caught exception's `.message`) straight into the JSON error body — invisible
in the rendered UI (an unknown string just falls through to generic copy) but
fully readable on the wire to anyone watching the network tab or calling the
function directly. `safeError()` keeps the real error server-side only
(Supabase captures function logs) and returns a fixed string from the same
translation table the client already knows how to render — so a new Edge
Function error path should call `safeError()`, not throw or return raw driver
text.

### Edge Function CORS is an explicit allow-list

Every Edge Function's `corsHeaders()` echoes `Access-Control-Allow-Origin`
only for an origin in its own `ALLOWED_ORIGINS` set (`SITE_URL` env var plus
`http://localhost:5173` for local dev against the real project — this repo has
no staging project), never a bare `*` (F10). This was a real gap but a narrow
one: the app's bearer-token auth model means CORS can't leak or forge that
token to a third party either way — see each function's own `index.ts` for the
one-line rationale doc-comment.

### House rule: every admin-facing mutation verifies what it actually changed

Any `.update()` or `.insert()` in an admin-facing flow that isn't immediately
followed by a full page reload must chain `.select(...).maybeSingle()` (or
otherwise inspect the returned row/count) and treat an empty result as a
failure with its own message — never infer success from `error === null`
alone. PostgREST returns `error: null` whether a write's `WHERE` clause
matched one row or zero, so a bare `.update()` filtered by an id that RLS
silently excludes (a stale row in a second tab, a race with another admin
acting on the same target, the target no longer matching the policy's scope)
is a no-op that still looks like success. `supabase/functions/record-login/index.ts:52-59`
is the canonical example — it chains `.select("user_id").maybeSingle()` after
its update and returns a `404` when nothing comes back. See
`docs/rbac-security-forensic-review.md`, F5/F6, for the two places this was
missing and got fixed, and the audit of every other admin mutation in the
codebase for the same pattern.

### Module gating is a third, separate axis

`tenant_module_config` enables/disables whole modules per tenant
(`credentials`, `civil_registration`, `revenue`, `reports`, `audit`,
`services`, `approvals`). `useTenantModules` reads it and `<ModuleGate
moduleKey="...">` redirects to the woreda dashboard with a toast when the
module is off. Two behaviours to know: **a missing config row means enabled**
(absence is not a disable), and super admins always see every module. So a
module that should be off needs an explicit `is_enabled = false` row, and a
page that appears for a tenant it shouldn't is usually a missing row rather
than a broken gate.

Permission, module and RLS are independent — a page can be permitted, enabled,
and still return nothing because of `status`.

### Workflow engine: one shared FSM gates five status-bearing tables

`enforce_workflow_transition()` (migration `00000000000025`) is one generic
`BEFORE UPDATE` trigger function, defined once and attached — via
`CREATE TRIGGER`, never redefined per table — to every workflow-bearing
table: `credential_request`, `residence_credential`, `vital_event`,
`rental_occupancy_request`, `service_request`. It resolves which entity it's
guarding from `TG_TABLE_NAME`, looks up the attempted
`(entity, from_status, to_status)` triple in one platform-wide reference
table, `workflow_transition` (see `docs/erd.md`'s "Workflow engine" section
for its full shape), and rejects anything absent from that table. The same
function also enforces **maker ≠ checker** (one person can never both verify
and approve the same row) and blocks a system-only transition from firing
off a live user session.

`workflow_transition` deliberately carries **no `woreda_id`**: which state
changes are legal is fixed for the whole platform. A tenant can change _who_
holds a permission (`role_permission`), but never remove a
verification/approval/payment gate — a route that writes a status directly
instead of going through an existing mutation path is the way this gets
bypassed by accident, which is exactly what `workflow-fsm-review` checks for.

Two separate audit-writer triggers exist, not one, added at different times
for different table sets: `log_workflow_transition()` (migration 25) writes
into the pre-existing, generic `audit_log` table for
`credential_request`/`residence_credential`, kept alongside those tables'
own semantic audit inserts (the trigger row guarantees a direct PostgREST
call still leaves a trail; the app-written rows carry context — reprint
reason, waiver — the trigger can't see). `log_workflow_status_history()`
(migration 58) writes into a separate table, `workflow_status_history`, for
`vital_event`/`rental_occupancy_request`/`service_request`, which had no
per-module status-history table of their own the way credentials did — it
does not replace `credential_request_status_history`/
`credential_status_history`, which stay app-written.

A workflow/FSM migration and the frontend that expects its new states are
**one deploy unit, not two independently-schedulable ones** — landing the
schema change before the frontend broke live credential processing once
(the `docs/architecture.md` D-2 decision record is the incident account).
Never land a `workflow_transition` seed change without the frontend PR that
walks the new states in the same deploy.

### Storage: private buckets, and the path prefix _is_ the tenant check

Nine buckets, all private; reads go through signed URLs
(`createSignedUrl`), never public URLs. Two are newer than the rest:
`resident-documents` (PDF-only, with server-side MIME + 10 MB size limits —
the one bucket that validates upload constraints at the bucket level rather
than client-side only) and `attachments` (Task 11's generic
entity-bound upload table, for the credential and civil-registration
workflows, which had no multi-document table of their own). Tenant isolation for objects comes from
`storage_path_woreda_id(name)`, which derives the owning woreda **from the
object's path prefix**. So every upload must write
`` `${woredaId}/...` `` — an object stored at a bare filename is invisible to
its own tenant, and no error says so. Existing call sites all follow
`` `${woredaId}/${crypto.randomUUID()}.${ext}` `` (or a stable field name for
settings assets).

The one exception is `credential-templates`: it is platform-level, readable by
any authenticated user and writable only by `is_super_admin()`, so
`admin.credential-template.tsx` correctly uploads to a bare `${side}.png`.

Presentation images (resident photos, tenant logos/signatures, template
backgrounds) are converted to WebP **in the browser** before upload via
`src/utils/imageCompression.ts` — a 4 MB phone photo goes up as ~200 KB, which
is the whole point of doing it client-side. Scanned legal documents keep their
original bytes; check `convertForUpload`'s callers before routing a new upload
through it.

### Database migrations and Edge Functions

`supabase/migrations/00000000000000_baseline.sql` is a single reconstructed
baseline (the original schema was built incrementally via a dashboard, not
through migration files). 70+ numbered migrations follow it — early ones are
small, one-off fixes (`_storage`, `_credential`, `_tenant_name_en`); most of
the higher-numbered ones are task-scoped (`taskN_...`) and land as part of a
larger, tracked remediation effort (see `docs/architecture.md`'s decision
record and `docs/fix-task-v3-execution-notes.md`). Every migration in this
project is **additive-only**: no `DROP`, and a trigger/function body is only
ever changed via `CREATE OR REPLACE` on a new migration, never edited in
place — rolling back a function's behavior means a new migration that
`CREATE OR REPLACE`s it back, not reverting the file that added it. The one
sanctioned exception (`A5`, migration 39) is documented in "Custom roles"
above. `supabase db push`/`db diff` don't work against this project (the live
database predates migration files, so it has no
`supabase_migrations.schema_migrations` table to diff against) — the
Management-API three-phase process (write additively, dry-run wrapped in
`BEGIN…ROLLBACK`, apply, then verify by querying
`information_schema`/`pg_policies`/`pg_constraint` directly, never inferred
from "the apply call returned success") in "Sandboxed agent environments"
below is the actual mechanism of record; see the `fsm-migration` skill for
the full recipe. `supabase/seed.sql`
seeds reference data and `supabase/seed-app-users.sql` resolves users against
the target project's `auth.users` — when a template or config table (e.g.
`id_card_template_field`) is edited live in the DB, sync the same values into
`seed.sql` or a fresh deploy silently regresses.

The eight `supabase/functions/*` Edge Functions (`sign-credential`,
`invite-tenant-user`, `invite-platform-admin`, `resend-platform-invite`,
`resend-tenant-invite`, `activate-invited-user`, `record-login`,
`send-password-reset-link`) are a separate deploy artifact from the schema —
`supabase db push` and seed files don't touch them. `scripts/deploy-functions.sh`
deploys all eight via the Management API (the CLI's `functions deploy` doesn't
work from a proxied/sandboxed shell — see below). The `/deploy` skill in
`.claude/skills/deploy/` covers the full deploy and its ordering. All eight
import shared helpers from `supabase/functions/_shared/` (`response.ts` for
CORS/JSON/`safeError()`, `rateLimit.ts`, `clientIp.ts`) — see "Edge Function
errors" above and "Rate limiting" below.

### Rate limiting

`rate_limit_bucket` + `rate_limit_hit()` (`00000000000022_rate_limit.sql`) is
a Postgres-backed fixed-window limiter — Edge Function isolates have no
cross-invocation memory and this project has no Deno KV, so the counter lives
in the database. `supabase/functions/_shared/rateLimit.ts`
(`checkRateLimit()`) wraps the RPC and is called by the invite/resend
functions (`invite-tenant-user`, `invite-platform-admin`,
`resend-platform-invite`, `resend-tenant-invite`), keyed by the **verified
caller `user_id`**, never
by request-supplied IP (`clientIp.ts` derives IP for audit logging only, not
as a trust boundary). **Deliberately fail-open**: an RPC error (table
missing, transient DB failure) allows the request rather than blocking
invites — for an internal-staff app, a broken limiter must never become an
availability outage. The two public verification RPCs
(`verify_credential_token`, `verify_service_letter`) are deliberately _not_
rate-limited here — see the migration's own header comment for why.

### Residence credential (ID card) signing and printing

The multi-file path from "issue a credential" to "printed, scannable card":

1. `supabase/functions/sign-credential` reads every field from the database
   itself (never from the request) and signs a compact payload — short
   single-letter keys, `YYYYMMDD` dates, no JWT header — with ES256
   (`HARARI_EC_PRIVATE_KEY`). The public half lives in
   `src/config/credentialCryptoConfig.ts`, alongside the shared WebCrypto
   params both the signer and every verifier use. ES256 rather than RS256 is a
   physical constraint: a 64-byte signature where RSA-2048 needs 256 is part of
   what keeps the QR under printable module density.
2. The signed token is a compact `payload.signature` string stored in
   `residence_credential.qr_payload`, and is also the credential's identity for
   public verification: `src/routes/v.$token.tsx` checks the signature
   client-side, then calls `verify_credential_token()` for live revocation
   status (a valid signature doesn't mean a still-valid card).
3. `src/routes/woreda.credentials.$requestId.print.tsx` renders the physical
   card two ways: a preview pane (`CardFront`/`CardBack`, only shown when no
   template background is set) and the actual print surface (`PrintableCard`,
   driven by `id_card_template_field` rows positioned as percentages of a
   canvas). **Only `PrintableCard` is what actually prints** — it's sized in
   real millimetres (`CARD_WIDTH_MM`), not a DPI-derived guess, because a card
   printer is physically bound to 85.6×54mm and a container sized wrong
   silently clips whatever field lands outside the printable area.
4. `src/utils/barcode.ts` (Code 128, credential number) and the QR
   (`credentialVerifyUrl()`) both carry a **density guard**: the QR's own
   design note is that 173 modules at 19mm is ~1.3 printer dots per module at
   300dpi — below what any printer resolves, regardless of camera quality — so
   both symbols throw rather than render undersized instead of failing silently.
   `MIN_X_DIMENSION_UM = 250` does the same job for the barcode.
5. The credential number is 13 digits with a **Luhn** check digit (migration
   `00000000000002_credential.sql`; it replaced a bespoke mod-11 scheme). Both
   the length and the check-digit position are enforced invariants the barcode
   depends on.
6. Admin template editing (`src/routes/admin.credential-template.tsx`) locks
   the `qr_code` field to a fixed aspect ratio across every resize handle —
   a QR's modules are square, and a stretched bounding box stretches them.

`VITE_PUBLIC_SITE_URL` is deliberately used instead of
`window.location.origin` for the QR target: a card printed from a laptop on
localhost would otherwise carry a QR nobody can open, and the mistake only
surfaces after the cards are physically printed.

### Service requests and issued letters

`docs/general-service-requests-unified-approval-queue.md` is the design note
for the two newest modules and is worth reading before touching either. In
short: the service catalog (`service_type`) is **configurable data, not
hardcoded** — new letter kinds are added in Settings, not in code; fees flow
through the existing revenue/payment tables rather than a separate ledger; and
`/woreda/approvals` is a single inbox unioning four workflow tables
(service requests, credential requests, civil events, rental occupancy
requests) — the design doc's "returned items" are a status filter across
those, not a fifth table.

Issued letters are the second public verification surface:
`src/routes/verify.letter.$token.tsx` backed by the `verify_service_letter`
RPC. Letter bodies are authored as HTML from templates in Settings, so
`src/lib/letterTemplate.ts` owns both the `{TOKEN}` substitution list and an
allow-list sanitiser (tags, attributes and even inline style properties) —
template HTML is operator-authored but still untrusted, and it renders into the
print surface.

Printed revenue receipts are the third: `receipt` carries its own
`verification_token` (`00000000000013_receipt_verification.sql`), printed
from `woreda.revenue.$paymentId.receipt.tsx` and checked publicly at
`src/routes/verify.receipt.$token.tsx`, the same pattern as the credential
and letter surfaces (client renders, a DB RPC confirms current status —
a valid token doesn't by itself mean the receipt wasn't later voided).

`/woreda/complaints` (`woreda.complaints.tsx`) is not a separate module — it
renders the same `ServiceRequestList` component as `/woreda/services`,
filtered to `category="complaint"`. A new page that looks like it needs its
own table and workflow is usually better served by adding a `category` value
to the existing `service_type`/`service_request` tables than by building a
parallel one.

### Fee resolution: fail-closed, exact-match, zero-fee still records a payment

Three resolver functions — `resolve_credential_fee()`, `resolve_service_fee()`,
`resolve_civil_fee()` — each map their module's request/event/service type to
a `fee_schedule.service_type` row, resolve the caller's **own** woreda
internally (never a client-supplied parameter), require
`status = 'active'` and `effective_from <= current_date`, and **raise** —
no silent fallback to a default fee — if no matching active row exists. This
surfaced a real data gap once: `00000000000054` had to repair the live
catalog (activated stuck `review_required` rows, inserted missing service
types) before Stage 4 payment could be wired to it; `bun run
check:fee-catalog` and `bun run check:service-type-catalog` (both run in CI)
exist so that catalog can't silently drift back out of sync with what the
resolvers expect — see each script's own header comment for exactly what
static shape it checks (there's no live DB connection available in CI, so
both parse `supabase/seed.sql` as text, the same pattern
`check-role-perms-drift.ts` uses).

Note `service_request`'s fee source is **not** `fee_schedule` — it's
`service_type.fee_amount` directly (`NOT NULL DEFAULT 0`), because
`service_type` is an open, per-woreda-editable catalog rather than the small,
code-fixed enum `fee_schedule` was built for. `resolve_service_fee()` and
`check:service-type-catalog` exist for that different failure mode: a
service-type code present in some woredas' seed data but silently missing in
others (usually an operator forgetting to add a new letter/complaint type
everywhere).

The **exact-match fee guard** (`validate_credential_fee_amount()`, generic
across all three fee-bearing payment types) requires a recorded payment's
`amount` to equal the resolved fee **exactly** — no tolerance band, no
cashier discretion. The sole bypass is an explicit waiver (`waived = true`,
`amount = 0`, a waiver reason of at least 5 characters, plus
supervisor-level authorization for that module).

The **zero-fee rule**: a free service (fee resolves to `0`) still writes a
real `payment` row and a real `receipt` row — the pipeline never skips
payment recording just because nothing is owed.

### Shared UI conventions

Follow the existing list pages (`woreda.residents.index.tsx` is the canonical
one) rather than inventing per-page state:

- **Table state lives in the URL**, via helpers in `TableToolbar.tsx`
  (`useUrlSort`, `useClearTableFilters`, `ExportButtons`) and
  `TablePagination.tsx` (`useUrlPagination`, `useUrlSearchTerm`,
  `DEFAULT_PAGE_SIZE`). Sorting, paging, search and filters survive reload and
  are shareable.
- **Loading/empty/error are components**, not ad-hoc conditionals:
  `TableSkeletonRows`, `TableEmptyRow`, `TableErrorRow`.
- **CSV/PDF export** goes through `src/utils/tableExport.ts` (per-table) and
  `src/utils/reportExport.ts` (report sections), both taking woreda branding
  from `useReportBranding`.
- **Dates are Ethiopian-first** in the woreda portal: `src/utils/ethiopianCalendar.ts`
  does exact JDN-based conversion and holds the Amharic/English month names;
  input goes through `<EthiopianDateInput>`. Gregorian is stored, Ethiopian is
  displayed.
- **Labels are bilingual** in woreda-facing UI, Amharic first, in the form
  `"ስም / Name"` — including table headers and toast messages.
- UI primitives in `src/components/ui/` are **shadcn/ui** components (Radix +
  Tailwind v4, `components.json`); add new ones through the shadcn CLI rather
  than hand-writing them, and keep app-specific composition in
  `src/components/common/` and the feature folders.

### UX restructuring (`docs/ux/`) — all 5 phases complete, not yet merged

An Apple-HIG-driven restructuring (dark navy shell, floating translucent
toolbars, segmented steppers, and a two-typeface Amharic system — Tayitu for
headers/titles/nav, Jiret for body copy, replacing the single
`.font-noto-ethiopic` utility) is complete on the `ux-restructure` branch, not
yet merged. `docs/ux/` holds the planning trail and is the source of truth for
exactly which screens use the new patterns vs. the ~4 Cluster A screens and 3
Cluster B upload points that were deliberately left as-is — check
`ux_implementation_roadmap.md`'s status checklist rather than assuming every
one of the 55 screens was touched:

- `ux_screen_inventory.md`, `ux_pattern_map.md`, `ux_audit_findings.md` — the
  55-route inventory, the five reuse clusters (List/Filter/Export, Multi-step
  Forms, Detail/Profile, Printable Documents, Dashboards), and the
  Clarity/Deference/Depth/Typography audit scored per cluster.
- `ux_amharic_typography_plan.md` — the Tayitu/Jiret mapping rules, the
  `.font-am-heading`/`.font-am-body` utility split, and the font-license open
  item (Tayitu is © Anbassa Design; the user confirmed decorative-only use —
  headings/nav, never body copy — is acceptable).
- `ux_restructure_plan.md` — the shared components each cluster maps to:
  `AppShell` (replaces `WoredaShell`/`AdminShell`), `TableToolbar`, `Stepper`,
  `DetailHeader`/`WorkflowStepper`, `charts/`.
- `ux_implementation_roadmap.md` — the five-phase, dependency-ordered plan
  (Foundations → Shared patterns → Screen-by-screen adoption → Print/dashboards
  → Validation) with its status checklist kept current at the top.
- `ux_implementation_report.md` — the running implementation log: what's built,
  how it was verified (this sandbox has no real Supabase project, so
  authenticated-shell rendering is smoke-tested via headless Chromium's
  unauthenticated-redirect behavior rather than visually confirmed — see the
  report's "residual risks" section), and deviations from the plan.

As of the last update: **all five phases are done** — foundations, the four
shared component families, their rollout across Clusters A/C/E (Cluster B's
input-token pass and `Stepper` apply globally already; `SquircleUpload`
covers its 2 real single-image call sites, deliberately not the 3 mixed
image/PDF upload points), Cluster D's typography fix, and Phase 4's WCAG
contrast/keyboard/font validation (which found and fixed 3 real contrast
failures and 2 real focus-visibility gaps — not just a clean pass). The
login page was also redesigned to match a user-provided reference mockup,
outside the original 5-cluster scope. **The largest remaining risk before
merge**: every verification in this work used build/tsc/lint plus
headless-Chromium unauthenticated-redirect checks — none of it has been
seen rendered against a real authenticated session with live data (no
Supabase project exists in this sandbox). Continuing this work means
reading `ux_implementation_roadmap.md`'s status checklist and
`ux_implementation_report.md`'s residual-risks section first, not
re-deriving state from the code.

### Build and server entry

`src/server.ts` is a wrapper around TanStack Start's server entry, pointed at
by `tanstackStart({ server: { entry: "server" } })`. It exists because **h3
swallows in-handler throws** into a normal `500` JSON body
(`{"unhandled":true,"message":"HTTPError"}`), so a plain try/catch never fires
for those; the wrapper inspects 5xx JSON responses, recovers the real error via
`src/lib/error-capture.ts` and renders a readable error page. If SSR errors
start showing as opaque JSON, this is the file.

The same wrapper also applies `withSecurityHeaders` (`src/lib/security-headers.ts`)
to every document response, success or error path alike — HSTS, a CSP scoped to
the exact origins the app actually uses (Google Fonts, OSM tiles, the Supabase
project, `data:`/`blob:` for QR/barcode/WebP), `X-Frame-Options: SAMEORIGIN`,
`Permissions-Policy` (camera/geolocation to self only), and the usual
nosniff/referrer-policy pair. `docs/security-hardening.md` maps these against
what a Cloudflare-style WAF/DDoS/TLS product would otherwise cover and is
explicit about what still has to be clicked in the Vercel/Supabase dashboards
rather than shipped as code — read it before assuming a hardening gap needs a
repo change.

Vite plugin order matters (Tailwind → TanStack Start → nitro (build only) →
React), and `react`/`@tanstack/react-query` are deduped because two copies
break hooks. Don't pin a nitro preset — see the Vercel section.

## Repository tooling for agents

### Subagents (`.claude/agents/`)

Seven review agents, each covering a failure mode this codebase has that a build
or a typecheck will not catch. Invoke them by name.

| Agent                         | Use it when                                                                                                                 | Guards against                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secret-sweep`                | after any migration or deploy, before pushing                                                                               | a deploy token reaching a commit — see the rule at the top of this file                                                                                     |
| `tenant-isolation-review`     | touching a permission, role, migration, RLS policy, or upload path                                                          | cross-tenant reads, a client gate without its seed rows, a missing storage path prefix                                                                      |
| `portal-conventions-review`   | after adding a route or a list/detail page                                                                                  | a route missing `ssr: false`, table state in `useState` instead of the URL, non-bilingual labels, Gregorian dates in the woreda portal                      |
| `card-print-review`           | touching signing, the print route, the template editor, QR or barcode                                                       | invariants whose failure is only discovered after cards are physically printed                                                                              |
| `rbac-escalation-review`      | touching permissions.ts, seed.sql, `default_role_perms()`, `role_permission`, `tenant_role`, or `user_permission_override`  | a permission escalation slipping in via one grant source but not the others                                                                                 |
| `workflow-fsm-review`         | touching `workflow_transition`, `enforce_workflow_transition()`, a `*_status_check` constraint, or a route writing a status | an unreachable/skippable/resurrectable workflow state                                                                                                       |
| `main-logic-authority-review` | after any merge or rebase against `origin/main`, especially one resolved by hand or by taking main's whole file             | a UI-restructuring branch silently altering main's business logic, permissions, or workflow/status literals instead of only layering display changes on top |

They are read-only reviewers (`Bash`, `Read`, `Grep`, `Glob`) — they report, they
do not push, rewrite history or rotate credentials.

### Skills (`.claude/skills/`)

- **`review`** — the review workflow for this repo: scope the diff against its
  merge base, dispatch to the subagents above by what changed, rank findings by
  blast radius, and verify each claim before asserting it. It carries the list
  of known false positives (the public key, the anon JWT, the deliberate
  `credential-templates` bare path, the English-only admin portal) because a
  reviewer who flags those gets discounted on the findings that matter. Use it
  before opening or merging a PR.
- **`doctor`** — diagnose why something is broken or set up wrong. Runs
  `scripts/check-workspace.sh` (no credentials, no network: toolchain, deps,
  route registration, `ssr: false`, env var _names_, secret hygiene), then
  backend checks per artifact, then a symptom index that maps what you observe
  to which of the several identical-looking causes it actually is. Use it before
  a deploy and whenever a screen is unexpectedly empty.
- **`deploy`** — the four-artifact deploy (schema, seed, Edge Functions,
  frontend), its ordering, how to verify each artifact at its own surface, and
  the credential teardown that ends it.
- **`pdf-print-pipeline`** — how every printable document in this app is built:
  the shared `PrintDocumentShell` component and its `Doc*` primitives, and a
  real Chromium bug (a deferred `window.open()` navigation to a `blob:` URL
  gets silently blocked) that the current anchor-click pattern exists to avoid
  regressing. Use it before adding a new print route or "አትም / Print" button.
- **`verify`** — the build/launch/drive recipe for runtime-verifying a change:
  pointing local dev at the real Supabase project (there is no staging
  project), reusing a saved browser session, and driving Playwright under
  `xvfb` against real data. Use it before reporting a change as verified.
- **`document-designs`** — manages the four printable-document layouts (Resident
  Profile, Household Profile, Kebele Rental House Occupant Profile, Service
  Request Letter) as Claude Design Canvas `.dc.html` files: bilingual
  Amharic/English fieldsets, letterhead, document numbering, verification-code
  footers. Use it when a printed document's layout or field set needs to
  change — it's the design source `pdf-print-pipeline`'s components render.

The `review` and `doctor` skills exist for the same underlying reason: this repo
has no test suite and `tsc --noEmit` stays clean through most of the bugs that
matter here. `review`
is the gate before a change lands; `doctor` is what you run when something is
already wrong and failing silently — which, given RLS returning empty rather
than erroring, is the normal way this system breaks.

### Globally available skills relevant to this repo

Beyond the project skills above, several skills available to every session
(not checked into this repo, so they don't appear under `.claude/skills/`)
are worth reaching for here specifically:

- **`security-review`** — a general pending-changes security pass; use it
  alongside `tenant-isolation-review` for a migration or RLS change, not
  instead of it — the subagent knows this codebase's specific invariants
  (storage path prefixes, the override chain), the generic skill doesn't.
- **`code-review`** / **`simplify`** — correctness and cleanup passes over a
  diff; useful on non-domain-specific code (a utility function, a script
  under `scripts/`) where the repo-specific `review` skill's dispatch to
  `card-print-review`/`portal-conventions-review`/etc. has nothing to add.
- **`run`** — generic launch-and-screenshot recipe; prefer the project's own
  `verify` skill instead, since it already encodes the real Supabase project,
  saved-session, and `xvfb` setup this repo specifically needs.
- **`pdf`**/**`xlsx`**/**`docx`** — for one-off document manipulation
  (inspecting an exported CSV, editing a spreadsheet) that isn't the
  structured `woreda-manual` PDF pipeline.

These are general-purpose and don't need any per-project setup — invoke them
by name (e.g. `/security-review`) same as any project skill.

### gstack (machine-global, not part of this repo)

[gstack](https://github.com/garrytan/gstack) is installed at `~/.claude/skills/gstack`
on the machines that have it — a personal Claude Code skill suite (headless
browser, QA/review/planning skills, a design CLI), not something vendored
into this repository. It has to be installed per-machine
(`git clone ... ~/.claude/skills/gstack && ./setup`); a fresh clone of this
repo, or Claude Code on the web, won't have it unless someone installs it
there too.

Use `/browse` for all web browsing and QA driving in a real page (it wraps a
fast headless Chromium) rather than reaching for a separate browser-control
MCP tool, if one is offered. Skills worth knowing about here: `/office-hours`,
`/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`,
`/design-consultation`, `/design-shotgun`, `/design-html`, `/ship`,
`/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`,
`/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`,
`/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`,
`/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`,
`/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`,
`/unfreeze`, `/gstack-upgrade`, `/learn`.

**`/review` and `/deploy` are name collisions.** gstack installs its own
generic `/review` (pre-landing PR review) alongside this repo's own
`.claude/skills/review` (documented above, which already knows to dispatch
to `tenant-isolation-review`/`portal-conventions-review`/`card-print-review`/
`workflow-fsm-review`/`rbac-escalation-review`/`secret-sweep` and carries
this repo's specific false-positive list). For work in this repo, prefer the
project's own `/review` — it is scoped to the invariants that actually break
here; gstack's version has no idea RLS exists. Likewise, gstack's `/ship`
and `/land-and-deploy` don't know this repo's credential-teardown rule,
sandboxed-environment Management API workaround, or its four-artifact
deploy ordering — use this repo's own `/deploy` skill for anything that
touches Supabase or Vercel.

### SessionStart hook (`.claude/hooks/session-start.sh`)

Installs dependencies at the start of a Claude Code on the web session, and
no-ops locally (`CLAUDE_CODE_REMOTE`). It exists because a fresh container has
no `node_modules`, so `bun run lint` and `tsc --noEmit` fail with
module-resolution errors that read as code faults rather than a missing install.
It prefers `bun` — `bunfig.toml` sets `minimumReleaseAge`, a 24h supply-chain
guard that only `bun install` honours, so the npm fallback is a fallback, not an
equivalent.

The hook is registered in `.claude/settings.json` and runs **synchronously**:
the session starts slightly slower, but nothing races an incomplete install.

The repository was prettier-formatted in one sweep (the `claude/prettier-format`
branch), so `bun run lint` now reports ~49 real problems (`no-explicit-any`,
`exhaustive-deps`, `no-img-element`) and zero formatting noise. Keep it that
way: run `bun run format` on files you touch, and treat any sudden wall of
`prettier/prettier` errors as a regression (an unformatted commit, or a
regenerated file that needs a `.prettierignore` entry), not as background noise.
`tsc --noEmit` is clean.

## Sandboxed agent environments (Claude Code on the web, CI containers)

Outbound traffic is restricted to HTTPS through a local proxy. Two consequences
that are not obvious from the error messages.

### 1. Headless browsers cannot reach the internet by default

Playwright/Chromium bypasses the shell's proxy settings, so every external
navigation fails with `net::ERR_CONNECTION_RESET` even though `curl` to the
same URL works. The proxy also terminates TLS, so its certificate is not one
Chromium trusts.

Pass the proxy explicitly and accept its certificate:

```js
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  proxy: { server: process.env.HTTPS_PROXY },
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
```

`HTTPS_PROXY` is assigned per shell invocation and the port changes between
calls, so read it from the environment at launch. Never hard-code it, and never
disable TLS verification globally to work around it.

Testing against a _local_ service (`127.0.0.1`) needs none of this — but in
practice Chromium has still intermittently failed to reach an external host
(e.g. the real Supabase project) even with the flags above; setting
`NO_PROXY=* no_proxy=*` on the launching shell (forcing a direct connection
instead of through the proxy) has been the reliable fix when that happens.

### 2. Postgres ports are blocked; the Management API is the way in

`psql` to either the direct host or the pooler hangs and then times out:

- `db.<ref>.supabase.co` resolves to IPv6 only, which the sandbox has no route
  for, unless the project has the IPv4 add-on.
- `aws-0-<region>.pooler.supabase.com` resolves over IPv4 but ports 5432 and
  6543 are blocked outright. Port 443 to the same host is open, which is the
  tell that this is a port policy and not a Supabase problem.

Run SQL over HTTPS instead:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @payload.json     # {"query": "..."}
```

Build the JSON payload with a real serializer. Migration SQL contains quotes and
dollar-quoted function bodies that shell escaping mangles, and the failure looks
like a SQL syntax error rather than a quoting bug.

**Use `curl`, not Python's `urllib`, for every Management API call.** Cloudflare
returns `403` with error code `1010` specifically for the `Python-urllib`
User-Agent — confirmed by sending the identical request both ways with the
same token: `curl` succeeds, `urllib` doesn't. It isn't an auth or proxy issue
and retrying with the same tool won't help.

## Supabase

### Auth redirect URLs must be top-level, and allow-listed

For `POST /auth/v1/admin/generate_link`, `redirect_to` goes at the **top level**
of the body. Nesting it under `options` — which is where the JS client puts it —
makes the server ignore it silently and fall back to `site_url`:

```jsonc
{"type":"magiclink","email":"...","redirect_to":"https://app.example.com/"}   // honored
{"type":"magiclink","email":"...","options":{"redirect_to":"..."}}            // ignored
```

A URL that is not in `uri_allow_list` is also replaced by `site_url` with no
error. Both failure modes look identical, so when a redirect does not stick,
check the parameter position before assuming the allow-list is wrong.

Allow-list entries need the origin _and_ a wildcard to cover both the bare
origin and sub-paths:

```
https://app.example.com/**,http://localhost:5173,http://localhost:5173/**
```

Keep these narrow. A pattern like `https://*.vercel.app/**` would let any site
on that domain receive users' auth tokens.

Invited accounts land on `/set-password`; the invite Edge Functions
(`invite-tenant-user`, `invite-platform-admin`, `resend-platform-invite`,
`resend-tenant-invite`) are what generate those links, so a redirect problem
is usually in the function's request body rather than in the client.

GoTrue can deliver an invite in two different shapes, and only one of them is
handled automatically. The classic hash-fragment flow (`#access_token=...`) is
consumed by supabase-js's own `detectSessionInUrl` before any app code runs.
The other shape — `?token_hash=...&type=invite` (what the dashboard's email
template sends when it links straight to the site URL instead of routing
through GoTrue's `/verify` redirect) — is not; nothing calls `verifyOtp()` for
it on its own. `src/lib/authRedirect.ts` (`parseAuthRedirect`) parses that
shape, the equivalent `type=recovery` shape (kept for a manually-generated
reset link even though nothing in this app's own UI triggers one — see the
"Password change is self-service" note above), and GoTrue's rejection shape
(`?error=...&error_description=...`, an expired or
already-used link) out of the URL, and `src/routes/index.tsx` calls it before
its existing role/status redirect: a `token_hash` triggers
`verifyOtp({ type: "invite" | "recovery" })`, an error shows an explicit "this
link is no longer valid" card. Before this existed, both shapes silently fell
through to `!role` and landed on `/login` with no signal that anything had
gone wrong — if an invite or reset link "does nothing," check which shape the
project's email template is actually sending before assuming the allow-list or
`redirectTo` is the problem.

### Edge Functions are a separate deploy artifact

`supabase db push` and seed files do not touch them. Deploying is a
control-plane operation: a project `service_role` key cannot do it, only
`supabase login` or a Personal Access Token.

The CLI's `functions list` and `functions deploy` have been reported to fail
with `TransportError` behind the proxy in some sandboxes — this is
environment-dependent, not universal: `npx supabase functions deploy <fn...>
--use-api --project-ref $REF` (what `scripts/deploy-functions.sh` runs) has
also deployed cleanly in this same kind of sandboxed container. Try it first;
it's also the only path that correctly bundles `supabase/functions/_shared/`
(`response.ts`/`rateLimit.ts`/`clientIp.ts`, added in the INSA remediation's
Phase B) alongside a function's `index.ts` — confirmed by its own upload log,
which lists each shared file it pulls in per function.

If the CLI genuinely can't route through the proxy, the Management API works
as a single-file fallback:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$REF/functions/deploy?slug=$FN" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -F "metadata={\"name\":\"$FN\",\"entrypoint_path\":\"index.ts\",\"verify_jwt\":false};type=application/json" \
  -F 'file=@index.ts;type=application/typescript'
```

**This command is only valid for a function with no local imports.** All six
functions now import from `../_shared/*.ts` (`sign-credential`,
`invite-tenant-user`, `invite-platform-admin`, `resend-platform-invite`,
`activate-invited-user` import several shared modules; `record-login` only
`_shared/response.ts`), which this single-`file=@` form never uploads — the
function deploys, then 500s at import resolution on its first invocation.
Get the CLI path working (proxy config, a different network path, a
non-sandboxed shell) rather than hand-rolling a multi-file `curl` for this;
the exact multipart shape the Management API expects for a bundle with local
imports isn't documented here because it hasn't been verified against a raw
`curl` call, only against what the CLI itself sends.

To tell a deployed function from a missing one, call it unauthenticated. A
deployed function answers `401` with its own error body; a missing one answers
`404 {"code":"NOT_FOUND"}`. `scripts/deploy-functions.sh` wraps all of this.

## Vercel

### Deploy as an archive

`vercel deploy` uploads many files in parallel and dies partway through the
proxy with `fetch failed`, leaving a project that exists but has zero
deployments — so the URL 404s and it looks like the deploy never started.
`--archive=tgz` sends one tarball and gets through:

```bash
vercel deploy --prod --yes --archive=tgz --token="$VERCEL_TOKEN"
```

### Framework preset must stay "Other"

Nitro detects Vercel from the `VERCEL` env var and emits Build Output API v3
into `.vercel/output`. Setting the framework to `vite` makes Vercel look for a
static `dist/` instead and SSR breaks. Leave `framework: null` with
`buildCommand: bun run build`.

Do not pin a nitro preset in `vite.config.ts`. With none set, nitro builds
`node-server` locally and switches to `vercel` in CI on its own; pinning
`vercel` breaks local builds.
