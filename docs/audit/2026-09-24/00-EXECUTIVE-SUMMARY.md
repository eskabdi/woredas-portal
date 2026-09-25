# Executive Summary: woredas-portal Security and Status Audit

**System:** Harari woreda multi-tenant civil registry and services portal (`eskabdi/woredas-portal`)
**Baseline:** commit `9950f16` on `main` · **Audit date:** 2026-09-24 (Meskerem 14, 2019 EC)
**Standards:** INSA Web Application Security Testing Requirements (primary), OWASP Top 10 2021, OWASP API Top 10 2023, OWASP ASVS 4.0.3, NIST CSF, ISO/IEC 27001:2022 Annex A
**Method:** read-only, evidence-based static audit.

- 15 specialist agents ran in four waves.
- Every Critical and High finding was re-checked adversarially (23 verdicts, 16 duplicate merges, a 0/10 false-positive rate on a sample of 10 Mediums).
- The 2026-09-24 pass did not access any database, deployment or dashboard. On 2026-09-25 the production Supabase project, Vercel project, GitHub and TLS were checked read-only, and the owner answered the open questions (`10-live-verification.md`). §7 lists what remains.

## 1. Verdict

| Verdict | Critical | High | Medium | Low | Info | Total | INSA score |
|---|---|---|---|---|---|---|---|
| **NOT READY for production with real residents' data** | **1** | **15** | 51 | 61 | 21 | 149 | **33.1%** Appendix A (19.5/59) · 38.2% incl. Appendix B locale (27.5/72) |

INSA control totals (73 controls): PASS 11 · PARTIAL 33 · FAIL 28 · N/A 1 · UNVERIFIED 0. Full matrix: `03-insa-compliance-matrix.md`.

**Live verification (2026-09-25).** The figures above include the read-only check of the production Supabase project, Vercel, GitHub and TLS, plus the owner's answers (`10-live-verification.md`). That check added 4 findings (WP-LIVE-001 to 004), raised WP-LOC-014 to Low, confirmed 11 findings that had been "likely" or "needs live verification", and closed the last UNVERIFIED control (D-04, now PARTIAL). The main facts it established:
- **Operations:** production runs on the **Supabase Free plan with no backups and no PITR**; the direct database accepts connections from any IP without SSL; data sits in eu-west-1 (Ireland) and is processed in Vercel iad1 (USA).
- **Accounts:** a suspended tenant admin still exists (WP-DB-001), and `anon` can call `rental_eligibility` (WP-VER-001).

**Remediation status (update 2026-09-25).** The findings describe the codebase at baseline `9950f16`, re-checked against live state on 2026-09-25. Since then one finding has changed state in code. **WP-VER-001 (Critical) is fixed in code but not yet deployed.** Migration `00000000000090_p0_2_definer_woreda_scope.sql` fixes it, and CI now runs the ratchet check `check:definer-tenant-predicate`. Both are on branch `claude/read-and-execute-ipi0yo` (PR #85, commits `f406f22` and `72e5dc5`). The migration has not been applied to production. It waits for P0-1 (a verified backup). Until it is applied and checked with the queries at the end of the migration, the finding stays open in production, so the verdict and counts above are unchanged. Every other finding is still open.

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

Operationally, there is no MFA, no staging environment, no backup at all (confirmed live: Free plan, PITR off) and no monitoring. None of these defects need a redesign. Seven P0 fixes are each one day or less of work, and the High set is about two weeks once a staging copy exists.

## 2. INSA score by phase

| Phase | Score | Rating |
|---|---|---|
| A. Architecture and design | 31.2% (2.5/8) | 🟥 |
| B. Stack and inventory | 40.0% (2/5) | 🟧 |
| C. Coding and implementation | 28.6% (2/7) | 🟥 |
| D. Security functionality document | 30.0% (1.5/5) | 🟥 |
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
| 9 | **WP-OPS-002** | High | Confirmed | No database backups and no PITR (Supabase Free plan, confirmed live); Storage objects (scanned legal documents, signatures) have no backup | P0-1 |
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

1. **WP-VER-001 (Critical):** cross-woreda reads through DEFINER functions. `rental_eligibility()` is executable by `authenticated` and by `anon` (confirmed live 2026-09-25), and `get_credential_live_status()` has no callers yet reopens the credential-number enumeration closed in migration 34. This is the only place the "RLS alone keeps tenants apart" promise breaks.
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

**Updated 2026-09-25.** The live checks and the owner's answers closed most of this list. The detail is in `10-live-verification.md`, and the raw outputs are in `raw/live-2026-09-25/`.

**Resolved**
- **Live database:**
  - Migrations 71–89 are applied: 66 tables, all with RLS enabled.
  - Migration 90 is not applied.
  - `anon` can execute `rental_eligibility`.
  - There are no historical cross-woreda civil references.
  - The `credential.verify` rows, the console roles and the buckets were read.
- **Supabase Auth settings, all read:**
  - JWT signing is ES256; token expiry is 1 hour, with rotation on.
  - Sign-up is disabled. The server password minimum is 6, and leaked-password checking is off.
  - CAPTCHA is off, and MFA (TOTP) is available but not enforced.
  - There is no server session limit.
  - The redirect allow-list is narrow, and `verify_jwt` is set per function.
- **Platform:**
  - Free plan, with no backups and no PITR.
  - Hosted in eu-west-1 and Vercel iad1.
  - Direct DB access is open to all IPs, with no SSL enforcement.
  - Vercel has no WAF rules; preview protection is on.
  - The service_role key is present in Vercel.
  - SSL Labs grades A+/A.
  - `main` is protected, but no checks are required.
- **Owner decisions:**
  - The official spelling is "Jinala".
  - The Ethiopian 12 o'clock hours are 06:00 and 18:00.
  - Ethiopian clock bands are set accordingly.
  - The purpose of collecting ethnicity is stated.
  - "Region" means the administrative location only.
  - No Pro-tier purchase or staging project has been approved yet.

**Still needed**
- **Legal counsel:**
  - confirm that Personal Data Protection Proclamation No. 1321/2024 applies and is correctly cited;
  - identify the legal provision relied on for collecting ethnicity;
  - decide whether it may be optional;
  - state a purpose for religion, cause of death and divorce grounds.
- **Owner:**
  - the Amharic spelling that matches "Jinala";
  - a decision on the Supabase and Vercel Pro plans. This decision gates backups and PITR (P0-1), staging (P1-1), leaked-password protection, the session time-box, log drains and WAF rules.
- **A restore test**, recorded once backups exist.

## 8. Recommended next steps

1. **Within 48 hours (P0-1 to P0-7):** prove backups, close WP-VER-001, make the verifier fail closed, cut suspended users off at the database, sanitise stored letter HTML, extend the workflow INSERT guard, and regenerate the exposed letter token.
2. **Within 2 weeks (P1):** stand up staging; enforce read permissions and Storage permissions; freeze approved content and fix SoD; enforce CP server-side; enable and require MFA; move audit writes into database triggers.
3. **Before go-live:** external penetration test on staging (`06-testing-scope.md`), then owner sign-off.

Each P0/P1 item has a self-contained, ready-to-paste implementation prompt with acceptance tests in `09-fix-prompts.md`.

## 9. Deliverables index

| File | Content |
|---|---|
| `01-status-report.md` | Module-by-module status and the production-readiness verdict |
| `02-findings-register.md`, `02-findings.json` | 149 verified findings with evidence, CVSS, OWASP/ASVS/ISO/NIST mapping, live-verification notes |
| `03-insa-compliance-matrix.md` | 73 INSA controls with status and evidence |
| `04-stack-inventory.md` | Frameworks, libraries, integrations, actors, security infrastructure |
| `05-security-functionality-document.md` | As-is Security Functionality Document (INSA D) |
| `06-testing-scope.md` | Penetration-test scope, test accounts, environments |
| `07-remediation-roadmap.md` | P0/P1/P2 plan with owners, effort and dependencies |
| `08-drift-register.md` | Audit-brief claims and 210 documentation claims checked against code |
| `09-fix-prompts.md` | 23 implementation prompts (P0-1 to P1-16) |
| `10-live-verification.md` | Live check of production (2026-09-25) and the owner's decisions; what changed |
| `architecture/` | As-is DFD (L0/L1/L2), system architecture, ERD with reconciliation, workflow state machines |
| `api/` | OpenAPI 3.1 as-is specification, endpoint inventory, request/response samples |
| `authz/`, `privacy/` | Permission and route-guard matrices; PII inventory |
| `findings/` | Per-agent reports (15 agents + verifier) |
| `reference/` | INSA checklist and Appendix C catalog queries |
| `00-context/`, `raw/` | Ground truth, shared context, raw evidence and generator scripts |
