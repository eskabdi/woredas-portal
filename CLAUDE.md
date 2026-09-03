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

Package manager is **bun** (`bun.lock`, `bunfig.toml`) — a `package-lock.json` also
exists but bun is what CI/Vercel actually build with (see the Vercel section below).

```bash
bun install
bun run dev              # vite dev, http://localhost:5173
bun run build             # vite build — also regenerates src/routeTree.gen.ts
bun run lint               # eslint .
bun run format             # prettier --write .
npx tsc --noEmit           # typecheck — run `bun run build` first, see below
bun run test                # vitest run — unit tests, jsdom environment
bun run check:role-perms-drift  # fails if permissions.ts and default_role_perms() disagree
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
test` and the drift check on every PR and push to `main`; there was no CI at
all before F13 either. Verifying a UI change still means running the dev
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
don't assume an app-level filter is sufficient on its own. See `README.md` for
the full domain/role/permission model, and `docs/` for per-module design notes.

### Routing

TanStack Start + TanStack Router, file-based. Read `src/routes/README.md`
before adding routes — it documents the naming convention (`$id`, `{-$optional}`,
`$` splat, `_layout`, `__root`) and the Next.js/Remix conventions that do
**not** apply here.

**Every route sets `ssr: false`.** All 66 route files do; only `__root.tsx`
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
compiled-in default over eight roles (`super_admin`, `tenant_admin`,
`civil_registrar`, `registry_clerk`, `finance_clerk`, `supervisor`, `auditor`,
`viewer`). The database is the actual source of truth at three layers, and the
client resolves the same chain a query's RLS ultimately enforces:

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
   hardened further in `00000000000019`) — a per-*user* grant/deny that wins
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

Adding a *new permission* (not a per-tenant/per-user override — those are data,
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

### Password change is self-service; password reset (locked-out) is not

F12 in the forensic review flagged that a locked-out user had no path except
an admin re-invite. The system owner's product call (see "F12 implementation
notes" in `docs/rbac-remediation-tracker.md`) deliberately kept it that way —
`src/routes/login.tsx` still shows a static "Forgot your password? Contact
your administrator." message, not an interactive reset request. What actually
shipped as self-service is the *different*, more common case: an
already-signed-in user changing a password they still remember, via
`src/components/common/ChangePasswordDialog.tsx` (`supabase.auth.updateUser({
password })` against the live session — no token or email round-trip),
reachable from the header avatar dropdown in both `WoredaShell.tsx` (Amharic)
and `AdminShell.tsx` (English).

The `type=recovery` handling in `src/lib/authRedirect.ts` (`parseAuthRedirect`)
and `src/routes/index.tsx` (`verifyOtp({ type: "recovery" })`, routing to
`/set-password`) was built for an earlier, superseded version of this fix and
was deliberately left in rather than ripped out — it costs nothing to keep and
still correctly handles a `type=recovery` link if one is ever generated by
other means (e.g. an administrator manually sending a reset email from the
Supabase dashboard). Don't take its presence as evidence of an in-app
"forgot password" entry point; there isn't one.

### Edge Function errors reach the user's screen, translated

`supabase.functions.invoke()` throws `FunctionsHttpError` with a hardcoded
generic message *before* the response body is read — the function's own
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

### Storage: private buckets, and the path prefix _is_ the tenant check

Seven buckets, all private; reads go through signed URLs
(`createSignedUrl`), never public URLs. Tenant isolation for objects comes from
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
through migration files), followed by small numbered migrations for anything
since (`_storage`, `_credential`, `_tenant_name_en`). `supabase/seed.sql`
seeds reference data and `supabase/seed-app-users.sql` resolves users against
the target project's `auth.users` — when a template or config table (e.g.
`id_card_template_field`) is edited live in the DB, sync the same values into
`seed.sql` or a fresh deploy silently regresses.

The six `supabase/functions/*` Edge Functions (`sign-credential`,
`invite-tenant-user`, `invite-platform-admin`, `resend-platform-invite`,
`activate-invited-user`, `record-login`) are a separate deploy artifact from
the schema — `supabase db push` and seed files don't touch them.
`scripts/deploy-functions.sh` deploys all six via the Management API (the
CLI's `functions deploy` doesn't work from a proxied/sandboxed shell — see
below). The `/deploy` skill in `.claude/skills/deploy/` covers the full
deploy and its ordering.

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

Four review agents, each covering a failure mode this codebase has that a build
or a typecheck will not catch. Invoke them by name.

| Agent                       | Use it when                                                           | Guards against                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `secret-sweep`              | after any migration or deploy, before pushing                         | a deploy token reaching a commit — see the rule at the top of this file                                                                |
| `tenant-isolation-review`   | touching a permission, role, migration, RLS policy, or upload path    | cross-tenant reads, a client gate without its seed rows, a missing storage path prefix                                                 |
| `portal-conventions-review` | after adding a route or a list/detail page                            | a route missing `ssr: false`, table state in `useState` instead of the URL, non-bilingual labels, Gregorian dates in the woreda portal |
| `card-print-review`         | touching signing, the print route, the template editor, QR or barcode | invariants whose failure is only discovered after cards are physically printed                                                         |

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

Invited accounts land on `/set-password`; the three invite Edge Functions
(`invite-tenant-user`, `invite-platform-admin`, `resend-platform-invite`) are
what generate those links, so a redirect problem is usually in the function's
request body rather than in the client.

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

**This command is only valid for a function with no local imports.** Five of
the six functions (`sign-credential`, `invite-tenant-user`,
`invite-platform-admin`, `resend-platform-invite`, `activate-invited-user`;
`record-login` imports only `_shared/response.ts`) import from
`../_shared/*.ts`, which this single-`file=@` form never uploads — the
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
