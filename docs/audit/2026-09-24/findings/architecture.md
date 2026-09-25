# Findings: audit-architecture (Wave 3)

Scope: INSA A-01 to A-06, as-is DFD (L0/L1/L2), system architecture (deployment, component and security-layer views), ERD reconciliation and consolidated workflow state machines. Baseline HEAD `9950f16`. The live database and hosting dashboards were not reachable, so platform settings are marked Unverified.

## Artifacts produced

- `architecture/dfd.md`: L0 context, 9 trust boundaries, L1 with 12 processes and 13 store groups, 25 sensitive flows (🔒) each mapped to its control and gap, and L2 for Credentials and Civil Registration.
- `architecture/system-architecture.md`: deployment view, component view (8 Edge Functions, 64 public functions in groups, external integrations), and the security-layer table labelled Owned/Inherited/Missing/Unverified.
- `architecture/workflows.md`: 8 state machines consolidated from the workflow agent's output and corrected against the latest migrations.
- `architecture/erd.md`: a Reconciliation section appended, comparing the as-built ERD with `docs/erd.md`.

## Checklist verdicts

| ID | Status | Note |
|---|---|---|
| A-01 | **PARTIAL** | A project DFD L0 exists and its human actors match the 8 built-in roles, platform admin and public verifier. It omits custom roles, console-role scoping, the operator and every external service (SMTP, OSM, Google Fonts, esm.sh, Vercel, GitHub). A complete as-is L0 is in architecture/dfd.md §2. WP-ARC-001. |
| A-02 | **FAIL** | The project L1 has 5 processes and 6 stores, against 12 processes and 13 store groups as built. Civil registration, rental, settings, provisioning, receipt verification, buckets, Vault and localStorage are missing, and no L2 exists for Credentials or Civil Registration. The auditor produced both L2s. WP-ARC-001. |
| A-03 | **FAIL** | The project DFD marks 4 flows. As built there are 25 PII/financial flows, each now mapped to its control in architecture/dfd.md §3.3. Most carry at least one Weak or Missing control (e.g. WP-DB-004 read gating, WP-CRY-001 fail-open verifier, WP-PRV-002 PII in audit_log). The project doc also wrongly states the QR carries no PII. |
| A-04 | **PARTIAL** | A deployment diagram exists but is stale (6 functions, 43 tables, 9 buckets vs 8/66/10). It omits region and jurisdiction, previews, SMTP, DNS and the operator path. The as-is deployment view is in system-architecture.md §1. Supabase region: UNVERIFIED. |
| A-05 | **PARTIAL** | The project component diagram lists 6 Edge Functions and no RPC groups or third-party integrations. The auditor's component view lists all 8 functions, all 64 public functions grouped, and every external integration. |
| A-06 | **PARTIAL** | Layers are now labelled Owned/Inherited/Missing with evidence. WAF is not evidenced (dashboard opt-in). IDS/IPS and SIEM are missing. Edge verify_jwt, TLS versions, backups and Postgres network restrictions are UNVERIFIED. The project docs acknowledge the gaps, so they are not silently missing. |

## Findings

### WP-ARC-001 (Medium, Confirmed)

**Project architecture documents (docs/dfd.md, docs/architecture.md, docs/erd.md) are materially stale and contain claims the code contradicts**

Neither project diagram matches what the code does. The DFD omits civil registration, rental, settings, tenant provisioning, receipt verification, all 10 storage buckets, Vault, localStorage and the offline queue. It has no Level 2 view, and it states that the QR code carries no PII when the signed payload is readable base64 containing personal data. The architecture and ERD documents undercount functions, tables, buckets and public RPCs.

Evidence:
- `docs/dfd.md:73`: Verifier sends token only, no PII in request / QR encodes only the token, contradicted by sign-credential/index.ts:206-218 (readable name, sex, DOB, kebele, house no.)
- `docs/architecture.md:29`: 6 Edge Functions / 43 tables / 9 buckets: actual 8 / 66 / 10
- `docs/architecture.md:89`: Two RPCs for public verification: actual three (verify_receipt, 00000000000013:189)
- `docs/erd.md:10`: 52 tables, zero drift: 14 rental/checkpoint tables from migrations 71-89 absent
- `docs/dfd.md:42`: L1 has 5 processes, 6 stores; no L2 diagram exists

Attack scenario: Not directly exploitable. A privacy or INSA assessor who relies on docs/dfd.md would conclude that public verification exposes no PII and would not test the third verification surface or the rental financial stores.

Impact: INSA Phase A deliverables (A-01/A-02/A-04/A-05) fail on submission. Security reviews are scoped from wrong diagrams, and threat modelling misses real PII flows.

Recommendation: Replace docs/dfd.md, docs/architecture.md (deployment and component sections) and docs/erd.md with the as-is artifacts in docs/audit/2026-09-24/architecture/. Add a PR-template checklist item and a CI check comparing table, function and bucket counts in the docs against the migrations (roadmap P2-10).

Effort M. References: insa A-01, A-02, A-03, A-04, A-05, A-07, G-01; iso27001 A.5.37, A.8.27; nist_csf ID.AM-03 (CSF 2.0)

### WP-ARC-002 (Medium, Confirmed)

**No server-side application tier: several multi-step business transactions and the audit trail are driven by the browser rather than by one database transaction**

Every page talks to PostgREST with the anon key, so any invariant not written as RLS, a trigger or a DEFINER RPC is enforced only by browser code. The rental module follows the safe pattern: one locked DEFINER RPC per money movement. The credential, civil and service fee paths do not. They issue payment insert, receipt insert and status update as separate client calls, and most audit and status-history rows are written by the client.

Evidence:
- `docs/architecture.md:46`: No server-side application logic between the browser and Supabase (design choice)
- `src/routes/woreda.services.$requestId.index.tsx:324`: .from("payment").insert({... status: "confirmed"}) followed by a separate receipt insert at :342
- `src/lib/offlineSync.ts:244`: offline replay performs payment insert (:244) then receipt insert (:265) as separate calls
- `src/:0`: 68 client-side audit_log insert sites; 23 client references to *_status_history tables
- `supabase/migrations/00000000000087_rental_review_round4_fixes.sql:693`: Counter-example: rental money movement is one locked SECURITY DEFINER transaction

Attack scenario: A staff user with a valid session calls PostgREST directly and inserts a payment without a receipt or status change, or changes a status without the matching audit row. The browser-side sequencing never runs, and nothing in the database reconciles the gap.

Impact: Partial transactions, forgeable or missing audit evidence, and an inconsistent financial ledger. This is the common cause behind several High and Medium workflow and privacy findings.

Recommendation: Adopt the rental pattern platform-wide: one SECURITY DEFINER RPC per business transaction (record_fee_payment, transition_request) with SET search_path = '', FOR UPDATE, an idempotency key, and DB-written audit and history rows. Then revoke client INSERT on audit_log and the history tables (roadmap P1-9, P1-12).

Effort L. References: insa A-05, C-01; owasp_top10 A04:2021; asvs V1.1.2, V11.1.1; iso27001 A.8.27; nist_csf PR.PS-06 (CSF 2.0)

### WP-ARC-003 (Medium, Confirmed)

**Anonymous verification pages, the tenant portal and the super-admin console share one origin and one localStorage session under a CSP that allows inline script**

Three trust levels (anonymous public, tenant staff, platform super admin) run as one SPA on one origin. The bearer session lives in localStorage, readable by any script on the origin, and the CSP does not block inline script. A script-execution bug on any page, including the public ones that render attacker-influenced token content, can therefore read the session of whoever is signed in on that browser. That includes a super admin.

Evidence:
- `src/integrations/supabase/client.ts:24`: storage: typeof window !== "undefined" ? localStorage : undefined
- `src/lib/security-headers.ts:52`: "script-src 'self' 'unsafe-inline'"
- `src/routes/v.$token.tsx:1`: public verifier routes (v.$token, verify.letter.$token, verify.receipt.$token) served from the same SPA/origin as woreda.* and admin.*

Attack scenario: An XSS in any route (for example the stored letter-template XSS in WP-APP-001) runs in a super admin's browser and exfiltrates the access and refresh tokens from localStorage, giving cross-tenant platform access until the refresh token is revoked.

Impact: Any single XSS escalates to platform-wide session theft. The blast radius is not contained per portal.

Recommendation: Move the admin console, and ideally the public verifiers, to separate origins or subdomains. Adopt CSP nonces (drop 'unsafe-inline'). Consider cookie-based session storage (HttpOnly, SameSite=Strict) through a thin server tier. Require aal2 MFA for super_admin (roadmap P1-8, P1-10, P2-3).

Effort L. References: insa A-06, C-02; owasp_top10 A04:2021, A05:2021; asvs V3.2.3, V14.4.3; iso27001 A.8.26; nist_csf PR.AA-05 (CSF 2.0)

### WP-ARC-004 (Low, Confirmed)

**Tenant (woreda) creation exists only as seed data and operator SQL; the console provisioning flow cannot create a tenant**

The console's provisioning page only configures modules and invites a tenant admin for an existing woreda. New woreda rows, and therefore the AFTER INSERT triggers that seed permissions, offices and rental policy, come only from seed.sql or an operator running SQL with the account PAT over the Management API.

Evidence:
- `supabase/seed.sql:70`: INSERT INTO public.woreda (...) VALUES (... 'AMIR_NUR' ...) : 6 woredas seeded
- `src/routes/admin.tenants.$woredaId.provision.tsx:150`: provisioning upserts tenant_module_config and invokes an invite Edge Function; no insert on woreda anywhere in src/
- `supabase/migrations/00000000000015_permission_matrix_backfill.sql:71`: AFTER INSERT ON woreda trigger seeds role_permission (also 00000000000048:103 offices, 00000000000071:247 rental policy)

Attack scenario: Not directly exploitable. The risk is operational: adding a seventh woreda needs production SQL access (TB8), which bypasses RLS and every application audit control.

Impact: Privileged tenant lifecycle operations happen outside the audited application path, with no maker-checker step and no audit_log entry.

Recommendation: Add a super-admin-only create_woreda() DEFINER RPC with CP permission, input validation and a DB-written audit row. Record the operator path in the runbook until then.

Effort S. References: insa A-05, OPS-01; iso27001 A.8.32; nist_csf PR.PS-01 (CSF 2.0)

### WP-ARC-005 (Low, Likely)

**The SSR tier is configured to receive the service_role key although no code uses it**

.env.example tells operators that the service_role key is required, but client.server.ts is imported by nothing. If the key is set in the Vercel project environment as instructed, a key that bypasses RLS sits in an execution environment that never needs it, including preview deployments.

Evidence:
- `.env.example:30`: SUPABASE_SERVICE_ROLE_KEY=  (comment :29 'Required by src/integrations/supabase/client.server.ts')
- `src/integrations/supabase/client.server.ts:10`: const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
- `src/:0`: grep: no module imports client.server (the module is dead code)

Attack scenario: A future SSR bug, dependency compromise or preview-deployment misconfiguration reads process.env and exposes a key that bypasses RLS on every tenant.

Impact: Needless expansion of where the most powerful data-plane secret lives. If it leaked, that would be a cross-tenant compromise (R7 Critical on exposure).

Recommendation: Remove SUPABASE_SERVICE_ROLE_KEY from the Vercel environment, including previews, and from .env.example until server code needs it. Confirm in the Vercel dashboard and rotate the key if it has ever been set on preview deployments.

Effort S. References: insa A-06, SEC-02; owasp_top10 A05:2021; asvs V14.1.3; iso27001 A.8.24; nist_csf PR.DS-01 (CSF 2.0)

## Documentation drift

| Claim | Source | Verdict | Evidence |
|---|---|---|---|
| QR encodes only the token; verifier sends no PII | `docs/dfd.md:73-74,98` | CONTRADICTED | supabase/functions/sign-credential/index.ts:206-218 |
| Two public verification routes/RPCs | `docs/dfd.md:28-30; docs/architecture.md:89` | CONTRADICTED | src/routes/verify.receipt.$token.tsx:65; 00000000000013:189 |
| 6 Edge Functions, 43 tables, 9 buckets | `docs/architecture.md:29-31` | CONTRADICTED | scripts/deploy-functions.sh:28-37; raw/audit-database-catalog.json (66); 10 buckets |
| 52 tables, zero drift against migrations | `docs/erd.md:10-12` | CONTRADICTED | 66 tables in migrations; 14 added in migrations 71-89 after the doc's last edit (eb3d283, 2026-09-14) |
| No server-side application logic between browser and Supabase | `docs/architecture.md:46-53` | CONFIRMED | no loader/beforeLoad/createServerFn in src/routes |
| A query that forgets a filter still cannot cross tenants | `docs/architecture.md:59-63` | CONTRADICTED | True for PostgREST table access; false for DEFINER functions (WP-VER-001) |
| attachments bucket serves credential and civil-registration workflows | `CLAUDE.md (Storage)` | CONTRADICTED | src/routes/woreda.credentials.new.tsx:372 only; 00000000000053:93-98 has no vital_event arm |
| SUPABASE_SERVICE_ROLE_KEY required by client.server.ts | `.env.example:29-30` | CONTRADICTED | client.server.ts is imported by no module |

## Blockers

- Supabase region, TLS versions, WAF enablement, preview protection and Edge `verify_jwt` need dashboard access (the owner's input, listed in `00-EXECUTIVE-SUMMARY.md`).
- Whether all 66 tables exist in production needs Appendix C query 1.
