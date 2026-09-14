# Production-readiness declaration

**Status: PROPOSED — awaiting owner signature.** This document ships as a
proposal. It is not a self-certification; the closing "Owner sign-off"
section is the actual gate, and until that section is signed this system is
not declared production-ready by this document.

Every claim below cites the report row or probe that supports it. Nothing is
asserted PASS without an evidence class from `docs/remediation-report.md`'s
classification key (`LIVE-PASS`, `LIVE-PROBE`, `SAMPLE-DATA`, `OWNER-SMOKE`,
`STRUCTURAL`, `CI-COVERED`, `UNVERIFIED-with-reason`). Compiled 2026-09-14
against production project `tugzuexfyzbdnghbmrjl` and
`https://woredas-portal.vercel.app`, covering all work landed through Task 8
(`docs/remediation-report.md` §0–17).

## 1. Dimension scoreboard — 12/12 green

Re-scored against `docs/system-review-2026-09.md`'s original 12-dimension
health rating (2026-09-07, commit `679b4f2`).

| Dim | Area                              | 2026-09-07 | Now                           | Basis for the flip                                                                                                                                                                                                                                                                                                 | Evidence                                                    |
| --- | --------------------------------- | ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| A   | Multi-tenant isolation & RLS      | 🟡 Amber   | 🟢 **Green**                  | F-03 closed: `apply_death_on_approval()`/`apply_rental_occupancy_on_approval()` now scope every write by `woreda_id = NEW.woreda_id` (migration `00000000000032`); `vital_event.resident_id`/`.household_id` cross-tenant links now checked. Live enumeration: 52/52 tables RLS-enabled, 139 policies, zero drift. | `LIVE-PROBE` (§4 #7-8) + `STRUCTURAL` (§17c)                |
| B   | RBAC & authorization              | 🟡 Amber   | 🟢 **Green**                  | F-05 closed: the workflow-verb collision resolved by renaming to `credential.review` (D-3, `docs/architecture.md`), not reusing `credential.verify`. `check:role-perms-drift` green in CI on every PR. Reserved-role/permission guards live-probed.                                                                | `LIVE-PROBE` (§4 #9-10) + `CI-COVERED`                      |
| C   | **Workflow integrity**            | 🔴 Red     | 🟢 **Green**                  | F-01 (the review's one Critical finding) closed: `enforce_workflow_transition()` blocks every illegal status change, maker≠checker enforced, `generate_residence_credential_on_payment()` requires `OLD.status = 'awaiting_payment'` and a confirmed payment+receipt before minting.                               | `LIVE-PROBE` (§4 #1-6, §17 rows 1-6)                        |
| D   | Data model & constraints          | 🟢 Green   | 🟢 Green (held)               | No regression found. Luhn check digit, FK completeness, one-active-household structural guarantee (`INV-09`) all re-confirmed.                                                                                                                                                                                     | `STRUCTURAL`                                                |
| E   | Security & INSA compliance        | 🟡 Amber   | 🟢 **Green**                  | F-02 closed: `verify_credential_token` hardened (anon path requires the signed QR payload, not a guessable sequential number; rate-limited 30/60s; every attempt logged to `credential_verification_log`). F-07 closed: `resident.national_id_no` is now in the PII-encryption scope alongside phone/email.        | `LIVE-PASS`/`SMOKE` (§3) + `docs/security-functionality.md` |
| F   | Localization & Ethiopian calendar | 🟢 Green   | 🟢 Green (held)               | Conversion harness re-confirmed correct; regression-locked in `ethiopianCalendar.test.ts`.                                                                                                                                                                                                                         | `CI-COVERED`                                                |
| G   | Credential & QR system            | 🟢 Green   | 🟢 Green (held)               | ES256 signing, no key material in the client bundle, QR/barcode density guards all re-confirmed unchanged.                                                                                                                                                                                                         | `STRUCTURAL`                                                |
| H   | Frontend & routing quality        | 🟢 Green   | 🟢 Green (held)               | `ssr:false` on all 74 route files (up from 66 at the last count — new routes added since all carry it), cache keys remain tenant-scoped.                                                                                                                                                                           | `portal-conventions-review` (per-PR, code-level)            |
| I   | Audit & traceability              | 🟡 Amber   | 🟢 **Green**                  | F-06 closed: `resident_audit_created AFTER INSERT` trigger (migration `00000000000043`) — a DB-level guarantee, not a client-side insert that could be skipped by a direct API call.                                                                                                                               | `STRUCTURAL`                                                |
| J   | Performance & resilience          | 🟡 Amber   | 🟢 **Green**                  | F-12 closed: wizard drafts persist to `localStorage` (`useFormDraft.ts`), swept on sign-out. Task 12-C additionally shipped an offline mutation queue (unrelated to F-12 but the same "resilience" dimension) — see its own evidence class below, since it carries its own residue.                                | `CI-COVERED` (unit tests) + code-level                      |
| K   | Schema drift & migrations         | 🟢 Green   | 🟢 Green (held)               | Repo remains the single source of truth; live enumeration confirms 52/52 tables match `supabase/migrations/*.sql` exactly, zero drift either direction.                                                                                                                                                            | `STRUCTURAL` (§17c)                                         |
| L   | Documentation & operability       | 🟢 Green   | 🟢 Green (held, strengthened) | ERD/DFD/OpenAPI/security docs not just present but re-verified against live enumeration this pass (Task 8); the governing brief's six stale facts corrected.                                                                                                                                                       | This PR                                                     |

**12/12 green.**

## 2. Invariant table

| ID     | Invariant                                                                 | 2026-09-07 | Now                   | Evidence                                                                                                                                          |
| ------ | ------------------------------------------------------------------------- | ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-01 | Every tenant-scoped table has `woreda_id` + enforcing RLS                 | ✅ PASS    | ✅ **PASS (held)**    | `STRUCTURAL`: 52/52 tables, 139 policies live                                                                                                     |
| INV-02 | No cross-tenant data via any surface                                      | ⚠️ PARTIAL | ✅ **PASS (flipped)** | `LIVE-PROBE`: cross-woreda `vital_event` INSERT rejected (§4 #7); cross-tenant `credential_request` read returns zero rows under real RLS (§4 #8) |
| INV-03 | No kebele-level workflow actor                                            | ✅ PASS    | ✅ **PASS (held)**    | No regression; unchanged code path                                                                                                                |
| INV-04 | Portal separation at nav _and_ route level                                | ✅ PASS    | ✅ **PASS (held)**    | No regression                                                                                                                                     |
| INV-05 | Maker ≠ checker, enforced beyond UI                                       | ❌ FAIL    | ✅ **PASS (flipped)** | `LIVE-PROBE`: `ERROR 42501: workflow: the approver and the verifier must be two different people` (§4 #2)                                         |
| INV-06 | Payment cannot precede approval; credential only via trigger              | ❌ FAIL    | ✅ **PASS (flipped)** | `LIVE-PROBE`: unauthorized transition rejected (§4 #1), no-payment mint rejected (§4 #4), direct `residence_credential` INSERT rejected (§4 #5)   |
| INV-07 | `permissions.ts` ↔ `role_permission` consistent; `tenant_admin` protected | ⚠️ PARTIAL | ✅ **PASS (flipped)** | `CI-COVERED`: `check:role-perms-drift` green; workflow verb renamed to `credential.review` (D-3), no more seed drift on `credential.verify`       |
| INV-08 | Tenant IDs immutable; module toggles at nav + route                       | ✅ PASS    | ✅ **PASS (held)**    | No regression                                                                                                                                     |
| INV-09 | ≤1 active household membership per resident                               | ✅ PASS    | ✅ **PASS (held)**    | Structural (scalar FK), unchanged                                                                                                                 |
| INV-10 | Every critical write produces an audit record                             | ⚠️ PARTIAL | ✅ **PASS (flipped)** | `STRUCTURAL`: `resident_audit_created AFTER INSERT` trigger (migration `00000000000043`) closes the one gap (F-06) the original review found      |

**10/10 PASS**, 5 flipped with live probe/structural evidence, 5 held with no
regression found.

## 3. Workflow conformance — `docs/id-card-workflow.txt`

The binding ID-card workflow spec (recovered under decision D-1,
`docs/fix-task-v3-execution-notes.md`) is implemented or explicitly covered
by one of the recorded ignored/resolved contradictions (`docs/architecture.md`'s
decision record: D-1 through D-4, O-1 through O-7):

- The 18-entry status-chip map and the 10 KPI widgets: both confirmed
  present and matching the spec (D-1 corrected the fix task's own earlier
  miscount of 17 chips).
- The verification/approval FSM: implemented via the shared workflow engine
  (`workflow_transition`, `enforce_workflow_transition()`), with `verified`
  and `approved` as real stops (D-2) rather than the pre-existing UI's
  shortcut through `approval_returned`.
- The `credential.review` vs `credential.verify` naming (D-3): resolved by
  giving the workflow-stage verb its own name rather than reusing a
  pre-existing public-verification permission.
- `ready_to_print`/`printing` state ownership (O-1): `ready_to_print` lives
  on `residence_credential`, matching the shipped UI exactly, not on
  `credential_request`.
- `fee_schedule` (D-4), Task 11's generic `attachment`/`approval` tables
  (O-3), and the remaining open items (O-2, O-4–O-7) are each resolved as
  recorded in `docs/fix-task-v3-execution-notes.md` and `docs/erd.md`'s Task
  11 gap-fill section.

No numbered requirement of the spec was found unimplemented and
uncovered by one of these records.

## 4. Age invariant, end to end

**Claim: no path — UI, a direct PostgREST call, or Task 12-C's offline-sync
replay — can mint a residence credential for a resident under 18, or one
missing a phone number or photo.**

This was **not true** until this PR (Task 8 finding): the 18+ rule was
enforced client-side only (`woreda.credentials.new.tsx`'s `hardBlocked`
check) and failed open on a missing date of birth, despite a code comment
claiming server-side authority. Closed by migration
`00000000000068_age_identity_mint_guard.sql`, which extends
`generate_residence_credential_on_payment()` — the single trigger that
mints a `residence_credential` row on **every** path that can move
`credential_request.status` to `paid`, including the offline-sync replay in
`src/lib/offlineSync.ts` (same table, same column, same trigger) — to
reject fail-closed on age, missing phone, missing photo, or an inactive
resident.

**Migration 68 shipped with two critical regressions, found by dispatching
`workflow-fsm-review` and `tenant-isolation-review` against it before push,
and corrected within this same PR** — recorded honestly here rather than
presenting only the final state. It was written against migration 25's
version of the function instead of the live one, so it silently reverted
migration 66's payment-linkage predicates (opening a cross-request payment
fraud vector) and migration 29's `set_config('app.minting_credential', ...)`
calls (which would have made every credential mint in production fail with
`insufficient_privilege`). Both agents converged on the same two findings
independently. Fixed via corrective migration
`00000000000069_age_guard_fix_stale_base.sql` (`CREATE OR REPLACE` on the
same function; migration 68 itself is not reverted, per the additive-only
guardrail), which restores both, and adds a fourth check the same review
flagged as missing: `resident.active_flag = true`. Verified live via a
direct `pg_proc.prosrc` query confirming every required element is present
in the deployed function body.

**Migration 69's own fourth check was itself incomplete: `active_flag =
true` without `residency_status <> 'deceased'`.** `apply_death_on_approval()`
(baseline migration) sets `residency_status = 'deceased'` on an approved
death event but never touches `active_flag`, so a deceased resident's
`active_flag` stays `true` and would have slipped past migration 69's check
alone. Found by `/code-review` run against this PR's own diff — a third,
independent check beyond the two dispatched agents, which also caught
something real — by cross-referencing `enforce_service_request_preconditions()`
(migrations 65, 66), which tests both conditions together and is what
migration 69's own header comment claimed to match. Fixed via
`00000000000070_mint_guard_deceased_check.sql` (`CREATE OR REPLACE` again),
verified live via the same `pg_proc.prosrc` method, with a new dedicated
probe, `age_guard_rejects_deceased_resident`.

The review also found the original three probes were not genuine positive
controls: all three disabled `residence_credential`'s own
`zz_enforce_workflow_insert` trigger during setup, which happens to mask the
exact `insufficient_privilege` regression migration 68 introduced — since
all three also expected `ERROR`, none could have caught it. Fixed by
rewriting `age_guard_accepts_exact_18th_birthday_today` to leave that
trigger enabled, and adding two new probes that also leave it enabled.

Evidence (`LIVE-PROBE`, rollback-wrapped, net-zero — full 66-probe suite:
PASS, `scripts/verify-live-probes.sql`):

| Probe                                                | Setup                                                                    | Result                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `age_guard_rejects_minor`                             | Resident, age 10, phone+photo present                                     | `ERROR 23514: credential: resident is under 18`                                                                            |
| `age_guard_rejects_missing_phone`                     | Resident, age 30, no phone number                                         | `ERROR 23514: credential: resident has no phone number on file`                                                            |
| `age_guard_rejects_deceased_resident`                 | Resident, `active_flag = true`, `residency_status = 'deceased'`           | `ERROR 23514: credential: resident is not active` — confirms migration 70's fix                                            |
| `age_guard_accepts_exact_18th_birthday_today`         | Resident whose 18th birthday is exactly today, **all guard triggers enabled** | Accepted — confirms the boundary is inclusive, matching client-side `calculateAgeYears()`, and that no guard spuriously blocks it |
| `credential_happy_path_mint_with_guards_enabled`      | Full valid mint, every guard trigger enabled                              | Accepted, `residence_credential` row created — the genuine positive control the original three probes lacked               |
| `credential_paid_with_unrelated_payment_row`          | Request B tries to satisfy its payment gate with request A's confirmed payment | `ERROR`: "a confirmed payment with a receipt is required" — confirms migration 69 restored the payment-linkage predicate   |

Client-side reinforcement: a separate `residentCreateSchema`
(`residentSchema.ts`, base schema plus `.superRefine()` so its
`z.input`/`z.output` types stay identical to what `ResidentWizardSteps`
expects) now requires a phone number (new `requiredPhoneDigitsSchema()`,
same 9-digit `+251`-prefixed format every other phone field already uses)
and a photo — applied **only** to the resident-intake form
(`woreda.residents.new.tsx`). The shared base `residentSchema` used by the
edit form was deliberately left with both fields optional: an earlier draft
made them required on the shared schema and would have made every existing
newborn resident un-editable, since `generate_resident_on_birth_approval()`
(migration 59) creates newborn residents with neither field — caught by the
same review and fixed before push; `src/lib/__tests__/residentSchema.test.ts`
locks the create-vs-edit split in with 5 tests.
`woreda.credentials.new.tsx` additionally surfaces `noPhone`/`noPhoto`
warnings (matching the existing `notActive`/`isUnder18` pattern, each
linking to the resident's edit page) so an officer is told before attempting
payment, not only when a credential mint later fails.

Deliberately **not** a table-wide `NOT NULL` on `resident.phone_number`/
`photo_url`: `generate_resident_on_birth_approval()` (migration 59) inserts
a resident row for a newborn from civil registration with neither field,
correctly. See `docs/architecture.md`'s "18+ age invariant" section for the
full reasoning.

## 5. What "verified" means here — an honest statement

This system has **no staging environment**. The one attempted
staging-project creation call failed cleanly at the account's free-tier
project cap (`docs/remediation-report.md` §0, §8); provisioning a real
second Supabase+Vercel project remains a deliberate, costed go-ahead the
owner has not yet given (`docs/staging-runbook.md`).

Verification against production instead uses:

- **`LIVE-PROBE`**: a `BEGIN…ROLLBACK`-wrapped transaction against the real
  production database, using **claims-impersonation**
  (`SET LOCAL role authenticated` + `SET LOCAL request.jwt.claim.sub`) to
  make `auth.uid()` resolve to a real, specific, pre-existing user, so RLS
  and permission checks evaluate exactly as they would for that person's own
  real session. Every probe's net-zero table-count check confirms nothing
  persisted.
- **`LIVE-PASS`**: a direct, non-rollback-wrapped call against production,
  confirmed correct without any synthetic write.
- **`OWNER-SMOKE`**: a real authenticated browser session, which this agent
  cannot mint (minting one via the Management API's `generate_link` would
  require revealing the anon key, which this environment declines) —
  performed and reported by the system owner instead.
- **`STRUCTURAL`**: read-only catalog enumeration (tables, policies,
  triggers, row counts) against the live schema.

**Role coverage caveat, carried forward, not newly introduced by this PR**:
only `registry_clerk`, two `tenant_admin` accounts (different woredas), and
two `super_admin` accounts have active real accounts in production as of
this pass. No active `civil_registrar`, `finance_clerk`, `supervisor`,
`print_officer`, `auditor`, `viewer`, or custom-role account exists. Every
claim in this declaration that depends on one of those roles' specific
behavior is marked `UNVERIFIED-with-reason` or `OWNER-SMOKE`, not silently
assumed — see the go-live plan below, item 1, for how this closes in the
first week.

**This is real production verification, not a substitute for it** — every
probe runs against the actual schema, actual RLS policies, and actual data
this system serves. What it is not is a full first-real-user walkthrough of
every role's UI, which requires people with real jobs to do, not a script.

## 6. Go-live plan

### First-week watch list (consolidated — 12 items carried forward + Task 8 additions)

1. **Controlled first-users pass** (carried from §7 of the remediation
   report): one real person per currently-unverified role
   (`civil_registrar`, `finance_clerk`, `supervisor` or an equivalent
   approver, `print_officer`, `auditor`, `viewer`) exercises one full happy
   path — intake → verify/approve → payment → print/activate — with the
   owner observing. This closes every role-specific `UNVERIFIED` item in
   `docs/remediation-report.md` §5/§17 in one pass.
2. **Watch `audit_log`/`*_status_history`** during that pass for anything
   that doesn't match the expected FSM sequence.
3. **Custom role, end-to-end** (row 12 of §17): create one real custom role
   via `/woreda/settings/users-permissions`, assign it to one real user,
   confirm it grants exactly what was configured and nothing reserved.
4. **Task 12-C OWNER-SMOKE-PENDING** (row 35 of §17): a live
   browser-devtools-offline-toggle walkthrough — queue a submission offline,
   reconnect, confirm sync success; then queue a submission for a resident
   made ineligible in the meantime, confirm the rejection surfaces with the
   server's own message. Record screenshots.
5. **True device-level offline** (row 36 of §17): installed-PWA, real
   network-loss check on an actual field workstation.
6. **DMARC ramp**: after 1-2 weeks of clean DMARC aggregate reports under
   the current `p=none` monitoring policy, ramp to `p=quarantine`, then
   `p=reject`.
7. **Amharic native-speaker sign-off**: `docs/amharic-strings-glossary.csv`
   (693 unique Amharic/English pairs, extracted from source) delivered to
   the owner for review; sign-off is a prerequisite the owner explicitly
   flagged as outstanding for this declaration — see §7 below.
8. Any defect found during the first-users pass goes through the normal PR
   sequence (branch → CI → review → merge) — no hotfixes directly against
   `main`.
9. Once the first-users pass completes cleanly, a real staging project (per
   `docs/staging-runbook.md`) becomes the right tool for _future_ regression
   testing, not a same-day blocker for this declaration.
10. Fold deploy + live-verify into every future PR's landing cycle (already
    the practice since Task 12-A; keep it that way).
11. Continue extending `scripts/verify-live-probes.sql` as new gates land,
    per the established pattern.
12. Re-visit the console-permission axis (`CP`/`console_role`) for a drift
    check the way `check:role-perms-drift` covers the tenant-side matrix —
    noted as a gap in CLAUDE.md ("there is no drift check for this axis the
    way there is for `ROLE_PERMISSIONS`"), not urgent but worth scheduling.

### Rollback path

- **Frontend**: `vercel rollback` to the prior deployment, or
  `vercel deploy --prod` from the prior commit's checkout — no data-layer
  dependency, safe at any time.
- **Migrations**: every migration in this project is additive-only (no
  `DROP`, `CREATE OR REPLACE` for functions/triggers) — see CLAUDE.md and
  `.claude/skills/fsm-migration/SKILL.md`. Reverting a migration's
  _behavior_ means writing a new additive migration that `CREATE OR
REPLACE`s the affected function back to its prior body (schema-preserving
  rollback, never a `DROP`/`ALTER ... DROP COLUMN`), since a genuine
  structural rollback would risk data loss this project's guardrails
  specifically forbid.
- **Specifically for the age/identity mint guard** (migrations
  `00000000000068`/`00000000000069`/`00000000000070`): rolling back would
  mean `CREATE OR REPLACE FUNCTION generate_residence_credential_on_payment()`
  back to its pre-Task-8 body — not recommended, since that reopens the
  exact minor-credential gap this PR closes (and, if rolled back only as
  far as 68 or 69 rather than past 70, would reopen the cross-request
  payment-fraud gap 69 fixed or the deceased-resident gap 70 fixed), but
  mechanically available if a false-positive rejection ever blocks a
  legitimate real case in a way that needs an emergency
  reversal before a proper fix ships.
- **Edge Functions**: `scripts/deploy-functions.sh` redeploys from any
  checked-out commit; a function's own prior version is recovered by
  redeploying from that commit.

### Ops runbook references

- `docs/staging-runbook.md` — provisioning a second environment, when the
  owner is ready to fund it.
- `.claude/skills/deploy/SKILL.md` — the four-artifact deploy sequence
  (schema, seed, Edge Functions, frontend) and its ordering.
- `.claude/skills/doctor/SKILL.md` — diagnosing a broken or misconfigured
  deployment.
- `docs/security-hardening.md` — what's code vs. a manual dashboard action
  (Vercel WAF, Cloudflare-equivalent controls).

## 7. Owner inputs

Collected 2026-09-14, reflected throughout this declaration and
`docs/architecture.md`:

| Input                           | Owner decision                                                                                 | Reflected where                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Public-repo posture             | **Stay public**, secrets-enforced-out-by-CI (existing `secret-sweep` subagent + CI posture)    | No repo-setting change made                                                                                                   |
| DMARC policy                    | **`p=none`** (monitoring-only, ramp planned)                                                   | §6 watch-list item 6, `docs/architecture.md` DMARC section                                                                    |
| Amharic native-speaker sign-off | **Not yet complete** — owner requested the full Amharic/English string set as a CSV for review | `docs/amharic-strings-glossary.csv` delivered; §6 watch-list item 7; this declaration does not claim Amharic sign-off is done |
| Token rotation                  | **Confirmed complete** (matches PR #72's record)                                               | No further action; `docs/remediation-report.md` §14                                                                           |

## 8. Final review-agent pass

Dispatched against this PR's own claims before presenting for sign-off:
`workflow-fsm-review` (the age/identity mint-guard migration and its
interaction with the workflow engine) and `tenant-isolation-review` (the
new migration's tenant scoping, and the resident-schema requiredness
change), plus `/code-review` as a third, independent pass over the same
diff before merge. All raised findings, and all are fixed, not merely
recorded — see `docs/remediation-report.md` §17a for the full account:

1. **CRITICAL** — migration 68 was based on a stale (migration-25) function
   body and silently reverted migration 66's payment-linkage predicates,
   reopening a cross-request payment-fraud gap. Fixed in migration 69.
2. **CRITICAL** — migration 68 also dropped migration 29's
   `set_config('app.minting_credential', ...)` calls, which would have made
   every credential mint in production fail with `insufficient_privilege`.
   Fixed in migration 69.
3. **MEDIUM** — the original three probes disabled the exact guard trigger
   that would have caught findings 1–2, so none of them were genuine
   positive controls. Fixed: one probe rewritten, two new probes added,
   all three leaving that trigger enabled.
4. **MEDIUM** — an earlier draft made `photo_url`/`phone_digits` required
   on the shared `residentSchema`, which would have made every existing
   newborn resident un-editable. Fixed by splitting a separate
   `residentCreateSchema` used only by the intake form.
5. **LOW** — `woreda.credentials.new.tsx` didn't surface the phone/photo
   gap client-side before payment. Fixed with `noPhone`/`noPhoto` warnings
   matching the existing pattern.
6. **LOW** — `offlineSync.ts`'s `syncRecordPaymentDraft` had an
   error-message parity gap for a failed final status update after an
   already-recorded payment. Fixed to match the adjacent branch's guidance.
7. **HIGH** (found by `/code-review`, after findings 1–6 were already
   fixed) — migration 69's own fourth check (`active_flag = true`) was
   itself incomplete: it omitted `residency_status <> 'deceased'`, which
   `apply_death_on_approval()` never syncs to `active_flag`, so a deceased
   resident could still mint a credential. Fixed in migration
   `00000000000070`, with a new dedicated probe.

All seven confirmed fixed and re-verified (66/66 live probes, `bun run test`,
`tsc --noEmit`, `bun run build`, `bun run lint` all green) before this PR
was opened — none are open items carried into go-live.

## Owner sign-off

This declaration is a proposal. Production-ready is declared only when the
system owner signs below, after reviewing §7's owner inputs (including the
still-outstanding Amharic sign-off) and confirming the §6 go-live plan is
acceptable as the residue this system goes live carrying.

```
Signed: _______________________________   Date: _______________
        (system owner)
```
