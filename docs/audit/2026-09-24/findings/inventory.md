# Technology Stack, Features and Security-Infrastructure Inventory

**Audit:** woredas-portal, 2026-09-24 (Meskerem 14, 2019 EC). **Wave:** 1. **Agent:** `audit-inventory`.
**Scope:** INSA B-01, B-02 (the inventory part), B-03, B-04, B-05 and G-01, plus checking what the docs claim against what the code does.
**Baseline:** HEAD `9950f16e426eedd586c6fd85f6c328d9923542d1`. This audit was read-only and did not access any database. The machine-readable companion is `inventory.json`.

## Executive summary

The application stack is modern and small. The web app's dependencies are fully locked (`bun.lock`, `--frozen-lockfile` in CI, and a 24-hour `minimumReleaseAge` guard). No payment gateway, SMS provider or analytics SDK exists. The repository's claim that "third-party integrations: none" is therefore substantially true.

The weaknesses are in the parts the lockfile does not cover, and in documentation:

- All eight privileged Edge Functions pull `supabase-js` from esm.sh at a floating `@2`, with no pin or lock (**WP-INV-001, Medium**).
- The newest and most financially sensitive subsystem, Kebele Rental Houses billing/settlement/arrears, adds 14 tables. None of them appears in the ERD, DFD or architecture record. Only 13% of recent code commits touched any document, so G-01 fails (**WP-INV-002, Medium**).
- There is no owned detection layer: no SIEM, IDS/IPS or CSP reporting. There is no evidence the WAF is enabled, and CAPTCHA is not integrated (**WP-INV-003, Medium**).
- The `rental_houses` module toggle exists in the schema but does nothing (**WP-INV-005, Low**).
- The stack, actor and agent-guidance documents contain more than 30 checked claims that no longer match the code (**WP-INV-007/008**).

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 3 | WP-INV-001, 002, 003 |
| Low | 5 | WP-INV-004, 005, 006, 007, 008 |
| Info | 2 | WP-INV-009, 010 |

| Control | Status |
|---|---|
| B-01 Frameworks recorded | **PARTIAL**: all recorded, but every version in the doc is wrong |
| B-02 Libraries + CVEs | **PARTIAL**: 1 High advisory (build-time); no CI scanning; Edge Function dependencies not locked |
| B-03 Third-party integrations | **PARTIAL**: no payment/SMS confirmed; esm.sh and the SMTP relay are not recorded; no data/auth/secret record per integration |
| B-04 Actor types and boundaries | **PARTIAL**: generated matrix matches DB defaults; prose is stale; live overrides UNVERIFIED |
| B-05 Security infrastructure | **PARTIAL**: inherited layers are stated; WAF not evidenced; IDS/IPS/SIEM absent |
| G-01 Living documentation | **FAIL**: 13% of code commits carry any doc change (8% for architecture-class docs) |

---

## 1. Development frameworks (B-01)

The resolved version is what `bun.lock` pins and CI installs (`bun install --frozen-lockfile`, `.github/workflows/ci.yml:30`). It was cross-checked against `node_modules/*/package.json`. The documented version is from `docs/tech-stack.md:10-20`.

| Layer | Package | Resolved (lock) | Documented | Match |
|---|---|---|---|---|
| UI | react / react-dom | 19.2.8 | 19.2.0 | No |
| Meta-framework / server entry | @tanstack/react-start | 1.168.46 | 1.168.44 | No |
| Routing | @tanstack/react-router / router-plugin | 1.170.29 / 1.168.32 | 1.170.27 / — | No |
| Server state | @tanstack/react-query | 5.101.4 | 5.83.0 | No |
| Client state | zustand | 5.0.15 | 5.0.14 | No |
| Forms / validation | react-hook-form / zod / @hookform/resolvers | 7.85.0 / 3.25.76 / 5.9.0 | 7.71.2 / 3.24.2 / — | No |
| Styling | tailwindcss / @tailwindcss/vite (+ shadcn/ui on 27 Radix primitives) | 4.3.3 / 4.3.3 | 4.2.1 | No |
| Build | vite / @vitejs/plugin-react / lightningcss | 8.2.1 / 5.2.0 / 1.33.0 | 8.0.16 | No |
| SSR/server build | nitro | **3.0.260603-beta** (pre-release) | "nitro" (no version) | — |
| Language | typescript (`strict: true`, tsconfig.json:18) | 5.9.3 | 5.8.3 | No |
| Backend SDK | @supabase/supabase-js | 2.112.3 | 2.108.2 | No |
| Test | vitest / jsdom / @testing-library/* | 4.1.11 / 30.0.1 | 4 / 30 | Approx. |
| Lint/format | eslint / prettier / typescript-eslint | 9.39.5 / 3.9.6 / 8.67.0 | 9 / 3.7 | Approx. |
| Package manager | bun | 1.3.11 (`packageManager`, CI pinned) | bun | Yes |
| Edge runtime | Deno (Supabase Edge) + `https://esm.sh/@supabase/supabase-js@2` | **unpinned** | not recorded | — |

The documented versions are the caret floors from `package.json`. The document itself says it "narrates" `package.json` (tech-stack.md:3-6), which is where the gap comes from. Generating the table from `bun.lock` would close it (WP-INV-007).

## 2. Libraries and plugins (B-02)

- **Counts:** 87 direct dependencies (64 runtime, 23 dev). About 580 resolved entries in `bun pm ls --all` (`raw/inventory-bun-pm-ls-all.txt`).
- **Advisories:** `bun audit` lists 1 vulnerability: **js-yaml `>=4.0.0 <4.3.2`, High, GHSA-2883-xcg3-v3hh**. It is pulled in through `eslint › @eslint/eslintrc` and `@tanstack/react-start › @tanstack/start-plugin-core › xmlbuilder2`. Both are build tooling, so it is not expected in the shipped bundle (`raw/inventory-bun-audit.txt`; WP-INV-004).
- **Staleness:** 38 packages are behind (`raw/inventory-bun-outdated.txt`). Notable ones:
  - supabase-js 2.112.3 → 2.117.1
  - react 19.2.8 → 19.3.0
  - @tanstack/react-start 1.168.46 → 1.168.58
  - Majors available but not adopted: zod 4, recharts 3, pdfjs-dist 6 / react-pdf 11, vitest 5, TypeScript 7
- **Pins:**
  - `pdfjs-dist` is pinned exactly (5.4.296) to match react-pdf 10.5.0. It is well past the CVE-2024-4367 fix line.
  - `nitro` is pinned to a beta (WP-INV-009).

Functional library inventory (application-facing):

| Function | Package @ resolved version |
|---|---|
| PDF generation / print | jspdf 4.2.1, html2canvas-pro 2.4.0, react-to-print 3.3.0 (html2canvas 1.4.1 is transitive only, via jspdf) |
| PDF viewing | pdfjs-dist 5.4.296, react-pdf 10.5.0 |
| QR render / scan | qrcode.react 4.2.0 / html5-qrcode 2.3.8 |
| Barcode | jsbarcode 3.12.3 (Code 128) |
| Maps | leaflet 1.9.4, react-leaflet 5.0.0 |
| Charts | recharts 2.15.4 |
| Motion | framer-motion 12.43.0 |
| Dates | date-fns 4.4.0, react-day-picker 9.14.0 (Ethiopian calendar is in-house: `src/utils/ethiopianCalendar.ts`) |
| UI primitives | 27 × @radix-ui/*, cmdk 1.1.1, vaul 1.1.2, sonner 2.0.8, embla-carousel-react 8.6.0, input-otp 1.4.2, react-resizable-panels 4.12.2, lucide-react 0.575.0 |
| HTML sanitising | **none from npm**: `dompurify` 3.4.13 is transitive only (via jspdf) and not imported. Letter templates use an in-house allow-list sanitiser (`src/lib/letterTemplate.ts`), which the appsec reviewer owns. |
| i18n | **none**: react-i18next/i18next are not installed. Labels are inline bilingual strings. |

**Edge Function dependencies** sit outside `bun.lock` entirely. Every function imports `https://esm.sh/@supabase/supabase-js@2`, and there is no `deno.json`, import map or `deno.lock` under `supabase/`. The code that runs with the `service_role` key and the ES256 signing key is whatever esm.sh serves on deploy day (**WP-INV-001**).

## 3. Third-party integrations (B-03)

A repo-wide search for external URLs and SDKs found no payment, SMS or analytics integration. The search covered `src/`, `supabase/functions`, `public/`, `package.json`, `vite.config.ts` and the scripts, and looked for Stripe, Chapa, Telebirr, Twilio, SendGrid, Sentry, PostHog, gtag and similar names. Revenue is recorded internally. `payment.channel` is a data field, not a processor.

| Integration | Kind | Data shared | Auth method | Secret location | Recorded in repo docs? |
|---|---|---|---|---|---|
| Supabase (PostgREST, GoTrue, Storage, Edge Functions, Postgres) | BaaS / data processor | All application data and PII | Anon/publishable key + user JWT (browser); service_role key and `HARARI_EC_PRIVATE_KEY` (Edge) | Client: `VITE_SUPABASE_*` at build time. Edge: Supabase function secrets (`Deno.env.get`, e.g. `sign-credential/index.ts:68-71`). Deploy: `SUPABASE_ACCESS_TOKEN` in the operator's shell only | Yes (architecture.md), but the region/data residency is not recorded |
| Vercel | Hosting / SSR / edge TLS | Every HTTP request; build-time env | Vercel project; `VERCEL_TOKEN` for deploys | Vercel dashboard env; operator shell | Yes (architecture.md, security-hardening.md). **No `vercel.json`** in the repo: framework preset and env are dashboard-only |
| Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) | CDN, runtime, every page including public verify pages | Visitor IP, User-Agent, origin (Referrer-Policy `strict-origin-when-cross-origin`) | None | — | Yes, but stale (claims Noto is primary; Tayitu/Jiret are self-hosted) |
| OpenStreetMap tile servers (`{s}.tile.openstreetmap.org`) | Map tiles, runtime | Staff IP plus tile z/x/y around the household/rental location being viewed | None | — | Yes |
| esm.sh | Code CDN, **deploy-time** | Nothing sent; **code received** into service-role functions | None | — | **No** |
| GoTrue SMTP relay (provider unnamed) | Outbound e-mail for invite/recovery links | Staff e-mail addresses, one-time auth links | SMTP credentials in the Supabase dashboard | Supabase dashboard | **No** (architecture.md:471 mentions "its mail relay"; DMARC `p=none`) |
| GitHub / GitHub Actions | Source hosting, CI | Source code | `GITHUB_TOKEN`, `permissions: contents: read` (ci.yml:8-9) | GitHub | Partially |
| Browser device APIs | Camera (html5-qrcode), geolocation (Leaflet) | Local only | Permissions-Policy `camera=(self), geolocation=(self)` | — | Yes |

Findings: WP-INV-001 (esm.sh), WP-INV-006 (fonts/OSM privacy), WP-INV-010 (SMTP relay).

## 4. Actor types and permission boundaries (B-04)

The audit brief expects "8 roles". The code defines **9 built-in roles plus a tenant-defined `custom` role**, alongside several non-staff actors. Sources:

- Client: `src/config/permissions.ts:1-20`, `ROLE_PERMISSIONS` at :198-466.
- DB whitelist: `app_user_role_check` at `00000000000041_task13_review_hardening.sql:196-201`, plus the `validate_app_user_role()` trigger.
- DB default grants: `default_role_perms()`, whose latest definition is in `00000000000083_rental_phase5_checkpoint.sql:96-112`.
- `bun run check:role-perms-drift` prints: `OK: permissions.ts and default_role_perms() agree for every role.`
- `generate-permissions-doc.ts --check` reports `docs/permissions-matrix.md` in sync.

| Actor | Scope | Default grant boundary (compiled = SQL default) | Editable per tenant? | DB enforcement |
|---|---|---|---|---|
| `super_admin` | Platform | platform.manage, tenant.create/manage, user.manage, audit.view, report.view. Holds **no** tenant data-plane perms by default; bypasses via `is_super_admin()` in policies | No (A7: excluded from `role_permission_role_name_check`) | `is_super_admin()`, plus a second axis: `console_role` / `user_has_console_perm()` (5 `CP` keys; `console_role_id IS NULL` = unrestricted) |
| `tenant_admin` | One woreda | 79 perms (default_role_perms, migration 83:103), i.e. every tenant perm including the reserved ones (tenant.manage, user.manage, credential.approve/revoke, civil.approve, rental.policy.configure, rental.reverse…) | No (A7) | `user_has_perm()` + `get_user_woreda_id()` |
| `supervisor` | One woreda | Approvals/verification across modules | Yes (`role_permission`) | same |
| `civil_registrar` | One woreda | Residents + civil registration | Yes | same |
| `registry_clerk` | One woreda | Residents/households/credential intake | Yes | same |
| `finance_clerk` | One woreda | Payments/revenue/rental collection | Yes | same |
| `auditor` | One woreda | Read-only across modules + audit.view, report.view, rental.report (14 perms) | Yes | same |
| `viewer` | One woreda | Read-only (9 perms) | Yes | same |
| `print_officer` | One woreda | credential read/view/preview_print/confirm_print/authorize_reprint/activate, approval.queue.view (7 perms) | Yes (whitelisted since migration 35) | same |
| `custom` (tenant_role) | One woreda | **None by default** (`ROLE_PERMISSIONS.custom = []`); grants only via `tenant_role_permission` | Yes, by definition; reserved keys excluded by CHECK | `user_has_perm()` custom branch (migration 39) |
| Pending / suspended user | Authenticated, no data | `user_has_perm()` requires `status='active'` | — | same |
| Anonymous public verifier | Unauthenticated | EXECUTE on `verify_credential_token` (00000000000034:305), `verify_receipt` (00000000000013:189), `verify_service_letter` (left open: 00000000000007:70, 00000000000008:70) | — | GRANT to `anon` |
| Edge Functions (system actor) | Service role | Bypass RLS; each re-derives the caller from its JWT | — | In-function checks (owned by audit-api-edge) |
| Resident / applicant | No login | Data subject only; staff key in their data | — | — |

Boundary caveats:

1. `role_permission` per-tenant rows, `user_permission_override` rows and custom roles are live data and **UNVERIFIED** here.
2. Module gating (`tenant_module_config`) is a third axis, and one of its keys, `rental_houses`, is not enforced anywhere (**WP-INV-005**).
3. The prose actor list in `docs/tech-stack.md:71-78` omits `print_officer` and `custom`.

## 5. Security infrastructure (B-05)

| Layer | Status | Provider / location | Evidence |
|---|---|---|---|
| TLS termination and certificates | **Inherited** | Vercel edge; Supabase | docs/architecture.md:81; docs/security-hardening.md:82 |
| HSTS | **Owned** | `max-age=63072000; includeSubDomains` (no preload) | src/lib/security-headers.ts:77 |
| CSP / XFO / Permissions-Policy / nosniff / Referrer-Policy | **Owned** | Documents only; `script-src 'unsafe-inline'` is a known limitation | src/lib/security-headers.ts:48-97 |
| DDoS (L3/L4) | **Inherited** | Vercel + Supabase platform | docs/architecture.md:82 (provider claim; not independently verifiable) |
| Load balancing | **Inherited (implicit)** | Vercel edge network / Supabase managed. Not explicitly recorded in repo docs | — |
| WAF | **Unverified**: available but opt-in | Vercel Firewall managed ruleset, listed as a to-do dashboard action | docs/security-hardening.md:52-54; architecture.md:83 |
| IDS / IPS | **Absent** | None found | tech-stack.md:85 ("No dedicated WAF/IDS-IPS/SIEM") |
| SIEM / log forwarding / alerting | **Absent** | No log drain, no Sentry/Datadog, no CSP `report-to` | grep: no matches; security-headers.ts:50-63 |
| Application audit trail | **Owned** | `audit_log`, `workflow_status_history`, and trigger writers (the database/logging agents own the depth review) | CLAUDE.md "Audit trail"; migrations 25, 58 |
| Rate limiting | **Owned (partial) + Inherited** | `rate_limit_hit()` in 5 Edge Functions (invites/resends/password reset); GoTrue built-in limits (dashboard) for sign-in | `grep checkRateLimit(`; security-hardening.md:64-65 |
| Bot protection / CAPTCHA | **Absent (likely)** | `login.tsx:96-99` sends no `captchaToken`, which implies CAPTCHA is off | src/routes/login.tsx:96 |
| Leaked-password protection, auth rate limits, DB network restrictions | **Unverified** | Supabase dashboard only | security-hardening.md:62-74 |
| Secrets management | **Inherited** | Supabase function secrets; Vercel env; operator shell for deploy tokens | .env.example (placeholders only); deploy-functions.sh:46-55 |
| Staging / separate environments | **Absent** | Staging declined (free-tier cap) | architecture.md:446-451 |
| Custom domain (a prerequisite for a Cloudflare-class edge) | **Absent** | Production is `woredas-portal.vercel.app` | src/config/credentialCryptoConfig.ts:40; security-hardening.md:86-89 |

Finding: **WP-INV-003**.

## 6. Features claimed vs present

**Present in code but missing from, or thin in, the governing docs** (CLAUDE.md, architecture.md, erd.md, dfd.md, tech-stack.md):

- **Kebele Rental Houses financial core** (migrations 71-89, first added 2026-09-21). It comprises 14 tables:
  - Policy and accounts: `rental_policy`, `rent_account(_sequence)`, `rent_rate_history`, `rent_charge`
  - Payments and settlement: `rental_payment`, `rent_payment_settlement`, `payment_reconciliation_exception`
  - Arrears: `arrears_plan_sequence`, `arrears_repayment_plan`, `arrears_repayment_installment`, `arrears_installment_charge`
  - Reminders and checkpoints: `rent_reminder`, `service_request_checkpoint`

  It also adds 9 `*_decrypted` views, 5 `get_rental_*` report RPCs, settle/reverse/plan RPCs, and the routes `/woreda/rental-accounts/$occupancyId` and `/woreda/rental-reports`. It is absent from erd.md, dfd.md, architecture.md and api-security.md. The only coverage is `docs/rental-policy-decisions.md` and partial mentions in `security-functionality.md` (WP-INV-002).
- **Public receipt verification** (`verify_receipt`, anon-granted). It is missing from the "two public RPCs" statements (CLAUDE.md:196, architecture.md:89).
- **Column-level PII encryption layer** (Phase C: `encrypt_pii_*`, `derive_woreda_key`, 17 views of which most are `*_decrypted`). Documented in `docs/phase-c-stage4-design.md` and `security-functionality.md`; not mentioned in CLAUDE.md or tech-stack.md.
- **Service worker and offline form queue** (`public/sw.js`, `src/lib/offlineQueue.ts`, `useServiceWorker.ts`). The queue persists form payloads to `localStorage` (offlineQueue.ts:43, 63). Documented only in `docs/task12c-mapping-memo.md`. Handed off to the privacy reviewer.
- **The `rental-request-documents` storage bucket** (00000000000001_storage.sql:33): the 10th bucket, absent from every bucket count.
- **The `rental-financial-integrity-review` agent**: tracked, but not in CLAUDE.md's agent table.

**Claimed but absent or ineffective:**

- **`rental_houses` module toggle.** Present in the CHECK constraint and the TypeScript type, but has no gate, no admin UI and no server check (WP-INV-005).
- **`WoredaShell.tsx` / `AdminShell.tsx`.** Replaced by `AppShell.tsx` after the UX merge (PR #79).
- **`vercel.json` framework settings** that CLAUDE.md describes. Not in the repo.
- **`verify_jwt:false` Edge deployment** (security-hardening.md:40-41). Not in `config.toml` or the deploy script, so the live setting is unknown.
- **Staging environment.** A runbook exists; the environment does not. The docs are honest about this.
- **react-i18next, a Workbox PWA and html2canvas** (README/brief). Not adopted.

All 31 checked claims, with verdicts, are in `inventory.json` → `drift[]`. Summary: 6 CONFIRMED, 22 CONTRADICTED, 3 NOT FOUND.

## 7. Living documentation (G-01)

Method: `git log -50 --no-merges --name-only` from HEAD, with each commit classified by the paths it touches (`raw/inventory-g01-doc-cooccurrence.txt`).

| Metric | Value |
|---|---|
| Non-merge commits sampled | 50 |
| Commits touching code (src/, migrations, functions, seed) | 39 |
| …that also touched any doc (docs/**, CLAUDE.md, README) | 5 (13%) |
| …that also touched a DFD/ERD/SFD/API/architecture/tech-stack/permissions doc | 3 (8%) |
| INSA threshold | ≥ 80% |
| "Add security later" deferrals in code/docs | none found |

Six consecutive "rental review round N" security-fix migrations (84-89) landed with no documentation change. `docs/erd.md` was last changed on 2026-09-14 and `docs/dfd.md` on 2026-09-05, both before the rental financial core existed. **G-01: FAIL.**

## 8. Findings

### WP-INV-001: Edge Functions load `supabase-js` from esm.sh at floating `@2` (Medium, Supply Chain, Confirmed)

All 8 functions import `https://esm.sh/@supabase/supabase-js@2` (e.g. `sign-credential/index.ts:1`). No import map or lockfile exists under `supabase/`, and `deploy-functions.sh:40` bundles whatever is current at deploy time.

These functions hold `SUPABASE_SERVICE_ROLE_KEY`, and `sign-credential` also holds `HARARI_EC_PRIVATE_KEY` (`sign-credential/index.ts:71`). A compromised 2.x release, or a problem on the esm.sh side, would ship into production silently and could exfiltrate both. The code itself admits the resolved source is not reviewed (`send-password-reset-link/index.ts:156-158`).

**Fix:** use a `deno.json` import map with `npm:@supabase/supabase-js@2.112.3` (matching bun.lock), commit a `deno.lock`, and re-pin whenever bun.lock changes.

### WP-INV-002: Living documentation not maintained; rental financial core undocumented (Medium, Docs, Confirmed)

See sections 6 and 7. The effect is that the controls on a money-handling subsystem, one with six rounds of security-fix migrations, have no ERD, DFD or SFD evidence.

**Fix:** document the rental core across erd/dfd/SFD/api-security/openapi, and refresh architecture.md's counts. Add a static CI check that fails when a migration's `CREATE TABLE` name is missing from erd.md.

### WP-INV-003: No evidenced detection layer; WAF unverified; no CAPTCHA (Medium, Logging, Needs-live-verification)

See section 5. Credential stuffing against `/login` or enumeration of the public RPCs would raise no alert.

**Fix:**
- Enable the Vercel Firewall and keep evidence that it is on.
- Add Supabase/Vercel log drains to a retained, alerting store.
- Add a CSP `report-to` endpoint.
- Integrate Turnstile/hCaptcha into `login.tsx` before switching it on in Supabase.
- Record every layer as Owned, Inherited or Absent.

### WP-INV-004: One High advisory (js-yaml, build-time); no dependency scanning in CI (Low, Supply Chain, Likely)

GHSA-2883-xcg3-v3hh, reached via eslint and the TanStack Start plugin. `ci.yml` has no `bun audit` step, and there is no Dependabot or Renovate.

**Fix:** update the parent packages, and add `bun audit --audit-level=high` to CI.

### WP-INV-005: `rental_houses` module toggle is not enforced (Low, Config, Confirmed)

`baseline.sql:615` and `permissions.ts:474` accept the key. However:

- No `ModuleGate` uses it.
- The rental nav items (permissions.ts:536, 543) have no `moduleKey`.
- `useTenantModules.ts:6-14` and the admin `MODULES` lists omit it.
- No RPC checks it.

The rental routes are still permission-gated, so this is not an authorization bypass. The module simply cannot be turned off per tenant.

**Fix:** add the gate, the nav keys, the admin toggle and a server-side check.

### WP-INV-006: Google Fonts and OSM tiles leak IPs and viewed locations to third parties (Low, Privacy, Confirmed)

The root shell loads Noto Sans Ethiopic and Inter from Google on every page, including the public verification pages (`__root.tsx:124`). OSM tile coordinates reveal which neighbourhoods and residences staff are looking at (`LocationPickerMap.tsx:8`, `LocationDisplayMap.tsx:4`).

**Fix:** self-host both fonts, as Tayitu and Jiret already are. Use a contracted or self-hosted tile service.

### WP-INV-007: Stale Phase-2 inventory document (Low, Docs, Confirmed)

`docs/tech-stack.md` has wrong versions (all 11), omits `print_officer` and `custom`, gives a wrong font citation (`styles.css:23` is Jiret), and omits esm.sh, the SMTP relay, Vercel/Supabase as processors, and GitHub.

**Fix:** generate the version table from bun.lock and add a CI `--check`. Expand the integrations table using section 3 above.

### WP-INV-008: CLAUDE.md contradicts the code in at least 12 places (Low, Docs, Confirmed)

This matters more than usual because 129 of the 177 commits are agent-authored. The contradictions:

- UX restructure called unmerged, but it is merged.
- `WoredaShell`/`AdminShell` are named, but they are gone.
- "No test suite", but there are 23 test files.
- Reset links said to be "not triggered by UI", but they are.
- 7 agents claimed; there are 8.
- 9 buckets claimed; there are 10.
- 67 route files claimed; there are 69.
- 52 tables claimed; there are 66.
- 2 public RPCs claimed; there are 3.
- "Six" functions import `_shared`; all eight do.
- Rate limiting is said to cover 4 functions; it covers 5.
- The module list omits `rental_houses`.

**Fix:** correct these statements, and point hard-coded counts at generated sources.

### WP-INV-009: nitro beta in the production build; `actions/checkout` not SHA-pinned (Info)

`package.json:104`, `ci.yml:15`. Track nitro to a stable release, and SHA-pin `actions/checkout`.

### WP-INV-010: SMTP relay provider unnamed; DMARC `p=none` (Info, Needs-live-verification)

`architecture.md:471-479`. Record the provider, the data it receives and where its secret lives, and finish moving DMARC to `p=reject`.

## 9. Hand-offs to other agents

- **audit-api-edge:** the live `verify_jwt` setting per function (the security-hardening.md claim was NOT FOUND in the repo), and the esm.sh pinning in WP-INV-001.
- **audit-authz:** RBAC-03 server-side module enforcement generally (only `services` is checked server-side); `rental_houses` (WP-INV-005).
- **audit-architecture:** A-02/A-07 for the rental core; Supabase region / data residency is not recorded anywhere.
- **Privacy / appsec:** the offline queue's use of `localStorage` for form payloads (PII at rest in the browser); the in-house letter HTML sanitiser (no DOMPurify).

## 10. Raw evidence produced

- `raw/inventory-bun-audit.txt`: `bun audit` output
- `raw/inventory-bun-outdated.txt`: `bun outdated`
- `raw/inventory-bun-pm-ls-all.txt`: `bun pm ls --all`
- `raw/inventory-g01-doc-cooccurrence.txt`: per-commit classification for G-01

No application file, lockfile, config or migration was modified. `git status` shows only `docs/audit/` and the pre-existing untracked `.claude/agents/audit-*.md`.
