# Executive Summary: woredas-portal Security and Status Audit

**System:** Harari woreda multi-tenant civil registry and services portal (`eskabdi/woredas-portal`)
**Baseline:** commit `9950f16` on `main` · **Audit date:** 2026-09-24 (Meskerem 14, 2019 EC)
**Standards:** INSA Web Application Security Testing Requirements (primary), OWASP Top 10 2021, OWASP API Top 10 2023, OWASP ASVS 4.0.3, NIST CSF, ISO/IEC 27001:2022 Annex A
**Method:** read-only, evidence-based static audit.

- 15 specialist agents ran in four waves.
- Every Critical and High finding was re-checked adversarially (23 verdicts, 16 duplicate merges, a 0/10 false-positive rate on a sample of 10 Mediums).
- No database, deployment or dashboard was accessed. Anything that depends on live state is marked **Unverified**, and the queries or settings needed to close it are listed in §7.

## 1. Verdict

| Verdict | Critical | High | Medium | Low | Info | Total | INSA score |
|---|---|---|---|---|---|---|---|
| **NOT READY for production with real residents' data** | **1** | **15** | 50 | 58 | 21 | 145 | **32.8%** Appendix A (19/58) · 38.0% incl. Appendix B locale (27/71) |

INSA control totals (73 controls): PASS 11 · PARTIAL 32 · FAIL 28 · N/A 1 · UNVERIFIED 1. Full matrix: `03-insa-compliance-matrix.md`.

**In one paragraph.** The portal is functionally broad and well engineered in places:

- The rental financial core runs every money movement as one locked database transaction.
- RLS is on all 66 tables.
- The build is clean and 202 unit tests pass.

Tenant isolation, least privilege and separation of duties are still not enforced where it matters, in the database:

- Three privileged database functions can be steered into another woreda's data (**Critical**).
- Suspended staff keep full read access.
- Every staff role can read every resident regardless of its permissions.
- Several maker-checker gates can be skipped by writing rows directly.
- The public ID-card verifier can be made to show a revoked card as valid.

Operationally, there is no MFA, no staging environment, no evidenced backup and no monitoring. None of these defects need a redesign. Seven P0 fixes are each one day or less of work, and the High set is about two weeks once a staging copy exists.

## 2. INSA score by phase

| Phase | Score | Rating |
|---|---|---|
| A. Architecture and design | 31.2% (2.5/8) | 🟥 |
| B. Stack and inventory | 40.0% (2/5) | 🟧 |
| C. Coding and implementation | 28.6% (2/7) | 🟥 |
| D. Security functionality document | 25.0% (1/4), 1 Unverified | 🟥 |
| E. API security | 25.0% (1.5/6) | 🟥 |
| F. Testing scope | 50.0% (1.5/3) | 🟧 |
| G. Living documentation | 0.0% (0/1) | 🟥 |
| H. Project-specific extensions (tenancy, RBAC, maker-checker, crypto, ops) | 35.4% (8.5/24) | 🟥 |
| Appendix B: Ethiopian locale (EC dates, Arabic numerals, fonts, names, clock) | 61.5% (8/13) | 🟨 |

🟥 below 35% · 🟧 35–54% · 🟨 55–79% · 🟩 80% or more.

## 3. Risk heatmap (highest severity per module and dimension)

| Module | Tenant isolation / AuthZ | Workflow / SoD | Crypto / QR | AppSec (XSS, injection) | Privacy | AuthN / session | Ops / config | Locale |
|---|---|---|---|---|---|---|---|---|
| Platform (cross-cutting) | 🟥 Critical | 🟨 | 🟩 | 🟨 | 🟨 | 🟧 High | 🟧 High | 🟨 |
| Civil Registration | 🟥 (WP-VER-001) | 🟧 High | — | — | 🟨 | — | — | 🟩 |
| Credentials | 🟧 High | 🟧 High | 🟨 | — | — | — | — | — |
| QR verification | — | — | 🟧 High | — | 🟨 | — | 🟨 | — |
| Services and letters | 🟩 | 🟧 High | 🟨 | 🟧 (via Settings) | — | — | — | — |
| Settings | 🟧 High | 🟩 | — | 🟧 High | — | — | — | — |
| Super Admin | 🟧 High | — | — | — | — | 🟧 (MFA) | 🟩 | — |
| Residents | 🟧 (WP-DB-004) | 🟨 | — | — | 🟨 | — | — | 🟩 |
| Households | 🟧 (WP-DB-004) | — | — | — | 🟩 | — | 🟩 | 🟩 |
| Revenue | 🟨 | 🟨 | 🟨 | — | — | — | — | 🟨 |
| Rental | 🟥 (WP-VER-001) | 🟨 | — | — | — | — | 🟨 docs | 🟨 |

🟥 Critical · 🟧 High · 🟨 Medium · 🟩 Low/Info · — no finding. Platform-wide findings (WP-DB-001, WP-DB-004, WP-AUTH-001) apply to every module; they are shown in the module rows only where they reach that module's data directly.

## 4. Top 10 findings

| # | ID | Severity | Confidence | Finding | Fix |
|---|---|---|---|---|---|
| 1 | **WP-VER-001** | Critical | Likely | Three SECURITY DEFINER functions (`generate_resident_on_birth_approval` trigger, `rental_eligibility()`, `get_credential_live_status()`) trust a caller-supplied key without re-checking the caller's woreda, so other woredas' residents' data, including ethnicity and religion, can be read and copied across tenants | P0-2 |
| 2 | **WP-CRY-001** | High | Confirmed | The public ID-card verifier fails open: a revoked card shows "Verified" after its token is re-encoded, or whenever the live lookup misses or errors | P0-3 |
| 3 | **WP-DB-001** | High | Confirmed | `get_user_woreda_id()` ignores `app_user.status`, so suspended, pending and inactive staff keep tenant-wide data access | P0-4 |
| 4 | **WP-DB-004** | High | Confirmed | Read permissions (`resident.read`, `civil.read`, `payment.read`, `audit.view`, …) are not enforced by SELECT RLS; every staff account can read and export all tenant PII | P1-2 |
| 5 | **WP-WF-001** | High | Confirmed | The workflow INSERT guard covers only the credential tables, so civil events and service letters can be created directly at `registered`/`issued`, skipping maker-checker and payment | P0-6 |
| 6 | **WP-APP-001** | High | Confirmed | Stored XSS: the letter-template editor writes unsanitised `letter_body_html` into the live DOM | P0-5 |
| 7 | **WP-AZ-001** | High | Confirmed | Console permissions (CP) are enforced only in the browser; a "scoped" super admin keeps unrestricted power at the database and Edge Function layer | P1-7 |
| 8 | **WP-AUTH-001** | High | Confirmed | No MFA for any role, including `super_admin` and `tenant_admin` | P1-8 |
| 9 | **WP-OPS-002** | High | Needs live check | Backups, PITR and DR are unevidenced (free-tier indications); Storage objects (scanned legal documents, signatures) have no backup | P0-1 |
| 10 | **WP-WF-004** | High | Confirmed | Approved content is not frozen: the subject of an approved credential, civil event or letter can be changed before its side effect fires | P1-4 |

The other High findings are:

- **WP-WF-002:** letters can take the complaint path.
- **WP-WF-003:** maker-checker is defeated after a return cycle.
- **WP-WF-005:** read-only roles can write credential requests.
- **WP-WF-006:** a registered death is incomplete and reversible.
- **WP-DB-002:** Storage has no permission check; any user can overwrite official signatures and stamps.
- **WP-OPS-001:** there is no staging environment.

Full register: `02-findings-register.md` and `02-findings.json`.

## 5. Top 5 cross-tenant and authorization risks

1. **WP-VER-001 (Critical):** cross-woreda reads through DEFINER functions. `rental_eligibility()` is granted to `authenticated` and probably to `anon` (live check pending), and `get_credential_live_status()` has no callers yet reopens the credential-number enumeration closed in migration 34. This is the only place the "RLS alone keeps tenants apart" promise breaks.
2. **WP-AZ-001 (High):** CP console roles are cosmetic at the data layer, so every super admin is in effect unrestricted across all six woredas.
3. **WP-AUTH-001 + WP-ARC-003 (High / Medium):** one stolen password, or one XSS on any page of the shared origin (localStorage session, `script-src 'unsafe-inline'`), gives the attacker a super admin's cross-tenant session.
4. **WP-DB-001 (High):** revoking a staff member does not revoke data access, and live sessions are not signed out.
5. **WP-DB-004 + WP-DB-002 (High):** inside a tenant, least privilege does not exist for reads or for Storage objects. Viewers read all PII, and any user can replace the woreda's seal and signature images.

## 6. Top 5 quality and status risks

1. **WP-OPS-001 (High):** production is also the test environment. There is nowhere to dry-run a fix or run a penetration test without touching real residents' data.
2. **WP-ARC-002 / WP-WF-009 (Medium):** credential, civil and service fee payment is three separate browser calls (payment → receipt → status) with no one-payment-per-request constraint, and most audit rows are written by the browser. The rental module shows the correct pattern.
3. **WP-LOC-001 (Medium):** rent-charge and arrears due dates are stored one day early in the Ethiopian time zone. This affects money and eligibility in every woreda.
4. **WP-ARC-001 / WP-INV-002 (Medium):** the project DFD, ERD and architecture documents predate the rental financial core. 113 of 210 checked documentation claims are contradicted, and `docs/dfd.md` wrongly says the QR carries no PII. G-01 (living documentation) scores 0%.
5. **WP-BQ-001 (Medium):** 128 toasts show raw backend error text, bypassing `translateError()`. That means untranslated English in an Amharic-first portal and minor schema disclosure.

## 7. What could not be verified, and what the owner must provide

The audit had no access to the live database, Supabase dashboard or Vercel dashboard. The TLS probe was blocked by the sandbox egress policy. To close the Unverified items, please provide the following (read-only; never share the tokens themselves):

**A. Live database: output of the queries in `reference/appendix-c-catalog-queries.md`**
- Q1 table/view/function inventory: were migrations 71–89 applied, and do 66 tables exist?
- RLS enabled and `pg_policies` for every table; function `prosecdef`/`proconfig`/ACL. Specifically, does `anon` hold EXECUTE on `rental_eligibility` and `get_credential_live_status`?
- Live `role_permission` rows for `credential.verify` (WP-WF-005).
- `app_user` rows with `role = 'super_admin'` and a non-null `console_role_id` (WP-AZ-001 exposure).
- Storage bucket `allowed_mime_types` / `file_size_limit`.

**B. Supabase Auth settings (dashboard screenshots or Management API config export with secrets removed)**
- JWT signing algorithm, access-token expiry, refresh-token rotation and reuse interval, session time-box and inactivity timeout.
- Public sign-up enabled or disabled; anonymous sign-in; email confirmation.
- Password policy (minimum length, character classes) and leaked-password protection.
- CAPTCHA provider, auth rate limits, MFA factors enabled (TOTP / phone).
- Email templates (invite, recovery), SMTP provider, redirect URL allow-list and Site URL.
- Per-Edge-Function `verify_jwt` setting (8 functions).
- Plan tier.

**C. Platform and operations**
- Backups: daily backups, PITR, retention, and a dated restore test (P0-1).
- Supabase region and data-residency position; network restrictions on direct Postgres.
- Vercel: Firewall/WAF managed rules, preview deployment protection, which environment variables exist in Production and Preview (names only; confirm `SUPABASE_SERVICE_ROLE_KEY` is **not** set, WP-ARC-005).
- An SSL Labs report for the production hostname.
- GitHub branch protection: required status checks on `main`.

**D. Owner and legal decisions**
- Spelling of the fifth woreda: "Jineala" (seed) versus the spelling used in official documents.
- Ethiopian clock period bands for display. Proposed: ጠዋት 1–5 (07:00–11:59), ቀትር 6–11 (12:00–17:59), ማታ 1–5 (19:00–23:59), ለሊት 6–11 (00:00–05:59). The two Ethiopian "12 o'clock" hours (06:00 and 18:00) need the owner's choice of band.
- Legal confirmation that Ethiopia's Personal Data Protection Proclamation No. 1321/2024 applies and is correctly cited (the audit could not verify it against the Federal Negarit Gazette offline). Also the lawful basis for collecting ethnicity and religion (WP-PRV-005).
- Approval to provision a staging Supabase project (real cost; P1-1).

## 8. Recommended next steps

1. **Within 48 hours (P0-1 to P0-7):** prove backups, close WP-VER-001, make the verifier fail closed, cut suspended users off at the database, sanitise stored letter HTML, extend the workflow INSERT guard, and regenerate the exposed letter token.
2. **Within 2 weeks (P1):** stand up staging; enforce read permissions and Storage permissions; freeze approved content and fix SoD; enforce CP server-side; enable and require MFA; move audit writes into database triggers.
3. **Before go-live:** external penetration test on staging (`06-testing-scope.md`), then owner sign-off.

Each P0/P1 item has a self-contained, ready-to-paste implementation prompt with acceptance tests in `09-fix-prompts.md`.

## 9. Deliverables index

| File | Content |
|---|---|
| `01-status-report.md` | Module-by-module status and the production-readiness verdict |
| `02-findings-register.md`, `02-findings.json` | 145 verified findings with evidence, CVSS, OWASP/ASVS/ISO/NIST mapping |
| `03-insa-compliance-matrix.md` | 73 INSA controls with status and evidence |
| `04-stack-inventory.md` | Frameworks, libraries, integrations, actors, security infrastructure |
| `05-security-functionality-document.md` | As-is Security Functionality Document (INSA D) |
| `06-testing-scope.md` | Penetration-test scope, test accounts, environments |
| `07-remediation-roadmap.md` | P0/P1/P2 plan with owners, effort and dependencies |
| `08-drift-register.md` | Audit-brief claims and 210 documentation claims checked against code |
| `09-fix-prompts.md` | 23 implementation prompts (P0-1 to P1-16) |
| `architecture/` | As-is DFD (L0/L1/L2), system architecture, ERD with reconciliation, workflow state machines |
| `api/` | OpenAPI 3.1 as-is specification, endpoint inventory, request/response samples |
| `authz/`, `privacy/` | Permission and route-guard matrices; PII inventory |
| `findings/` | Per-agent reports (15 agents + verifier) |
| `reference/` | INSA checklist and Appendix C catalog queries |
| `00-context/`, `raw/` | Ground truth, shared context, raw evidence and generator scripts |
