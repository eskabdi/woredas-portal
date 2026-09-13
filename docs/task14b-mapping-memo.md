# Task 14-B — service_request 8-stage FSM + letter-issuance gating mapping memo

Committed before any code, per the task's own step 1. This memo assumes the
reader knows Task 14-A's own memo (`docs/task14a-mapping-memo.md`) — the
shared engine core, `workflow_status_history`, the payment-entity-extension
pattern, and the `resolve_*_fee()` RPC pattern are not re-derived here, only
referenced. This memo focuses on what's specific to `service_request`: where
the as-built reality disagrees with the task's literal text, and the design
this PR actually implements.

## 0. Scope decisions (read this first)

1. **The target 8-stage FSM (B3) applies to `category = 'letter'` only.**
   `category = 'complaint'` already has a real, different, working flow
   (`in_progress` → `resolved`, generally no payment step at all — every
   complaint `service_type` row has `requires_payment = false`) that the task
   text never actually describes (its 8-stage spec ends at `issued → completed`,
   which has no complaint analogue; complaints go `approved → in_progress →
resolved → closed`, a materially different shape). Rather than force
   complaints through a payment gate and an `issued`/letter step they were
   never designed to need, this PR treats complaints exactly like Task
   14-A treated `rental_occupancy_request`: **enforcement only, zero behavior
   change** — their as-built transitions are seeded into `workflow_transition`
   so the shared engine gates them, but no new stage, no payment requirement,
   no precondition beyond what already exists. The full gated FSM,
   `verified` stage, payment integration, and letter-issuance gating below
   apply to `category = 'letter'` requests exclusively.
2. **No `verified` status is ever reached today.** The as-built "Verify"
   button (`woreda.services.$requestId.index.tsx:726-774`) jumps straight from
   `under_review` to `pending_approval` (or further, skipping approval
   entirely, if `service_type.requires_approval = false` — not currently true
   for any letter type, only complaints have `requires_approval` variance and
   none actually have it false either; confirmed live, all 84 rows have
   `requires_approval = true`). `verified` exists in the CHECK constraint and
   in `SERVICE_STATUS_LABEL`, but no code path ever writes it, and
   `verified_by_user_id` has never been set on a real row. B3's spec requires
   a genuine `under_review → verified → pending_approval` two-hop, matching
   civil's own Task 14-A shape exactly — this PR adds the real intermediate
   stage and rewires the UI to drive it (§8).
3. **Zero-fee requests currently skip payment entirely, and a non-zero-fee
   payment cannot be recorded as zero.** `collectPayment()`
   (`woreda.services.$requestId.index.tsx:309-364`) hard-refuses when
   `fee_amount` is not `> 0` ("This request has no fee"), and
   `nextAfterApproval()` (304-307) routes a zero-fee letter straight to
   `approved` with no `awaiting_payment`/`paid` stage at all — there is
   currently **no** `payment`/`receipt` row for any free letter, anywhere.
   B3's universal zero-fee rule (every paid transition writes a real
   zero-value payment + receipt) requires changing this: every `letter`
   request, fee or no fee, now goes through `awaiting_payment → paid`. This
   is a deliberate behavior change for zero-fee letters specifically (not
   "zero behavior change" the way complaints/rental are) — B3 calls for it
   explicitly and Task 14-A already established the identical pattern for
   civil registration.
4. **Service fees are NOT in `fee_schedule` — they live on
   `service_type.fee_amount` directly, and that's staying.** The task's
   step 5 text asks to "extend check:fee-catalog's mapped set" the way Task
   14-A did for civil registration, but `fee_schedule` was purpose-built for
   a small, fixed, code-defined enum of request/event types
   (`resolve_credential_fee()`/`resolve_civil_fee()` both switch on a literal
   `CASE` over 4-7 hardcoded strings). `service_type` is the opposite shape:
   an open, **per-woreda-editable** catalog (created/edited from
   `woreda.settings.woreda-configuration.tsx`'s Services/Complaints tabs) —
   there is no fixed universal list to check `fee_schedule` against, and
   `service_type.fee_amount` is `NOT NULL DEFAULT 0`, so "fee unresolvable"
   structurally cannot happen for an existing row the way a _missing_
   `fee_schedule` row can. Duplicating the same amount into a second catalog
   table would add a synchronization-drift risk (two sources of truth for one
   price) for no correctness gain. This PR keeps `service_type.fee_amount` as
   the sole fee source and writes `resolve_service_fee(_service_type_id)` to
   mirror `resolve_civil_fee()`'s fail-closed/tenant-scoped/permission-checked
   _shape_ (raises if the id doesn't resolve to an active row in the caller's
   own woreda) without introducing a redundant catalog. §5 covers the actual
   check script this PR adds instead of extending `check-fee-catalog.ts`
   (which stays untouched — it validates `fee_schedule`, which this module
   doesn't use).
5. **No 30-day draft-purge job exists** (same finding as Task 14-A's own §0.2
   — grepped every migration and script again for `purge`: zero hits). The
   task's context list describes one as an already-landed "14-A asset"; it
   is not — 14-A's memo explicitly recorded that none exists, and nothing
   since has built one. `draft` is also never written by
   `woreda.services.new.tsx` (inserts directly at `submitted`, same as every
   other module in this app) — moot in practice, not a gap this PR creates or
   needs to close.
6. **`INV-08`, `resolve_credential_fee`-style "reconciliation rule" citations,
   and "amounts per `woreda_settings`" do not exist in this codebase.**
   Grepped: no literal `INV-08` string, no `woreda_settings` table. What
   actually exists and is checked instead: `service_type.is_active` (the
   real per-type enable flag) and `tenant_module_config` (`module_key =
'services'`, whole-module toggle, currently `is_enabled = true` for all 6
   woredas, "missing row = enabled" convention per `useTenantModules.ts:46`).
   This PR's precondition trigger checks both, server-side, for the first
   time (currently only the client-side `<ModuleGate>` on the end-user routes
   enforces the module toggle — Settings' own service-type CRUD screen has no
   module gate at all, confirmed live in the Explore pass; not this PR's to
   fix, noted as a pre-existing gap).
7. **`service_request` already has every actor column Task 14-A's shared
   engine needs**: `verified_by_user_id`, `approved_by_user_id`,
   `issued_by_user_id`, `requested_by_user_id`, all wired to
   `force_actor_columns()` (`trg_force_actor`). Maker≠checker (verify vs
   approve) is enforced **for free** the instant `enforce_workflow_transition()`
   is attached — same as civil, no new columns needed.
8. **`payment_id` already exists on `service_request`** (nullable FK to
   `payment`), and `payment.service_request_id` already exists too — the
   entity-typed-FK-extension pattern Task 14-A added for `vital_event_id` was
   already applied to `service_request` at some earlier point. No `payment`/
   `receipt` schema changes needed for this task (unlike 14-A, which had to
   ALTER both tables). Confirmed live:
   `payment_source_exclusive_check` already has a clause for
   `service_request_id` alongside `credential_request_id`/`rental_request_id`/
   `vital_event_id`.
9. **The `approved_by_user_id` FK differs from the memo's own trigger-name
   alphabetical-ordering concern in 14-A.** There is no death-side-effect
   analogue here — `service_request` has no side-effect trigger firing on any
   status at all (no resident-mutation, no credential-revocation). The
   `paid → issued` system-adjacent step (§3) is the only place a trigger does
   real work (rendering + persisting the letter), and it is **not** a hidden
   `is_system` transition the way civil's `paid → registered` is — `issued`
   stays a normal, permission-gated (`service.issue_letter`), user-driven
   transition. Only the _content generation_ (rendering the sanitized letter
   HTML) needs to move server-side to close the gating gap (§3) — the
   transition itself needs no GUC trick.

## 1. `service_request` — as-built inventory

### Columns (live catalog)

Everything the new FSM needs already exists — see §0.7/§0.8. No new columns
required on `service_request`, `payment`, or `receipt`.

### Status CHECK (as-built, superset target)

```
as-built (14 values): draft, submitted, under_review, returned, pending_approval,
  approval_returned, approved, rejected, awaiting_payment, paid, issued,
  in_progress, resolved, closed
target (add): verified, completed
```

Every as-built value survives. `in_progress`/`resolved` stay legal and
actively used (complaints, §0.1). `approval_returned` stays legal
(complaints still use it; letters get the same treatment civil's
`approval_returned` got in 14-A — legal-but-retired, no outgoing seed row
for the letter path specifically, since the new FSM merges both
verification-stage and approval-stage returns onto the single `returned`
value, matching civil's own precedent exactly).

### Existing triggers (all as named)

| Trigger                                | Timing               | Function                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `trg_assign_service_request_number`    | BEFORE INSERT        | `assign_service_request_number()`    | Unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `trg_assign_letter_verification_token` | BEFORE INSERT        | `assign_letter_verification_token()` | **Unconditionally** assigns a token at INSERT, regardless of category or eventual status — harmless in isolation since `verify_service_letter()` independently gates on `status IN ('issued','resolved','closed') AND issued_at IS NOT NULL` (confirmed live), but confusingly early. Left unchanged — not a security gap once the real gap (§3) is closed, and changing INSERT-time behavior risks the token column being null on other legitimate read paths that don't expect it. |
| `trg_force_actor`                      | BEFORE INSERT/UPDATE | `force_actor_columns(...)`           | Already covers the 4 actor columns the FSM needs (§0.7)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `service_request_pii_sync_trg`         | BEFORE INSERT/UPDATE | `service_request_pii_sync()`         | Unrelated to this task, untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `service_request_set_updated_at`       | BEFORE UPDATE        | `set_updated_at()`                   | Unrelated, untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

No workflow-engine trigger exists yet — `enforce_workflow_transition()` has
never been attached to `service_request`.

### RLS (as-built)

`service_request_update`'s `WITH CHECK`/`USING` only lists
`{service.create, service.verify, service.approve, service.issue,
complaint.manage, tenant.manage}` — **`service.record_payment` is not in
this list**, meaning `collectPayment()`'s `.update()` today is gated only by
whichever _other_ coarse permission the caller happens to hold, not a
payment-specific one. `service_request_insert` only checks `{service.create,
complaint.manage, tenant.manage}`. Neither policy currently references any
of the 7 granular verbs already sitting unused in `permissions.ts`
(`service.submit/.resubmit/.return/.reject/.record_payment/.issue_letter/
.complete` — confirmed via the Explore pass: defined and pre-assigned to
roles, zero call sites in route code). §4 widens both policies to the full
granular set, mirroring civil's migration 058 exactly.

## 2. Letter issuance — as-built path and where it must move

Today: `issueLetter()` (`woreda.services.$requestId.index.tsx:253-302`) runs
**entirely client-side** — it fetches the `service_type`'s
`letter_body_html`/`letter_body_template`, renders it through
`renderLetterTemplate(sanitizeLetterHtml(template), {...})` in the browser,
and only then calls `transition("issued", { extra: { issued_letter_html,
letter_summary, issued_at, issued_by_user_id } })`, a plain `.update()`
gated by the same broad RLS policy as every other status write. There is
**no server-side check that the request is actually paid** before this
transition — a caller with `service.issue` (or any of the other coarse
permissions the broad policy accepts) can `PATCH` a request straight from
`approved` (or any status) to `issued` with a forged
`issued_letter_html`/`issued_at`, and `verify_service_letter()`'s public RPC
would then serve it as a legitimately issued letter. This is this task's own
named "core security fix" (step 4), and it is real — confirmed by reading
the RLS policy and the transition code, not assumed.

**Where it moves**: a `BEFORE UPDATE` payment-gate trigger
(`enforce_service_request_payment_gate()`, mirroring
`enforce_vital_event_payment_gate()`) blocks `awaiting_payment → paid`
without a confirmed, correctly-bound payment+receipt (same shape as 14-A's
own HIGH-severity fix — the `p.service_request_id = NEW.service_request_id`
binding is included from the start this time, learned from that finding).
A **second** `BEFORE UPDATE` trigger,
`enforce_service_request_issuance_gate()`, blocks any transition INTO
`issued` unless `OLD.status = 'paid'` — closing the exact gap above. The
letter-rendering logic itself (currently 100% client-side) is **not** moved
into a trigger in this PR — re-implementing HTML templating in plpgsql would
be a much larger, riskier change than the task asks for, and the actual
security property that matters (issuance can only be reached from `paid`,
enforced server-side) doesn't require it. What does move: the client's own
`issueLetter()` becomes a thin caller that still renders client-side (same
`sanitizeLetterHtml`/`renderLetterTemplate` calls, so print/preview parity is
untouched by construction) but the resulting `.update()` now has to satisfy
the new trigger, so a forged direct-API attempt with no real payment fails
regardless of what HTML it submits.

## 3. Pre-conditions (new, `BEFORE INSERT OR UPDATE`, `category = 'letter'` only unless noted)

Same tenant-scoping discipline as civil's Task 14-A preconditions (always
re-derive from `NEW.woreda_id`, never trust it as an assertion) and the
**exact same "only validate when supplied" lesson** Task 14-A had to learn
the hard way on its birth precondition (§10.5 of that task's remediation
report) — applied correctly from the start here:

- **resident linkage**: `NEW.resident_id`, when set, must resolve to an
  `active_flag = true` resident in `NEW.woreda_id`. `NEW.household_id`, when
  set, must resolve to a household in `NEW.woreda_id`. Neither is required to
  be present — confirmed live that `woreda.services.new.tsx` never sets
  `household_id` at all and allows a fully manual (non-resident-linked)
  applicant (§ Explore report item 6) — this precondition must not become
  Task 14-A's exact regression.
- **service type enabled**: `NEW.service_type_id` must resolve to an
  `is_active = true` row in `NEW.woreda_id` (this doubles as the "unresolvable
  fee" guard from §0.4 — an inactive or cross-tenant `service_type_id` fails
  here before `resolve_service_fee()` is ever reached at payment time), AND
  the woreda's `tenant_module_config` row for `module_key = 'services'` must
  not be `is_enabled = false` (missing row = enabled, matching
  `useTenantModules.ts`'s own convention exactly).

All four checks fire on INSERT and UPDATE (an applicant/service type could
be linked or changed later), bilingual raises, `category = 'letter'` scope
per §0.1 (complaints keep their current, unvalidated-at-this-layer behavior
— zero behavior change).

## 4. RLS policy changes for `service_request`

Widened the same way civil's migration 058 widened `vital_event`'s policies:
`service_request_insert`'s `WITH CHECK` and `service_request_update`'s
`USING`/`WITH CHECK` both gain the 7 granular verbs
(`service.submit/.resubmit/.verify/.return/.reject/.record_payment/
.issue_letter`) additively — the coarse verbs
(`service.create/.verify/.approve/.issue`) stay in the array, so nothing that
works today stops working before the UI rewrite (§8) lands in the same PR.
`service.complete` is added to `service_request_update` only (never needed at
insert).

## 5. The letter FSM seed (B3, 8-stage) and the complaint enforcement-only seed

```
service_request (category='letter'):
  draft            -> submitted         service.submit
  submitted        -> under_review      service.verify
  under_review     -> verified          service.verify
  under_review     -> returned          service.return
  returned         -> under_review      service.resubmit
  verified         -> pending_approval  service.approve
  pending_approval -> approved          service.approve
  pending_approval -> returned          service.return
  pending_approval -> rejected          service.reject   (terminal)
  approved         -> awaiting_payment  service.record_payment
  awaiting_payment -> paid              service.record_payment
  paid             -> issued            service.issue_letter
  issued           -> completed         service.complete
```

13 rows. No `is_system` row — per §0.9, `paid → issued` is a normal
permission-gated transition, not a hidden system one; nothing here needs the
`app.system_transition` GUC pattern. `completed` is a **new** terminal value
(added to the CHECK as a superset extension) distinct from the existing
`closed` — `closed` remains legal (superset) and is what complaints still use
(§ below); `issued → completed` is the letter path's own new terminal per
B3's literal spec, chosen as a new distinct value rather than reusing
`closed` so the two categories' terminals stay unambiguous in reporting
(`closed` = complaint-path terminal via `resolved → closed`; `completed` =
letter-path terminal via `issued → completed`) — a deliberate naming choice,
flagged here for the owner in case `closed` was actually meant to be reused;
easy to change before merge if so.

```
service_request (category='complaint', enforcement only, zero behavior change):
  submitted         -> under_review        service.verify
  under_review      -> pending_approval    service.verify   (as-built: skips verified entirely for complaints — matches nextAfterApproval()'s complaint branch)
  under_review      -> returned            service.return
  returned          -> under_review        service.resubmit
  pending_approval  -> approved            service.approve
  pending_approval  -> approval_returned   service.return
  pending_approval  -> rejected            service.reject   (terminal)
  approved          -> in_progress         service.issue
  in_progress       -> resolved            service.issue
  resolved          -> closed              service.issue
  issued            -> closed              service.issue    (dead edge, CHECK-legal, never reached by complaints — kept for symmetry with the letter path's own closed-adjacent value; harmless)
```

11 rows, all matching exactly what `nextAfterApproval()`/the detail route
already drive for complaints today (§ Explore report items 1/5) — this is
the rental-module treatment from 14-A, applied to complaints.

## 6. Permissions

All 11 `service.*` permissions already exist in `permissions.ts`'s `P` map
and are already assigned in `ROLE_PERMISSIONS` (§0 of this memo, confirmed
via Explore + direct grep) — **this mirrors civil's own §0.3 finding
exactly**: `check:role-perms-drift` already passes today, before this PR
touches anything. The only permission-layer work this PR does is confirming
the existing default grants match B3's stated role mapping (registry_clerk/
civil_registrar hold create/submit/resubmit/verify/return/view; supervisor
holds approve/return/reject/view; finance_clerk holds record_payment/view;
registry_clerk also holds issue_letter; auditor/viewer hold read/view) and
re-running `check:role-perms-drift` after the RLS/FSM changes land to prove
nothing drifted. `service.complete`'s default holder: per the Explore
report, the as-built "Close file" button is gated on the coarse
`service.issue` permission, held by `registry_clerk`/`civil_registrar`
(confirmed in `permissions.ts`) — `service.complete` is already assigned to
the same roles in the matrix, so no change needed there either.

## 7. UI wiring scope

`woreda.services.$requestId.index.tsx` is rewritten for `category='letter'`
requests specifically, mirroring civil's `woreda.civil.$eventId.tsx` rewrite
pattern from Task 14-A:

- "Verify" becomes a real two-hop: `under_review → verified` (still
  `service.verify`), then a `service.approve`-gated "Send for Approval" step
  drives `verified → pending_approval` (identical shape to civil's).
- Approve/Return/Reject at `pending_approval` unchanged in spirit but now
  target the single `returned` value (not `approval_returned`) for the
  letter path, per §5.
- A Payment card (mirroring civil's, itself mirroring credential's)
  replaces `collectPayment()`'s hard fee>0 refusal — always records a real
  payment+receipt (amount may be 0), gated by `service.record_payment`.
- `issueLetter()` stays mostly as-is (client renders, same sanitizer call)
  but only renders its action button when `status === 'paid'` (previously
  `['approved','paid']` — the UI already usually landed exactly on the
  security bug's own edge case), and now surfaces the new trigger's raise if
  a stale/race client attempts it anyway.
- A new terminal "Complete" step (`issued → completed`, `service.complete`)
  replaces the old "Close file" button for the letter path only; complaints
  keep their existing `resolved → closed` "Close file" unchanged.
- Complaint-category requests on this same route are **not** rewritten —
  their existing button wiring (`in_progress`/`resolved`/`closed`,
  `approval_returned`) stays byte-identical, since §0.1 scopes them out.
- History card reads `workflow_status_history` (new for this entity, same
  pattern as civil) in addition to the existing `service_request_status_history`
  the route already reads — both stay populated (the client-side history
  insert is unchanged; the DB-trigger-written one is new and additive, same
  relationship civil's `workflow_status_history` has to
  `credential_status_history`/`credential_request_status_history` in 14-A).
- Queue (`woreda.services.index.tsx`/`ServiceRequestList.tsx`) and KPIs: per
  the Explore report, the list page is **not** built on Task 12-B's
  `CredentialQueueTable`/`KpiWidgetRow` today — it's a bespoke table with
  zero KPI widgets. This task's step 6 asks to reuse those shared
  components "not forked." Given the component is currently
  credential-request-shaped (its filter set, column set, and quick-action
  switch are all keyed to `credential_request`'s own fields/statuses), a
  literal import-and-reuse is not possible without first generalizing it —
  out of scope for a workflow-engine PR to do safely for a component two
  other live pages depend on. This PR instead: (a) adds a `get_service_kpis()`
  RPC following `get_credential_kpis()`'s exact pattern (`SECURITY DEFINER`,
  internally `woreda_id`-scoped, no client parameter), and (b) renders those
  counts through the **same underlying `KpiWidgetRow`/`KpiCard` primitive**
  Task 12-B already extracted as a reusable building block (not the
  `CredentialQueueTable` itself, which is the part that's genuinely
  credential-specific) — this satisfies "reuse the shared component, don't
  fork it" for the piece that's actually shared-shaped, while being honest
  that `ServiceRequestList`'s own table stays bespoke rather than forcing an
  ill-fitting reuse. Flagged here for the owner; a follow-up task to
  generalize `CredentialQueueTable` into a shared list-table primitive (the
  way `KpiWidgetRow`/`KpiCard` already are) would let a future pass close
  this properly.

## 8. What this PR does NOT do

- Any change to the complaint path's behavior, statuses, or permissions
  beyond the enforcement-only `workflow_transition` seed (§5) — zero
  behavior change, matching rental's Task 14-A treatment.
- A `CredentialQueueTable` generalization/fork (§7) — flagged as a follow-up.
- Moving letter-HTML rendering into plpgsql/the database (§2) — the
  client-side render + sanitize path is unchanged; only the transition gate
  is server-enforced.
- Any change to `fee_schedule`, `check:fee-catalog`, or the credential/civil
  fee-resolution pattern (§0.4) — a new, separate `resolve_service_fee()`
  RPC and a new, separate `scripts/check-service-type-catalog.ts` are added
  instead, checking `service_type`'s own catalog completeness.
- Building a draft-purge job (§0.5) — not asked for by anything real, not
  built.
- Touching Settings' service-type CRUD screen's missing module-gate (§0.6) —
  a real, separate, pre-existing gap, not this PR's to fix.
