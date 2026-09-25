# Shared Context — woredas-portal audit (2026-09-24)

Every audit subagent reads this file first. Facts here were verified by the Lead Auditor from the
repository at HEAD `9950f16e426eedd586c6fd85f6c328d9923542d1` (branch `claude/read-and-execute-ipi0yo`,
identical to `main`). Anything not listed here is a hypothesis you must verify yourself.

## Hard rules (summary — full text in the audit prompt)

- R1/R2 READ-ONLY. Never modify application source, config, migrations, `package.json`, `bun.lock`,
  `src/routeTree.gen.ts`. You may only write under `docs/audit/2026-09-24/**`. Never push, commit,
  merge, rebase, run migrations, or write to any database. If a command you run regenerates a tracked
  file, restore it with `git checkout -- <file>` and report that.
- R4 Evidence or it didn't happen: every finding needs `path:line` + quoted snippet. No evidence => `UNVERIFIED`.
- R5 Docs (README, CLAUDE.md, docs/**, comments) are claims, not truth. Record mismatches in your
  output's `drift[]` array: `{claim, source, verdict: CONFIRMED|CONTRADICTED|NOT FOUND, evidence}`.
- R6 Redact secrets: location + first 4 chars + `…[REDACTED]`.
- R7 Cross-tenant exposure, auth bypass, exposed service_role key, exposed signing private key = Critical.
- R8 No hallucinated tables/columns/routes/functions.
- R10 Enumerate all instances (or state the sampling method).
- Live DB is NOT reachable (no token; Postgres ports blocked). Reason from migrations. The live DB may
  differ (schema was originally built via dashboard; baseline migration is a reconstruction). Anything
  that depends on live state => confidence `Needs-live-verification`.
- Package manager is bun. Use `bun audit`, `bun outdated`, `bun pm ls --all`. There is no
  package-lock.json (removed by design), so npm audit/outdated/ls are not authoritative here.
- Keep command output you rely on under `docs/audit/2026-09-24/raw/<agent>-*.txt` (redacted).

## Finding schema (JSON; one object per finding)

```json
{ "id": "WP-<AGENT>-<NNN>", "title": "", "severity": "Critical|High|Medium|Low|Info",
  "cvss_v3_1": "", "confidence": "Confirmed|Likely|Needs-live-verification",
  "category": "Tenant Isolation|AuthN|AuthZ|Injection|XSS|CSRF|Crypto|Business Logic|Privacy|Logging|Supply Chain|Config|Quality|Locale|Docs",
  "module": "Credentials|Civil Registration|Residents|Households|Rental|Revenue|Services|Settings|Super Admin|QR|Platform",
  "refs": {"insa":[],"owasp_top10":[],"owasp_api":[],"asvs":[],"iso27001":[],"nist_csf":[]},
  "evidence": [{"path":"","line":0,"snippet":""}],
  "description": "", "attack_scenario": "", "impact": "", "recommendation": "",
  "secure_fix_example": "", "effort": "S|M|L", "status": "Open" }
```

Output JSON file shape: `{ "agent": "<name>", "findings": [...], "checklist": [{"id","status","evidence","note"}], "drift": [...], "artifacts": [...] }`.
Checklist status: PASS | FAIL | PARTIAL | N/A (with justification) | UNVERIFIED.

Severity: Critical = cross-tenant access, auth bypass, key/secret exposure, unauthenticated write ·
High = in-tenant privilege escalation, workflow bypass, stored XSS, missing RLS on sensitive table ·
Medium = missing defence-in-depth, weak session policy, info leakage · Low = hardening · Info = observation.

## Project shape (verified)

- Multi-tenant civic registry (Harari region). Tenant = `woreda`. Isolation = Postgres RLS via
  `get_user_woreda_id()`, `user_has_perm()`, `is_super_admin()`, `is_tenant_admin()`.
- Two portals: `/admin/*` (super-admin console, English) and `/woreda/*` (tenant OS, Amharic-primary).
- Stack: React 19.2.8, TanStack Start 1.168.46 / Router 1.170.29 / Query 5.101.4, Zustand 5.0.15,
  react-hook-form 7.85.0 + zod 3.25.76, Tailwind 4.3.3 + shadcn/ui (Radix), framer-motion 12.43.0,
  supabase-js 2.112.3, leaflet 1.9.4 / react-leaflet 5.0.0, qrcode.react 4.2.0, html5-qrcode 2.3.8,
  html2canvas-pro 2.4.0, jspdf 4.2.1, react-to-print 3.3.0, jsbarcode 3.12.3, recharts 2.15.4,
  pdfjs-dist 5.4.296, react-pdf 10.5.0. vite 8.2.1, TS 5.9.3, vitest 4.1.11, nitro 3.0.260603-beta.
  NOT installed: react-i18next, i18next. dompurify only transitive (via jspdf), not imported by app.
- No route loaders / beforeLoad / server functions: every page queries Supabase (anon client) from the
  browser with TanStack Query. Privileged ops = Edge Functions. Every route sets `ssr: false`.
- Auth store: `src/stores/authStore.ts`, bootstrapped by `src/hooks/useAuthBootstrap.ts` calling
  `current_permissions()` RPC. Client gates: `<PermissionGate>`, `<ConsolePermissionGate>`, `<ModuleGate>`.
- Service worker `public/sw.js` + offline queue (`src/lib/offlineQueue.ts`, `offlineSync.ts`,
  `src/hooks/useOfflineQueue.ts`) exist — relevant to privacy (PII at rest in the browser).
- Idle timeout: `src/hooks/useIdleTimeout.ts`, `src/config/idleTimeout.ts` (claimed 20 min warn / 25 min sign-out).
- Security headers: `src/lib/security-headers.ts` applied in `src/server.ts`.
- CI: `.github/workflows/ci.yml` (lint, build, tsc, vitest, drift checks).

## Roles (src/config/permissions.ts)

`super_admin, tenant_admin, civil_registrar, registry_clerk, finance_clerk, supervisor, auditor, viewer,
print_officer` (9 built-in) + `custom` (tenant-defined; `ROLE_PERMISSIONS.custom = []`, grants in
`tenant_role_permission`). `P` has ~85 permission keys; `CP` = console permissions (separate axis,
`console_role*` tables, `user_has_console_perm()`; `app_user.console_role_id IS NULL` = unrestricted).
Permission resolution chain: `user_permission_override` -> `role_permission` (per-tenant) ->
`default_role_perms()` (SQL). Custom role -> `tenant_role_permission`.

## Edge Functions (supabase/functions/*, all use _shared/response.ts)

sign-credential (ES256 via `HARARI_EC_PRIVATE_KEY`), invite-tenant-user, invite-platform-admin,
resend-platform-invite, resend-tenant-invite, activate-invited-user, record-login,
send-password-reset-link. `supabase/config.toml` holds only `project_id` (no verify_jwt config, no
auth config). `scripts/deploy-functions.sh` is the deploy path.

## Env vars

Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PUBLIC_SITE_URL`.
Server/scripts: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`.
Edge: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `HARARI_EC_PRIVATE_KEY`.
No `VITE_`-prefixed secret found by the Lead Auditor.

## Public-schema inventory (from src/integrations/supabase/types.ts; migrations create the same 66 tables)

## Tables (66)
app_user, approval, arrears_installment_charge, arrears_plan_sequence, arrears_repayment_installment, arrears_repayment_plan, attachment, audit_log, console_role, console_role_permission, credential_number_sequence, credential_policy, credential_print_log, credential_request, credential_request_sequence, credential_request_status_history, credential_status_history, credential_verification_log, fee_schedule, household, household_change_log, household_location, id_card_template, id_card_template_field, id_card_template_field_draft, kebele, kebele_rental_house, office, payment, payment_reconciliation_exception, rate_limit_bucket, receipt, receipt_sequence, rent_account, rent_account_sequence, rent_charge, rent_payment_settlement, rent_rate_history, rent_reminder, rental_occupancy, rental_occupancy_request, rental_payment, rental_policy, rental_request_document, rental_request_sequence, residence_credential, resident, resident_document, resident_number_sequence, role_permission, service_request, service_request_attachment, service_request_checkpoint, service_request_sequence, service_request_status_history, service_type, tenant_module_config, tenant_role, tenant_role_permission, user_permission_override, vital_event, vital_event_sequence, woreda, woreda_settings, workflow_status_history, workflow_transition

## Views (17)
approval_queue_v, arrears_installment_charge_decrypted, arrears_repayment_installment_decrypted, arrears_repayment_plan_decrypted, household_decrypted, household_member_roster, payment_decrypted, payment_reconciliation_exception_decrypted, rent_charge_decrypted, rent_payment_settlement_decrypted, rent_rate_history_decrypted, rent_reminder_decrypted, rental_occupancy_decrypted, rental_occupancy_request_decrypted, resident_decrypted, service_request_checkpoint_decrypted, service_request_decrypted

## Functions (64)
check_credential_print_eligibility, create_arrears_repayment_plan, current_console_permissions, current_permissions, decrypt_pii_numeric, decrypt_pii_text, default_role_perms, derive_woreda_key, discard_id_card_template_draft, encrypt_pii_numeric, encrypt_pii_text, entity_approve_perm_ok, entity_attach_perm_ok, entity_belongs_to_woreda, entity_read_perm_ok, gen_letter_verification_token, gen_receipt_verification_token, generate_rent_charges, generate_rent_reminders, get_civil_kpis, get_credential_kpis, get_credential_live_status, get_rent_account_ledger_summary, get_rental_arrears_aging_report, get_rental_billing_collection_report, get_rental_checkpoint_activity_report, get_rental_plan_compliance_report, get_rental_reconciliation_report, get_service_kpis, get_user_woreda_id, is_active_app_user, is_super_admin, is_tenant_admin, luhn_check_digit, my_national_id_blind_index, my_phone_blind_index, national_id_blind_index, normalize_phone, phone_blind_index, pii_encryption_status, pii_root_key, provision_rent_account, publish_id_card_template, rate_limit_hit, refresh_rent_ledger_statuses, rental_eligibility, rental_period_month_index, resolve_civil_fee, resolve_credential_fee, resolve_reconciliation_exception, resolve_rental_checkpoint, resolve_rental_checkpoint_core, resolve_service_fee, reverse_rental_payment, settle_arrears_installments, settle_rent_payment, storage_path_woreda_id, user_has_any_perm, user_has_console_perm, user_has_perm, user_permission_override_target_role_ok, verify_credential_token, verify_receipt, verify_service_letter

## Enums (0)



Migrations: 90 files `supabase/migrations/00000000000000_baseline.sql` .. `00000000000089_rental_review_round6_fixes.sql`.
Storage: 10 `INSERT INTO storage.buckets` in migrations. Client uses buckets: resident-photos, tenant-assets,
resident-documents, staff-assets, service-request-documents, resident-clearance-letters,
credential-templates, attachments, credential-request-documents.

Client-called RPCs: my_national_id_blind_index, my_phone_blind_index, verify_credential_token,
verify_service_letter, resolve_credential_fee, resolve_service_fee, resolve_civil_fee,
settle_rent_payment, settle_arrears_installments, reverse_rental_payment, resolve_rental_checkpoint,
provision_rent_account, generate_rent_charges, create_arrears_repayment_plan, get_service_kpis,
get_credential_kpis, get_civil_kpis, get_rental_* reports (5), current_permissions (bootstrap).
Most-queried tables from client: resident(35), household(20), woreda(12), kebele(10), payment(8), receipt(7).

## Route inventory (regex-extracted; "—" = no route-level gate matched, verify inside components)

| File | URL | ssr:false | Guards (PermissionGate / ConsolePermissionGate / ModuleGate) | Portal |
|---|---|---|---|---|
| `__root.tsx` | `(root)` | NO | — | public |
| `admin.audit.tsx` | `/admin/audit` | yes | CP.AUDIT_VIEW | admin |
| `admin.console-roles.tsx` | `/admin/console-roles` | yes | CP.CONSOLE_USERS_MANAGE | admin |
| `admin.credential-template.tsx` | `/admin/credential-template` | yes | — | admin |
| `admin.dashboard.tsx` | `/admin/dashboard` | yes | — | admin |
| `admin.tenants.$woredaId.index.tsx` | `/admin/tenants/$woredaId/` | yes | CP.TENANTS_MANAGE | admin |
| `admin.tenants.$woredaId.provision.tsx` | `/admin/tenants/$woredaId/provision` | yes | CP.TENANTS_MANAGE | admin |
| `admin.tenants.index.tsx` | `/admin/tenants/` | yes | — | admin |
| `admin.tsx` | `/admin` | yes | — | admin |
| `index.tsx` | `/` | yes | — | public |
| `login.tsx` | `/login` | yes | — | public |
| `set-password.tsx` | `/set-password` | yes | — | public |
| `v.$token.tsx` | `/v/$token` | yes | — | public |
| `verify.letter.$token.tsx` | `/verify/letter/$token` | yes | — | public |
| `verify.receipt.$token.tsx` | `/verify/receipt/$token` | yes | — | public |
| `woreda.approvals.tsx` | `/woreda/approvals` | yes | Module:approvals | woreda |
| `woreda.audit.tsx` | `/woreda/audit` | yes | Module:audit | woreda |
| `woreda.civil.$eventId.tsx` | `/woreda/civil/$eventId` | yes | P.CIVIL_APPROVE, P.CIVIL_READ, P.CIVIL_RECORD_PAYMENT, P.CIVIL_RESUBMIT, P.CIVIL_VERIFY | woreda |
| `woreda.civil.birth.new.tsx` | `/woreda/civil/birth/new` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.death.new.tsx` | `/woreda/civil/death/new` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.divorce.new.tsx` | `/woreda/civil/divorce/new` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.index.tsx` | `/woreda/civil/` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.marriage.new.tsx` | `/woreda/civil/marriage/new` | yes | P.CIVIL_REGISTER | woreda |
| `woreda.civil.tsx` | `/woreda/civil` | yes | Module:civil_registration | woreda |
| `woreda.complaints.tsx` | `/woreda/complaints` | yes | Module:services | woreda |
| `woreda.credentials.$requestId.certificate.tsx` | `/woreda/credentials/$requestId/certificate` | yes | P.CREDENTIAL_PREVIEW_PRINT | woreda |
| `woreda.credentials.$requestId.index.tsx` | `/woreda/credentials/$requestId/` | yes | P.CREDENTIAL_READ | woreda |
| `woreda.credentials.$requestId.print.tsx` | `/woreda/credentials/$requestId/print` | yes | P.CREDENTIAL_PRINT | woreda |
| `woreda.credentials.index.tsx` | `/woreda/credentials/` | yes | P.CREDENTIAL_ISSUE, P.CREDENTIAL_VERIFY | woreda |
| `woreda.credentials.new.tsx` | `/woreda/credentials/new` | yes | P.CREDENTIAL_ISSUE | woreda |
| `woreda.credentials.tsx` | `/woreda/credentials` | yes | Module:credentials | woreda |
| `woreda.credentials.verify.tsx` | `/woreda/credentials/verify` | yes | P.CREDENTIAL_VERIFY | woreda |
| `woreda.dashboard.tsx` | `/woreda/dashboard` | yes | P.AUDIT_VIEW | woreda |
| `woreda.households.$householdId.edit.tsx` | `/woreda/households/$householdId/edit` | yes | P.HOUSEHOLD_UPDATE | woreda |
| `woreda.households.$householdId.index.tsx` | `/woreda/households/$householdId/` | yes | — | woreda |
| `woreda.households.$householdId.print.tsx` | `/woreda/households/$householdId/print` | yes | — | woreda |
| `woreda.households.index.tsx` | `/woreda/households/` | yes | P.HOUSEHOLD_CREATE, P.HOUSEHOLD_UPDATE | woreda |
| `woreda.households.new.tsx` | `/woreda/households/new` | yes | P.HOUSEHOLD_CREATE | woreda |
| `woreda.households.tsx` | `/woreda/households` | yes | — | woreda |
| `woreda.rental-accounts.$occupancyId.tsx` | `/woreda/rental-accounts/$occupancyId` | yes | — | woreda |
| `woreda.rental-houses.$houseId.edit.tsx` | `/woreda/rental-houses/$houseId/edit` | yes | — | woreda |
| `woreda.rental-houses.$houseId.index.tsx` | `/woreda/rental-houses/$houseId/` | yes | — | woreda |
| `woreda.rental-houses.$houseId.occupant-print.tsx` | `/woreda/rental-houses/$houseId/occupant-print` | yes | — | woreda |
| `woreda.rental-houses.index.tsx` | `/woreda/rental-houses/` | yes | — | woreda |
| `woreda.rental-houses.new.tsx` | `/woreda/rental-houses/new` | yes | — | woreda |
| `woreda.rental-houses.occupants.new.tsx` | `/woreda/rental-houses/occupants/new` | yes | — | woreda |
| `woreda.rental-houses.requests.$requestId.index.tsx` | `/woreda/rental-houses/requests/$requestId/` | yes | — | woreda |
| `woreda.rental-houses.requests.index.tsx` | `/woreda/rental-houses/requests/` | yes | — | woreda |
| `woreda.rental-reports.tsx` | `/woreda/rental-reports` | yes | — | woreda |
| `woreda.reports.$reportType.print.tsx` | `/woreda/reports/$reportType/print` | yes | P.REPORT_EXPORT | woreda |
| `woreda.reports.index.tsx` | `/woreda/reports/` | yes | Module:reports | woreda |
| `woreda.reports.tsx` | `/woreda/reports` | yes | — | woreda |
| `woreda.residents.$residentId.edit.tsx` | `/woreda/residents/$residentId/edit` | yes | P.RESIDENT_UPDATE | woreda |
| `woreda.residents.$residentId.index.tsx` | `/woreda/residents/$residentId/` | yes | P.RESIDENT_UPDATE | woreda |
| `woreda.residents.$residentId.print.tsx` | `/woreda/residents/$residentId/print` | yes | — | woreda |
| `woreda.residents.index.tsx` | `/woreda/residents/` | yes | P.RESIDENT_CREATE, P.RESIDENT_UPDATE | woreda |
| `woreda.residents.new.tsx` | `/woreda/residents/new` | yes | — | woreda |
| `woreda.residents.tsx` | `/woreda/residents` | yes | — | woreda |
| `woreda.revenue.$paymentId.receipt.tsx` | `/woreda/revenue/$paymentId/receipt` | yes | P.REVENUE_RECEIPT_REPRINT | woreda |
| `woreda.revenue.index.tsx` | `/woreda/revenue/` | yes | — | woreda |
| `woreda.revenue.tsx` | `/woreda/revenue` | yes | Module:revenue | woreda |
| `woreda.services.$requestId.index.tsx` | `/woreda/services/$requestId/` | yes | P.SERVICE_APPROVE, P.SERVICE_RECORD_PAYMENT | woreda |
| `woreda.services.$requestId.print.tsx` | `/woreda/services/$requestId/print` | yes | — | woreda |
| `woreda.services.index.tsx` | `/woreda/services/` | yes | — | woreda |
| `woreda.services.new.tsx` | `/woreda/services/new` | yes | — | woreda |
| `woreda.services.tsx` | `/woreda/services` | yes | Module:services | woreda |
| `woreda.settings.index.tsx` | `/woreda/settings/` | yes | — | woreda |
| `woreda.settings.users-permissions.tsx` | `/woreda/settings/users-permissions` | yes | P.TENANT_MANAGE | woreda |
| `woreda.settings.woreda-configuration.tsx` | `/woreda/settings/woreda-configuration` | yes | P.TENANT_MANAGE | woreda |
| `woreda.tsx` | `/woreda` | yes | — | woreda |

## Early drift signals (Lead Auditor; confirm or refute)

1. QR signing is ES256 (EC P-256), not RS256 as the brief claims.
2. Credential number is 13 digits with a Luhn check digit (migration 00000000000002), not `WW-KK-YY-NNNNNN-C` mod-11.
3. 9 built-in roles + `custom`, not 8.
4. Role/Permission matrix UI and ID-card template editor appear to exist (brief says not built).
5. docs/erd.md says 52 tables; schema has 66.
6. A column-level PII encryption layer (Phase C, 14 `*_decrypted` views, pgcrypto/Vault key derivation) exists — not in the brief.
7. No ModuleGate on households/residents/rental routes; rental is not one of the module keys.
8. html2canvas-pro used instead of html2canvas; react-i18next not installed.

## Wave notes (appended by the Lead Auditor between waves)

### After Wave 1 (inventory, supplychain, build-quality)

- `bunx tsc --noEmit` 0 errors; `bun run lint` 0 errors / 8 warnings; `bun run test` 202/202 pass (23 files);
  all four drift/catalog checks pass; build succeeds; `src/routeTree.gen.ts` does not drift. RT-01 PASS
  (24 dynamic-segment files checked). Edge Functions and `scripts/` are NOT covered by tsc (tsconfig) — WP-BQ-002.
- 128 error toasts render raw backend `error.message` (none via `translateError()`), e.g.
  `src/routes/woreda.residents.index.tsx:658` — WP-BQ-001 (C-07 overlap; appsec owns the C-07 verdict).
- No secrets in tree or full history (mirror-clone scan); `service_role` never reaches the client bundle — SEC-01 PASS.
  One High advisory (js-yaml GHSA-2883-xcg3-v3hh) reachable only via build tooling. CI has no dependency/secret scan.
- All 8 Edge Functions import `https://esm.sh/@supabase/supabase-js@2` unpinned, no import map / deno.lock — WP-INV-001.
- `rental_houses` IS an accepted module key in DB + TS types, but no ModuleGate / nav / admin toggle / server check uses it — WP-INV-005.
  Only the `services` module appears to have any server-side module check (inventory's reading — authz to confirm).
- Offline queue persists form data in `localStorage` (privacy to assess). Letter templates use an in-house
  HTML sanitiser (`src/lib/letterTemplate.ts`), not DOMPurify (appsec to assess).
- No `vercel.json` in repo; hosting config is dashboard-only. `login.tsx:96` passes no `captchaToken`.
- Colour tokens are stock shadcn slate; no "Academic Curator" tokens exist. `<html lang="en">` at `src/routes/__root.tsx:136`.
- Docs drift is heavy: CLAUDE.md claims "no test suite", "~49 lint problems", "UX restructure not merged",
  `WoredaShell`/`AdminShell` — all contradicted; docs/architecture.md says 43 tables / 6 functions / 9 buckets
  (actual 66 / 8 / 10); rental financial core (migrations 71–89) absent from erd/dfd/architecture docs.

### After Wave 1 (database) — see findings/database.md, raw/audit-database-*

- Replay of all 90 migrations (latest definitions): RLS enabled on all 66 tables; all 17 views security_invoker;
  all 130 SECURITY DEFINER functions pin search_path; no policy grants to anon/PUBLIC; types.ts matches migrations
  column-for-column. Live FORCE RLS / EXECUTE grants / bucket limits UNVERIFIED.
- WP-DB-001 (High): `get_user_woreda_id()` does not check `app_user.status` — suspended/pending/inactive staff keep
  read on 43 tables and full RW/D on 9 storage buckets (migration 11 fixed is_super_admin/is_tenant_admin only).
  CLAUDE.md's "pending user sees empty results" claim is contradicted for these tables.
- WP-DB-004 (High): SELECT policies do not check read permissions (resident.read, civil.read, payment.read,
  audit.view) — any woreda member incl. print_officer / zero-grant custom role reads residents (+ decrypted
  national ID views), civil events, payments, audit_log.
- WP-DB-002 (High): storage.objects policies check only woreda path prefix, not permission — any staff can
  overwrite official signature/stamp/logo, read/delete legal document scans.
- WP-DB-003 (High, likely): birth-approval trigger resolves mother by `mother_resident_id` without a woreda check
  -> cross-woreda PII copied into new resident.
- WP-DB-006/007 (Medium): numbering sequence tables and kebele reference data writable by any staff; numbering
  triggers accept client-supplied numbers. WP-DB-008: audit_log forgeable by any staff; log tables updatable.
  WP-DB-009: rental_eligibility() no woreda check, likely anon-executable. WP-DB-010: get_credential_live_status()
  cross-woreda. WP-DB-011: hard DELETE on payment/receipt. WP-DB-012: FKs not woreda-composite.
  WP-DB-005: plaintext PII still stored beside encrypted copies.
- Migration 64 embeds a real letter-verification token (redacted in outputs).
- "Additive-only" claim contradicted: migration 10 drops a column; 28 DROP CONSTRAINT across 16 migrations.

### After Wave 2 (authz, auth-session, appsec, api-edge, crypto-qr, workflows, privacy-logging, locale, ops-scope)

Raw totals before verification: 157 findings — 0 Critical, 20 High, 56 Medium, 60 Low, 21 Info.
High candidates: WP-DB-001..004, WP-AZ-001/002, WP-AUTH-001/002, WP-APP-001/002, WP-API-001, WP-CRY-001,
WP-WF-001..006, WP-OPS-001/002. Known overlaps to merge: WP-AZ-001 ≡ WP-API-001 (console roles UI-only);
WP-AZ-002 ≈ WP-WF-004/005 ≈ WP-APP-002 (non-status fields writable after approval; letters);
WP-DB-001 ≈ WP-AUTH-002 (suspension doesn't cut access); WP-DB-004 ≈ WP-AZ-005 (read perms unenforced);
WP-DB-005 ≈ WP-CRY-006 (plaintext twins); WP-DB-013 ≈ WP-CRY-008 (letter token in migration 64/docs);
WP-APP-005 ≈ WP-LOC-005 (FAN/phone client-only); WP-APP-003 ≈ WP-AUTH-003 (localStorage + unsafe-inline CSP);
WP-INV-004 ≈ WP-SUP-002 (js-yaml); WP-INV-005 ≈ WP-AZ-004 (module toggles UI-only); WP-API-005 ≈ WP-OPS-001 (localhost CORS).
Artifacts already produced: architecture/erd.md (database), api/openapi.yaml + api/samples (api-edge),
authz/permission-matrix.md + authz/route-guard-matrix.md (authz), privacy/pii-inventory.csv (privacy),
findings/workflows.md Mermaid diagrams (workflows), findings/ops-scope-testing-scope.md (ops).
Facts: bearer-header auth, tokens in localStorage, CSP allows 'unsafe-inline' scripts, no MFA, no staging,
no backups evidence, main has no required status checks, QR fallback host woredas-portal.vercel.app,
region eu-west-1 per one doc (unverified), Google Fonts + OSM tiles third parties, mail relay unnamed.
