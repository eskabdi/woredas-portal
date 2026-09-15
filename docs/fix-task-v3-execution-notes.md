# Execution notes — `fix-task-production-readiness-v3.md`

Prepared 2026-09-07, before implementation. Records what was checked, what in the fix
task conflicts with the as-built system, and the owner decisions that settle each
conflict. Read this alongside the fix task; where the two disagree, this file is the
later document.

Binding sources now in-repo: `docs/id-card-workflow.txt` (the ID Card Workflow spec,
recovered from the owner's `.docx` and converted to text) and
`docs/system-review-2026-09.md` (the audit of commit `679b4f2`).

---

## 1. Live-database verification (closes the audit's dimension-K gap)

The audit could not reach the live project and marked every schema claim **UNVERIFIED**.
That is now closed. Executed 2026-09-07 against project `tugzuexfyzbdnghbmrjl`
(woreda-portal-DB, eu-west-1, ACTIVE_HEALTHY) via the Management API:

| Check                                    | Result   |
| ---------------------------------------- | -------- |
| Tables in live `public` schema           | **42**   |
| Tables defined in the 25 repo migrations | **42**   |
| In repo but not live                     | **none** |
| In live but not repo                     | **none** |

**No schema drift.** KD-4 is not reproduced against the live database either, not just
against the repo. Dimension K is Green with evidence.

### Guardrail 19 needs different mechanics

The fix task says run `supabase db diff` before starting and `supabase db push` after
each migration. Neither works on this project:

- The live database has **no** `supabase_migrations.schema_migrations` table — the schema
  predates migration files (built via the dashboard; see `CLAUDE.md`). `db push` has no
  baseline and would attempt to replay all 25 migrations.
- Postgres ports 5432 / 6543 are blocked from sandboxed agent environments; port 443 to
  the same host is open.

The intent of guardrail 19 is satisfied by different means, encoded in the
`fsm-migration` skill: apply through the Management API (the path
`scripts/phase-c-apply-migration.sh` already used to land migration 23), and verify by
querying `information_schema`, `pg_policies` and `pg_constraint` instead of diffing.
The pre-work drift check is the table comparison above.

---

## 2. Conflicts found, and how they are settled

### D-1 · `ID Card Workflow.txt` — resolved, now in-repo

Cited as a binding source but absent from the tree. The owner supplied it; it is saved as
`docs/id-card-workflow.txt` (845 lines). Two corrections to the fix task's summary of it:

- The status chip map has **18** entries, not the 17 the fix task states: Draft,
  Submitted, Under Review, Verified, Returned, Pending Approval, Approved, Awaiting
  Payment, Paid, Ready to Print, Printing, Printed, Active, Expired, Suspended, Revoked,
  Replaced, Rejected (`docs/id-card-workflow.txt:580-601`).
- The 10 KPI widgets are confirmed as listed (`:765-780`).

### D-2 · FSM vs the as-built UI — **UI moves to the FSM**

The as-built UI skips two states the fix task's FSM requires, and writes one the FSM does
not mention:

| UI action                  | File:line                                         | Writes today                           | FSM requires                                                      |
| -------------------------- | ------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Verification "አልፏል / Pass" | `woreda.credentials.$requestId.index.tsx:336-369` | `under_review → pending_approval`      | `under_review → verified`, then `verified → pending_approval`     |
| Approval "Approve"         | `:486-510`                                        | `pending_approval → awaiting_payment`  | `pending_approval → approved`, then `approved → awaiting_payment` |
| Approval "Return"          | `:531-552`                                        | `pending_approval → approval_returned` | `pending_approval → returned`                                     |

**Owner decision: change the UI to match the FSM.** `verified` and `approved` become
real stops. The Pass and Approve buttons are rewritten to walk every state. This is the
full 8-stage model the workflow spec describes, and it costs extra work in Task 12.

Consequences to carry into implementation:

- `approval_returned` stays in the CHECK constraint (removing it is non-additive) but
  becomes a **retired value with no seeded transitions**. The UI must stop writing it.
- Return-from-approval therefore lands in `returned`, and resubmit goes
  `returned → under_review` — meaning an approval return now re-enters **verification**,
  not approval. That is a real behaviour change from today, where
  `approval_returned → pending_approval` skipped re-verification. It is the stricter
  reading and consistent with the FSM.
- `draft`, `verified` and `approved` are currently unreachable from the UI; after this
  change only `draft` remains UI-unreachable, by design (E1).

### D-3 · `credential.verify` name collision — **new name for the workflow step**

Two different meanings compete for one string:

- **As built:** `credential.verify` gates the public ID-lookup screen
  (`src/config/permissions.ts:272-277`, route `/woreda/credentials/verify`) and is
  deliberately granted to `viewer` and `auditor`.
- **Workflow spec:** `credential.verify` is the workflow verification verb held by
  `registry_clerk`; read-only roles get `credential.view` instead
  (`docs/id-card-workflow.txt:59-68`).

Reusing the string would hand request-verification to every viewer and auditor.

**Owner decision: the workflow step takes a new name, `credential.review`.**
`credential.verify` keeps its current meaning and its current grants — no role silently
gains power. Everywhere the workflow spec says `credential.verify` as a workflow verb,
implement `credential.review`. `credential.view` is still added per the spec's RBAC
table for the read-only roles.

Related, not blocking: `credential.print` triples as QR-sign + print + handover, and
`credential.renew` is defined but referenced by no route.

### D-4 · `fee_schedule` already exists — **extend it additively**

Task 11 lists it under "Build". It is one of the 42 existing tables
(`baseline.sql:122-131`):

```
as-built: fee_schedule_id, woreda_id, service_type, standard_fee, penalty_rate,
          status, created_at, updated_at
Task 11:  woreda_id, service_type, amount, effective_from, is_active
```

Renaming is non-additive, and the single sanctioned non-additive change (A5) is already
spent on Task 13's role CHECK replacement.

**Owner decision: extend the existing table.** Add `effective_from` only; use
`standard_fee` and `status` as they are. Payment stages read the existing columns.

Note for Task 12: the credential payment stage does **not** currently read
`fee_schedule` at all — it reads `woreda_settings.credential_issuance_fee`
(`woreda.credentials.$requestId.index.tsx:1338-1350`). Pointing it at `fee_schedule` is
part of the work, not an existing behaviour.

---

## 3. Open items carried into implementation (no decision needed yet)

| #   | Item                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-1 | `ready_to_print` and `printing` are `residence_credential` statuses, not `credential_request` ones. Task 1 places `paid → ready_to_print` on the request FSM. Both tables need additive CHECK extensions; the migration must state which state belongs to which table.                                                                                                      |
| O-2 | Permission catalogue roughly doubles. 12 of Task 4's 16 credential permissions are new, plus ~9 civil and ~10 service, plus `print_officer` as a 7th tenant role. `seed.sql`'s `role_permission` goes from 1,512 rows (6 × 42 × 6) to roughly 3,000+. Every new key needs three edits in lockstep — this is the KD-5 failure mode, and why `rbac-escalation-review` exists. |
| O-3 | Task 11's `attachment` overlaps `service_request_attachment`, `rental_request_document` and `resident_document`; `approval` overlaps the `*_status_history` tables. Recommendation: new tables sit alongside the existing ones and serve new modules only.                                                                                                                  |
| O-4 | `vital_event.status` defaults to `'pending'`, a value **absent from its own CHECK list** (`baseline.sql:484` vs `:620`). Pre-existing latent bug; Task 14 touches this table and should fix it additively.                                                                                                                                                                  |
| O-5 | `service_request`'s constraint is named `service_request_status_chk`, not `_check`. Scripts that assume the `_check` suffix will miss it.                                                                                                                                                                                                                                   |
| O-6 | The revoke path leaves `credential_request.status` at `active` — revocation acts on the credential only. Confirm this is intended before Task 10 changes it.                                                                                                                                                                                                                |
| O-7 | `credential_request` has no `printed_by_user_id` / `issued_by_user_id`; print and handover actors live in `credential_print_log` and on `residence_credential`. Task 10's print/handover audit must use those.                                                                                                                                                              |

---

## 4. Tooling added for this fix task

| Path                                         | Purpose                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/fsm-migration/SKILL.md`      | write additive migration → dry-run in a rolled-back transaction → apply via Management API → verify by query. Replaces the non-functional `db push` / `db diff` guidance.             |
| `.claude/skills/acceptance-harness/SKILL.md` | per-role test users, direct PostgREST attempts, PASS/FAIL/UNVERIFIED evidence, teardown. The "Done means" criteria are mostly "a direct PATCH must raise", which the UI cannot prove. |
| `.claude/agents/workflow-fsm-review.md`      | FSM correctness: unreachable states, skipped gates, resurrectable terminals, user-drivable system transitions, seeded FSM vs CHECK vs UI.                                             |
| `.claude/agents/rbac-escalation-review.md`   | privilege escalation: three-source lockstep, reserved powers ungrantable via matrix **and** overrides, `tenant_admin` non-editable (A7), custom roles fail closed.                    |
| `.claude/skills/review/SKILL.md`             | dispatch rows added for both new agents.                                                                                                                                              |

Existing agents keep their scope: `tenant-isolation-review` (Tasks 2, 11),
`portal-conventions-review` (Task 12), `card-print-review` (Tasks 10, 12 print),
`secret-sweep` (every push).

---

## 5. Per-task loop

Landing order is unchanged: **1 → 9 (+1b) → 2 → 3 → 4 + 13 → 5 → 6 → 7 → 10 → 11 → 12
→ 14 → 8 last.** Tasks 1, 1b and 2 block go-live.

1. `fsm-migration` — write the additive migration, dry-run against live.
2. Apply via Management API; verify each object by query.
3. Dispatch the matching reviewer(s) per the `review` skill's dispatch table.
4. `acceptance-harness` — execute that task's "Done means" checkboxes live, record
   command output.
5. CI gates: `bun run test` · `bun run build` · `npx tsc --noEmit` ·
   `bun run check:role-perms-drift` · `bun run scripts/generate-permissions-doc.ts --check`.
6. `secret-sweep`, then one PR per task (1+1b together; 4+13 together).

---

## 6. Post-merge code review of Task 1 (2026-09-07)

Task 1 merged as `186706d` without the review chain, because the merge was
requested directly. The chain was run afterward, before the migration reached
any database. It found **15 findings**, four of them release-blocking. All were
reproduced against the repo before being acted on; the fixes ship in
`00000000000026_workflow_engine_fixes.sql` and the accompanying UI changes.

### Blocking, fixed

| #   | Finding                                                                                                                                                                                                                                                                                                                         | Fix                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| R-1 | `approved` was a dead end. `PaymentCard`'s body was gated on `awaiting_payment` alone, so the fee-raise step inside `handleRecord` — the only writer of that status — was unreachable. Every request approved after Task 1 shipped would have frozen.                                                                           | Card body also renders at `approved`.                                                  |
| R-2 | A failed print could never be retried to completion. `handlePrint` moved the credential to `printing` only when `!isReprint`, and one print-log row makes `isReprint` permanently true — so the retry stayed at `ready_to_print` and the confirmation panel never reappeared. This defeated the exact feature it was built for. | Gate on `cred.status === "ready_to_print"`, the FSM-legal source, not on `!isReprint`. |
| R-3 | `approval_queue_v` did not know about `verified` or `approved`, the two resting stops the new FSM introduces — so both work items vanished from `/woreda/approvals`, the single inbox those roles work from.                                                                                                                    | View recreated with both statuses added to the credential arm.                         |
| R-4 | The public verification page treated `printing` as a fully valid credential. Scanning a card still at the printer — including a failed print's discarded misfeed — returned the green "valid" verdict.                                                                                                                          | `notYetIssued` now covers `printing` as well as `ready_to_print`.                      |

### Non-blocking, also fixed

`revoked_by_user_id` was clearable by a status-preserving PATCH (the clearing
guard named only the verifier and approver columns, and `force_actor_columns()`
ignores an explicit null); three mutations inferred success from `error === null`
against the repo's own house rule, one of them discarding the result entirely;
a partially-failed print confirmation stranded the request with the confirm
panel hidden; `verified`/`printing` and four other workflow statuses had no
Amharic chip labels in an Amharic-first portal; `credential.preview_print` was
listed twice in three role branches; the enforcement trigger ran on every
update of both tables; migration 25's header claimed to be ADDITIVE while
dropping a CHECK constraint and two policies; and `docs/erd.md` still said 42
tables.

`approval_returned` was retired with no exit — harmless today (zero live rows,
and nothing writes it any more) but a permanent freeze for any row that reached
it. Migration 26 seeds one recovery transition out of it and none into it.

### Caught by the security pass, not the code review

The code review's approval-queue fix (R-3) was written as a plain
`CREATE OR REPLACE VIEW`. That is **not** safe on this view, and the security
pass caught it before it reached a database:

- `CREATE OR REPLACE VIEW` does **not** preserve `reloptions`. Replacing the
  view without restating `WITH (security_invoker = on)` resets it to NULL —
  verified empirically against this project (`before: {security_invoker=on}`,
  `after: null`).
- `approval_queue_v` is owned by `postgres`, which carries `rolbypassrls`, and
  is `GRANT SELECT ... TO anon`.

So the fix as first written would have stopped the view applying the underlying
tables' RLS and made **every woreda's** service requests, credential requests,
vital events and rental occupancy requests readable by an unauthenticated
caller — the top entry on this repo's own severity ladder, introduced by a
change whose stated purpose was making two statuses visible.

`00000000000006_view_security_invoker.sql` exists because this project already
lost the option once in exactly this way. Migration 26 now restates the option
and **asserts it before COMMIT**, so a future replace that forgets the clause
fails the migration instead of silently opening the view. A negative control
(the same migration with the clause removed) was confirmed to fail with that
assertion, and the passing run was confirmed not to disturb
`household_member_roster`, the other `security_invoker` view.

The lesson generalises: on this project a view replacement is a security change,
not a cosmetic one.

### Deferred, with reasons

| #    | Finding                                                                                                                                                                                                                                      | Why not now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-15 | `log_workflow_transition()` writes a `STATUS_*` audit row for every transition while the app's own handlers still insert their semantic rows (`REQUEST_APPROVED`, `CREDENTIAL_PRINTED`), so one approval click produces three audit entries. | Both halves are load-bearing and neither is simply removable: the trigger row is the guarantee that a **direct PostgREST call** leaves a trail (that is the INV-10 half of F-01), and the app rows carry context the trigger cannot see (reprint reason, printer, waiver). Collapsing them is an audit-model change, not a bug fix, and doing it under deploy pressure risks losing the guarantee that motivated the trigger. Tracked for Task 10, which already reworks the print/handover audit path. |

The one Amharic string this work introduces, `በህትመት ላይ` (`printing`), was
approved by the system owner on 2026-09-07. Every other label reuses a string
already reviewed elsewhere in the app.

### What CI could not have caught

`bun run check:role-perms-drift` was structurally blind to the duplicated
permission: it collapses each role's branch to a `Set` before anything compares
it. The parser now rejects a key listed twice in one branch, with two
regression tests (`scripts/__tests__/check-role-perms-drift.test.ts`). The other
fourteen findings remain outside what any gate in this repo can see — which is
the same argument `docs/rbac-security-forensic-review.md` makes for the review
chain existing at all.

---

## 7. Deploy ordering: migrations and frontend are not independent

Discovered while preparing the live apply. **Migrations 25+26 and the frontend
cannot be deployed independently — each breaks the other's counterpart.**

The seeded FSM does **not** contain the transitions the currently-deployed
frontend writes:

| Deployed UI action | Writes                                 | Seeded? |
| ------------------ | -------------------------------------- | ------- |
| Verification Pass  | `under_review -> pending_approval`     | **No**  |
| Approval Approve   | `pending_approval -> awaiting_payment` | **No**  |

That is by design — decision D-2 made `verified` and `approved` real stops — but
it means:

- **Migration first, old frontend still live:** Pass and Approve raise. The core
  approval flow stops until the new frontend deploys. Nothing is corrupted; users
  see an error toast.
- **Frontend first, old database still live:** the new print flow writes
  `printing` to `residence_credential`, which is absent from the old CHECK
  constraint (migration 25 is what adds it). The write fails **after** the job
  has gone to the printer — producing a physical card the database believes was
  never printed. That is precisely the failure mode the two-phase print step was
  built to eliminate.

**Order: migrations first, frontend immediately after.** The frontend-first
window has a physical-world consequence that the migration-first window does
not — an error toast on Pass is recoverable in a way a printed-but-unrecorded
card is not. Both migrations go in **one transaction** (see
`scripts/apply-workflow-migrations.sh`); 25 alone is a broken state, since it is
26 that fixes the `approved` dead end, the hidden approval-queue rows and the
green verdict on a card still at the printer.

Keep the gap short and prefer off-hours. Requests sitting mid-approval when the
migration lands are not stuck — the new UI walks them through `verified` and
`approved` normally once it is live.

### The apply path

`scripts/apply-workflow-migrations.sh <ref> [--dry-run]` is the committed,
reviewable path, and `.claude/settings.json` allows exactly that script rather
than pre-approving arbitrary SQL against the project. It strips both migrations'
own `BEGIN`/`COMMIT` and wraps the concatenation in one transaction, so
`--dry-run` genuinely rolls back — leaving an inner `COMMIT` in place would
commit migration 25 for real before the wrapper's `ROLLBACK` was ever reached.
The dry run and the apply send byte-identical SQL apart from the closing
keyword, so what was rehearsed is what runs.

---

## 8. Deployment completed — 2026-09-08

The frontend and all migrations are live and in step. Production is built from
`3cc09c2` (confirmed via the deployment's own `meta.githubCommitSha`), aliased
to `woredas-portal.vercel.app`.

### Final live state

| Check                                      | Value |
| ------------------------------------------ | ----- |
| `workflow_transition` rows                 | 31    |
| Temporary LEGACY-28 rows remaining         | 0     |
| `ready_to_print -> printed` (one-step)     | 0     |
| `ready_to_print -> printing` (two-phase)   | 1     |
| `submitted -> verified` (8-stage path)     | 1     |
| `submitted -> pending_approval` (old)      | 0     |
| Ungated transitions                        | 0     |
| Terminal states with an exit               | 0     |
| `zz_enforce_workflow_insert` triggers      | 2     |
| `anon` grants on the two PII-bearing views | 0     |

### Migration order, and why it mattered

25 → 26 → 27 → 28 (temporary) → 29 → **deploy frontend** → 30 (removes 28).

28 and 30 are a matched pair created by an ordering mistake: 25/26 were applied
while the pre-Task-1 frontend was still serving, so the transitions that build
writes were unseeded and live credential processing failed with
`may not move from submitted to pending_approval`. 28 re-seeded them to restore
service; 30 removed them once the new frontend was live. 30 guards itself —
it refuses to run while any request sits at `pending_approval` without having
passed through `verified`, the signature of the old build still being in play.

**The general rule this establishes for this project:** the credential
frontend and the workflow FSM are a single deploy unit. Neither half is
independently deployable, because each enforces assumptions about the other.
The migration must land first (the frontend writes `printing`, which only the
migration makes legal), and the frontend must follow immediately.

### Restored by migration 30

Two-phase printing. While the legacy rows were live, `ready_to_print -> printed`
was legal, so a jammed or misfed printer spent the credential and forced the
resident to start a new request. That window is closed.

### Still open (not deployment blockers)

- **Fee waivers** send `amount: 0`, which `payment_amount_sync()` rejects
  outright. Broken before this work; under the FSM it also strands the request
  at `awaiting_payment` (migration 27's abandon paths are now the escape).
  Needs a product decision — `validate_credential_fee_amount()` already
  contemplates supervisor-authorised waivers, but nothing implements them.
- **`vital_event`, `service_request`, `rental_occupancy_request`** carry no FSM
  triggers, so F-01 remains fully open on all three. Task 14.
- **`authenticated` retains INSERT/UPDATE/DELETE on `household_member_roster`**,
  which is auto-updatable over `resident`. Gated by RLS and used by no code.
