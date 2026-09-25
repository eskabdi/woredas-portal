# Security functionality document

INSA Enforcer Phase 4. Existing documentation already covers two of the five
sections in depth for other reasons — this document links to those rather
than duplicating them, and fills in the three that had no dedicated write-up.

## Access control (RBAC/ABAC)

Covered in depth by [`docs/rbac-security-forensic-review.md`](./rbac-security-forensic-review.md)
(findings F1–F11) and [`docs/rbac-remediation-tracker.md`](./rbac-remediation-tracker.md).
Summary for this document's purposes:

Two independent gates, both have to be right:

1. **Client-side**: `<PermissionGate permission={P.X}>` gates UI and route
   access, reading `hasPermission` off the zustand auth store
   (`src/stores/authStore.ts`), populated at sign-in by the
   `current_permissions()` RPC.
2. **Database-side**: `user_has_perm(_perm)` gates what a query can actually
   return — this is the real enforcement point; the client-side gate is UX,
   not security.

Both resolve the same three-layer chain, in order: a per-user
`user_permission_override` (wins in both directions), then a per-tenant
`role_permission` override, then the compiled `default_role_perms()`
baseline. See [`docs/permissions-matrix.md`](./permissions-matrix.md) for
the generated, always-current compiled matrix, and
[`docs/erd.md`](./erd.md#tenancy--rbac) for the tables involved.

A second, independent dimension (`console_role`/`console_role_permission`)
scopes what an individual `super_admin` can do inside `/admin` — see the
same ERD section.

## Input validation strategy

Two independent layers, consistently applied:

1. **Client-side — Zod schemas via React Hook Form** (`zodResolver`), used
   in 14 route files: `login.tsx`, `set-password.tsx`,
   `woreda.residents.new.tsx`, `woreda.residents.$residentId.edit.tsx`,
   `woreda.households.new.tsx`, `woreda.households.$householdId.edit.tsx`,
   `woreda.credentials.new.tsx`, `woreda.rental-houses.new.tsx`,
   `woreda.rental-houses.$houseId.edit.tsx`,
   `woreda.settings.woreda-configuration.tsx`, and the four civil-event forms
   (`woreda.civil.birth.new.tsx`, `.death.new.tsx`, `.divorce.new.tsx`,
   `.marriage.new.tsx`). Representative examples:
   - `login.tsx`: `email: z.string().email(...)`, `password: z.string().min(6, ...)`.
   - `woreda.credentials.new.tsx`: `resident_id: z.string().uuid(...)`,
     `request_type`/`credential_type` constrained to `z.enum([...])`,
     `notes: z.string().max(2000).optional().nullable()`.
2. **Database-side — CHECK constraints and enums**, independent of and not
   reliant on the client ever running (a direct PostgREST call bypasses the
   form entirely). Every workflow `status` column is a `CHECK ... = ANY
(ARRAY[...])` enum (see [`docs/erd.md`](./erd.md) for the exhaustive
   list per table); `resident.email` has a regex format check
   (`resident_email_format`); `payment.amount` and `rental_occupancy.rent_amount`
   both require `> 0`.

Both layers are allow-list validation (enums, regex, explicit type/format),
matching the Enforcer's requirement — nothing here is a deny-list/blocklist
approach.

## Session & cookie logic

- **Transport**: bearer JWT via the `Authorization` header, not a cookie.
  `src/integrations/supabase/client.ts` configures `auth.storage: localStorage`,
  `persistSession: true`, `autoRefreshToken: true`. No `Set-Cookie` header is
  ever issued by this app (confirmed — `src/server.ts` and
  `src/lib/security-headers.ts` set no cookies; the app's one `document.cookie`
  use, in `src/components/ui/sidebar.tsx`, is a UI preference, unrelated to
  auth).
- **Why CSRF tokens are correctly absent**: a cookie-based session is sent
  automatically by the browser on every request to the cookie's origin,
  which is what makes a forged cross-site request dangerous. A bearer token
  in an explicit header is not attached automatically by the browser to any
  request this app didn't itself construct, so there is no ambient
  credential for a forged request to ride on.
- **Session regeneration**: handled entirely by Supabase Auth's own
  refresh-token rotation (`autoRefreshToken`); this app does not implement
  its own token-regeneration logic.
- **Idle/inactivity timeout** (shipped in INSA remediation Phase B): 20
  idle minutes shows a warning toast with a "stay signed in" action, 25
  idle minutes forces sign-out — within the Enforcer's 15–30 minute band.
  Implemented by `src/hooks/useIdleTimeout.ts` (constants in
  `src/config/idleTimeout.ts`), mounted once per portal in
  `WoredaShell.tsx`/`AdminShell.tsx`, reusing each shell's existing
  sign-out path. Mechanics worth knowing: activity is an absolute
  timestamp checked on a 15-second interval (so a laptop waking from
  sleep past the limit is caught immediately, where a long `setTimeout`
  would never have fired), reading with scroll/wheel counts as activity
  (capture-phase listeners — the shells' scroll containers don't bubble),
  and the last-activity timestamp is shared across tabs via
  `localStorage`, so an idle background tab cannot end a session someone
  is actively using in another tab (supabase-js broadcasts sign-out to
  every tab). Timeout length is compiled-in for v1; a per-tenant
  `woreda_settings` value remains a future enhancement.

## Encryption in transit

Covered by [`docs/security-hardening.md`](./security-hardening.md): TLS 1.2+
enforced end to end, Vercel auto-provisions and renews certificates, and
`Strict-Transport-Security` (2 years, `includeSubDomains`) is set on every
response by `src/lib/security-headers.ts`.

## Encryption at rest

INSA Enforcer 1.3 / 3.9. Implemented by
`supabase/migrations/00000000000023_pii_encryption.sql` and
`00000000000024_rental_occupancy_request_decrypted_view.sql` (Phase C of the
remediation plan). **Stages 1–3 are applied to production and verified live
— see "Rollout status" below for what stage 4 still leaves plaintext.**

**Scope.** `resident.phone_number`, `resident.email`, `household.phone_number`,
`household.email`, `service_request.applicant_phone` (PII), and
`payment.amount`, `rental_occupancy.rent_amount`,
`rental_occupancy_request.rent_amount` (financial). Each gains a `*_enc bytea`
companion column; the plaintext column stays authoritative until stage 4.

**Cipher and keys.** AES-256 via pgcrypto's `pgp_sym_encrypt`. The root key is
a Supabase Vault secret named `pii_root_key`, created by hand and never
committed — the same discipline `CLAUDE.md` applies to the deploy tokens and
`HARARI_EC_PRIVATE_KEY`. **Losing it means losing the ciphertext; it is not
recoverable from a database backup.**

**Keys are derived per tenant** — `hmac(woreda_id, root_key, 'sha256')` — which
is what makes it safe to expose `decrypt_pii_text()` to `authenticated` at all.
The decrypting views must be `security_invoker = on` so the underlying table's
RLS still gates every row (the lesson of
`00000000000006_view_security_invoker.sql`), and under invoker semantics the
caller necessarily holds `EXECUTE` on the decrypt function. A per-tenant key
plus an explicit tenant check in that function means the exposed primitive is
not generic: another woreda's ciphertext is rejected by the check, and passing
your own `woreda_id` to bypass the check derives the wrong key and fails to
decrypt. A stolen dump plus one compromised staff account therefore exposes one
tenant, not the platform.

**What this does and does not protect — and its real scope.** It closes the
stolen-dump/backup case for the columns actually covered:
`resident.phone_number`/`.email`/`.national_id_no`,
`household.phone_number`/`.email`/`.rent_amount`, `service_request.applicant_phone`,
`payment.amount`, `rental_occupancy.rent_amount`,
`rental_occupancy_request.rent_amount`. `resident.national_id_no` and
`household.rent_amount` were originally left plaintext — the first migration's
own header comment recorded both as known gaps (`national_id_no` a stronger
identifier than the phone number already covered; `household.rent_amount` an
oversight next to `rental_occupancy.rent_amount`, which was in scope from the
start) — and Task 6 (fix-task-production-readiness-v3) closed both, same
per-tenant-key design, in
`00000000000044_task6_household_rent_national_id_pii.sql`.
Vault's root key is held outside the database, so a dump yields ciphertext for
those fields — **not "the database's PII" as a whole**. Still left plaintext
on the same rows: `full_name`, `date_of_birth`, `father_name`,
`mother_full_name`, `birth_place`, `work_info`, `former_residence`;
`household.address_line`, `gps_lat`/`gps_lng`; `service_request`'s
`applicant_name`, `details`, `incident_place`, `fee_amount`; and
`issued_letter_html`, which renders a resident's name and address into stored
HTML. A stolen dump still yields near-complete civil-registration PII per
resident; this migration materially narrows what it exposes for the
highest-sensitivity identity, contact and financial fields, it does not make a
dump safe to lose. It also deliberately does **not** protect against a
compromised staff session reading its own tenant's data — that user can
already read that PII legitimately. RLS remains the tenant boundary; this
sits under it.

**Search tradeoff — a real, user-visible behaviour change.** A randomized
ciphertext cannot be searched, so `resident.phone_number` and, since Task 6,
`resident.national_id_no` each carry a deterministic blind index (HMAC under
the same per-tenant key) alongside their `_enc` column. This makes
**exact-match** lookup work and partial/substring lookup impossible: the
residents list page's `.ilike` "starts with 091…" / "starts with 1234…"
search cannot survive either cutover, and a staff member typing a partial
number or partial ID will get zero results on that field rather than a
filtered list (name, Amharic name and resident number still match on partial
input). That is a deliberate accepted cost, not an oversight — it is called
out here, in each migration's own header, and in the remediation plan.

Phone numbers are normalized before hashing so the formats staff actually
type fold together — `0911223344`, `+251 91 122 3344`, `251911223344` and
`911223344` all index as the 9-digit national significant number; anything
unrecognisable is indexed as its own digit string (`normalize_phone()`,
pinned explicitly and covered by the dry run, since getting this rule wrong
fails _silently_ — the resident simply is not found). National ID numbers get
no equivalent normalization (`national_id_blind_index()` only trims
whitespace) — there is no documented "same ID, different spelling" problem
for this field the way there is for phone numbers, and inventing a
normalization rule not asked for risks silently folding together IDs that
are not actually the same.

**Rollout status.**

| Stage | What                                                                                                                                               | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Columns, crypto functions, sync triggers, decrypting views                                                                                         | **Applied to production**                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2     | Create the Vault secret, backfill existing rows                                                                                                    | **Applied to production** — all pre-existing rows backfilled, verified via `pii_encryption_status()`                                                                                                                                                                                                                                                                                                                                                                           |
| 3     | Move read paths onto the `*_decrypted` views, call site by call site                                                                               | **Applied to production** — every application read call site now uses the decrypted view, verified live against production data; `00000000000024_...sql` (a sixth decrypting view, `rental_occupancy_request_decrypted`, closing a gap stage 1 left) is applied; `00000000000044_task6_...sql` (Task 6) added `resident.national_id_no` and `household.rent_amount` to the same rollout, cutting every read/search/duplicate-check call site over in the same migration series |
| 4     | Drop plaintext columns (separate migration, after burn-in) — the amount>0 guard's stage-4 mechanism is a genuinely open decision, not yet resolved | Not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Stage 3 notes.** The residents-list search (`woreda.residents.index.tsx`)
changed from `.ilike` substring matching to an exact match against a
deterministic blind index for both `phone_number` (`my_phone_blind_index`
RPC) and, since Task 6, `national_id_no` (`my_national_id_blind_index` RPC) —
two disclosed, intentional UX regressions: a staff member searching a partial
phone number or partial national ID now gets no match on either field (name,
Amharic name and resident number still match on partial input). The
duplicate-ID check in the resident wizard (`ResidentWizardSteps.tsx`) moved
from `.eq('national_id_no', ...)` to the same blind index for the same reason
— it was already an exact match, so nothing about that check's behavior
changed, only which column it reads. `household.rent_amount` is no longer a
gap: `00000000000044_task6_household_rent_national_id_pii.sql` brought it into
scope the same way `rental_occupancy.rent_amount` always was, with no search
tradeoff (it's a display-only numeric field, never filtered on).

**NULL-decrypt fallback policy, by field type.** A decrypt failure (Vault
secret rotated/absent, corrupt ciphertext) returns NULL, not an error — stage
1's fail-soft design. What a read call site does with that NULL differs
deliberately by field type: **financial reads fall back to the still-present
plaintext column** (`amount_decrypted ?? amount`, consistently across the
dashboard, revenue, reports and credential-payment call sites) so a decrypt
failure degrades a number on screen rather than silently reporting zero/wrong
revenue. **PII text reads on display-only pages fail closed** (render "—"),
since showing nothing is preferable to a wrong-looking blank field being
mistaken for "not recorded." **The two edit forms** (resident and household)
are the one place a NULL decrypt is genuinely destructive rather than
cosmetic — the form would otherwise pre-fill an empty phone/email/national
ID/rent amount, and saving overwrites the still-good plaintext with it — so
those also fall back to plaintext, matching the financial policy. The
printed ID card (`woreda.credentials.$requestId.print.tsx`) applies the same
policy to `national_id_no` for the same reason a display-only page would
normally fail closed: a physical card is expensive to reissue, so a
transient decrypt failure falls back to the still-present plaintext rather
than printing a blank ID field. At stage 4, once plaintext columns are
dropped, every one of these fallbacks needs to become a hard, visible error
instead: there will be no plaintext left to fall back to.

Stage 1 is inert by design: until the Vault secret exists, `encrypt_pii_*()`
returns NULL and the sync triggers write NULL rather than raising, so applying
the migration cannot break live writes. `pii_encryption_status()` (callable by
`service_role` and, indirectly, by an operator with database access) reports
whether the key is present and how far the backfill has got — check it rather
than assuming. `./scripts/run-phase-c-dryrun.sh <ref>` re-runs the full
verification suite inside a rolled-back transaction.

## Logging

**What is logged:**

- Generic error logging (`console.error`) in a small, fixed set of files —
  `src/integrations/supabase/client.ts`, `client.server.ts`,
  `auth-middleware.ts`, `src/server.ts`, `src/start.ts`,
  `src/routes/__root.tsx` — all configuration/SSR error-boundary logging,
  none of it logging credentials, tokens, or form payloads.
- `audit_log` table entries, written explicitly by 5 of the 6 Edge Functions
  on state-changing actions (`sign-credential`, `invite-tenant-user`,
  `invite-platform-admin`, `resend-platform-invite`, `activate-invited-user`)
  — actor, entity, action type, and a narrow before/after JSON diff.
  `record-login` deliberately does **not** write an audit row for every
  login (would be pure noise against an admin-action-focused trail); it
  only updates `app_user.last_login_at`.
- Supabase's own platform-level logs (Edge Function invocation logs, Auth
  logs) — operated by Supabase, not this repo.

**What is never logged, by design:**

- Passwords, in any form — this app never sees a plaintext password outside
  the browser's own request to Supabase Auth; nothing in application code
  handles or logs one.
- Full PII payloads — `audit_log.new_value_json`/`old_value_json` carry
  narrow, action-specific fields (e.g. `{ email, role, full_name }` on an
  invite), not a full resident/household record dump.
- Raw JWTs or the Supabase service-role key — read from environment
  variables at call time, never printed; see CLAUDE.md's credential-hygiene
  rules, which this section follows for logging the same way that document's
  rules govern deploy tokens.
- Raw driver/exception text in HTTP response bodies — since Phase B, every
  Edge Function error path routes through `safeError()`
  (`supabase/functions/_shared/response.ts`), which logs the real error
  server-side (Supabase captures function logs) and returns only a fixed
  string from the client-side translation table.

One logging addition from Phase B: `audit_log.source_ip` — a column that
existed since the baseline but was never written — is now populated
best-effort by all five audit-writing Edge Functions via
`_shared/clientIp.ts`. It is informational only (forwarded-for headers are
spoofable by a direct caller), which is also why the rate limiter below
keys on the verified caller identity, never on IP.

**Gap closed (INSA finding 3.6, Phase B)**: fourteen error paths across the
six Edge Functions used to interpolate raw driver/exception text (Postgres
error messages, GoTrue rejections, caught `.message` strings) into their
JSON response bodies, plus one 409 that echoed a status enum value. All now
return fixed strings via `safeError()`; the one deliberately-preserved
distinction is GoTrue's duplicate-email rejection, mapped to the existing
reviewed `"User already registered"` copy so an admin can still tell "this
person already has an account" apart from "sending failed". The three
invite functions additionally answer `429 Too many requests` past a
per-caller budget (20 or 10 calls per 10 minutes, keyed by verified
`user_id` against `rate_limit_bucket` — migration `00000000000022`).

## RLS & trigger inventory (live-verified)

Every other section above documents _what_ is enforced and _why_; this
section is the raw count, taken by read-only enumeration of the production
schema (Task 8, 2026-09-14 — `information_schema`/`pg_catalog` queries over
the Management API, the same method `docs/erd.md`'s live re-verification
used, per the reason recorded in `docs/architecture.md`'s decision record).

| Metric                                 | Live count |
| -------------------------------------- | ---------- |
| Tables in `public` schema              | 52         |
| Tables with row-level security enabled | 52 (100%)  |
| RLS policies                           | 139        |
| Triggers                               | 144        |
| `SECURITY DEFINER` functions           | 88         |

Every table has RLS enabled — there is no table in this schema a query can
read or write without going through a policy. The policy count (139) is
lower than an earlier estimate of "156+" carried in prior planning
documents; the earlier figure was a projection made before several of the
Task 11 gap-fill tables (`office`, `household_location`, `approval`,
`attachment`) and the Task 12-C offline-queue work (which added zero new
tables or policies — it is entirely client-side) were designed, so it
should not be read as a target this count fell short of. This table is the
current, corrected figure, not a discrepancy to investigate.

`SECURITY DEFINER` functions are the highest-risk category in this
inventory precisely because they run with the function owner's privileges,
bypassing RLS for whatever they touch — every one of the 88 has been the
subject of at least one review pass in this project's history (the console
role/permission functions, `current_permissions()`, the fee-resolution
RPCs, the KPI RPCs, `entity_belongs_to_woreda()` and its Task-11 sibling
functions, the verification RPCs) specifically for whether it re-derives
its own tenant/permission scope internally rather than trusting a
caller-supplied parameter — see `docs/rbac-security-forensic-review.md` and
the individual task mapping memos (`docs/task12-mapping-memo.md`,
`docs/task14a/b/c-mapping-memo.md`) for the per-function review record.

**Correction (security audit 2026-09-24, WP-VER-001).** That review record
was not complete: three `SECURITY DEFINER` functions looked up a row by a
caller-controlled key with no woreda predicate —
`generate_resident_on_birth_approval()` (copied a mother's ethnicity,
religion and household from any woreda into a new child resident),
`rental_eligibility()` (answered for any woreda's resident, and was still
executable by `anon`) and `get_credential_live_status()` (a cross-tenant
credential-status oracle for every authenticated user). Migration
`00000000000090_p0_2_definer_woreda_scope.sql` pins every such lookup to the
event's or caller's woreda, extends `enforce_vital_event_preconditions()` to
reject any out-of-woreda resident or household reference on every civil
event type, revokes `rental_eligibility()` from `anon`, and retires
`get_credential_live_status()` (no client grant at all). So that a fourth
case cannot land unnoticed, `bun run check:definer-tenant-predicate`
(`scripts/check-definer-tenant-predicate.ts`, run in CI) statically flags
any `SECURITY DEFINER` statement that reads a tenant table without
`woreda_id`, `is_super_admin()` or `auth.uid()` in it; the pre-existing
tolerated cases are listed with their reason in the script's
`REVIEWED_BASELINE`, and the list can only shrink.

## Related documents

- [`docs/rbac-security-forensic-review.md`](./rbac-security-forensic-review.md) — full access-control history and closed escalation paths.
- [`docs/permissions-matrix.md`](./permissions-matrix.md) — the generated, current permission matrix.
- [`docs/security-hardening.md`](./security-hardening.md) — transport and header-level controls.
- [`docs/api-security.md`](./api-security.md) — per-endpoint authentication/authorization detail.
- [`docs/erd.md`](./erd.md) — the tables and constraints referenced above.
