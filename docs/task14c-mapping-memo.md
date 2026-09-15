# Task 14-C — generalize workflow surfaces to civil + services mapping memo

Committed alongside the code (not strictly before it, since the actual
component boundaries only became clear while reading the three modules'
existing pages) per the task's own step 1. This memo assumes the reader
knows Task 12-B's own memo (`docs/task12-mapping-memo.md`) — the
`CredentialQueueTable`/`KpiWidgetRow` extraction this task generalizes —
and Task 14-A/14-B's (the shared engine, `workflow_status_history`).

## 1. As-built route inventory (before this PR)

| Module                        | List route                                                                              | Detail route                              | Queue filters                                            | KPI row                                                          | History timeline                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credentials                   | `woreda.credentials.index.tsx`                                                          | `woreda.credentials.$requestId.index.tsx` | status·type·kebele·officer·date (`CredentialQueueTable`) | `KpiWidgetRow` (`get_credential_kpis`)                           | **none** — `credential_request_status_history` written on every transition, never rendered                                                                                 |
| Civil registration            | `woreda.civil.index.tsx`                                                                | `woreda.civil.$eventId.tsx`               | type·status·search only, no kebele/officer/date range    | **none**                                                         | Inline block reading `workflow_status_history`, **Gregorian date bug** (`toLocaleString("en-GB")`)                                                                         |
| Service requests / complaints | `woreda.services.index.tsx` / `woreda.complaints.tsx` → shared `ServiceRequestList.tsx` | `woreda.services.$requestId.index.tsx`    | status·type·kebele·search, no officer/date range         | `ServiceKpiWidgetRow` (`get_service_kpis`, already shipped 14-B) | **Two** cards: one reading `service_request_status_history` (Gregorian date), one reading `workflow_status_history` (Ethiopian date, letters only — hidden for complaints) |

Two findings that reshaped scope before writing code:

1. **`get_service_kpis()` and `ServiceKpiWidgetRow` already exist** (shipped
   in 14-B), already following the sibling-widget-row pattern (reusing the
   shared `KpiCard` primitive, not forking it) this task's step 2 asks for.
   Nothing to generalize there — only civil needed the equivalent built.
2. **Services already had two competing history cards**, not zero — one
   client-written (`service_request_status_history`, via `transition()`),
   one engine-written (`workflow_status_history`, via the DB trigger),
   showing near-duplicate content for every transition after 14-B attached
   the engine to `service_request`. Not a gap to fill; a duplication to
   collapse, per the task's own instruction to unify on
   `workflow_status_history` for this module.

## 2. Per-entity status inventories vs. the shared `StatusChip` constant

| Entity               | CHECK constraint values                                                                                                                                                               | Missing from `StatusChip` before this PR                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credential_request` | draft, submitted, under_review, verified, pending_approval, returned, approval_returned, rejected, approved, awaiting_payment, paid, printed, active                                  | — (fully covered)                                                                                                                                                                                        |
| `vital_event`        | draft, submitted, under_review, verified, pending_approval, returned, approval_returned, rejected, approved, awaiting_payment, paid, registered, issued                               | — (fully covered)                                                                                                                                                                                        |
| `service_request`    | draft, submitted, under_review, verified, returned, pending_approval, approval_returned, approved, rejected, awaiting_payment, paid, issued, completed, in_progress, resolved, closed | `issued`, `completed`, `in_progress`, `resolved`, `closed` — these five lived only in a **second, forked** color/label map (`src/lib/serviceConstants.ts`'s `SERVICE_STATUS_STYLE`), not in `StatusChip` |

Fix: the five missing values were added directly to `StatusChip`'s
`STATUS_STYLES`/`STATUS_LABELS_AM`, `SERVICE_STATUS_STYLE` was deleted
entirely, and `ServiceRequestList`'s `StatusBadge` now delegates to
`<StatusChip>` instead of rendering its own span. `StatusChip` is now the
single color/label source across every surface (queue, detail, timeline);
`serviceStatusLabel()` (a bilingual `"ረቂቅ / Draft"`-shaped single string,
used for CSV/PDF export columns and dropdown option text, a different
concern than chip color) is unchanged and was already Amharic-consistent
with `StatusChip`'s own labels.

## 3. `get_civil_kpis()` KPI definitions

Mirrors `get_service_kpis()`'s exact shape (`SECURITY DEFINER`, `STABLE`,
tenant-scoped via `get_user_woreda_id()`, gated on `civil.read`):

| Field                                                        | Definition                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `registered_this_month_birth` / `..._death` / `..._marriage` | `count(*)` where `event_type` matches and `status = 'registered'` and `updated_at` falls in the current calendar month   |
| `pending_verification`                                       | `count(*)` where `status IN ('submitted', 'under_review')`                                                               |
| `pending_approval`                                           | `count(*)` where `status IN ('verified', 'pending_approval')`                                                            |
| `awaiting_payment`                                           | `count(*)` where `status = 'awaiting_payment'`                                                                           |
| `avg_turnaround_days`                                        | `avg(updated_at - created_at)` in days, for rows currently `status = 'registered'` with `updated_at` in the last 90 days |

`vital_event` has no dedicated `submitted_at`/`registered_at` column (every
row is inserted directly at `'submitted'`, the same convention
`service_request`/`credential_request` use) — `created_at` stands in for
submission time, and `updated_at` at the moment `status = 'registered'`
stands in for registration time, since `'registered'` is a terminal status
the row is never updated past (no outbound transition exists from it in
`workflow_transition`, confirmed by the existing
`civil_terminal_rejected_locked`-style probe pattern for terminal states).

`get_service_kpis()`'s existing definitions (new today, pending
verification, pending approval, awaiting payment, issued this month,
rejected this month, avg turnaround) are unchanged by this PR — the task's
step 3 spec for services (add "completed this month" and "rejection rate
(30d)") was **not** implemented: `get_service_kpis()` is a live, already-
shipped 14-B RPC with an established client (`ServiceKpiWidgetRow`,
`useServiceKpis()`), and widening its returned shape is a separate,
reviewable change with its own migration and client update, not a
generalization of the queue/chip/history surfaces this PR is scoped to.
Recorded as a deferred item, not silently dropped.

## 4. `WorkflowQueueTable` — what actually generalized vs. what stayed per-entity

The three entities' underlying Supabase queries differ too much (different
tables, different joins — civil needs a `household!inner(kebele_id)` embed
for its kebele filter since `vital_event` has no `kebele_id` column
directly, services needs a dynamic `service_type` catalog join, credentials
needs a `residence_credential` join for the revoked-status special case) to
share one query builder without forcing an artificial abstraction over it.
What _did_ generalize into `src/components/workflow/WorkflowQueueTable.tsx`:

- `useWorkflowQueueFilters()` — the URL-persisted state for
  search/status/type/kebele/officer/date-range/sort/pagination, previously
  owned inline by `CredentialQueueTable` alone.
- The presentational shell: filter bar layout, sort headers
  (`SortableTh`), loading/error/empty states, the permission-gated
  quick-action button column, and `TablePagination`.
- `waitingDaysLabel()` — the elapsed-days computation, previously
  `CredentialQueueTable`'s own private helper.

Each caller (now three: `CredentialQueueTable`, `woreda.civil.index.tsx`,
`ServiceRequestList.tsx`) supplies its own Supabase query, column render
functions, and filter option lists. `CredentialQueueTable`'s own exported
behavior — URL params, query shape, columns, quick actions — is unchanged;
only its presentational internals moved into the shared component (12-B
regression precondition: full 176-test suite green post-generalization,
including `credential-print-preview-parity.regression.test.ts` and
`ethiopian-date-formatting.regression.test.ts`).

Civil registration gained kebele and officer filters, a quick-action column
(submitted/under_review → Verify `civil.verify`, pending_approval → Approve
`civil.approve`, awaiting_payment → Record Payment
`civil.record_payment`, mirroring `CredentialQueueTable`'s exact
status→action mapping), a waiting-duration column, and `CivilKpiWidgetRow`.
Services gained an officer filter and a waiting-duration column (kebele and
type filters already existed); its quick-action column reuses the same
`service.verify`/`service.approve`/`service.record_payment` permission keys
for both `letter` and `complaint` categories, since both are seeded into
the same shared `workflow_transition` table with the same permission
strings (confirmed by the existing
`service_complaint_approve_skips_to_in_progress` probe, which drives a real
complaint through those exact permissions).

## 5. History timeline unification

`src/components/workflow/HistoryTimeline.tsx` — one presentational
component (`StatusChip` pairs for old→new, `formatEthiopianDateTime()`,
resolved actor names, bilingual empty state) plus three query hooks:

- `useWorkflowHistory(entity, entityId, enabled)` — reads
  `workflow_status_history`, used by civil (`entity: "vital_event"`) and
  services (`entity: "service_request"`, both categories now — the
  complaint-only exclusion in the old services page is gone).
- `useCredentialRequestHistory(id, enabled)` — reads
  `credential_request_status_history` (unchanged table, unchanged writes;
  only the read/render side changed). New feature: the credential detail
  page previously rendered no history timeline at all.
- `useActorNames(userIds)` — a batched `app_user` lookup, since none of the
  three modules resolved actor names before this PR (`changed_by_user_id`
  is a bare `uuid` on both `credential_request_status_history` and
  `service_request_status_history`, no FK declared, so a plain `.in()`
  lookup is used rather than an embedded select).

Fixes a real bug in the process: civil's inline history block rendered
`changed_at` via `toLocaleString("en-GB")` — Gregorian — in a portal whose
dates are Ethiopian-first everywhere else.

`service_request_status_history` itself is **not** touched — still written
by `transition()` on every app-driven hop, still queryable directly for
anyone who needs the pre-14-B-engine history of an old request. Only the
detail page's _read_ path changed, to the single engine-written source the
task's step 5 names.

## 6. Deferred / out of scope for this PR

- Widening `get_service_kpis()`'s own shape (completed-this-month,
  30-day rejection rate) — see §3.
- `workflow_transition` remaining entity-scoped rather than
  category-scoped, and `finance_clerk`'s widened UPDATE-verb set — both
  carried on the watch list from payment hardening, unchanged by this PR.
- Offline work (Task 12-C's own scope, explicitly excluded by this task's
  brief).
