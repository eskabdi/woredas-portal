# 01 — Project Status Report

**Repository:** `eskabdi/woredas-portal` · **Baseline:** `9950f16` (main, identical to the audit branch) · **Audit date:** 2026-09-24 (Ethiopian calendar: Meskerem 14, 2019 EC)
**Method:** read-only static audit by 15 specialist agents, adversarial verification of every Critical and High finding, no database access. Anything that depends on live production state is marked *Unverified*.

## 1. Overall position

The product is **functionally broad and close to feature-complete** for its stated scope. It has two portals and 69 route files, covering resident and household registration, ID credentials with signed QR codes, civil registration, general services and complaints, kebele rental houses with a full financial core, revenue, reports and audit. The build pipeline is healthy:

- the typecheck is clean;
- lint shows 0 errors and 8 warnings;
- all 202 unit tests pass;
- the static catalog and permission-drift checks pass;
- the production build succeeds.

It is **not ready for production use with real residents' data**. The blockers are security and operational controls, not missing features:

| Verdict | Critical | High | Medium | Low | Info | INSA score (Appendix A) |
|---|---|---|---|---|---|---|
| **Not ready** | 1 | 15 | 50 | 58 | 21 | **32.8%** (19/58 scored; 38.0% including Appendix B) |

Legend: ✅ working, no blocking finding · 🟡 working with Medium or lower gaps · 🔴 working but carries a Critical or High finding · ⚪ not built or not operational.

## 2. Module status

| Module | Routes | Status | What works | What blocks or weakens it | Findings (C/H/M) |
|---|---|---|---|---|---|
| Resident Registration | 6 | 🔴 | Multi-step registration, EC dates, photo upload as WebP, FAN, `*_decrypted` view for encrypted phone, email and FAN | Every tenant user can read all residents regardless of `resident.read` (WP-DB-004). Suspended staff keep access (WP-DB-001). Plaintext PII stays authoritative (WP-DB-005). PII is copied into `audit_log` (WP-PRV-002). Special-category fields are mandatory with no lawful basis (WP-PRV-005). | 0/0/4 + platform High |
| Households | 6 | 🟡 | Head, spouse and alternate head; member roster view; transfer; map location | Reads ungated (WP-DB-004); OSM tiles disclose viewed locations (WP-PRV-008) | 0/0/0 (3 Low) |
| Credentials (ID cards) | 7 | 🔴 | Request → verify → approve → pay → print FSM, ES256-signed QR, 13-digit Luhn number, density-guarded print | One user can verify and approve after a return cycle (WP-WF-003). Read-only roles can write via `credential.verify` (WP-WF-005). `print_officer` cannot be assigned (WP-AZ-006). | 0/2/2 |
| QR verification (public `/v/$token`) and staff scanner | 1 + scanner | 🔴 | Client-side signature check, live revocation RPC | Verifier **fails open**: a revoked card can show "Verified" (WP-CRY-001). The staff scanner checks revocation only on request (WP-CRY-002). The QR carries readable PII (WP-CRY-003). QR codes point to a vendor subdomain (WP-OPS-008). | 0/1/3 |
| Civil Registration | 7 | 🔴 | Birth, death, marriage, divorce; birth auto-creates the resident; death revokes credentials | Events can be inserted directly at `approved` (WP-WF-001). Approved content is not frozen (WP-WF-004). Death is incomplete and reversible (WP-WF-006). Cross-woreda parent lookup on birth approval (WP-VER-001). Divorce cannot be paid (WP-WF-008). | 1*/3/2 |
| Services and Complaints | 6 | 🔴 | Configurable catalog, letter templates with sanitised print, public letter verification | Letters can take the complaint path and still verify (WP-WF-002). Stored XSS in the letter-template editor (WP-APP-001). Letter token not from a CSPRNG (WP-DB-013). | 0/1+1/0 |
| Kebele Rental Houses (occupancy + financial core) | 10 | 🟡 | Strongest module: one locked SECURITY DEFINER transaction per money movement, idempotency keys, exact-sum settlement, SoD and frozen fields on requests | Due dates stored one day early (WP-LOC-001). Client-chosen billing start and unbilled termination month (WP-WF-013). `rental_eligibility()` answers for residents of any woreda and is probably anon-executable (WP-VER-001). Undocumented (WP-INV-002). | 1*/0/3 |
| Revenue and Receipts | 3 | 🟡 | Fail-closed fee resolvers, exact-match fee guard, public receipt verification | Payment → receipt → status is three client calls (WP-WF-009). Weak waiver control (WP-WF-010). Receipts not unique per payment (WP-CRY-007). Counters are tenant-writable (WP-DB-006). No EC fiscal year (WP-LOC-003). | 0/0/6 |
| Approvals inbox, Reports, Dashboard | 5 | 🟡 | Unified approval queue view (`security_invoker`), CSV/PDF export with woreda branding | Report and export read keys not enforced by RLS (WP-DB-004, merged WP-AZ-005). Exports are unaudited (WP-PRV-004). | 0/0/0 + platform |
| Settings (woreda) | 3 | 🔴 | Users and roles, custom roles, per-user overrides, module toggles, letterhead assets | Any tenant user can overwrite signatures, stamps and logos in Storage (WP-DB-002). Kebele reference data writable by every user (WP-DB-007). Stored XSS sink (WP-APP-001). | 0/2/1 |
| RBAC and tenant isolation (cross-cutting) | — | 🔴 | RLS on 66/66 tables, three-layer permission chain, drift check in CI, custom roles fail closed | DEFINER functions without a woreda re-check (**WP-VER-001, Critical**). Status ignored by `get_user_woreda_id()` (WP-DB-001). Read permissions not enforced (WP-DB-004). Module toggles UI-only (WP-AZ-004). | 1/3/— |
| Super Admin console | 7 | 🔴 | Tenant module provisioning, console roles, credential template designer, platform audit | Console permissions (CP) are enforced only in the browser (WP-AZ-001). Tenant creation only via seed/operator SQL (WP-ARC-004). | 0/1/0 |
| Authentication and session | 3 | 🔴 | Invite, set-password, admin-initiated reset, 25-minute idle logout, self-service password change | No MFA for any role (WP-AUTH-001). Tokens in `localStorage` on an origin shared by public, tenant and admin pages (WP-APP-003, merged WP-AUTH-003; WP-ARC-003). No CAPTCHA or lockout evidence (WP-AUTH-005). | 0/1/— |
| Operations (environments, backups, CI, monitoring) | — | 🔴 | CI runs lint, build, typecheck, tests and three catalog checks | No staging: production doubles as the test environment (WP-OPS-001). Backups/PITR unevidenced (WP-OPS-002). CI not a required check (WP-OPS-004). No monitoring or SIEM (WP-OPS-006). | 0/2/— |

\* WP-VER-001 is one Critical finding spanning civil registration (`generate_resident_on_birth_approval`), rental (`rental_eligibility`) and credentials (`get_credential_live_status`). It is counted once in the totals.

## 3. Build and code health

| Check | Result | Evidence |
|---|---|---|
| `bunx tsc --noEmit` | 0 errors. Edge Functions and `scripts/` are outside the typecheck (WP-BQ-002). | `raw/build-quality-tsc.txt` |
| `bun run lint` | 0 errors, 8 warnings; 56 inline `eslint-disable` (WP-BQ-003) | `raw/build-quality-lint.txt` |
| `bun run test` | 23 files, 202 tests passed. No coverage tooling; the QR verifier is untested (WP-BQ-007). | `raw/build-quality-test.txt` |
| `bun run build` | Succeeds; route tree stable (RT-01 PASS) | `raw/build-quality-build.txt` |
| Drift and catalog checks | Pass | `raw/build-quality-*.txt` |
| `bun audit` | 1 High (js-yaml, build-time only) | `findings/supplychain.md` |
| Error hygiene | 128 toasts show raw backend `error.message` (WP-BQ-001) | `raw/build-quality-raw-error-toasts.txt` |
| Secrets in tree and history | No deployment token or `service_role` key found (SEC-01 PASS) | `findings/supplychain.md` |

## 4. Documentation status

The project keeps a large doc set. These docs were treated as claims, and **113 of 210 checked claims are contradicted** by code (`08-drift-register.md`). The main gaps:

- `docs/dfd.md`, `docs/erd.md` and `docs/architecture.md` predate the rental financial core (14 tables, migrations 71–89).
- `docs/dfd.md` states the QR carries no PII, which is false.
- Only 13% of code-changing commits touch any doc (G-01 FAIL).

As-is replacements are in `architecture/`, `api/openapi.yaml` and `05-security-functionality-document.md`.

## 5. Production-readiness verdict: **Not ready**

Go-live requires **all** of the following:

1. **Backups proven:** plan tier, daily backup and PITR confirmed, one restore test recorded (P0-1, WP-OPS-002).
2. **Critical closed:** a same-woreda re-check and anon revoke on the three DEFINER functions (P0-2, WP-VER-001).
3. **Verifier fails closed** on the public and staff scanners (P0-3, WP-CRY-001/002).
4. **Suspended users lose access** at the database and their sessions are revoked (P0-4, WP-DB-001).
5. **Stored XSS removed** from the letter-template editor (P0-5, WP-APP-001).
6. **Workflow INSERT guard and category-aware service FSM** (P0-6, WP-WF-001/002).
7. **All remaining High findings** fixed and verified on a staging copy (P1-1 to P1-8).
8. **MFA enforced** (`aal2`) for `super_admin` and `tenant_admin` (P1-8, WP-AUTH-001).
9. **External penetration test** against staging per `06-testing-scope.md`, with no open Critical or High.
10. **Owner sign-off** on `docs/go-live-declaration.md`, updated from this audit, plus legal confirmation of the data-protection basis (Proclamation No. 1321/2024).

Items 1–6 are small (≤ 1 day each) and can be done within 48 hours. Items 7–9 take about two weeks once staging exists. See `07-remediation-roadmap.md` and the ready-to-paste prompts in `09-fix-prompts.md`.

## 6. Open items not assessable from the repository

- Live schema parity: were migrations 71–89 applied? (Appendix C query 1)
- Supabase Auth configuration: JWT expiry, refresh-token reuse, sign-up, password policy, leaked-password check, CAPTCHA, rate limits, MFA factors, redirect allow-list.
- Per-function `verify_jwt`, backups/PITR, region and data residency, TLS configuration, Vercel WAF and preview protection.
- Live `role_permission` rows for `credential.verify`; super admins with a console role; whether anon has EXECUTE on `rental_eligibility`.

The full list and the queries are in `00-EXECUTIVE-SUMMARY.md` §7 and `reference/appendix-c-catalog-queries.md`.
