# System architecture

INSA Enforcer Phase 1.2. The structural counterpart to
[`docs/security-hardening.md`](./security-hardening.md), which maps each
layer below against the WAF/DDoS/TLS/API-Shield/Page-Shield capabilities a
Cloudflare-fronted stack would otherwise provide — read that document for the
control-by-control detail; this one is the shape.

## Deployment topology

```mermaid
flowchart TB
    subgraph Client["Client (browser)"]
        Browser["Woreda staff / platform admin / public verifier"]
    end

    subgraph Vercel["Vercel — frontend & SSR shell"]
        direction TB
        Edge["Edge network — TLS termination, DDoS mitigation, optional WAF ruleset (dashboard opt-in)"]
        SSR["TanStack Start server entry (src/server.ts)<br/>Every route: ssr:false — signed-out shell only, hydrates client-side"]
        Headers["withSecurityHeaders (src/lib/security-headers.ts)<br/>HSTS · CSP · X-Frame-Options · Permissions-Policy · nosniff · Referrer-Policy"]
        Edge --> SSR --> Headers
    end

    subgraph Supabase["Supabase — data & auth plane"]
        direction TB
        PostgREST["PostgREST — auto-generated REST over Postgres<br/>every table RLS-enabled"]
        Auth["GoTrue (Auth) — JWT issuance, invite/recovery email links"]
        Storage["Storage — 9 buckets, all private, signed-URL reads only"]
        Functions["6 Edge Functions (Deno) — service-role, own CORS allow-list,<br/>each re-checks caller identity + authorization in code"]
        DB[("Postgres — 43 tables, RLS on every one,<br/>SECURITY DEFINER helper functions")]
        PostgREST --> DB
        Functions --> DB
        Auth --> DB
    end

    Browser -- "HTTPS" --> Edge
    Headers -- "anon key, JWT bearer" --> PostgREST
    Headers -- "JWT bearer" --> Auth
    Headers -- "JWT bearer, signed URLs" --> Storage
    Headers -- "JWT bearer" --> Functions
```

## Why the shape is what it is

- **No server-side application logic between the browser and Supabase.**
  There are no `loader`s, no `beforeLoad` guards, no `createServerFn` calls
  anywhere in `src/routes`. Every page queries PostgREST directly with the
  anon key from `useQuery`/`useMutation`; the only privileged server-side
  code is the 6 Edge Functions, invoked explicitly for the handful of
  operations that must bypass RLS (inviting a user, signing a credential,
  activating an invited account, recording a login). See CLAUDE.md's "Data
  layer" section for the full rationale.
- **`ssr: false` on all 66 route files.** Auth state is bootstrapped
  client-side from `supabase.auth.getSession()`
  (`src/hooks/useAuthBootstrap.ts`), so a server-rendered pass has no session
  and no permissions. TanStack Start is present for the router, the build,
  and the server entry — not for SSR of authenticated pages.
- **RLS is the tenant boundary, not application code.** Every table scopes
  its policies to `woreda_id = get_user_woreda_id()` (or an explicit
  `is_super_admin()` escape hatch); a query that forgets a `woreda_id` filter
  still cannot cross tenants, because the database itself won't return the
  rows. See [`docs/erd.md`](./erd.md) for where that boundary sits per table.
- **Edge Functions run as service-role and re-check authorization
  themselves.** Service-role bypasses RLS entirely, so each of the 6
  functions independently verifies caller identity (via the caller's own JWT,
  never a body-supplied `user_id`) and role/status/permission before
  mutating anything — see [`docs/api-security.md`](./api-security.md) for the
  per-function breakdown.
- **Security headers are applied once, centrally, to every response.**
  `src/server.ts` wraps TanStack Start's server entry specifically because
  h3 (the underlying server framework) swallows in-handler throws into an
  opaque `500` JSON body; the same wrapper that recovers a readable error
  page also applies `withSecurityHeaders` on both the success and error path,
  so a failure mode can never accidentally ship without HSTS/CSP.

## What sits where

| Concern                              | Layer                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| TLS termination, cert renewal        | Vercel edge (auto-provisioned)                                                                                                  |
| DDoS mitigation (L3/L4)              | Vercel edge (always on) + Supabase                                                                                              |
| WAF (managed OWASP ruleset)          | Vercel Firewall — dashboard opt-in, not a repo change (see `docs/security-hardening.md`)                                        |
| Security response headers            | `src/lib/security-headers.ts`, applied in `src/server.ts`                                                                       |
| Authentication (session issuance)    | Supabase Auth (GoTrue) — JWT, `localStorage`-persisted client-side, bearer-header transport                                     |
| Authorization (row-level)            | Postgres RLS policies, keyed off `app_user.role`/`status` and the permission-override chain                                     |
| Authorization (Edge Function-level)  | In-function checks against the caller's own JWT — see `docs/api-security.md`                                                    |
| File storage                         | Supabase Storage — 9 private buckets (8 tenant-prefixed, plus the platform-level `credential-templates`), signed-URL reads only |
| Public, unauthenticated verification | Two RPCs (`verify_credential_token`, `verify_service_letter`) called directly by the anon client                                |

## Decision record

Task 8 (2026-09-14): the permanent record of the design decisions made while
closing out `docs/system-review-2026-09.md`'s findings and the resulting
`fix-task-production-readiness-v3.md` work (that document itself is external
— supplied to scope the review, never checked into this repo — so it is
cited here by the label its own migrations and `docs/fix-task-v3-execution-notes.md`
use, not reproduced). This section is the place a future engineer or auditor
should look for "why is it built this way," rather than re-deriving it from
migration comments scattered across 68 files.

### Corrections to the governing brief

Six factual corrections to the review brief's stated ground truth — full
detail and evidence in `docs/brief-reconciliation-memo.md`, summarized here
since that memo's own opening line points back to this section:

| #   | Brief asserted                                                       | As-built                                                                                          | Why                                                                                                               |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | RS256 signing                                                        | **ES256** (ECDSA P-256)                                                                           | A 64-byte signature vs. RS256's 256 bytes is a QR module-density constraint on an 85.6×54mm card.                 |
| 2   | Credential number `WW-KK-YY-NNNNNN-C`, mod-11                        | **13 digits, Luhn (mod-10)**                                                                      | Migration `00000000000002` explicitly replaced the bespoke mod-11 scheme.                                         |
| 3   | `safeBase64Encode`/`Decode` mandatory                                | **Do not exist** — byte-level `atob`/`btoa` + `TextEncoder`/`TextDecoder` instead                 | The Unicode-corruption hazard the brief's naming implies genuinely doesn't occur here (see KD-2 in the review).   |
| 4   | Revenue/Reporting/Audit UI, credential-template editor not yet built | **All built and routed**                                                                          | Live since before the review; the brief was stale, not the app.                                                   |
| 5   | DFD/Security-Functionality docs missing                              | **Present** (`docs/dfd.md`, `docs/security-functionality.md`, `docs/erd.md`, `docs/openapi.yaml`) | Same.                                                                                                             |
| 6   | QR budget ~1.8 KB                                                    | **~500 characters**                                                                               | `sign-credential`'s own header comment: the real constraint is printer module density, not an arbitrary size cap. |

### Ignored/resolved contradictions between the fix-task spec and the as-built system

The fix-task spec and the as-built system disagreed in several places found
while implementing it. The spec's own external document apparently used an
"IC-" numbering for these (one such reference, `IC-4`, survives as a
backward-pointer in `docs/erd.md`), but the actual enumerated record that
exists **in this repository** — the one this section treats as
authoritative — is `docs/fix-task-v3-execution-notes.md`'s **D-1 through
D-4** (decisions made) and **O-1 through O-7** (open items resolved without
needing a separate decision):

- **D-1 — spec recovery.** `docs/id-card-workflow.txt` (the binding ID-card
  workflow spec) was cited throughout the fix task but absent from the tree;
  recovered from the owner's source and committed. Two corrections to how
  the fix task itself had summarized it: the status-chip map has **18**
  entries, not 17; the 10 KPI widgets list was confirmed accurate as cited.
- **D-2 — the as-built UI moved to match the FSM, not the reverse.** Before
  this work, "Pass"/"Approve" skipped `verified`/`approved` as real stops and
  wrote `approval_returned` on return-from-approval — a status the tightened
  FSM's target chain doesn't reach. Resolved by making `verified` and
  `approved` real stops (the buttons were rewritten to walk every state) and
  retiring `approval_returned` from active use: it stays legal in the `CHECK`
  constraint (removing it would be non-additive) but has no transitions in
  or out; return-from-approval now lands in `returned` and re-enters
  **verification**, not approval — a genuine behavior change from the
  previous shortcut. Landing this produced a real production incident
  sequence (15 code-review findings, a security-review catch on a dropped
  `security_invoker` setting, and a deploy-ordering hazard resolved by a
  temporary re-seed migration later removed once the new frontend was
  confirmed live) — all recorded in `docs/fix-task-v3-execution-notes.md`
  §6-8, kept here as the reminder that a workflow/UI FSM change is a single
  deploy unit with the frontend, never migration-then-frontend-whenever.
- **D-3 — `credential.verify` name collision.** The spec's workflow-stage
  verification verb collided with the pre-existing `credential.verify`,
  which gates the public ID-lookup screen and is deliberately held by
  `viewer`/`auditor` (two read-only roles) — reusing it for "may verify a
  credential request" would have handed that power to both. Resolved by
  naming the workflow verb `credential.review` instead; `credential.verify`
  keeps its original meaning and grants unchanged.
- **D-4 — `fee_schedule` already existed.** The spec listed it under
  "Build," but it was already a live table with different column names
  (`standard_fee`/`status` vs. the spec's `amount`/`is_active`). Renaming
  would be non-additive, and the one migration-guardrail-sanctioned
  non-additive exception (**A5**, below) was already spent elsewhere.
  Resolved by extending in place: only `effective_from date` was added
  (nullable; `NULL` means always effective); `standard_fee`/`status` are
  reused as-is, mapped rather than duplicated.
- **O-1 (ready_to_print/printing ownership)**: `ready_to_print` is a
  `residence_credential` state, not a `credential_request` state — the
  request FSM ends at `paid`, the credential FSM runs
  `ready_to_print → printed → active`, both matching the shipped UI exactly.
- **O-2 through O-7** (permission-catalogue near-doubling risk; Task 11's
  `attachment`/`approval` tables sitting alongside rather than replacing
  existing module-local tables; a pre-existing latent `vital_event.status`
  default-vs-CHECK mismatch; a constraint-naming inconsistency; the revoke
  path leaving `credential_request.status` unchanged at `active`; missing
  `printed_by_user_id`/`issued_by_user_id` columns) — each resolved as its
  own task landed; see `docs/fix-task-v3-execution-notes.md` for the specific
  resolution of each.

### The shared workflow engine and per-entity FSMs

One generic `BEFORE UPDATE` trigger function, `enforce_workflow_transition()`
(migration `00000000000025`, closing the review's one Critical finding,
F-01), is defined once and attached — via `CREATE TRIGGER`, never redefined
— to every workflow-bearing table: `credential_request`,
`residence_credential` (migration 25), `vital_event` and
`rental_occupancy_request` (migration 58), `service_request` (migration 61).
It resolves which entity it's guarding from `TG_TABLE_NAME`, looks up the
attempted `(entity, from_status, to_status)` triple in one platform-wide
reference table (`workflow_transition` — see `docs/erd.md`'s "Workflow
engine" section for its full shape), and rejects anything absent from that
table. The same function also enforces maker≠checker (one person can never
both verify and approve the same row) and blocks a system-only transition
from firing off a live user session.

`workflow_transition` deliberately carries **no `woreda_id`**: which state
changes are legal is fixed for the whole platform. A tenant can change _who_
holds a permission (`role_permission`), but never remove a
verification/approval/payment gate — that asymmetry is the load-bearing
design choice underneath the whole engine.

Two separate audit-writer trigger functions exist, not one, because they
were added at different times for different sets of tables:
`log_workflow_transition()` (migration 25) writes into the pre-existing,
generic `audit_log` table for `credential_request`/`residence_credential`,
deliberately kept alongside those tables' own semantic audit inserts (a
trigger row guarantees a direct PostgREST call still leaves a trail; the app
rows carry context — reprint reason, waiver — the trigger can't see).
`log_workflow_status_history()` (migration 58) writes into a **new**,
separate table, `workflow_status_history`, created because `vital_event`,
`rental_occupancy_request` and `service_request` had no pre-existing
per-module status-history table the way credentials did — it does not
replace `credential_request_status_history`/`credential_status_history`,
which stay app-written.

### Custom roles

The fix-task spec's own guardrail numbering (again, from the external
document, not reproduced here) refers to specific rules as "A5" and "A7" in
this repo's migration comments — those two are the ones with a concrete,
citable implementation; no "A1"–"A4" or "A6" appear anywhere in this
repository, so treat any reference to them as pointing into that external
document, not into code here.

- **A5 — the one sanctioned non-additive change.** Adding `custom` as a
  ninth `app_user.role` value needs a cross-table, same-tenant, `is_active`
  condition a plain `CHECK` cannot express, so `app_user_role_check` was
  **dropped** and replaced by a `BEFORE INSERT/UPDATE` trigger,
  `validate_app_user_role()` (migration 39), that enforces the same
  built-in-role whitelist **plus** the new custom-role rule — a strict
  superset, nothing legal before it becomes illegal after. A later hardening
  pass (migration 41) re-added a plain `CHECK` **alongside** the trigger,
  purely as a value-whitelist backstop for contexts where triggers don't
  fire (logical replication, `pg_restore --disable-triggers`) — itself
  purely additive, restoring the general no-DROP guardrail without losing
  the trigger's cross-table logic.
- **A7 — `tenant_admin` is not editable through the matrix.**
  `role_permission_role_name_check` lists only the non-admin roles
  (`registry_clerk`, `civil_registrar`, `finance_clerk`, `supervisor`,
  `auditor`, `viewer`, `print_officer`) and **excludes**
  `tenant_admin`/`super_admin` entirely — confirmed live (Task 8 enumeration,
  2026-09-14): `role_permission` contains exactly those 7 role names, zero
  rows for either admin role. `tenant_admin`'s grant set is fixed at whatever
  `default_role_perms('tenant_admin')` compiles to; there is no path, matrix
  or override, that can change it.

`tenant_role`/`tenant_role_permission` (migration 38) are the schema this
capability actually runs on — see `docs/erd.md`'s "Custom roles" section for
the tables, the fail-closed resolution chain, and the live fact that **zero
custom roles exist in production** as of this enumeration: the capability is
built, RLS/trigger-enforced, and covered by migration-level checks, but has
no real-world usage to probe against yet.

### The 18+ age invariant, and the identity-completeness gate added alongside it

Task 8 found that the 18+ rule for issuing a residence credential was
enforced **client-side only** (`woreda.credentials.new.tsx`'s
`hardBlocked` check, computed via `calculateAgeYears()`), and failed
**open**, not closed, when a resident's date of birth couldn't be read — the
code's own comment claimed "the server is the actual authority" for this
check, but no database CHECK, trigger, or RPC actually enforced it. A direct
PostgREST call, or a replayed Task 12-C offline-sync item, driving
`credential_request` straight to `paid` had no database-side gate stopping a
credential from being minted for a minor.

Closed by migration `00000000000068`, corrected by `00000000000069`:
`generate_residence_credential_on_payment()` — the one `SECURITY DEFINER`
trigger that actually inserts the `residence_credential` row on every path
that can reach `paid` (the UI, a direct API call, and the offline-sync
replay all update the same column through the same trigger) — now also
verifies, immediately before minting:

1. The resident's age (`date_part('year', age(CURRENT_DATE, date_of_birth))`,
   the same exact-date-boundary semantics as the client's own
   `calculateAgeYears()`) is at least 18.
2. The resident has a non-empty `phone_number` on file.
3. The resident has a non-empty `photo_url` on file.
4. The resident's `active_flag` is `true`.

All four fail **closed**: a resident row that can't even be found, or whose
`date_of_birth` is somehow `NULL` (the column is `NOT NULL` today, but the
check defends the invariant even if that ever changes), is rejected the same
as an under-18 resident — never treated as "unknown, so allow."

**Migration 68 was written against a stale base and had to be corrected.**
It based the new function body on migration 25's version rather than the
live one, silently reverting two later changes to the same function:
migration 66's payment-linkage predicates (`p.credential_request_id =
NEW.credential_request_id AND p.payment_type = 'credential_fee'` — without
them, any confirmed payment anywhere in the woreda could satisfy a different
request's payment gate) and migration 29's `set_config('app.minting_credential',
...)` calls around the INSERT (without them, `residence_credential`'s own
`BEFORE INSERT` guard would reject every mint with `insufficient_privilege`).
Both were caught by dispatching `workflow-fsm-review` and
`tenant-isolation-review` against the migration before push, and both agents
converged on the same two findings independently. `00000000000069` restores
both predicates via `CREATE OR REPLACE` on the same function (migration 68
itself is not reverted, per the additive-only guardrail) and adds the
`active_flag` check above, which the same review pass flagged as also
missing. Verified live via a direct `pg_proc.prosrc` query.

The review also found the original three probes were not real positive
controls for this guard — all three disabled `residence_credential`'s own
`zz_enforce_workflow_insert` trigger during setup, which happens to mask
exactly the `insufficient_privilege` failure mode migration 68 introduced.
Fixed: `age_guard_accepts_exact_18th_birthday_today` now leaves that trigger
enabled, and two new probes (`credential_happy_path_mint_with_guards_enabled`,
`credential_paid_with_unrelated_payment_row`) do the same. Live-probed
(rollback-wrapped, net-zero) — the full suite now covers a 10-year-old
resident (rejected on age), a 30-year-old resident with no phone number on
file (rejected on phone), a resident whose 18th birthday is exactly today
with every guard trigger left enabled (accepted — confirming both the
inclusive boundary and that the guard doesn't spuriously reject a valid
mint), a full happy-path mint with every guard enabled (accepted), and a
request attempting to pay with a different request's already-confirmed
payment row (rejected). **65/65 probes `PASS`, net-zero.** See
`scripts/verify-live-probes.sql`'s "Task 8: age + identity-completeness
guard" section for the exact probes and `docs/go-live-declaration.md` for
the evidence-class citation.

Deliberately **not** a table-wide `NOT NULL` on `resident.phone_number`/
`resident.photo_url`: `generate_resident_on_birth_approval()` (migration 59)
inserts a resident row for a newborn from civil registration with neither a
phone number nor a photo — correctly, since a newborn has neither. A
blanket `NOT NULL` would break every future birth registration — this is
also why phone/photo requiredness lives on a separate `residentCreateSchema`
(`residentSchema.ts`, built via `.superRefine()` over the base schema so its
`z.input`/`z.output` types stay identical) used only by the intake form
(`woreda.residents.new.tsx`), not on the shared `residentSchema` that the
edit form also uses — an earlier draft required both fields on the shared
schema directly and would have made every existing newborn resident
un-editable; caught by the same review pass and fixed before push. The
mint-time guard above is what makes the requirement airtight regardless of
how a `credential_request` reached `paid`, without constraining the one
legitimate case where a resident record is created without them.
`woreda.credentials.new.tsx` also surfaces `noPhone`/`noPhoto` warnings
client-side, matching the existing `notActive`/`isUnder18` pattern, so an
officer sees the gap before attempting payment rather than only at the
DB rejection.

### One office per woreda

Not a labeled invariant anywhere in this repo (a working label like "E2" may
exist in the external spec document, but nothing in the codebase uses it) —
the invariant itself is real and structurally enforced. `office.woreda_id`
carries a `UNIQUE` constraint, so a second office row for the same woreda is
a constraint violation, not merely an unusual state. Seeded with exactly one
row per existing woreda at creation, plus a trigger on `woreda` INSERT
(`seed_office_for_new_woreda`) so a future woreda always gets exactly one
too — mirroring `seed_role_permission_for_new_woreda()`'s existing pattern
rather than depending on a provisioning wizard to remember. See
`docs/erd.md`'s Task 11 gap-fill table for the two-migration bug-and-fix
history of the office-consistency trigger.

### Fee-catalog mapping and the exact-match fee guard

`resolve_credential_fee()`, `resolve_service_fee()`, and `resolve_civil_fee()`
each map their module's request/event/service type to a `fee_schedule.service_type`
row, resolve the caller's **own** woreda internally (never a client
parameter), require `status = 'active'` and `effective_from <= current_date`,
and **raise** — no silent fallback — if no matching active row exists. This
fail-closed design surfaced a real data gap before Stage 4 payment could be
wired to it: `00000000000054` repaired the live catalog (activated
stuck `review_required` rows, inserted missing `'Internal Re-Print'`/`'New
ID Issuance'` rows at the flat fee already in effect) and added
`bun run check:fee-catalog` to CI so the catalog can't silently drift back
out of sync with what the resolvers expect.

The **exact-match fee guard** (`validate_credential_fee_amount()`, generic
across all three fee-bearing payment types since migration 65) requires a
recorded payment's `amount` to equal the resolved fee **exactly** — no
tolerance band, no cashier discretion. The sole sanctioned bypass is an
explicit waiver (`waived = true`, `amount = 0`, a waiver reason of at least
5 characters, and — restored by migration 66 after an initial gap —
supervisor-level authorization for that module). Migration 66 also fixed the
guard to resolve fees against the **linked request's own** `woreda_id`
rather than the calling session's, closing a cross-tenant/super-admin edge
case.

The **zero-fee rule**: a free service (fee resolves to `0`) still writes a
real `payment` row and a real `receipt` row — the pipeline never skips
payment recording just because nothing is owed. Live-probed for both civil
registration and service requests (`docs/remediation-report.md`); the
`age_identity_mint_guard` probes added in Task 8 reuse the same pattern for
the credential module.

### Deploy mechanism of record

`supabase db push`/`db diff` are non-functional in this project for two
independent, permanent reasons (both detailed in CLAUDE.md's "Database
migrations" and ".claude/skills/fsm-migration/SKILL.md"): the live database
has no `supabase_migrations.schema_migrations` table (the original schema
was built through the Supabase dashboard, before migration files existed),
and Postgres ports 5432/6543 are blocked from every sandboxed agent
environment this project is developed in (port 443 to the same host is
open, confirming this is a port policy, not a Supabase-side problem).

The mechanism of record instead is the **Management API over HTTPS**,
three phases: write the migration additively (no `DROP`; trigger/function
bodies only via `CREATE OR REPLACE`; a status `CHECK` extension must be a
strict superset), **dry-run** it wrapped in `BEGIN; … ROLLBACK;` against the
live project (payload built with a real JSON serializer — migration SQL's
dollar-quoted function bodies break naive shell-escaping), then **apply** the
same SQL without the rollback and **verify by querying**
`information_schema`/`pg_policies`/`pg_constraint` directly — never inferred
from "the apply call returned success." `curl`, never Python's `urllib`:
Cloudflare returns `403` code `1010` specifically for the `Python-urllib`
User-Agent on an otherwise-identical request with the same token — confirmed
empirically, not assumed.

A workflow/FSM migration and its frontend are **one deploy unit, not two
independently-schedulable ones** — the D-2 rollout above is the concrete
incident record for why: landing the schema change before the frontend that
expects it broke live credential processing until a temporary re-seed
migration restored the old behavior.

### Verification methodology

Every verification claim in `docs/remediation-report.md` carries one of a
fixed set of evidence-class tags — never an unqualified "verified":

| Tag                      | Meaning                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `LIVE-PASS`              | A direct, non-rollback-wrapped API/RPC call against production, confirmed correct.                                            |
| `LIVE-PROBE`             | A `BEGIN…ROLLBACK`-wrapped behavioral probe (`scripts/verify-live-probes.sql`), net-zero verified against production.         |
| `SAMPLE-DATA`            | Verified via committed-then-cleaned real writes (not rolled back) — used when the effect under test only manifests on commit. |
| `OWNER-SMOKE`            | Requires a real authenticated browser session this agent cannot mint; performed and reported by the system owner.             |
| `STRUCTURAL`             | A read-only catalog/row-count check against the live database.                                                                |
| `CI-COVERED`             | Already enforced by an automated CI gate on every PR; not re-verified live here.                                              |
| `UNVERIFIED-with-reason` | Not checked, with a stated reason — never a silent gap.                                                                       |

Two constraints shaped this taxonomy, both owner decisions rather than
engineering shortcuts. **Staging was declined**: the one attempted
staging-project creation call failed cleanly at the account's free-tier
project cap, with no side effects (no project, no charge, no orphaned
resource) — provisioning a real second Supabase+Vercel project remains a
deliberate, costed go-ahead the owner has not yet given (see
`docs/staging-runbook.md`), not something to trigger opportunistically.
**In-session session-minting is blocked**: minting a real browser session
via the Management API's `generate_link` would require revealing the anon
key, which this environment's permission classifier declines.

The standardized substitute for both is **claims-impersonation** inside a
rollback-wrapped transaction: `SET LOCAL role authenticated` drops the raw
Management-API session's default `rolbypassrls = true`, and
`SET LOCAL request.jwt.claim.sub = '<uuid>'` makes `auth.uid()` resolve to a
real, specific user, so `get_user_woreda_id()`/`user_has_perm()` evaluate
exactly as they would for that person's own real session — both settings
reset when the transaction rolls back. This, plus a real owner smoke-pass on
the actual UI for anything the database layer can't observe on its own, is
the standard verification method for this project going forward, not an ad
hoc substitute for a staging environment this project doesn't have.

### DMARC and deliverability posture

The first real (non-synthetic) invite email sent during Task 14-A's
verification pass delivered correctly but landed in spam — diagnosed as an
SPF/DKIM/DMARC alignment gap for the sending domain through its mail relay,
a DNS-zone fix outside this repo's own code or migrations. The owner later
confirmed the fix (raw `Authentication-Results` header showing
`dkim=pass`, `spf=pass`, `dmarc=pass`) — but the domain's current DMARC
policy is `p=none`, which only **monitors** alignment; it does not yet
**enforce** it, so a forged sender claiming the domain would still reach an
inbox today. This is a deliberate ramp-in-progress, not a finished state:
the go-live plan's watch list carries the ramp to `p=quarantine` then
`p=reject` after a clean monitoring period.

### Branch protection and CI enforcement

Branch protection on `main` is owner-configured (GitHub Settings, never a
repo file this session can change) and only partially independently
corroborable from inside a session: a required-approving-review rule is
confirmed live via this project's own repeated experience attempting to
merge a PR with only a plain comment (not a submitted GitHub review) —
`405 At least 1 approving review is required by reviewers with write
access` — but sub-rules like stale-approval dismissal, conversation-resolution-required,
and no-administrator-bypass are owner-reported, not independently
provable from a single blocked-merge observation, and are recorded as such
rather than overclaimed. CI itself (`.github/workflows/ci.yml`) runs on
every PR and push to `main`: lint, build (regenerates
`src/routeTree.gen.ts` before typecheck needs it), `tsc --noEmit`, the full
test suite, `check:role-perms-drift`, `check:fee-catalog`,
`check:service-type-catalog`, and `generate-permissions-doc.ts --check` —
all required to pass before a PR is even mergeable, independent of the
review requirement above.

## Related documents

- [`docs/security-hardening.md`](./security-hardening.md) — the Cloudflare-capability
  equivalence table and what's still a manual dashboard action.
- [`docs/erd.md`](./erd.md) — the data model this architecture sits on top of.
- [`docs/api-security.md`](./api-security.md) — every Edge Function and RPC,
  categorized Public/Private/Internal.
- [`docs/dfd.md`](./dfd.md) — how data actually flows through this topology
  for the four flows that touch PII or money.
- [`docs/brief-reconciliation-memo.md`](./brief-reconciliation-memo.md) —
  full detail on the six governing-brief corrections.
- [`docs/go-live-declaration.md`](./go-live-declaration.md) — the
  production-readiness declaration this decision record supports.
