# Kebele Rental Houses Management — Phase 0 Policy Sign-Off

Records the owner decisions on PD-01…PD-11
(`Kebele_Rental_Houses_Management_Implementation_Plan.md` §39) that gate every later
phase. Phase 0's own "Done" criterion is "every PD signed; policy rows live and
audited" — this file is the sign-off record, `rental_policy`
(migration `00000000000071_rental_phase0_policy.sql`) is the "policy rows live" half.

Four decisions were real product/security judgment calls and were put to the system
owner explicitly rather than defaulted silently; the rest are the plan's own stated
recommendations, adopted as-is since they're technical/low-risk defaults with an
explicit escape hatch (`rental_policy` is per-woreda and editable by `tenant_admin`
under `rental.policy.configure` for the configurable ones; the workflow-engine ones
are structural and revisited only via a future migration).

| # | Decision | Signed-off value | Where enforced |
|---|---|---|---|
| PD-01 | Due-date rule for charges | Fixed EC day, `due_day = 10`, early in the period | `rental_policy.due_rule`/`due_day` (Phase 2 consumes it in `generate_rent_charges()`) |
| PD-02 | Termination final billable period | Through the termination month (Nehase if terminated during Pagumē) | `rental_policy.termination_final_period_rule` (Phase 1/2 termination logic) |
| PD-03 | Checkpoint blocking default | **Visible, non-blocking** — arrears shown to the clerk, submission proceeds; blocking only where explicitly enabled | `rental_policy.block_on_rental_arrears = false` (Phase 5 checkpoint) |
| PD-04 | Plan-compliance effect on the checkpoint | Reduce severity, don't hide arrears | `rental_policy.plan_compliance_effect = 'reduce_severity'` |
| PD-05 | Waiver/adjustment authority + limits | Supervisor approval; a documented max amount (nullable until Phase 6 defines one) | `rental_policy.waiver_requires_role`/`waiver_max_amount` (Phase 6 capability, recorded now) |
| PD-06 | Reminder channels and cadence | ERP + print first; SMS stays a legal value, never selected by default until a gateway is procured | `rental_policy.reminder_channels = {erp,print}` |
| PD-07 | Self-verification: may the submitting clerk also verify? | **No** — require `requested_by ≠ verified_by`, mirroring the existing maker≠checker rule (closes audit finding AF-13) | Not a `rental_policy` column — a Phase 1 trigger guard on `rental_occupancy_request`, parallel to the existing verified≠approved check |
| PD-08 | Payment-type unification | `rental_rent` canonical; `house_rent` usage retired (enum value kept, never written going forward) | Application-level in Phase 3 (`rental_payment` extension); no schema change needed since the enum already has both values |
| PD-09 | Add the `verified → returned` edge | **Yes**, mirroring civil registration (closes audit finding AF-15) | Not a `rental_policy` column — a Phase 1 `workflow_transition` seed row for `rental_occupancy_request` |
| PD-10 | Billing/reminder invocation | Manual-first RPC now; scheduled invocation (pg_cron / Edge Function) is a later follow-up once cadence is confirmed in production | `rental_policy.billing_invocation_mode = 'manual'` |
| PD-11 | House inventory enrichment (GPS/photos/inspection) and house-registration approval | **Deferred to Phase 6** — no house-registration approval workflow now (it remains an unapproved inventory act); GPS/photo/inspection fields not added in Phases 0-5 | No schema change in this phase; `kebele_rental_house` untouched |

## Why PD-03/PD-07/PD-09/PD-11 went to the owner explicitly

- **PD-03** changes whether an unrelated service (e.g. birth registration) can be
  blocked over a rent dispute — a real service-availability tradeoff, not a technical
  default.
- **PD-07** tightens separation of duties on an as-built workflow that today allows
  self-verification (AF-13) — a behavior change to an existing, live flow, not a
  greenfield default.
- **PD-09** adds a new state-machine edge to a live FSM (`rental_occupancy_request`)
  that as-built has no return path (AF-15) — changes what an approver can do today.
- **PD-11** decides whether this phase's scope expands to include house-registration
  approval and physical inspection data, which would materially change Phase 1/2's
  workload.

All four were confirmed with the recommended (and now signed-off) value; see the
session record for the exact prompts and answers.

## What Phase 0 delivered

- `rental.policy.configure` permission — added to `tenant_admin`'s compiled default
  grant (`src/config/permissions.ts`, `default_role_perms()` in migration `00071`),
  reserved (excluded from the matrix/override/custom-role reassignment paths the same
  way `credential.configure_policy` is).
- `rental_policy` table — one row per woreda, RLS-gated (same-woreda read, `tenant_admin`
  write via `rental.policy.configure`), auto-seeded on new-woreda insert, backfilled for
  all 6 existing woredas with the values in the table above.
- The 12-month rental year itself (Meskerem–Nehase; Pagumē never billed) is **not** a
  `rental_policy` column — the plan is explicit that it's structural, not configurable,
  and it lands as a `CHECK` constraint on `rent_charge.ethiopian_month` in Phase 2.

## Verification

```sql
-- one row per woreda, defaults as signed off
select woreda_id, due_day, reminder_channels, block_on_rental_arrears,
       plan_compliance_effect, billing_invocation_mode
  from rental_policy order by woreda_id;

-- tenant_admin's compiled default includes the new permission
select 'rental.policy.configure' = ANY(default_role_perms('tenant_admin'));

-- reserved-key lists widened
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('user_permission_override_no_locked_keys',
                    'tenant_role_permission_no_reserved_keys');
```

Run against the live project 2026-09-20: 6/6 woredas have a `rental_policy` row with
the signed-off defaults; `default_role_perms('tenant_admin')` includes
`rental.policy.configure`; both reserved-key `CHECK` constraints include it.
`bun run check:role-perms-drift` passes.

## Next

Phase 1 (integrity hardening, AF-01…AF-11) is unblocked. PD-07 and PD-09 are Phase 1
work items (trigger guard + `workflow_transition` seed row), not yet implemented —
tracked there, not here.
