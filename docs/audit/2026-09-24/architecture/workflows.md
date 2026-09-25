# Workflow State Machines — consolidated (audit 2026-09-24)

Produced by `audit-architecture` (Wave 3) by consolidating the diagrams in `../findings/workflows.md` §4 and re-checking every edge against the replayed transition table `../raw/workflows-fsm-reconstructed.txt` (83 rows, 6 entities, after replaying every `INSERT INTO public.workflow_transition` in migrations 25, 26, 27, 28, 58, 61, 72, 75, 80, 81, 85 and the `DELETE … LIKE 'LEGACY-28:%'` in `00000000000030:82`). Guards and side effects were re-checked against the **latest** definition of each function:

| Function | Latest definition |
|---|---|
| `enforce_workflow_transition()` | `00000000000046_task10_credential_lifecycle.sql:135` |
| `enforce_workflow_insert()` (credential tables only) | `00000000000029_workflow_insert_guard.sql:81`, triggers `:204-211` |
| `enforce_rental_request_integrity_guards()` (rental insert guard) | `00000000000089_rental_review_round6_fixes.sql:87` |
| `enforce_vital_event_preconditions()` / `enforce_service_request_preconditions()` | `00000000000066_payment_hardening_review_fixes.sql:406` / `:339` (neither checks `NEW.status` on INSERT) |
| `generate_residence_credential_on_payment()` (mint) | `00000000000070_mint_guard_deceased_check.sql:28` |
| `apply_death_on_approval()`, `generate_resident_on_birth_approval()` | `00000000000059_task14a_civil_payment_and_preconditions.sql:82`, `:118` |
| `reverse_rental_payment()` | `00000000000089_rental_review_round6_fixes.sql` (rent_charge back to `due`/`overdue` at `:513`) |
| `settle_rent_payment()` | `00000000000087_rental_review_round4_fixes.sql:693-742` |

Labels show the `required_permission` of the seeded triple. `SYSTEM` = `is_system = true`, reachable only inside a SECURITY DEFINER body that sets the transaction-scoped GUC `app.system_transition`. Every diagram below was parse-checked with Mermaid 11.

## Corrections made to the Wave 2 diagrams

| # | Diagram | Wave 2 version | Corrected to | Evidence |
|---|---|---|---|---|
| 1 | Service request | Omitted the seeded edge `approved → in_progress` (`service.issue`); it was mentioned only in prose | Edge drawn | `raw/workflows-fsm-reconstructed.txt` (service_request block); `00000000000061:112-130` |
| 2 | Service request | Label contained `;`, which Mermaid 11 rejects (diagram failed to render) | Rewritten | Parse check (this audit) |
| 3 | Rent charge / payment | Labels contained `;` and nested notes (diagram failed to render) | Split into two valid diagrams | Parse check (this audit) |
| 4 | Civil registration | Showed `[*] --> submitted` as the INSERT entry | Direct INSERT at **any** status shown explicitly; latest `enforce_vital_event_preconditions()` has no status check and `enforce_workflow_insert()` is attached only to the two credential tables | `00000000000066:406-440`; `00000000000029:204-211` |
| 5 | Service request | Same as 4 | Same correction | `00000000000066:339-360` |
| 6 | Payment status | Showed `pending --> confirmed` as a guarded edge | Shown as unguarded PATCH for non-rental payment types; only `rental_rent` rows are guarded | `00000000000086:74` (rental guard); `baseline.sql:1600` (payment UPDATE policy) |

No edge in the Wave 2 diagrams was absent from the replayed table, and no replayed edge other than #1 was missing from them.

## 1. Credential request (`credential_request`) — 22 transitions

```mermaid
stateDiagram-v2
    [*] --> draft : INSERT, guarded to draft or submitted
    [*] --> submitted : INSERT, guarded to draft or submitted
    draft --> submitted : credential.submit
    submitted --> under_review : credential.review
    submitted --> verified : credential.review
    submitted --> returned : credential.return
    under_review --> verified : credential.review
    under_review --> returned : credential.return
    returned --> under_review : credential.resubmit
    approval_returned --> under_review : credential.resubmit, recovery only
    verified --> pending_approval : credential.approve
    verified --> returned : credential.return
    verified --> rejected : credential.reject
    pending_approval --> approved : credential.approve, verifier not approver
    pending_approval --> returned : credential.return
    pending_approval --> rejected : credential.reject
    approved --> awaiting_payment : credential.record_payment
    approved --> returned : credential.return
    approved --> rejected : credential.reject
    awaiting_payment --> paid : credential.record_payment, mint gate
    awaiting_payment --> returned : credential.return
    awaiting_payment --> rejected : credential.reject
    paid --> printed : credential.confirm_print
    printed --> active : credential.activate
    rejected --> [*]
    active --> [*]
    note right of paid
      Mint trigger (mig 70) runs on entry to paid.
      Needs confirmed and receipted credential_fee
      payment for this request, resident 18 or older,
      photo, phone, not deceased. Inserts residence_credential.
    end note
    note left of returned
      WP-WF-003 actor columns survive a return,
      so maker-checker compares stale values.
      WP-WF-004 and WP-WF-005 subject columns stay
      writable after approval.
    end note
```

`approval_returned` is legal in the CHECK constraint but nothing leads into it (reachable only by data written before the FSM).

## 2. Residence credential (`residence_credential`) — 9 transitions

```mermaid
stateDiagram-v2
    [*] --> ready_to_print : mint trigger only, GUC app.minting_credential
    ready_to_print --> printing : credential.preview_print, print eligibility
    printing --> printed : credential.confirm_print, writes credential_print_log
    printing --> ready_to_print : credential.preview_print, print failed
    printed --> active : credential.activate, supersedes prior card
    active --> suspended : credential.suspend, reason required
    suspended --> active : credential.suspend, reason required
    active --> revoked : credential.revoke, reason, tenant_admin only
    active --> replaced : credential.activate, successor must exist
    active --> expired : SYSTEM, no job drives it
    revoked --> [*]
    replaced --> [*]
    expired --> [*]
    note right of suspended
      WP-WF-006 death revokes only active cards.
      A suspended or printed card of a deceased
      resident can still become active.
    end note
```

## 3. Civil registration (`vital_event`: birth, death, marriage, divorce) — 12 transitions

```mermaid
stateDiagram-v2
    [*] --> draft : INSERT
    [*] --> submitted : INSERT
    [*] --> awaiting_payment : INSERT at any status, no guard, WP-WF-001
    draft --> submitted : civil.submit
    submitted --> under_review : civil.verify
    under_review --> verified : civil.verify
    under_review --> returned : civil.return
    returned --> under_review : civil.resubmit
    verified --> pending_approval : civil.approve
    pending_approval --> approved : civil.approve, verifier not approver
    pending_approval --> returned : civil.return
    pending_approval --> rejected : civil.reject
    approved --> awaiting_payment : civil.record_payment
    awaiting_payment --> paid : civil.record_payment, payment gate
    paid --> registered : SYSTEM, same transaction
    registered --> [*]
    rejected --> [*]
    note right of registered
      Side effects on registration:
      birth inserts a resident, idempotent, WP-DB-003
      death marks resident deceased and revokes ACTIVE cards only, WP-WF-006 and 007
      marriage and divorce have no side effect, WP-WF-008
      divorce cannot reach paid, no fee mapping, WP-WF-008
    end note
```

The `[*] --> awaiting_payment` edge stands for "any status in the CHECK constraint, including `approved`, `paid` and `registered`". It is not in `workflow_transition`; it exists because no BEFORE INSERT trigger on `vital_event` inspects `status`. Dead states: `approval_returned`, `issued`.

## 4. Service request (`service_request`: letters and complaints share one FSM) — 20 transitions

```mermaid
stateDiagram-v2
    [*] --> draft : INSERT
    [*] --> submitted : INSERT
    [*] --> issued : INSERT at any status, no guard, WP-WF-001
    draft --> submitted : service.submit
    submitted --> under_review : service.verify
    under_review --> verified : service.verify
    under_review --> pending_approval : service.verify, complaint edge usable by letters
    under_review --> returned : service.return
    returned --> under_review : service.resubmit
    verified --> pending_approval : service.approve
    pending_approval --> approved : service.approve, verifier not approver
    pending_approval --> in_progress : service.approve, complaint edge, no SoD check
    pending_approval --> returned : service.return
    pending_approval --> approval_returned : service.return, complaint sink
    pending_approval --> rejected : service.reject
    approved --> awaiting_payment : service.record_payment
    approved --> in_progress : service.issue, no UI path
    awaiting_payment --> paid : service.record_payment, payment gate
    paid --> issued : service.issue_letter, issuance gate
    issued --> completed : service.complete
    issued --> closed : service.issue
    in_progress --> resolved : service.issue
    resolved --> closed : service.issue
    completed --> [*]
    closed --> [*]
    rejected --> [*]
    note right of resolved
      WP-WF-002 verify_service_letter accepts issued,
      resolved, closed and completed. A letter driven
      along the complaint edges verifies publicly
      with no approval SoD and no payment.
    end note
```

`approval_returned` has no exit (WP-WF-016). The `[*] --> issued` edge stands for "any status", as in §3.

## 5. Rental occupancy request (`rental_occupancy_request`) — 11 transitions

```mermaid
stateDiagram-v2
    [*] --> draft : INSERT, guarded, requester required
    [*] --> submitted : INSERT, guarded, requester required
    submitted --> verified : rental.create, verifier is caller and not requester
    under_review --> verified : rental.create
    returned --> verified : rental.create
    submitted --> returned : rental.create
    under_review --> returned : rental.create
    verified --> approved : rental.approve, approver is caller, not verifier or requester
    verified --> rejected : rental.approve
    verified --> approval_returned : rental.approve
    approval_returned --> verified : rental.create
    approval_returned --> returned : rental.create
    approval_returned --> under_review : rental.create
    approved --> [*]
    rejected --> [*]
    note right of approved
      apply_rental_occupancy_on_approval
      new registration inserts rental_occupancy, one active per house
      termination ends occupancy and rent account, house vacant
      rent account provisioning is a separate client RPC, WP-WF-013
      fields signed off at verification are frozen
    end note
```

`draft` has no exit and `pending_approval` is unreachable (WP-WF-016).

## 6. Arrears repayment plan (`arrears_repayment_plan`) — 9 transitions

```mermaid
stateDiagram-v2
    [*] --> submitted : create_arrears_repayment_plan RPC only, server-computed amounts
    submitted --> active : rental.plan.approve, approver is caller and not requester
    submitted --> returned : rental.plan.approve
    submitted --> cancelled : rental.plan.create
    returned --> submitted : rental.plan.create
    returned --> cancelled : rental.plan.create
    active --> completed : SYSTEM, last installment settled
    completed --> active : SYSTEM, reversal reopens an installment
    active --> defaulted : rental.plan.manage
    active --> cancelled : rental.plan.manage
    cancelled --> [*]
    defaulted --> [*]
```

## 7. Rent charge (`rent_charge.status`, not engine-guarded; written only by DEFINER RPCs)

```mermaid
stateDiagram-v2
    [*] --> due : generate_rent_charges, rental.billing, months 1 to 12 only
    due --> paid : settle_rent_payment or settle_arrears_installments, exact sum, row locks, idempotency key
    overdue --> paid : settle_rent_payment or settle_arrears_installments
    paid --> due : reverse_rental_payment, rental.reverse, reverser not collector
    paid --> overdue : reverse_rental_payment, when past due date
    note right of due
      overdue is derived at read time and
      refresh_rent_ledger_statuses is never called, WP-WF-016.
      scheduled, waived and cancelled have no writer.
    end note
```

## 8. Payment status (`payment.status`: pending, confirmed, reversed)

```mermaid
stateDiagram-v2
    state "rental_rent payments" as RENT {
        [*] --> confirmed : settle RPC only, direct insert blocked
        confirmed --> reversed : reverse_rental_payment only
    }
    state "credential, civil, service fee payments" as FEE {
        [*] --> confirmed : client INSERT, exact-match fee guard
        confirmed --> reversed : any payment.collect PATCH, WP-WF-011
        reversed --> confirmed : any payment.collect PATCH, WP-WF-011
        confirmed --> pending : any payment.collect PATCH, WP-WF-011
        pending --> confirmed : any payment.collect PATCH, WP-WF-011
    }
```

A waiver is a `confirmed` payment with `amount = 0` and `waived = true` (reason ≥ 5 characters, any module's approve permission — WP-WF-010). There is no `due`, `overdue` or `waived` payment status: those live on `rent_charge` and `arrears_repayment_installment`.

## 9. Where each guard lives (summary)

| Entity | UPDATE FSM | INSERT status guard | Actor pinned to caller | Maker ≠ checker in DB | Payment gate | Subject frozen after approval | Trigger-written trail |
|---|---|---|---|---|---|---|---|
| `credential_request` | yes | yes | no | verifier ≠ approver at `approved` | yes (mint) | no | `audit_log` |
| `residence_credential` | yes | yes (mint only) | `revoked_by` only | n/a | print gate | number, serial, QR only | `audit_log` |
| `vital_event` | yes | **no** | no | verifier ≠ approver at `approved` | yes | `resident_id` once set | `workflow_status_history` |
| `service_request` | yes | **no** | no | verifier ≠ approver at `approved` only | yes + issuance | no | `workflow_status_history` |
| `rental_occupancy_request` | yes | yes | yes | requester ≠ verifier ≠ approver | n/a | yes | `workflow_status_history` |
| `arrears_repayment_plan` | yes | RPC only | yes | requester ≠ approver | n/a | yes | `audit_log` |

Source: `../findings/workflows.md` §3, re-checked for the two INSERT rows as described in correction 4–5.
