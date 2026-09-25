# 06 — Testing Scope (INSA Phase 6)

Final version adopted by the Lead Auditor from the audit-ops-scope draft (`findings/ops-scope-testing-scope.md`), 2026-09-24 (Meskerem 14, 2019 EC). It is intended to replace `docs/testing-scope.md`, which is stale (WP-OPS-012). Covers F-01, F-02 and F-03. **Placeholders only — no real credential, token, password or key may ever be written into this document or any tracked file.**

## 1. Rules of engagement (preconditions)

1. **Testing targets staging only.** A staging Supabase project and a staging Vercel project must be
   provisioned per `docs/staging-runbook.md` before any dynamic test. **Production is out of scope
   for active testing.** It holds real residents' PII and financial records, and it has no evidenced
   backups or PITR (WP-OPS-001, WP-OPS-002). The only production activity allowed is a passive
   TLS/header check (`curl -sSI`, SSL Labs).
2. Staging runs the same migrations (00 to 89), `supabase/seed.sql` (reference data only: 6 woredas,
   19 kebeles, fees, service types, role matrix) and the same 8 Edge Functions. **Never** run
   `supabase/seed-app-users.sql` against staging, because it binds real people's accounts.
3. Staging gets its **own** `HARARI_EC_PRIVATE_KEY` (a new EC P-256 keypair) and its **own** Vault
   `pii_root_key`, and a staging build must embed the staging public key. Never reuse production key
   material.
4. `SITE_URL` (Edge) and `VITE_PUBLIC_SITE_URL` (frontend) point at the staging host. The Supabase Auth
   `uri_allow_list` contains only the staging origin (plus `http://localhost:5173` if the testers need
   it).
5. Test accounts are created **only** in staging, by the seeder (extended per §4), with a **unique
   generated password per account**. Passwords are handed to the test lead through a password manager.
   They are never committed, pasted into issues, or placed in this document.
6. Load and DoS testing is out of scope unless the owner separately authorises it against staging.
   Vercel and Supabase platform-level attacks are out of scope under the provider policies.
7. At the end of the engagement, run the teardown: delete the test users, or delete the staging
   project entirely.

## 2. Asset inventory (F-01)

`<staging-host>` = staging Vercel domain. `<staging-ref>` = staging Supabase project ref.
Production values are listed for identification only.

| # | Asset | Staging URL / endpoint | Production (identification only) | Environment | Auth surface | In scope | Primary test focus |
|---|---|---|---|---|---|---|---|
| 1 | Woreda OS web app | `https://<staging-host>/woreda/*` (57 route files) | `https://woredas-portal.vercel.app/woreda/*` | Staging | GoTrue email+password → JWT (localStorage), 8 tenant built-in roles + `custom`; `PermissionGate`/`ModuleGate` client-side | **Yes** | Client-gate vs RLS divergence, IDOR via route params (`$residentId`, `$householdId`, `$requestId`, `$eventId`, `$houseId`, `$occupancyId`, `$paymentId`), offline queue/SW PII at rest, XSS in letter templates |
| 2 | Super Admin Console | `https://<staging-host>/admin/*` (8 route files) | `…/admin/*` | Staging | `super_admin`; `console_role_id` NULL = unrestricted, else `CP` perms | **Yes** | CP gate bypass (routes without a gate: dashboard, tenants index, credential-template), tenant provisioning, template upload |
| 3 | Auth pages | `/login`, `/set-password`, `/` (invite/recovery `token_hash` handling) | same paths | Staging | Anonymous → session | **Yes** | Brute force / rate limit, CAPTCHA absence, recovery and invite token handling, open redirect, session timeout (20/25 min idle) |
| 4 | Supabase Auth (GoTrue) | `https://<staging-ref>.supabase.co/auth/v1/*` | `https://<prod-ref>.supabase.co/auth/v1/*` | Staging | anon key; password grant; admin endpoints service-role only | **Config only** (platform code inherited) | Password policy, JWT expiry/refresh rotation, sign-up disabled, redirect allow-list, rate limits |
| 5 | PostgREST data API | `https://<staging-ref>.supabase.co/rest/v1/<table>` | same shape | Staging | anon key + JWT; RLS on 66 tables, 17 `security_invoker` views | **Yes (primary)** | Cross-woreda reads/writes, status bypass (pending/suspended users, WP-DB-001), read-permission gaps (WP-DB-004), direct status PATCH vs FSM, `WITH CHECK` row migration, anon DML grants |
| 6 | RPCs | `…/rest/v1/rpc/<fn>` (64 functions; about 22 called by the client) | same | Staging | JWT; SECURITY DEFINER with tenant re-check | **Yes** | Fee resolvers, settle/reverse rental payments, KPI/report RPCs (cross-tenant), `rental_eligibility` / `get_credential_live_status` (WP-DB-009/010), decrypt functions |
| 7 | Public verification: credential | `https://<staging-host>/v/$token` → `verify_credential_token` | `…/v/$token` | Staging | **Anonymous** | **Yes** | Enumeration, rate limit (30/60 s claim), PII disclosure in response, signature algorithm pinning, revoked-card handling |
| 8 | Public verification: letter | `/verify/letter/$token` → `verify_service_letter` | same | Staging | **Anonymous** | **Yes** | Token guessability (WP-DB-013), status disclosure, no rate limit |
| 9 | Public verification: receipt | `/verify/receipt/$token` → `verify_receipt` | same | Staging | **Anonymous** | **Yes** | As #8; voided-receipt handling |
| 10 | Edge Function `sign-credential` (QR signing) | `https://<staging-ref>.supabase.co/functions/v1/sign-credential` | same shape | Staging | JWT → `getUser`; `status='active'`; `user_has_perm('credential.print')` + woreda match; reads all fields from DB | **Yes** | Cross-woreda signing, re-sign of revoked or non-`ready_to_print` credential, payload canonicalisation, key never in response |
| 11 | Edge Function `invite-tenant-user` | `…/functions/v1/invite-tenant-user` | same | Staging | JWT; active tenant_admin of target woreda or super_admin; role allow-list; rate-limited | **Yes** | Invite into another woreda, invite of tenant_admin/super_admin, redirect injection |
| 12 | Edge Function `invite-platform-admin` | `…/functions/v1/invite-platform-admin` | same | Staging | JWT; super_admin; rate-limited | **Yes** | Non-super caller, console-role restriction honoured? |
| 13 | Edge Function `resend-platform-invite` | `…/functions/v1/resend-platform-invite` | same | Staging | JWT; active super_admin; 10/600 s | **Yes** | Target restriction, e-mail bombing |
| 14 | Edge Function `resend-tenant-invite` | `…/functions/v1/resend-tenant-invite` | same | Staging | JWT; active tenant_admin/super_admin; staff-role allow-list | **Yes** | Cross-woreda target |
| 15 | Edge Function `activate-invited-user` | `…/functions/v1/activate-invited-user` | same | Staging | Caller's own JWT only; `pending → active` | **Yes** | Re-activation of suspended/inactive accounts, body-supplied `user_id` ignored |
| 16 | Edge Function `record-login` | `…/functions/v1/record-login` | same | Staging | Caller's own JWT | **Yes** | Writing another user's `last_login_at` |
| 17 | Edge Function `send-password-reset-link` | `…/functions/v1/send-password-reset-link` | same | Staging | JWT; active tenant_admin/super_admin of target's woreda; staff targets only; target must be active | **Yes** | Reset of admin accounts, cross-woreda, e-mail enumeration |
| 18 | Storage | `https://<staging-ref>.supabase.co/storage/v1/object/*`, 10 private buckets (below) | same | Staging | JWT; policies keyed on `storage_path_woreda_id(name)` | **Yes** | Cross-woreda path access, overwrite of signatures/stamps/logos by low-privilege roles (WP-DB-002), MIME/size bypass on 7 unrestricted buckets, SVG/HTML upload, signed-URL lifetime |
| 19 | Frontend SSR shell and headers | `https://<staging-host>/` | `https://woredas-portal.vercel.app/` | Staging (+ passive prod header/TLS check) | none | **Yes** | CSP (`'unsafe-inline'` script), HSTS, framing, error-page leakage |
| 20 | Service worker and offline queue | `public/sw.js`, `src/lib/offlineQueue.ts` (browser) | — | Staging | n/a | **Yes** | PII persisted in `localStorage`, cross-user residue on shared workstations, sign-out sweep |
| 21 | Vercel preview deployments | `woredas-portal-<hash>-woreda.vercel.app` | — | Preview | Vercel Deployment Protection (unverified) | **Config only** | Preview protection enabled; previews not wired to production keys (WP-OPS-005) |

Buckets (row 18): `credential-request-documents`, `credential-templates` (platform-level;
super-admin write; bare path by design), `rental-request-documents`, `resident-clearance-letters`,
`resident-photos`, `service-request-documents`, `tenant-assets`, `resident-documents` (PDF-only,
10 MB), `staff-assets`, `attachments`.

**Out of scope:**
- Vercel and Supabase platform infrastructure (inherited; provider policies).
- Google Fonts and OSM tile servers.
- The SMTP relay provider.
- GitHub.
- Physical card printers.
- Social engineering.
- Volumetric DoS.
- Anything in the production data plane beyond the passive TLS/header check.

Note for the Edge Function tests: whether the Supabase gateway enforces `verify_jwt` on the deployed
functions is indeterminate from the repository. `config.toml` has no `[functions.*]` block and the
deploy script passes no `--no-verify-jwt`. Testers should record the observed behaviour when a
request carries no `Authorization` header.

## 3. Privilege levels (INSA "Admin / User / Guest" mapping)

| INSA level | This system |
|---|---|
| Admin | `super_admin` (unrestricted and console-role-restricted), `tenant_admin` |
| Privileged user | `supervisor`, `civil_registrar`, `finance_clerk`, `print_officer`, custom role with approve grants |
| User | `registry_clerk`, `auditor`, `viewer`, custom role with minimal or zero grants |
| Guest | Anonymous visitor (public verification routes, login page, anon key on PostgREST) |
| Negative states | Any role with `app_user.status` in (`pending`, `suspended`, `inactive`) |

## 4. Test-account matrix (F-02) — placeholders only, staging only

Two tenants are needed so that isolation can be tested: **Woreda A = Aboker**
(`81ac2ad6-a320-4069-b8dc-0c43e358371b`) and **Woreda B = Abadir**
(`b0d23d2d-53e3-4d43-9b8e-05d38150f13c`), both seeded by `supabase/seed.sql`. Each account gets its
own generated password (`<generated at seed time — held in password manager>`). E-mails use the
reserved `example.com` domain.

| # | Account (placeholder e-mail) | Role | Woreda | Status | `console_role_id` / custom role | Purpose |
|---|---|---|---|---|---|---|
| 1 | `stg-super-unrestricted@example.com` | super_admin | — (NULL) | active | NULL (unrestricted) | Platform console, tenant provisioning |
| 2 | `stg-super-restricted@example.com` | super_admin | — | active | `<console role with AUDIT_VIEW only>` | CP gate enforcement at DB and Edge |
| 3 | `stg-tadmin-a@example.com` | tenant_admin | A | active | — | Tenant admin boundary, settings, invites |
| 4 | `stg-tadmin-b@example.com` | tenant_admin | B | active | — | Cross-tenant admin actions A↔B |
| 5 | `stg-civreg-a@example.com` | civil_registrar | A | active | — | Civil registration maker |
| 6 | `stg-civreg-b@example.com` | civil_registrar | B | active | — | Cross-woreda civil (mother_resident_id, WP-DB-003) |
| 7 | `stg-clerk-a@example.com` | registry_clerk | A | active | — | Residents/households/credential intake |
| 8 | `stg-clerk-b@example.com` | registry_clerk | B | active | — | Isolation pair for #7 |
| 9 | `stg-finance-a@example.com` | finance_clerk | A | active | — | Payments, receipts, rental settlement, fee guard |
| 10 | `stg-finance-b@example.com` | finance_clerk | B | active | — | Cross-woreda payment/receipt |
| 11 | `stg-super1-a@example.com` | supervisor | A | active | — | Checker (verify/approve) |
| 12 | `stg-super2-a@example.com` | supervisor | A | active | — | **Second checker** for maker≠checker (MC-01) |
| 13 | `stg-supervisor-b@example.com` | supervisor | B | active | — | Cross-woreda approval attempt |
| 14 | `stg-auditor-a@example.com` | auditor | A | active | — | Read-only audit scope; must not write |
| 15 | `stg-viewer-a@example.com` | viewer | A | active | — | Read-only baseline; decrypted-PII exposure |
| 16 | `stg-viewer-b@example.com` | viewer | B | active | — | Isolation pair for #15 |
| 17 | `stg-print-a@example.com` | print_officer | A | active | — | Print/sign path only; must not read unrelated PII (WP-DB-004) |
| 18 | `stg-custom-zero-a@example.com` | custom | A | active | `<tenant_role with zero grants>` | Fail-closed custom role |
| 19 | `stg-custom-approver-a@example.com` | custom | A | active | `<tenant_role with service.approve only>` | Custom-role grant exactness; reserved-permission denial |
| 20 | `stg-pending-a@example.com` | registry_clerk | A | **pending** | — | Must see nothing (WP-DB-001 status bypass) |
| 21 | `stg-suspended-a@example.com` | supervisor | A | **suspended** | — | Must see and do nothing; reset link refused |
| 22 | `stg-inactive-a@example.com` | finance_clerk | A | **inactive** | — | As #21 |
| 23 | `stg-override-deny-a@example.com` | registry_clerk | A | active | `user_permission_override` deny `resident.create` | Per-user deny wins over the role grant |
| 24 | *(anonymous)* | — | — | — | — | Guest: anon key only; public verify routes; PostgREST anon probes |

Minimum viable subset if time is short: rows 1, 3, 4, 7, 8, 11, 12, 15, 17, 20, 21, 24.

**Test data per woreda (synthetic, staging only):**
- At least 5 residents, including one minor and one deceased.
- 2 households.
- 1 credential at each FSM state, with one signed and printed.
- 1 birth and 1 death event.
- 2 service requests (one letter issued).
- 1 rental house with an occupancy, charges and a settled payment.
- One upload in each bucket.

Record the created IDs per woreda so testers can attempt cross-woreda access by ID.

## 5. Seeding and credential rules (F-03)

- **Allowed:** creating the accounts above in staging with `scripts/seed-staging-users.ts`, once it is
  extended to this matrix: two woredas, all roles, status variants, custom and console roles, a
  unique password per account, and a `--teardown` flag (WP-OPS-009). Keep the existing
  production-ref refusal. Add a second guard: refuse when the target contains more than a threshold
  of `resident` rows.
- **Forbidden:**
  - Any `INSERT INTO auth.users`, test e-mail or password in `supabase/migrations/*`, `seed.sql`,
    `seed-app-users.sql`, scripts, docs or `.claude/`.
  - Running the seeder, the acceptance harness or `run-live-probes.py` against production.
  - Committed test writes ("SAMPLE-DATA") in production.
  - Manual `audit_log` or `app_user` inserts in production.
- **Current state (2026-09-24):**
  - No staging project exists.
  - No test users or passwords appear in any migration. The only `auth.users` reference is the FK at
    `baseline.sql:631`.
  - `supabase/seed-app-users.sql` maps three real people's accounts and must stay production-only,
    ideally untracked (WP-OPS-010).
  - Verification has so far been done on production with real accounts (WP-OPS-001).

## 6. Deliverables expected from the test team

- Per-finding evidence: the request, the response, and the account row # from §4.
- A cross-tenant matrix for every table and RPC in rows 5 and 6, run as each of the pairs 3/4, 7/8,
  9/10 and 15/16.
- The status-variant results (rows 20-22) for every table.
- A TLS/header report for the production host (passive) and the staging host.
- Teardown confirmation: `auth.users` count in staging back to its baseline, or the staging project
  deleted.
