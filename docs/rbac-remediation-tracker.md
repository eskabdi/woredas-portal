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
| 4     | P2 — F3 (per-user overrides), F8 (single source of truth), F9 (localization), F12 (password reset) | F3 done, rest pending   |
| 5     | P3 — F10 (CORS allow-list), access review (`updated_by`)                                           | pending                 |

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
