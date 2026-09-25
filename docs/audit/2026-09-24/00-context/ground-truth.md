# Phase 0 — Ground Truth

Audit of `eskabdi/woredas-portal` (Woreda Administration ERP · ወረዳ አስተዳደር ሥርዓት).
Mode: read-only, evidence-based. All facts below were collected from the repository working
tree by the Lead Auditor; raw command outputs are under `../raw/`.

## 1. Session record

| Item | Value |
|---|---|
| Remote | `origin https://github.com/eskabdi/woredas-portal` (fetch/push) — confirmed repo root |
| Branch | `claude/read-and-execute-ipi0yo` (session branch; identical to `main` at audit start) |
| HEAD SHA | `9950f16e426eedd586c6fd85f6c328d9923542d1` — "Merge pull request #83 from eskabdi/claude/woredas-portal-amharic-manual-0x86rz" |
| `git status --porcelain` | clean (empty) at audit start |
| Date (Gregorian) | 2026-09-24 (Thursday), 17:20 UTC |
| Date (Ethiopian Calendar) | Meskerem 14, 2019 EC (መስከረም 14 ቀን 2019 ዓ.ም.) — Arabic numerals per project convention |
| Local time at start (Ethiopian clock) | 20:20 EAT (UTC+3) = 2:20 ማታ |
| Live database access | **Not available.** No `SUPABASE_ACCESS_TOKEN` or project-ref variable is present in the session environment, and CLAUDE.md documents that Postgres ports are blocked from this sandbox. Appendix C catalog queries could not be run; every live-dependent control is marked `UNVERIFIED` and the queries are handed to the user (`../reference/appendix-c-catalog-queries.md`). |
| Supabase MCP server | Not connected in this session. |

## 2. Repository map

- Tracked files: **491** (`raw/git-ls-files.txt`).
- Total tracked lines ≈ 169,648. By language (tracked files only):

| Language | Lines |
|---|---|
| TSX | 51,823 |
| SQL | 27,876 (90 migration files + `seed.sql` 733 KB + `seed-app-users.sql` + scripts) |
| TS | 20,376 (incl. generated `src/integrations/supabase/types.ts`, 240 KB, and `src/routeTree.gen.ts`) |
| Markdown | 15,481 |
| JS / MJS | 4,639 |
| CSS | 801 |
| Shell / Python | 796 / 221 |

- Top-level: `src/` (routes 72 files incl. `README.md` + `__tests__`, components 98 files in 15 folders, lib 33, hooks 19, utils 11, config 6, stores 2, integrations 5), `supabase/` (90 migrations, 8 Edge Functions + `_shared`, `config.toml`, `seed.sql`, `seed-app-users.sql`), `public/` (`favicon.png`, `fonts/Tayitu-Regular.woff2`, `fonts/Jiret-Regular.woff2`, `images/`, `sw.js`), `scripts/` (drift checks, deploy/phase-C scripts, staging seed script), `docs/` (≈35 documents + `ux/`), `.claude/` (8 pre-existing agents, skills, designs), `.github/workflows/ci.yml`.
- Largest tracked files: `docs/woreda-portal-manual-am.pdf` (2.6 MB), `supabase/seed.sql` (733 KB), two Noto Sans Ethiopic TTFs under `.claude/skills/woreda-manual/assets/fonts/` (365 KB each), `types.ts` (240 KB), `docs/remediation-report.md` (224 KB), `bun.lock` (162 KB), baseline migration (155 KB).

## 3. Git health

- Last 50 commits: `raw/git-log-50.txt`; with file names: `raw/git-log-50-names.txt`.
- Contributors (all branches): `Claude <noreply@anthropic.com>` 129 commits, `eskabdi` 48 commits. The codebase is overwhelmingly agent-authored.
- Cadence: 6 commits in 2026-08, 171 in 2026-09 (`raw/commit-cadence.txt`). Very young, very fast-moving history (~6 weeks).
- Branches: `main`, `claude/read-and-execute-ipi0yo` (local + origin).
- Recent work is dominated by the Kebele Rental Houses phases 0–5 and six rounds of rental review fixes (migrations 71–89).
- `.gitignore` covers `.env`, `.env.*` (except `.env.example`), `.env*`, `p.json`, `payload.json`, `*.pem`, `*.key`, `supabase/.temp/`, `.vercel`, `.claude/settings.local.json`, `package-lock.json`.
- Only `.env.example` has ever been added under an `*.env*` pattern (`git log --all --diff-filter=A -- '*.env*'`); it contains placeholders only.

## 4. Manifest facts (installed = `node_modules/*/package.json`, lock = `bun.lock`)

Package manager: **bun 1.3.11** (`packageManager` field, `bun.lock`, `bunfig.toml`). No `package-lock.json` (deliberately removed and gitignored), so `npm audit` / `npm outdated` / `npm ls` from the audit prompt are not the correct tools here — `bun audit` / `bun outdated` are.

| Claimed package | Installed | Status |
|---|---|---|
| react / react-dom | 19.2.8 | Present |
| @tanstack/react-start | 1.168.46 | Present |
| @tanstack/react-router | 1.170.29 | Present |
| @tanstack/react-query | 5.101.4 | Present |
| zustand | 5.0.15 | Present |
| react-hook-form | 7.85.0 | Present |
| zod | 3.25.76 | Present |
| tailwindcss (v4) | 4.3.3 | Present |
| framer-motion | 12.43.0 | Present |
| @supabase/supabase-js | 2.112.3 | Present |
| leaflet / react-leaflet | 1.9.4 / 5.0.0 | Present |
| qrcode.react | 4.2.0 | Present |
| html5-qrcode | 2.3.8 | Present |
| html2canvas | 1.4.1 (transitive only) | **Drift:** app uses `html2canvas-pro` 2.4.0 directly |
| jspdf | 4.2.1 | Present |
| react-to-print | 3.3.0 | Present |
| react-i18next / i18next | — | **Not installed** (claim of "documented but not installed" confirmed) |

Present but not in the Section 3 claims: `jsbarcode` 3.12.3, `recharts` 2.15.4, `pdfjs-dist` 5.4.296 (pinned), `react-pdf` 10.5.0, `html2canvas-pro` 2.4.0, 27 `@radix-ui/*` primitives, `cmdk`, `vaul`, `sonner`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `date-fns`. Toolchain: vite 8.2.1, typescript 5.9.3, vitest 4.1.11, nitro `3.0.260603-beta` (a pinned beta), eslint 9. `dompurify` 3.4.13 is present only transitively (via jspdf) — the app does not import it.

## 5. Route inventory

Full table: `raw/route-inventory.md` (72 route files; regex-extracted guards — a "—" means no route-level gate matched the regex, not that the page is unguarded; guards may live inside child components). Summary:

- **Public (no auth):** `/`, `/login`, `/set-password`, `/v/$token` (credential verify), `/verify/letter/$token`, `/verify/receipt/$token`.
- **Admin console** (`/admin/*`, 8 files): layout `admin.tsx`; `ConsolePermissionGate` on audit, console-roles, tenant detail/provision; none matched on `admin.credential-template.tsx`, `admin.dashboard.tsx`, `admin.tenants.index.tsx`.
- **Woreda OS** (`/woreda/*`, 57 files): `ModuleGate` on the `approvals`, `audit`, `civil`, `complaints`, `credentials`, `reports`, `revenue`, `services` layouts. **No `ModuleGate` found for households, residents, rental-houses, rental-accounts, rental-reports** (rental is not one of the seven module keys). No route-level `PermissionGate` matched on most rental routes and several print routes — to be verified by audit-authz.
- Every route file except `__root.tsx` sets `ssr: false` (confirmed by regex).
- Dynamic segments: `$woredaId`, `$eventId`, `$requestId` (credentials, services, rental requests), `$householdId`, `$houseId`, `$occupancyId`, `$residentId`, `$paymentId`, `$reportType`, `$token`. RT-01 verdicts are the build-quality agent's job.

## 6. Supabase surface

- **Migrations:** 90 files, `00000000000000_baseline.sql` → `00000000000089_rental_review_round6_fixes.sql` (additive-only by project convention).
- **`supabase/config.toml`:** contains only `project_id = "woredas-portal"`. No `[functions.*] verify_jwt` entries, no auth settings — **all Supabase Auth configuration (JWT expiry, password policy, MFA, rate limits, session time-box) lives in the dashboard and is not visible in the repo.**
- **Edge Functions (8):** `sign-credential`, `invite-tenant-user`, `invite-platform-admin`, `resend-platform-invite`, `resend-tenant-invite`, `activate-invited-user`, `record-login`, `send-password-reset-link`, plus `_shared/` (`response.ts`, `rateLimit.ts`, `clientIp.ts`, …).
- **Generated types** (`src/integrations/supabase/types.ts`, `raw/types-inventory.txt`): **66 tables, 17 views, 64 functions, 0 enums** in `public`. Migrations `CREATE TABLE` 66 distinct public tables (one regex artefact, `quietly`, excluded) — table sets match.
  - 14 of the 17 views are `*_decrypted` views (column-level PII encryption layer, "Phase C"), plus `approval_queue_v`, `household_member_roster`, `service_request_decrypted`.
  - PII-encryption functions exist: `encrypt_pii_text/numeric`, `decrypt_pii_text/numeric`, `derive_woreda_key`, `pii_root_key`, blind-index functions for national ID and phone.
- **Client usage:** tables queried directly via PostgREST most: `resident` (35 call sites), `household` (20), `woreda` (12), `kebele` (10), `payment` (8), `receipt` (7). 22 distinct RPCs called from the client; 6 Edge Functions invoked from the client (`sign-credential` is not invoked by name from `src/` via the regex — verify).
- **Storage:** 10 `INSERT INTO storage.buckets` statements in migrations (CLAUDE.md claims 9 buckets). Buckets referenced by the client include `resident-photos`, `tenant-assets`, `resident-documents`, `staff-assets`, `service-request-documents`, `resident-clearance-letters`, `credential-templates`, `attachments`, `credential-request-documents`.
- **Schema-source triangulation:** migrations ↔ `types.ts` agree on the 66-table set. Live DB: **UNVERIFIED** (no access).

## 7. Environment & secrets map (`raw/env-refs.txt`)

| Variable | Where read | Exposure | Note |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `src/integrations/supabase/client.ts` | Client bundle | Public by design |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `client.ts` | Client bundle | Anon key, public by design (RLS-bound) |
| `VITE_PUBLIC_SITE_URL` | QR/verify URL builders | Client bundle | Public |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | `client.server.ts`, scripts | Server/scripts | |
| `SUPABASE_SERVICE_ROLE_KEY` | `client.server.ts` (imported by nothing), scripts | Server only | Not `VITE_`-prefixed — correct |
| `SUPABASE_ACCESS_TOKEN` | one script | Operator env only | Absent from `.env.example` by design |
| `Deno.env.get("SUPABASE_URL" / "SUPABASE_ANON_KEY" / "SUPABASE_SERVICE_ROLE_KEY")` | all 8 Edge Functions | Edge secrets | |
| `Deno.env.get("SITE_URL")` | 6 Edge Functions | CORS allow-list + redirects | |
| `Deno.env.get("HARARI_EC_PRIVATE_KEY")` | `sign-credential` | Edge secret | **ES256 (EC P-256), not RS256** as the brief claims |

No `VITE_`-prefixed secret was found.

## 8. Documentation inventory (claims, not truth)

`README.md` (Phase 1 scaffold spec, mostly marked Superseded), `CLAUDE.md` (agent guidance; detailed architectural claims), `docs/architecture.md` (authoritative design record), `docs/erd.md` (claims 52 tables live-enumerated — **types.ts/migrations show 66**), `docs/dfd.md`, `docs/openapi.yaml` (OpenAPI **3.0.3**, 673 lines, "Edge Function API"), `docs/api-security.md`, `docs/security-functionality.md`, `docs/security-hardening.md`, `docs/tech-stack.md`, `docs/testing-scope.md`, `docs/permissions-matrix.md` (generated), `docs/staging-runbook.md` (staging not provisioned), `docs/go-live-declaration.md` (unsigned), `docs/rbac-security-forensic-review.md`, `docs/rbac-remediation-tracker.md`, `docs/remediation-report.md`, `docs/system-review-2026-09.md`, `docs/rental-policy-decisions.md`, `docs/phase-c-stage4-design.md`, task mapping memos (12, 12c, 14a/b/c), incident report 2026-09-15, `docs/amharic-strings-glossary.csv`, Amharic user manual (md + pdf), `docs/ux/*` (9 files).

## 9. Early drift signals (to be confirmed by agents)

1. QR signing is **ES256**, not RS256 (CLAUDE.md, `sign-credential`, `credentialCryptoConfig.ts`).
2. Credential number is **13-digit Luhn**, not `WW-KK-YY-NNNNNN-C` mod-11 (migration `00000000000002_credential.sql`).
3. **9 built-in roles + `custom`**, not 8 (`print_officer` added; `custom` tenant-defined).
4. Role/Permission matrix UI and ID Card Template editor — claimed "not built"; both appear to exist (`woreda.settings.users-permissions.tsx`, `admin.credential-template.tsx`).
5. `docs/erd.md` table count (52) lags the schema (66).
6. Column-level PII encryption layer exists (14 `*_decrypted` views) — not mentioned in the brief.
7. `html2canvas-pro` replaces `html2canvas`; `react-i18next` absent.
