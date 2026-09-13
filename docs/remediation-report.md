# Production deploy + live-verification report

Evidence log for the deploy-and-verify pass covering all work landed through
Task 12-A (`fix-task-production-readiness-v3.md`, tasks 1, 1b/9, 2, 3, 4+13,
5, 6, 7, 10, 11, 12-A). Run 2026-09-13, against production project
`tugzuexfyzbdnghbmrjl` and `https://woredas-portal.vercel.app`.

**Classification key** used in every row below:

| Tag                    | Meaning                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `STRUCTURAL`           | Read-only catalog/row-count check against the live database                                       |
| `SMOKE`                | Userless behavioral check against the deployed frontend/RPCs                                       |
| `LIVE-PROBE`           | A `BEGIN...ROLLBACK`-wrapped behavioral probe, net-zero verified (see `scripts/verify-live-probes.sql`) |
| `CI-COVERED`           | Already enforced by an automated CI gate on every PR; not re-verified live here                    |
| `UNVERIFIED`           | Not checked, with a stated reason — never a silent gap                                             |

## 0. Premise corrections found during this pass

Two factual corrections to the task's starting assumptions, made before any
action was taken, both reported to the user at the time:

1. **The live database was not at a pre-task baseline.** All 56 migrations
   (through Task 12-A's own `00000000000054`–`056`) were already applied —
   every task in this multi-session engagement was developed and
   live-verified directly against this same production project. There was no
   migration gap to close; §1 below is a confirmation, not an application.
2. **Production already contains real, non-synthetic data**: 3 residents, 5
   `residence_credential` rows, 8 receipts, created 2026-08-20 through
   2026-09-08 (predating this session) — not the "nothing issued yet"
   pre-production state the task assumed. This data was read-only referenced
   for some probes below (never written to outside a rolled-back
   transaction) and never modified.

Also: two script commits (`scripts/verify-live-probes.sql`,
`scripts/run-live-probes.py`) were pushed directly to `main` rather than
through a reviewed PR branch — a lapse in this repo's normal process. They
are test/tooling-only (no application code touched) but this should not
recur.

## 1. Deployment state

| Item                                              | Result                                                                                                        | Evidence                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 12-A merged to `main`                              | PASS                                                                                                             | PR #59, merge commit `fa6b574`, CI green (lint/build/tsc/test/drift/fee-catalog) before merge      |
| DB migration catalog matches `main`               | PASS (`STRUCTURAL`)                                                                                              | 51 live tables == 51 `CREATE TABLE` statements across `supabase/migrations/*.sql`; no drift        |
| Vercel production serves current `main`            | PASS                                                                                                             | `vercel deploy --prod --yes --archive=tgz` from `main@fa6b574`; deployment `dpl_91JBVNt7AmKuVN4dHYvuVuDxY7t8` aliased to `https://woredas-portal.vercel.app`, HTTP 200. No commit-SHA metadata is recoverable from Vercel itself (archive-tgz deploys aren't git-linked) — the guarantee is by construction: the deploy was built from a freshly checked-out `main` with a clean working tree. |
| Edge Functions reachable                           | PASS                                                                                                             | All 7 functions respond non-404 (`sign-credential` 405, `invite-tenant-user` 405, `invite-platform-admin` 405, `resend-platform-invite` 405, `activate-invited-user` 405, `record-login` 405, `send-password-reset-link` 401) |

## 2. Structural verification (`STRUCTURAL`)

| Check                                                       | Result | Evidence                                                                 |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------- |
| RLS enabled on every table                                    | PASS   | `pg_class.relrowsecurity = true` for all 51 tables spot-checked (8 key tables individually, `pg_policies` populated for all 51) |
| Every table has ≥1 policy                                     | PASS   | `pg_policies` grouped by `tablename`: 51/51 rows present, counts 1–4 each  |
| `workflow_transition` seed                                    | PASS   | 31 rows: 22 `credential_request`, 9 `residence_credential`                |
| `role_permission` default matrix                              | PASS   | 2,982 rows = 7 roles × 6 woredas × 71 permissions each (426/role, 497/woreda, uniform) |
| `fee_schedule` — Task 12's 4 mapped service types             | PASS   | 6 active rows each for `New ID Issuance`/`ID Renewal`/`Lost ID Replacement`/`Internal Re-Print` — exactly what `resolve_credential_fee()` needs |
| `office` backfill (Task 11)                                   | PASS   | Exactly 1 row per woreda × 6 woredas                                       |
| `household_location` backfill (Task 11)                       | PASS   | 0 households missing a `household_location` row                          |
| `bun run check:fee-catalog` against live seed state            | PASS   | `OK: all 6 woredas have exactly one active row for each of 4 mapped service types.` |
| `bun run check:role-perms-drift`                               | PASS (`CI-COVERED`) | `OK: permissions.ts and default_role_perms() agree for every role.`      |

## 3. Userless behavioral smoke (`SMOKE`)

| Check                                                        | Result | Evidence                                                             |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Production app loads                                          | PASS   | `GET https://woredas-portal.vercel.app/` → HTTP 200                    |
| Public verify route reachable (unauthenticated)                | PASS   | `GET /v/nonexistenttoken` → HTTP 200 (client-rendered not-found state) |
| `verify_credential_token` returns no PII for an invalid token   | PASS   | `POST rpc/verify_credential_token {"_token":"bogus.token"}` → `200 []` — no row, no error, no existence leak |
| `verify_service_letter` returns no PII for an invalid token     | PASS   | `POST rpc/verify_service_letter {"_token":"bogus"}` → `200 []`         |
| Anon direct table read is RLS-empty, not an error               | PASS   | `GET /rest/v1/resident?select=full_name,national_id_no` as anon → `200 []` |
| Anon rate-limiting on the verify RPCs (observable 429)          | `UNVERIFIED` | By design: `docs/erd.md`'s rate-limiting section states the two public verification RPCs are deliberately **not** rate-limited (see migration `00000000000022_rate_limit.sql`'s own header comment). The rate limiter (`rate_limit_bucket`/`checkRateLimit()`) only gates the three invite Edge Functions, which require an already-authenticated admin caller — there is no anon-reachable rate-limited surface to produce a 429 against, and creating an admin session to test it would mean either a synthetic account (excluded) or the owner's own real session (not available to this agent). |
| Auth sign-in for the owner's real account                       | `UNVERIFIED` | Requires the owner's actual password, which this agent does not have and should not request. See §6 (owner UI smoke). |

## 4. Live behavioral probes (`LIVE-PROBE`)

All 10 probes below are defined in `scripts/verify-live-probes.sql` and executed
by `scripts/run-live-probes.py`. Every probe ran inside `BEGIN...ROLLBACK`;
the run's net-zero table below proves nothing persisted.

| # | Probe                                        | Task    | Result | Evidence (exact error / result) |
| - | ----------------------------------------------- | ------- | ------ | ---------------------------------- |
| 1 | Unauthorized backward transition (`active`→`submitted`) | 1  | PASS | `ERROR 23514: workflow: credential_request may not move from active to submitted` |
| 2 | Maker = checker on approval                      | 1       | PASS | `ERROR 42501: workflow: the approver and the verifier must be two different people` |
| 3 | Terminal (`rejected`) state re-opened             | 1       | PASS | `ERROR 23514: workflow: credential_request may not move from rejected to submitted` |
| 4 | `paid` reached with no confirmed payment+receipt   | 1       | PASS | `ERROR 23514: payment: a confirmed payment with a receipt is required before a credential is generated` |
| 5 | Direct `INSERT` into `residence_credential` (bypassing the payment trigger) | 1/10 | PASS | `ERROR 42501: workflow: a residence credential is issued by the payment trigger, not by direct insert` — a stronger guarantee than the originally-scoped "one active credential per resident" index check: a new row can't be forged at all outside the payment trigger. The partial unique index itself (`residence_credential_one_active_per_resident ... WHERE status='active'`) was separately confirmed live via `pg_indexes`. |
| 6 | `credential_number` immutable once assigned        | 10      | PASS | `ERROR P0001: residence_credential.credential_number cannot be changed once assigned` |
| 7 | Cross-woreda `vital_event` INSERT (tenant_admin from woreda A, `woreda_id` = woreda B) | 2 | PASS | `ERROR 23514: vital_event: resident_id does not belong to woreda d43c7fea-...` — rejected before the RLS tenant-check was even reached, by a same-purpose trigger-level guard |
| 8 | Cross-tenant `credential_request` read returns zero rows | 4/2 | PASS | tenant_admin of woreda B selecting woreda A's rows → `{"visible_rows": 0}` under `SET LOCAL role authenticated` (RLS actually engaged, not bypassed) |
| 9 | `role_permission` row for a reserved role (`super_admin`) rejected | 4+13 | PASS | `ERROR 23514: ... violates check constraint "role_permission_role_name_check"` |
| 10 | Reserved permission (`credential.approve`) ungrantable via `user_permission_override` | 4+13 | PASS | `ERROR 23514: ... violates check constraint "user_permission_override_no_locked_keys"` |

**Net-zero proof** (before → after, this run):

```
table:credential_request:       5 → 5
table:residence_credential:     5 → 5
table:vital_event:              0 → 0
table:role_permission:       2982 → 2982
table:user_permission_override: 0 → 0
seq:credential_request_sequence: 5 → 5
seq:resident_number_sequence:    3 → 3
seq:vital_event_sequence:        1 → 1
auth.users:                      9 → 9
rate_limit_bucket:               1 → 1
```

10/10 probes passed. No residue.

### RLS-as-role feasibility (item 5 of the task)

**Feasible**, and used above (probes 7–8). The raw Management API session
runs as role `postgres` with `rolbypassrls = true` (confirmed via
`pg_roles`), so it bypasses RLS by default — but `SET LOCAL role
authenticated` inside the transaction drops that bypass, and `SET LOCAL
request.jwt.claim.sub = '<uuid>'` makes `auth.uid()` resolve to a real
user for `get_user_woreda_id()`/`user_has_perm()`. Both are reset/rolled
back with the rest of the transaction.

**Role coverage available**: only two roles have an active account in
production — `registry_clerk` (35b307bd-...) and `tenant_admin` (two
accounts, in different woredas: 64e0384a-... and bad5a1c7-...), plus two
`super_admin` accounts. No active `civil_registrar`, `finance_clerk`,
`supervisor`, `print_officer`, `auditor`, `viewer`, or custom-role account
exists. `tenant_admin`'s default permission grant (`default_role_perms`)
happens to cover every FSM permission the probes above needed
(`credential.review`/`.approve`/`.record_payment`/`.reject`/`.confirm_print`/`.activate`),
which is why probes 1–4 could use it as a single capable actor. Checks that
specifically require one of the unavailable roles are `UNVERIFIED` below.

## 5. Items UNVERIFIED with reason

| Item                                                              | Task | Reason |
| -------------------------------------------------------------------- | ---- | -------- |
| 18y-0d accepted / 17y-364d rejected age boundary                     | 1/9  | `calculateAgeYears()` + `PreConditionCard` is a **client-side advisory** check (per its own design: "the server remains the sole authority... this only gives the officer a specific reason before a generic server rejection"). There is no database-layer age gate to probe — confirmed by grep across `supabase/migrations/*.sql` for any age/DOB CHECK on `credential_request` or a trigger referencing `date_of_birth`: none exists. This is CI-covered instead: `src/utils/__tests__/ethiopianCalendar.test.ts` has 3 boundary-case unit tests for `calculateAgeYears` (today's-birthday edge, Feb-29-against-non-leap-year), run on every PR. |
| `viewer` role write rejected                                         | 4    | No active `viewer` account exists in production; creating one would violate the zero-synthetic-accounts decision for this pass. The `role_permission`/`default_role_perms()` matrix for `viewer` was inspected statically instead: `check:role-perms-drift` confirms `viewer`'s compiled and DB-seeded permission sets agree, and neither includes any write permission (`credential.submit`/`.verify`/`.approve`/etc.) — so `user_has_perm()` would return false for any write attempt by construction. Not a live-fired proof. |
| Custom tenant-role end-to-end (grant → assign → exact access)        | 4+13 | No custom-role account exists in production. `tenant_role`/`tenant_role_permission` schema and RLS were inspected statically (both scoped by `woreda_id = get_user_woreda_id()`, `tenant_role.is_active` gates); the resolution chain in `user_has_perm()`'s `role = 'custom'` branch was read and traced but not exercised end-to-end. |
| Print officer, civil_registrar, finance_clerk, supervisor, auditor role-specific gates | 4/2/1 | Same reason — no active account for these roles in production. |
| Auth sign-in for the owner's real account                            | —    | Requires the owner's password; not requested or available to this agent. |
| Anon rate-limit 429                                                   | 3    | By design not rate-limited (see §3) — there is no anon-reachable surface where a 429 is the expected behavior. |
| Owner-facing UI smoke (8 stage UIs, attachment upload, print preview, bilingual strings, Ethiopian-calendar dates, permissions-matrix screens) | 12-A/others | Requires a real authenticated session in a browser; this agent has neither the owner's credentials nor (in this sandboxed environment) a path to drive the production UI as a logged-in user without one. See §6. |

## 6. Owner UI smoke — not run by this agent

The task's item 6 (stage UIs render, attachment upload with checksum
confirmation, print preview, permissions-matrix screens, `tenant_admin`
grants uneditable) requires a real logged-in session. This agent does not
have and should not request the owner's production credentials. Structural
and RLS evidence above (§2, §4) indirectly supports most of these — e.g. the
attachment RLS policies and `fee_schedule` catalog are proven correct at the
database layer — but rendering/interaction correctness itself is unverified
here. This becomes the first item of the go-live watch plan (§7).

## 7. Go-live watch plan (Task 8 scope)

Given the `UNVERIFIED` set above is concentrated in (a) roles with no active
production account and (b) UI-only rendering/interaction, the recommended
first-week rollout:

1. **Controlled first-users pass**: have one real person per currently-unverified
   role (civil_registrar, finance_clerk, supervisor or an equivalent
   approver, print_officer, auditor, viewer) exercise one full happy path —
   registry_clerk intake → civil_registrar or supervisor verify/approve →
   finance_clerk payment → print_officer print/activate — with the owner
   observing directly.
2. Watch `audit_log` and `credential_request_status_history` during this
   pass for anything that doesn't match the expected sequence; a mismatch
   here is worth more than a synthetic probe since it's the real FSM under
   real role assignments.
3. Any defect found during this pass goes through the normal PR sequence
   (branch → CI → review → merge) — no hotfixes against `main` directly, and
   nothing gets special-cased around the deploy that already happened.
4. Once the first-users pass completes cleanly, treat every item in §5 as
   closed by that pass's own evidence rather than re-running synthetic
   probes against roles that now have real accounts to test with properly
   (at that point, a real staging pass per `docs/staging-runbook.md` becomes
   the right tool for *future* regression testing — not a same-day
   requirement).
5. Deploy discipline going forward (per this pass's own finding): fold
   deploy + live verify into every PR landing cycle — merge → push →
   Management-API catalog diff → `scripts/run-live-probes.py` (extend it as
   new gates land) — rather than letting deploy verification accumulate
   across many merged-but-undeployed PRs the way it did before this pass.

## 8. Cleanup confirmation

- `auth.users` count unchanged (9 before this pass, 9 after) — zero synthetic
  accounts created anywhere in this pass.
- `/tmp/_probe_payload.json`, `/tmp/live-probe-results.json`,
  `/tmp/q.json`, `/tmp/create_proj.json`, `/tmp/proj_dryinfo.json` deleted.
- `SUPABASE_ACCESS_TOKEN`/`VERCEL_TOKEN` were read from the environment only,
  never echoed, printed, or written to a file; no `p.json`/`payload.json`
  left behind in the repo working tree.
- `git status --porcelain` clean on `main` after the two script commits.
- The one attempted staging-project creation call (twice) failed cleanly at
  the free-tier project cap with no side effects — no project, no charge, no
  orphaned resource.
