# Task 14-A — workflow engine generalization + civil registration FSM mapping memo

First deliverable of Task 14-A (`fix-task-production-readiness-v3.md`), committed
before any code per the task's own step 1. Enumerates the as-built state of
`vital_event`, `rental_occupancy_request`, and the payment/receipt tables against
the target design, and records every scope decision made where the task's own
text assumed something that turned out not to match the live schema — matching
this session's established practice (see Task 12's own mapping memo) of
recording the mismatch rather than guessing or forcing something that doesn't
apply.

## 0. Scope decisions (read this first)

1. **`service_request` is NOT wired to the shared engine in this PR.** The task's
   step 2 mentions `workflow_status_history` should be "written by the engine for
   vital_event, rental_occupancy_request, service_request", but steps 3–5 (the
   actual FSM-seeding/trigger-wiring instructions) only ever name `vital_event`
   (full FSM) and `rental_occupancy_request` ("enforcement only, zero behavior
   change"). Wiring `enforce_workflow_transition()` onto `service_request` without
   the same investigation this memo does for the other two entities would risk a
   live regression in a module (services/letters) this task never asked to touch.
   `service_request` is left exactly as it is — no trigger, no seed rows, no
   `workflow_status_history` entries. This is a scope decision for 14-B to pick up
   explicitly, not an oversight here.
2. **No 30-day draft-purge job exists anywhere in this codebase to "reuse."** Grepped
   every migration for `purge`: zero hits. `credential_request` drafts (the
   task's own implied precedent) already accumulate indefinitely with no cleanup
   job. Building a new purge job from scratch is out of this task's stated scope
   ("reuse... extend it," not "build it") — `vital_event` drafts get the same
   (lack of) treatment `credential_request` drafts already get. Not a regression;
   matches existing behavior.
3. **civil.\* permissions already exist in all three default sources.** Every
   permission the task's step 6 asks to add — `civil.create_event`, `.submit`,
   `.resubmit`, `.verify`, `.return`, `.reject`, `.record_payment`, `.view` — is
   already defined in `permissions.ts`'s `P` map, already in `default_role_perms()`
   (confirmed: `bun run check:role-perms-drift` passes today, before this PR
   touches anything), and already has 42 rows each (6 woredas × 7 roles) in the
   live `role_permission` table. The default grants already match the task's
   own stated intent exactly: `registry_clerk`/`civil_registrar` hold
   create_event/submit/resubmit/verify/return/view; `supervisor` holds
   approve/reject/view (not `return` — see §4); `finance_clerk` holds
   record_payment/view; `auditor`/`viewer` hold read/view. **No permission-layer
   work is needed in this PR.** What's missing is the FSM enforcement and RLS
   policy wiring that actually lets these permissions govern anything on
   `vital_event` — that's what this PR builds.
4. **`supervisor` does not hold `civil.return`.** Confirmed in `permissions.ts`:
   `civil_registrar`/`registry_clerk` hold `CIVIL_RETURN` (the return-from-verify
   and return-from-approval actions are both gated the same way `credential.return`
   already is — granted to the submitting-side roles, not the approving side, an
   existing asymmetry this task's own text ("supervisor approve/return/reject")
   assumed differently from what's actually configured). Not changed here — the
   existing default matrix is left as-is per the "no permission-layer work needed"
   decision above; if this asymmetry is wrong, that's a product decision for the
   owner, not something to silently "fix" by widening a role's grants.
5. **`fee_schedule.service_type` already has non-zero "Birth Certificate" (100
   ETB, 6 woredas)/"Death Certificate" (100 ETB, 1 woreda)/"Marriage Registration"
   (250 ETB, 6 woredas) rows.** These are the **certificate/letter** fees (the
   printed-document service, `service_type` catalog, 14-B's scope), not the
   registration event itself. Reusing them for the free registration fee would
   directly violate B2's zero-fee mandate. This PR seeds three **new**,
   distinctly-named `fee_schedule` rows — `Civil Registration - Birth`,
   `Civil Registration - Death`, `Civil Registration - Marriage` — at `amount = 0`,
   never touching the existing certificate rows.
6. **`verified_by_user_id`/`approved_by_user_id` already exist on `vital_event`.**
   Task step 4 says "if absent, add them additively" — they're already there
   (added when the table was first built), already wired to `force_actor_columns()`,
   so maker≠checker is enforced **for free** the moment `enforce_workflow_transition()`
   is attached as a trigger (it's the same shared function already gating
   `credential_request`, and it checks these exact two column names generically).
   No new columns needed.
7. **`enforce_workflow_transition()` is already entity-generic — no refactor
   needed.** It already resolves `v_entity := TG_TABLE_NAME` and looks up
   `workflow_transition WHERE entity = v_entity AND ...` — it was written
   generically in Task 1 (migration `00000000000025`) even though only
   `credential_request`/`residence_credential` triggers were ever attached to it.
   "Refactoring per-table trigger functions to delegate" (task step 2) reduces to:
   attach the SAME function as a trigger on `vital_event` and
   `rental_occupancy_request`, and seed their `workflow_transition` rows. No
   `CREATE OR REPLACE` of the core function's logic is needed or done — its
   behavior for `credential_request`/`residence_credential` is untouched by
   construction, which is why the Task 1 probe re-run (§6) is a regression check
   on _attaching new triggers to new tables_, not on a rewritten shared function.

## 1. `vital_event` — as-built inventory

### Columns (live catalog)

All the columns the new FSM needs already exist: `status`, `verified_by_user_id`,
`verified_at`, `approved_by_user_id`, `approval_decision_at`, `return_reason`,
`reject_reason`, `requested_by_user_id`, `issued_by_user_id`, `issued_at`. No new
columns needed for the FSM itself. **New columns needed for the payment stage**:
none on `vital_event` itself — payment linkage goes through a new
`payment.vital_event_id` column (see §3).

### Status CHECK (as-built, superset target)

```
as-built: draft, submitted, under_review, verified, pending_approval, returned,
          approval_returned, rejected, approved, issued
target (add): awaiting_payment, paid, registered
```

Every as-built value survives — `issued`/`approval_returned` become legal-but-
retired values (no outgoing seed row from them in the new FSM), mirroring exactly
how Task 12-A retired `credential_request.approval_returned` while keeping it in
the CHECK constraint. **Live row count: zero** (`select count(*) from vital_event`
returns 0 in production today) — there is no existing data to strand or migrate
through the new stages, which is why the UI rewrite (§7) can retire the old
`approved → issued` manual-close path outright rather than needing a compatibility
shim.

### Existing triggers (all `BEFORE UPDATE` unless noted)

| Trigger                                     | Function                                                                                                      | Fires on         | Notes                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trg_assert_vital_event_woreda_consistency` | `assert_vital_event_woreda_consistency`                                                                       | INSERT OR UPDATE | Cross-tenant guard: `resident_id`/`household_id` must belong to `NEW.woreda_id` — already exactly the shape a cross-tenant probe needs, no change |
| `trg_assign_vital_event_number`             | `assign_vital_event_number`                                                                                   | INSERT           | Sequence-assigned `event_number`, unrelated to FSM                                                                                                |
| `trg_force_actor`                           | `force_actor_columns('requested_by_user_id','verified_by_user_id','approved_by_user_id','issued_by_user_id')` | INSERT OR UPDATE | Pins actor columns to `auth.uid()` — same mechanism maker≠checker depends on for credentials                                                      |
| `trg_apply_death_on_approval`               | `apply_death_on_approval`                                                                                     | UPDATE           | **Guard moves from `status='approved'` to `status='registered'` per B2** (§5)                                                                     |
| `trg_generate_resident_on_birth_approval`   | `generate_resident_on_birth_approval`                                                                         | UPDATE           | **Same guard move** (§5)                                                                                                                          |
| `trg_pin_vital_event_resident`              | `pin_vital_event_resident`                                                                                    | UPDATE           | Not inspected further — no FSM-status dependency, left untouched                                                                                  |

**Not yet present** (new in this PR): `enforce_workflow_transition()` trigger
(the FSM gate itself — currently `workflow_transition` has zero rows for
`entity='vital_event'`, so **no FSM enforcement exists on this table today at
all**), a generic history-writing trigger, a payment-gate trigger, and the three
event-type pre-condition triggers (birth/death/marriage).

### RLS policies (as-built — need widening, see §4)

`vital_event_insert` requires `civil.register`; `vital_event_update` requires
`civil.register` OR `civil.approve`; `vital_event_delete` requires `civil.approve`.
**These are too narrow for the new FSM to actually be exercisable**: `civil.record_payment`
(finance_clerk's permission) is not in the UPDATE policy's allow-list at all, so a
finance_clerk today could not write `awaiting_payment→paid` even once
`enforce_workflow_transition()` allows it at the trigger level — RLS would still
block the write before the trigger ever runs. §4 widens the UPDATE policy to include
the full granular set, matching exactly how `credential_request_update` already
works (a broad RLS gate; the trigger does the actual stage-by-stage narrowing).

## 2. `rental_occupancy_request` — as-built inventory (traced via Explore agent)

| #   | to_status   | Legal FROM (client guard)               | Gating permission               | Side effect                                                                                                                |
| --- | ----------- | --------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | `verified`  | `submitted`, `under_review`, `returned` | `rental.create`                 | none                                                                                                                       |
| 2   | `returned`  | `submitted`, `under_review`, `returned` | `rental.create`                 | none                                                                                                                       |
| 3   | `approved`  | `verified`                              | `rental.approve`                | `apply_rental_occupancy_on_approval` (baseline) fires — occupancy row created/terminated, house `occupancy_status` flipped |
| 4   | `rejected`  | `verified`                              | `rental.approve`                | none                                                                                                                       |
| —   | `submitted` | (new row only)                          | `rental.create`/`rental.vacate` | `enforce_rental_request_eligibility` (existing INSERT-time gate)                                                           |

`under_review` and `approval_returned` are legal per the CHECK constraint but
**never written by any app code path** — included in the seed below anyway
(seeding `under_review`/`returned → verified` and `→ returned` symmetrically) so
attaching the trigger doesn't make a value the client-side guard already treats
as legal suddenly start raising, even though no live row currently occupies it.
`draft` and `pending_approval` are likewise never targeted — not seeded (no
outgoing edge needed since nothing reaches them). **Per the task's own
instruction, `apply_rental_occupancy_on_approval` is NOT touched** — its terminal
status stays `approved`, unlike `vital_event`'s move to a payment-gated
`registered` terminal. Rental has no payment stage in this PR.

**Live row counts**: 1 `approved`, 1 `rejected` — both are consistent with the
seed above (no outgoing edge from either), so attaching enforcement does not
strand these rows.

## 3. Payment / receipt tables — as-built shape and the extension needed

`payment` already carries `credential_request_id`, `rental_request_id`,
`service_request_id` (all nullable, entity-typed FK columns) — the "generic
equivalent" the task asks for already exists as this same pattern, just missing
a `vital_event_id` column. Extended additively (§5) rather than building a
separate generic payment table, per the Task 11 reconciliation rule (extend an
existing near-match, never fork a parallel structure).

Two **existing CHECK constraints block the zero-fee rule outright** and must be
widened (both strict supersets of what they replace):

- `payment_amount_check`: `CHECK (amount > 0)` → `CHECK (amount >= 0)`. Without
  this change, B2's own requirement ("free registrations write a zero-value
  payment + receipt") is a straight SQL constraint violation on every free
  registration. Confirmed zero existing rows have `amount = 0` today (there was
  never a caller that needed one), so widening this changes nothing for existing
  data.
- `payment_payment_type_check`: add `'civil_registration_fee'` to the allowed
  array.
- `payment_source_exclusive_check` currently only excludes
  `credential_request_id`+`rental_request_id` together (it doesn't even guard
  `service_request_id` — a pre-existing, already-documented gap in `docs/erd.md`,
  not this task's to fix). Extended to also guard the new `vital_event_id`
  column against the other three, without touching the existing clause's
  behavior for the columns it already covers (zero existing rows have more than
  one of the four source columns set, confirmed live).

`receipt` needs no schema change — it already references `payment_id` generically
regardless of what that payment is for.

## 4. RLS policy changes for `vital_event`

`vital_event_insert`/`vital_event_update` widened from `{civil.register}` /
`{civil.register, civil.approve}` to include the full granular set the new FSM
actually needs someone to exercise: `civil.create_event`, `.submit`, `.resubmit`,
`.verify`, `.return`, `.approve`, `.reject`, `.record_payment` (plus keeping
`civil.register` in the array — additive, not a replacement, so nothing that
worked before stops working). `vital_event_delete` is untouched (unrelated to
the FSM). This is the same broad-RLS-gate-plus-trigger-narrowing shape
`credential_request`'s policies already use.

## 5. Side-effect timing change (B2)

`apply_death_on_approval()` and `generate_resident_on_birth_approval()`: both
`CREATE OR REPLACE`d with their guard changed from `NEW.status = 'approved'` to
`NEW.status = 'registered'`. Tenant-scoping (`AND woreda_id = NEW.woreda_id`) and
idempotency (`NEW.resident_id IS NULL` for the birth case) carry over unchanged —
confirmed by reading both function bodies in full; neither needs any other edit.
Both are `BEFORE UPDATE` triggers, so they naturally re-fire on the internal
system-driven `paid → registered` update (§6) the same way they'd fire on any
other `UPDATE ... SET status = 'registered'`.

## 6. The `paid → registered` system transition — design

No existing precedent for an actually-_firing_ `is_system` transition exists in
this codebase (`workflow_transition`'s only `is_system=true` row today —
`residence_credential active→expired` — has no function anywhere that ever sets
`app.system_transition = 'on'` to drive it; it's a documented future hook, not a
working example). This PR builds the first real one:

1. `zzz_enforce_vital_event_payment_gate` (new, `BEFORE UPDATE`, named to sort
   after `zz_enforce_workflow_transition` so the generic FSM/permission check
   runs first): mirrors `generate_residence_credential_on_payment`'s gate shape
   — fires on `NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid'`,
   requires a `payment` row with `status='confirmed'` and a `receipt` row
   referencing it, raises (bilingual) otherwise.
2. `zz_advance_vital_event_to_registered` (new, `AFTER UPDATE`): fires on the
   same condition: once `paid` is actually committed, it sets
   `app.system_transition = 'on'` for the local transaction, issues
   `UPDATE vital_event SET status = 'registered' WHERE vital_event_id = NEW.vital_event_id`,
   then resets the GUC. This nested UPDATE re-fires every `BEFORE UPDATE` trigger
   on the row (`enforce_workflow_transition` sees `paid → registered`, finds the
   `is_system` seed row, and — because the GUC is now `on` — authorizes it
   without requiring any `user_has_perm()` check; `apply_death_on_approval`/
   `generate_resident_on_birth_approval` see their new `registered` guard and
   fire). A user can never reach `registered` directly: no seed row exists for
   any _user_-driven transition into it, and the raw session GUC is only ever
   set inside this one `SECURITY DEFINER` function body, never reachable from a
   client request.

## 7. Event-type pre-conditions (new, `BEFORE INSERT OR UPDATE`, fail-closed)

None of these exist today — new triggers, tenant-scoped (`AND woreda_id = NEW.woreda_id`
on every subquery, never trusting `NEW.woreda_id` as an assertion but always
re-deriving from the FK target the same way `assert_vital_event_woreda_consistency`
already does), bilingual raises:

- **birth**: if `NEW.household_id` is set, it must resolve to a household in the
  same woreda with `occupancy_status <> 'demolished'`... actually per the task's
  literal wording ("household linked and active") the check is: a `household_id`
  must be present (birth registration requires a linked household) and that
  household must exist in `NEW.woreda_id`.
- **death**: `NEW.resident_id` must resolve to a `resident` row in `NEW.woreda_id`
  with `active_flag = true` and `residency_status <> 'deceased'`, and there must be
  no other **open** (non-terminal) death-type `vital_event` for the same resident
  already in flight (prevents two concurrent death registrations for one person).
- **marriage**: both `event_details->>'spouse1'->>'resident_id'` and
  `...spouse2...` — when either party is resident-linked rather than a free-text
  name — must resolve to residents in the SAME `NEW.woreda_id`.

These fire on both INSERT and UPDATE (a party could be linked after initial
submission) but only actually check the fields that are set — a spouse recorded
as free text (no `resident_id`) doesn't trigger the tenant check for that party.

**Bug found live, fixed before merge**: the death precondition
(`resident.residency_status <> 'deceased'`) re-validates on every UPDATE, not
just initial submission. `trg_apply_death_on_approval` (BEFORE UPDATE, fires
first alphabetically — `apply` < `enforce`) legitimately flips the resident to
`deceased` inside the same nested `paid → registered` system-transition
cascade, moments before `trg_enforce_vital_event_preconditions` re-runs on
that same UPDATE — so the precondition rejected the very transition
finalizing that death. Fixed by short-circuiting the whole precondition
function when `current_setting('app.system_transition', true) = 'on'`: every
precondition was already enforced when the event was first submitted or
reviewed, so the system's own finalization step re-validates nothing. Caught
by `civil_death_side_effect_tenant_scoped`, confirmed fixed with 25/25 probes
passing net-zero.

## 8b. UI wiring — implemented

`woreda.civil.$eventId.tsx` rewritten per §8. Stage mapping actually shipped:

- Verification card (`submitted`/`under_review`/`returned`): "Pass
  Verification" chains `submitted → under_review → verified` in one click
  when starting from `submitted` (both hops are `civil.verify`); "Return"
  chains the same hop before landing on `returned` (`civil.return`);
  "Resubmit" is `returned → under_review` (`civil.resubmit`).
- Approval card (`verified`/`pending_approval`): a `civil.approve`-gated "Send
  for Approval" button drives `verified → pending_approval` (the supervisor
  pulling the item into their own queue) before Approve/Return/Reject appear
  for `pending_approval`. Return and Reject buttons are independently gated
  on `civil.return`/`civil.reject` — per §0.4/§9, `supervisor` was left
  without `civil.return` in this PR, so the Return button legitimately does
  not render for that role; this is the existing permission matrix, not a
  bug.
- Payment card (`approved`/`awaiting_payment`): mirrors credential's
  `PaymentCard` — raises `approved → awaiting_payment` on first submit, then
  records a `payment` (`payment_type='civil_registration_fee'`,
  `vital_event_id` set) + `receipt` and updates to `paid`. No waiver toggle:
  `resolve_civil_fee()` always resolves to 0 under B2, so there's nothing to
  waive. The `paid → registered` system cascade fires inside the same
  transaction as this last UPDATE, so the client's next read already sees
  `registered`.
- The manual "Close" button is removed; a read-only "Registered" outcome
  card replaces the old "Approved/Issued" one, with the resident link for
  birth/death.
- A new "Status History" card reads `workflow_status_history` directly
  (ordered by `changed_at`), separate from the existing client-side
  `audit_log` writes this route still makes on each transition.

`src/integrations/supabase/types.ts` regenerated against the live project
(`npx supabase gen types typescript --project-id tugzuexfyzbdnghbmrjl`) to
pick up `vital_event.payment_id`, `payment.vital_event_id`,
`workflow_status_history`, `workflow_transition`, and `resolve_civil_fee()` —
this is what unblocked `tsc --noEmit` after the route rewrite.

`scripts/check-fee-catalog.ts`'s `MAPPED_SERVICE_TYPES` extended with the
three `Civil Registration - *` rows so a fresh environment seeded from
`supabase/seed.sql` (which now also carries those 18 rows, synced from the
live values migration 059 inserted) passes `bun run check:fee-catalog` too.

## 8. UI wiring scope

`woreda.civil.$eventId.tsx` is rewritten to drive the new stages: the existing
"Pass Verification" action becomes explicit `under_review → verified` (still
`civil.verify`, not `civil.register` — the RLS widening in §4 is what makes this
legal), approval gains the payment hand-off (`approved → awaiting_payment`, then
a new Payment card mirroring credential's `PaymentCard` for `awaiting_payment → paid`,
both under `civil.record_payment`), and the manual "Close" button (`approved → issued`)
is removed — replaced by the automatic `paid → registered` system transition,
surfaced as a read-only "Registered" outcome state once reached. Bilingual
server-raised messages (event-type pre-conditions, payment gate, terminal-state
locks) are caught and shown via the same `toast.error((e as Error).message)`
pattern already used throughout this route.

## 9. What this PR does NOT do

- `service_request` FSM wiring (§0.1) — 14-B.
- A new draft-purge job (§0.2) — not asked for, not built.
- Touching the existing certificate `fee_schedule` rows (§0.5) — untouched.
- Widening `supervisor`'s permission grants (§0.4) — the existing matrix is left
  exactly as it is; this PR only wires enforcement onto what already exists.
- Any change to `service_request`'s or `residence_credential`'s own trigger
  bodies beyond what's already documented in Task 12's memo.

## 10. `workflow-fsm-review` finding, reviewed and left as-is

`pending_approval → returned` is seeded with `required_permission = 'civil.return'`
(§3's FSM table), which `civil_registrar`/`registry_clerk` hold and `supervisor`
does not (§0.4). `enforce_workflow_transition()` checks only the single
`required_permission` on the row being applied — it has no notion that
`pending_approval` is "the supervisor's queue" — so a registry_clerk/
civil_registrar holding `civil.return` can `PATCH` an event they submitted
straight back out of the supervisor's approval queue via a direct API call,
without the supervisor's involvement. The UI happens to mask this (the
Approve/Return/Reject block at `pending_approval` is gated behind one
`P.CIVIL_APPROVE` `<PermissionGate>` in `woreda.civil.$eventId.tsx`, so a
registry_clerk never sees the button), but that's a client-side accident, not
a server-side control.

This is the same asymmetry §0.4/§9 already recorded as an explicit,
deliberate scope decision: this PR widens _enforcement_ (the FSM now actually
gates what it always should have), it does not widen or rebalance the
existing permission grants those FSM rows key off. Fixing it would mean
either granting `supervisor` `civil.return` or splitting `pending_approval`'s
return path onto its own permission distinct from the verification-stage
`under_review → returned` edge — both are permission-matrix decisions for the
owner, not something to change opportunistically inside a workflow-engine
PR. Recorded here for the owner's explicit sign-off before go-live, not
fixed in this PR.

## 11. `/security-review` finding, fixed: payment gate wasn't bound to its own event

**HIGH, fixed before merge.** `enforce_vital_event_payment_gate()` originally
checked only `p.payment_id = NEW.payment_id AND p.woreda_id = NEW.woreda_id
AND p.status = 'confirmed'` — it never checked `p.vital_event_id =
NEW.vital_event_id`. Any staff member holding `civil.record_payment` can read
every confirmed payment in their own tenant (`payment_select` RLS is
woreda-scoped, not row-owner-scoped), including a payment originally recorded
against a rental fee, a credential fee, or a *different* vital_event. Pointing
`vital_event.payment_id` at that unrelated payment and transitioning to `paid`
passed the gate, and the system's own `paid → registered` cascade then fired
the birth/death side effects — finalizing a registration with no payment ever
actually collected for it, directly defeating this migration's own stated
invariant ("even a free registration must write a zero-value payment and
receipt").

Fixed in `00000000000059` by adding `AND p.vital_event_id =
NEW.vital_event_id` to the gate's `EXISTS` check, plus a new partial unique
index `payment_vital_event_id_unique ON payment(vital_event_id) WHERE
vital_event_id IS NOT NULL` so one payment can never be attached to more than
one event in the first place. Both re-applied live via `CREATE OR REPLACE`/
`CREATE UNIQUE INDEX IF NOT EXISTS` (idempotent, no new migration number,
since this was still pre-merge). A new regression probe,
`civil_paid_with_unrelated_payment_row`, reuses a real, already-confirmed
credential-fee payment from production and confirms the gate now rejects it
(26/26 probes pass net-zero).

The reviewing agent noted `generate_residence_credential_on_payment()` (the
credential module's own equivalent gate, migration 25/29, pre-existing) has
the identical missing binding for `credential_request_id` — a real gap, but
out of this PR's scope to fix; flagged here for a follow-up task rather than
silently expanded into.

## 12. `code-review` findings, fixed

1. **The final `paid` UPDATE in `PaymentCard.handleRecord` didn't verify a row
   was actually affected**, unlike the `awaiting_payment` raise a few lines
   above it in the same handler, which already does. PostgREST returns
   `error: null` whether the `WHERE` matched 0 or 1 rows (the house rule this
   codebase has hit before — see `CLAUDE.md`'s "every admin-facing mutation
   verifies what it actually changed"). Since a `payment` + `receipt` already
   exist by this point in the handler, a silent no-op here would mean money
   collected with the event stuck at `awaiting_payment` forever, while the UI
   tells the operator it succeeded. Fixed: the update now chains
   `.select("vital_event_id").maybeSingle()` and throws a bilingual error
   pointing at an administrator if nothing comes back.
2. **`woreda.civil.index.tsx`'s status filter and `StatusChip` were never
   updated for the new FSM.** `STATUSES` had no entry for `verified`,
   `awaiting_payment`, `paid`, or `registered` — the four stages every event
   now actually passes through — and still listed the now-dead
   `approval_returned` value (no seed row targets it under the new FSM,
   matching how `issued`/`approval_returned` are documented as legal-but-
   retired in §1). `StatusChip` had entries for `verified`/`awaiting_payment`/
   `paid` (added for the credential module) but none for `registered`, so a
   completed civil event showed the unstyled default gray chip with the raw
   English word instead of a colored, Amharic-labeled badge. Fixed both: the
   filter list now matches the seeded FSM exactly, and `registered` got its
   own emerald-styled, bilingual chip entry.
