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
