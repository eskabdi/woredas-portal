# RBAC Remediation Tracker

Tracks execution of `docs/rbac-security-forensic-review.md`'s action plan (F1–F11,
P0–P3), plus two findings discovered during remediation that aren't in the
report itself. This file is the place for anything that isn't the report's own
findings — new findings, phase status, decisions made along the way — so the
report stays exactly as reviewed and signed off.

## New findings (not in the original report)

### F12 — No self-service password-reset flow (High)

`src/routes/login.tsx` has no reset path at all — its only affordance is
"Forgot your password? Contact your administrator to be re-invited." Every
locked-out user becomes an admin ticket (a re-invite through
`invite-tenant-user`/`invite-platform-admin`, which also silently deactivates
nothing and just issues a fresh invite token). There is no
`resetPasswordForEmail()` call anywhere in the codebase, and `set-password.tsx`
only handles the invite (`type=invite`) shape, not GoTrue's recovery
(`type=recovery`) shape.

Addressed in Phase 4 (P2), alongside F9, since it extends the same
`authRedirect.ts` parsing work the invite-link fix (PR #22) already introduced
for the `type=invite` shape.

### F13 — No test harness exists in this repo (High)

Before this work, there was no Vitest/Jest, no `*.test.*`/`*.spec.*` file, and
no CI workflow at all (`.github/workflows/` didn't exist). Every regression
lock the report's Action Plan calls for ("Verify by…") had nowhere to land as
an actual, re-runnable check — they could only ever be manual, one-time
verifications. Fixing F13 first is what makes every other finding's fix
actually verifiable going forward, rather than asserted.

Addressed in Phase 1, before any other phase, per the remediation task's own
ordering.

## Phase status

| Phase | Scope                                                                                              | Status                  |
| ----- | -------------------------------------------------------------------------------------------------- | ----------------------- |
| 0     | Commit the report + this tracker                                                                   | done                    |
| 1     | F13 — Vitest test harness                                                                          | done                    |
| 2     | P0 — F1 (edge function errors), F5 (permission upsert)                                             | done                    |
| 3     | P1 — F4 (backfill/seeding), F6 (row-verification), F7 (`current_permissions()`)                    | done                    |
| 4     | P2 — F3 (per-user overrides), F8 (single source of truth), F9 (localization), F12 (password reset) | done                    |
| 5     | P3 — F10 (CORS allow-list), access review (`updated_by`)                                           | done                    |
| 6     | Internal review pass on the whole diff (`tenant-isolation-review`, `portal-conventions-review`, `secret-sweep`) before deploy | done |

## Open Decisions D1/D2 — resolution

The report's §"Open Decisions" section explicitly declined to make these calls
itself and required the system owner's sign-off before P2 starts. The owner
(via the remediation task that drives this work) has made both calls
explicitly, adopting the report's own recommendations:

- **D1 (override precedence):** **(a)** — a user-level override wins in both
  directions over the tenant-level `role_permission` default, with the
  explicit caveat the report attaches to this option: any future tenant-wide
  "kill switch" permission must be checked unconditionally, outside the
  override/role/default `COALESCE` chain, never modeled as an overridable
  `role_permission` deny.
- **D2 (override lifecycle on role change):** **(c)** — overrides persist by
  default across a role change, but the role-change UI surfaces the user's
  existing overrides so the admin performing the change explicitly confirms or
  clears them as part of that action.

This resolution is recorded here, not silently assumed in the migration or the
report itself.

## F3 implementation notes

- Schema: `supabase/migrations/00000000000017_user_permission_overrides.sql` —
  `user_permission_override` table per the report's §3.1 sketch, a
  `woreda_id`-derivation trigger closing the same cross-tenant spoofing path
  F11 traced and closed for `app_user` directly, RLS mirroring
  `role_permission`'s tenant-admin-writes-own-tenant pattern, and both
  `user_has_perm()` and `current_permissions()` rewritten with the D1(a)
  precedence link at the front of their existing `COALESCE` chain. A CHECK
  constraint excludes the same three `LOCKED_KEYS` `RolesPermissionsTab`
  already treats as system-locked, so a per-user override can't become a back
  door around that lock. Verified live: D1(a) precedence (a user-level grant
  overriding an explicit tenant-level deny) and the woreda-derivation trigger
  both confirmed correct in a rolled-back transaction against the real
  database.
- Client: a "Permissions" action (disabled for `tenant_admin`/`super_admin` —
  overrides are scoped to the six editable roles only, matching the report's
  own motivating example of restricting one person below their role) opens
  `UserPermissionOverridesDialog` in `UsersRolesTab.tsx`, a per-key
  Default/Grant/Deny control grouped the same way as `RolesPermissionsTab`.
  `ChangeRoleDialog` now fetches and surfaces the target user's existing
  overrides (D2(c)) with an explicit, unchecked-by-default "clear all
  overrides" confirmation, so they persist through a role change unless an
  admin deliberately clears them.
- Opportunistic fix bundled in: `RolesPermissionsTab.tsx`'s `PERMISSION_LABELS`
  and `GROUP_LABELS` predate F4's five permission keys entirely — after F4's
  backfill, the matrix already rendered all 42 keys, but the 15 new ones
  showed with a blank row label and an unlabeled/raw-prefix group heading.
  Not a numbered finding in the report; filled in while touching this file
  for F3's shared constants export, since leaving it would have made the new
  "Permissions" dialog (which reuses these same maps) inconsistently labeled
  too.

## F8 implementation notes

`scripts/check-role-perms-drift.ts` is a **drift check**, not a generator that
rewrites SQL: this repo's migrations are forward-only (CLAUDE.md), and
`default_role_perms()` lives in the already-applied baseline migration, which
is never edited after the fact. Auto-generating and overwriting that file
would violate that rule for no real benefit. Instead the script parses the
*last* `CREATE OR REPLACE FUNCTION default_role_perms` definition across all
migrations concatenated in order (matching Postgres's own semantics — a later
migration's redefinition wins), and fails CI the moment its per-role key sets
stop matching `permissions.ts`'s `ROLE_PERMISSIONS` — the actual failure mode
this finding is about: someone updates one copy and forgets the other, the way
`role_permission`'s seed data already had (F4).

`role_permission`'s own seed/backfill data — the report's third copy — isn't
compared here on purpose: since F4's migration, a trigger derives every
tenant's `role_permission` rows directly from `default_role_perms()`, for
existing tenants (one-time backfill) and every future one (the `woreda`-insert
trigger) alike. Once this check confirms `permissions.ts` and
`default_role_perms()` agree, the seed data can no longer drift independently
of either — the third copy stopped being independently hand-maintained the
moment F4 landed, so a separate seed-data check would only be checking a
downstream consequence, not a fourth source of truth.

Wired into `.github/workflows/ci.yml` as `bun run check:role-perms-drift`.
Regression lock: `scripts/__tests__/check-role-perms-drift.test.ts` (parser
correctness, including picking the *last* definition when more than one
exists); the check's actual real-world behavior was also sanity-tested by
temporarily introducing a real mismatch into `permissions.ts` and confirming
the script caught it before reverting.

## F9 implementation notes

Scoped down deliberately from a full Amharic-first pass to only the strings
the report itself already drafted and captioned as reviewed-pending:

- `src/config/permissionLabels.ts` — the report's eight §3.4 example
  permission labels, copied verbatim, wired into `RolesPermissionsTab` and
  `UserPermissionOverridesDialog`'s row labels (falls back to the existing
  English-only `PERMISSION_LABELS` for every other key).
- `src/lib/errorMessages.ts` — the report's five §3.4 example error messages
  (including the generic fallback) made bilingual; every other entry stays
  English-only.

**Update:** the system owner, a native Amharic speaker, has reviewed and
approved these thirteen strings (2026-09-01) -- they are final copy, not
placeholder text. Both files' header comments were updated accordingly.

Still not done: Amharic for the other ~34 permission keys or ~25 error
strings. Generating additional Amharic without the same review risks
shipping actively wrong text to the exact users this fix exists for --
strictly worse than the English-only label or message it would replace. Both
files still carry an explicit "do not add a new entry without the same
native-speaker review" comment at the top so this stays a deliberate,
visible gap rather than a silently abandoned one.

## F12 implementation notes

**Update (2026-09-01) — product decision, revises the original approach
below.** The system owner directed a different shape for F12: no
self-service "forgot password" entry point on the login page at all. A
locked-out user (someone who cannot sign in) still contacts an administrator
-- `login.tsx` shows a static message, same as before this remediation, not
an interactive request flow. Instead, an *already signed-in* user gets a
self-service "Change Password" action from the header avatar dropdown in
both portal shells:

- `src/components/common/ChangePasswordDialog.tsx` (new, shared) --
  `supabase.auth.updateUser({ password })` against the user's own live
  session. No token or email round-trip: the session itself already proves
  who they are, so this is simpler than the recovery-link flow and doesn't
  touch `authRedirect.ts`/`index.tsx` at all.
- Wired into `src/components/layout/WoredaShell.tsx` (bilingual: "የይለፍ ቃል
  ቀይር / Change Password") and `src/components/layout/AdminShell.tsx`
  (English, matching that console's existing English-only convention),
  both above the existing "Sign Out" item in the same dropdown.
- `src/routes/login.tsx` reverted to a static "Forgot your password? Contact
  your administrator." message -- the `mode`/`resetEmail`/`resetSent` state,
  the `onResetSubmit` handler, and `PUBLIC_SITE_ORIGIN` were all removed.

**What's still in place from the original approach:** `src/lib/authRedirect.ts`'s
`recovery` outcome kind and `src/routes/index.tsx`'s handling of it (verifying
via `verifyOtp({ type: "recovery" })` and populating the store directly rather
than trusting the ambient listener) were **not** removed -- there is no
in-app trigger for this path anymore, but it costs nothing to leave it
in place, and it still correctly handles a `type=recovery` link if one is
ever generated by other means (e.g. an administrator manually sending a
password-reset email from the Supabase dashboard, a capability independent
of this app's own UI). `set-password.tsx` needed no changes for either
approach.

**Net effect on F12's original complaint** ("every locked-out user becomes
an admin ticket"): that remains true by design for a user who cannot sign in
at all -- this is the system owner's explicit choice, not a gap. What's
newly self-service is the *different*, arguably more common case: a signed-in
user who wants to change a password they still remember.

Also fixed during this change, per `portal-conventions-review`: a hand-rolled
`<input type="checkbox">` in `ChangeRoleDialog` (F3) replaced with the
existing shadcn `Checkbox` already used one file over in
`RolesPermissionsTab.tsx`.

Verified: `bun run build`/`tsc --noEmit`/`bun run lint`/`bun run test` all
clean, and the reverted login page was rendered in a live local Chromium
(dev server pointed at the real Supabase project) confirming the static
message renders and no reset UI remains. The new "Change Password" dropdown
item and dialog were verified by code review and build/lint/typecheck only
-- not exercised in a live authenticated browser session; the underlying
`Dialog`/`Input`/`Button`/`Label` primitives are the same ones already
proven working elsewhere in this exact file (`ChangeRoleDialog`,
`UserPermissionOverridesDialog`).

<details>
<summary>Original approach (superseded by the product decision above, kept for history)</summary>

- `src/lib/authRedirect.ts`: `AuthRedirectOutcome` gains a `recovery` kind,
  parsed the same way as `invite` (`token_hash` + `type=recovery`) -- the
  same dashboard-template link shape PR #22's invite fix already had to
  handle for the identical reason (the classic hash-fragment flow is caught
  automatically by supabase-js; this shape isn't).
- `src/routes/index.tsx`: `useInviteTokenHandler` renamed
  `useAuthLinkHandler` (it now handles both link kinds) and calls
  `verifyOtp({ type: "recovery" })`, then explicitly runs
  `fetchAuthState()`/`setAuth()` itself rather than trusting the ambient
  `onAuthStateChange` listener to catch the resulting session change --
  deliberately sidesteps the question of whether that emits
  `PASSWORD_RECOVERY` or `SIGNED_IN`, since this handler never depends on it
  either way. A new `recovery-settled` state forces `/set-password`
  regardless of the (already-active) user's status, instead of falling
  through the existing pending/active dashboard-routing branches.
- `src/routes/login.tsx`: a "Forgot your password?" toggle replaces the old
  "contact your administrator" text, calling
  `supabase.auth.resetPasswordForEmail()`. The UI shows the same
  confirmation regardless of whether the call succeeds or the address is
  registered -- branching on that result would recreate, client-side,
  exactly the email-enumeration exposure the report's own "Out of Scope"
  section flags as unassessed for this app's auth endpoints.
- `set-password.tsx` needed **no changes**: it already only checks for a
  session (`!user`) and calls `updateUser({ password })` +
  best-effort `activate-invited-user` (a no-op for an already-active
  account, since that function only ever touches `pending` rows) — the same
  code path now correctly serves both invite and recovery sessions.

</details>

Regression lock: `src/lib/__tests__/authRedirect.test.ts` covers all six
outcome shapes, including the new `recovery` one and precedence against an
`error` in the same URL.

## Phase 5 (F10 + access review) implementation notes

**F10 — CORS allow-list.** All six Edge Functions replaced their static
`"Access-Control-Allow-Origin": "*"` with a per-request `corsHeaders(req)`
that reflects the request's `Origin` only if it's in an allow-list
(`SITE_URL` -- the same project-wide secret F2 introduced -- plus
`http://localhost:5173`, since this repo has no staging project and local
dev calls these functions directly against the real one). No shared module
between functions exists in this repo (each is deployed as a single
standalone file), so the same ~15-line helper is duplicated identically
across all six rather than introducing a new shared-code convention for one
low-severity finding. Every `json()` helper's call sites were threaded
`req` as an explicit first argument (mechanical, ~70 call sites across the
six files) so each response's CORS headers reflect that specific request.
Deployed and verified live: an allow-listed origin gets its own value
reflected back, a third-party origin gets no
`Access-Control-Allow-Origin` header at all (browsers block reading the
response), and every function still boots and authenticates correctly
(401, not a crash) after the refactor.

**Access review — `updated_by`.** `role_permission` gains an `updated_by
uuid REFERENCES app_user(user_id)` column
(`00000000000018_role_permission_audit_trail.sql`), and
`upsertRolePermission()` (F5) now takes the caller's id and chains
`.select().maybeSingle()` so `RolesPermissionsTab.toggle()` can gate its
`audit_log` insert on a confirmed written row rather than `error === null`
alone -- closing the audit trail's own version of F5's bug (a
silently-filtered upsert could previously still log a change that never
happened).

## F6 codebase-wide row-verification audit

Grepped every `.update(` call site in the codebase and classified each by
whether it mutates another account's identity/role/permission state (the
specific RLS-exclusion race F6 describes — a policy scoped to the caller's own
tenant or excluding certain target roles silently filtering the row) versus
ordinary tenant-scoped data entry on a record the acting user already owns
within their own tenant (residents, households, credentials, civil events,
service requests, rental houses, revenue, fee schedules, service-type catalog
entries) — the latter carries a materially different, much lower risk profile
and fixing it would expand this finding into an app-wide refactor the report
never claimed was needed. Fixed the former; left the latter as future
correctness hardening, not part of F6.

**Fixed** (added `.select(...).maybeSingle()` + a "row not found" toast,
matching `changeRole()`/`suspendUserAction()` and `record-login/index.ts`):

- `src/components/settings/UsersRolesTab.tsx` — `changeRole()`,
  `suspendUserAction()` (the two the report names directly)
- `src/components/admin/PlatformUsersTab.tsx` — `suspend()`, `reactivate()`,
  `toggleActive()`, `saveRoleChange()`, `setConsoleRole()` — five more
  instances of the identical anti-pattern on the platform-admin console's own
  user-management screen
- `src/routes/admin.console-roles.tsx` — `toggleActive()` (console role
  enable/disable) and the role name/description `save()` — both mutate
  `console_role`, a platform-level, `is_super_admin()`-gated table

**Already correct, no action needed:** `admin.console-roles.tsx`'s
`toggleGrant()` (the `console_role_permission` matrix) already uses
`.upsert()` with an explicit code comment citing this exact anti-pattern —
someone fixed this one independently before this remediation pass.

**Not fixed, out of scope for F6:** `.update()` sites in
`woreda.settings.woreda-configuration.tsx` (`service_type`, `fee_schedule`)
and `admin.credential-template.tsx` (`id_card_template`,
`id_card_template_field_draft`) — a tenant admin or platform super_admin
editing their own tenant's/platform's configuration row doesn't share the
identity-scoped RLS-exclusion race F6 is about. Left as a general
observation for whoever next touches those screens, not remediated here.

## Phase 6 — internal review pass before deploy

Per this repo's own `review` skill: before the final deploy, the whole branch
diff (`origin/main...HEAD`) was dispatched to `tenant-isolation-review`,
`portal-conventions-review`, and `secret-sweep`. Every actionable finding
below was fixed and verified live; the rest are documented as deliberate,
already-acknowledged gaps rather than silently dropped.

### `tenant-isolation-review` findings

**Finding 1 (High) — `seed.sql` vs. `default_role_perms()` divergence, direction
was backwards.** `role_permission`'s 972 seed rows used
`ON CONFLICT DO NOTHING`. `00000000000015_permission_matrix_backfill.sql`'s
`seed_role_permission_for_new_woreda()` trigger fires on `seed.sql`'s own
`INSERT INTO woreda` statements (which run before `seed.sql`'s
`role_permission` inserts), pre-populating every cell from
`default_role_perms()`. `DO NOTHING` meant that trigger-inserted row always
won, so `seed.sql`'s own explicit values — the tenant-level customizations it
exists to specify — silently never landed for any cell where they disagreed
with the pure default. Verified an 18-row disagreement exists this way:
`credential.verify` is `false` in `seed.sql` but `true` in
`default_role_perms()` for `finance_clerk`/`auditor`/`viewer`. Fixed by
switching all 972 inserts to
`ON CONFLICT (woreda_id, role_name, permission_key) DO UPDATE SET is_granted = EXCLUDED.is_granted`,
so `seed.sql`'s explicit values always win over the trigger's blanket
default, as intended. **No live-database action was needed**: queried
`role_permission` directly and confirmed every existing tenant already has
`credential.verify = false` for these three roles, matching `seed.sql`'s
intended value — the fix protects future fresh deploys from drifting to the
wrong (`true`) value, it doesn't correct anything already wrong in
production. Also corrected a stale claim in
`scripts/check-role-perms-drift.ts`'s own header comment, which asserted
`seed.sql` "can no longer drift independently of" `default_role_perms()` —
false, and this finding is why: `role_permission` is a per-tenant override
table by design, so `seed.sql` is *supposed* to be able to diverge from the
platform default. A drift check that enforced equality here would flag
legitimate tenant customization as a bug, so none was added; the comment now
explains the actual (asymmetric, one-directional) relationship instead.

**Finding 2 (High) — `role_permission_insert_tenant_admin` had no locked-key
exclusion.** The baseline's `UPDATE` policy on `role_permission` excludes
`credential.approve`/`civil.approve`/`tenant.manage`; the `INSERT` policy
right below it never did. F5's `upsertRolePermission()` can route through
`INSERT` when no row exists yet for a given `(woreda, role, key)` triple, so
this was a live bypass of the lock, not a theoretical one. Fixed in
`00000000000019_override_hardening.sql` by adding the same exclusion to the
`INSERT` policy's `WITH CHECK`. Verified live: `pg_policies` shows the new
`WITH CHECK` clause matches the `UPDATE` policy's.

**Finding 3 (High) — no target-role restriction on `user_permission_override`
writes, and its CHECK constraint didn't cover the platform-level locked
keys.** `app_user_tenant_admin_write` already excludes `role = 'tenant_admin'`
targets for exactly this reason (a tenant admin must not be able to edit
another tenant admin, let alone a super admin); the override table's write
policies never mirrored it, so a tenant admin could override permissions for
a peer tenant admin or, in principle, a super admin. Fixed by adding
`user_permission_override_target_role_ok(_user_id)` (a `SECURITY DEFINER`
helper checking the target's `app_user.role`) to the `INSERT`/`UPDATE`/
`DELETE` policies, and extending the CHECK constraint's locked-key list with
`platform.manage`/`tenant.create` (no `role_permission` row ever grants
these at the tenant level, but the override table is a separate surface that
could have). Verified live: a `platform.manage` insert attempt raises the
CHECK violation by name (`user_permission_override_no_locked_keys`).

**Finding 4 (Medium) — `user_permission_override.woreda_id` went stale on a
tenant move.** The BEFORE INSERT/UPDATE trigger from migration 17 sets
`woreda_id` once, but nothing re-ran it when `app_user.woreda_id` changed
later, so a person moved between tenants kept override rows pointing at
their old tenant. Fixed with the reviewer's own recommended (safest) option:
`app_user_clear_overrides_on_woreda_change`, an `AFTER UPDATE OF woreda_id ON
app_user` trigger that deletes every `user_permission_override` row for that
user when their tenant changes — a person moving tenants should not carry
the previous tenant's per-user grants forward. Verified live in a
rolled-back transaction: inserted an override, changed the user's
`woreda_id`, confirmed the override row count dropped to zero.

**Finding 5 (Medium) — `updated_by` columns were plain client-writable, not
server-enforced (schema half); no `audit_log` insert on override changes
(client half).** `role_permission.updated_by` (added in
`00000000000018_role_permission_audit_trail.sql`) and
`user_permission_override.updated_by` were both ordinary columns the client
could set to anything. Fixed the schema half by adding
`force_actor_columns('updated_by')` triggers to both tables — the same
pattern already used on 14 other tables in the baseline (`audit_log`,
`payment`, etc.) — so the column is overwritten server-side from `auth.uid()`
whenever a caller supplies a non-null value for it; verified live via
`pg_trigger`. Fixed the client half by adding `audit_log` inserts, gated on a
confirmed write (never on `error === null` alone, per the F6 house rule), to
`UserPermissionOverridesDialog`'s `setOverride()` (both the grant/deny path
and the clear-to-default path) and to `ChangeRoleDialog`'s "clear all
overrides" checkbox action.

**Lower-severity — `user_permission_override_select_same_woreda` was broader
than needed.** It allowed any authenticated user in the same tenant to read
every override row, not just the two roles that can act on them plus the
affected user themselves. Tightened to
`is_super_admin() OR is_tenant_admin() OR user_id = auth.uid()` in the same
migration.

**Lower-severity — `clearUserOverride`/`clearAllUserOverrides` weren't
row-verified, in the dangerous direction.** An admin clearing an override
that RLS silently filtered (e.g. exactly the Finding 3 target-role exclusion
just added) would believe the grant/deny no longer applied while it still
did. Fixed by chaining `.select(...)` on both delete calls in
`src/lib/userPermissionOverrides.ts` and treating an empty result as a
failure (`ROW_VERIFICATION_FAILURE_MESSAGE`) at both call sites in
`UsersRolesTab.tsx`.

**Finding 6 (High) — `login.tsx`'s active-user sign-in path dropped
`permissions`.** `fetchAuthState()` returns `{ appUser, consolePermissions,
permissions }`; the non-active-user branch passed all three to `setAuth()`,
but the active-user branch (the one every normal sign-in takes) only passed
`appUser`/`consolePermissions`, silently defeating F7 on the path that
matters. One-line fix: added `permissions` to that `setAuth()` call.

Migration `00000000000019_override_hardening.sql` (Findings 2-5 plus the two
lower-severity items) was applied live via the Management API, dry-run
verified in a rolled-back transaction first, then confirmed post-apply via
`pg_policies`, `pg_constraint`, and `pg_trigger` queries and one functional
test in a rolled-back transaction (the woreda-move deletion, Finding 4).

### `portal-conventions-review` findings

**Fixed.** `ChangeRoleDialog`'s "clear all overrides" checkbox was a
hand-rolled `<input type="checkbox">` instead of the existing shadcn
`Checkbox` primitive already used elsewhere in this file — replaced with
`<Checkbox checked={...} onCheckedChange={...} />`.

**Acknowledged, not fixed.** The new dialogs this phase added
(`ChangeRoleDialog`'s override notice, `UserPermissionOverridesDialog`) are
English-only, where the rest of the woreda-facing settings UI is
bilingual Amharic/English. Per this codebase's own discipline (never
fabricate Amharic translations without native-speaker review —
`src/config/permissionLabels.ts` and `src/lib/errorMessages.ts` earlier in
this same remediation were held to the identical standard), this is left as
a documented gap for a native speaker to close in a follow-up, not
silently "fixed" with invented copy.

### `secret-sweep`

Clean — no deploy token or other credential reached the working tree, the
staged diff, or any commit on this branch.
