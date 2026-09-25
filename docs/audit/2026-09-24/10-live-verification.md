# 10 — Live Verification and Owner Decisions (2026-09-25)

The original audit (2026-09-24) could not see the live system: the sandbox blocked the Supabase Management API, the Vercel API and TLS probes. On 2026-09-25 the environment's network access was opened, and the owner answered the open questions in §7 of the executive summary. This document records what was checked, how, and what changed.

## 1. Method and safeguards

| Source | How it was read | Access |
|---|---|---|
| Production database (`tugzuexfyzbdnghbmrjl`, "woreda-portal-DB") | Supabase Management API `POST /v1/projects/{ref}/database/query` with `read_only: true` (executed as `supabase_read_only_user`) | Catalog queries (Appendix C 1–10) and aggregate counts only; **no resident rows were read** |
| Supabase platform settings | `GET` Management API endpoints: Auth config, backups, Edge Functions, network restrictions, SSL enforcement, security/performance advisors, PostgREST config, organisation plan, API key names | Secret-bearing fields dropped or replaced with `[REDACTED]` before saving |
| Supabase JWKS | Public `/auth/v1/.well-known/jwks.json` | Public |
| Vercel project | `GET /v9/projects/{id}` (environment variable **names and targets only**), `GET /v1/security/firewall/config/active` | Values never requested |
| GitHub | Unauthenticated `GET /repos/eskabdi/woredas-portal/branches/main` | Public |
| TLS | SSL Labs API v3, host `woredas-portal.vercel.app` | Public |

Nothing was written to any system. Tokens came from the session environment and were never printed or saved. Every saved file was scanned for token values and token/JWT/key patterns before commit (clean). The owner's email in the organisation name was redacted. Raw outputs: `raw/live-2026-09-25/`.

## 2. Answers to the open questions (executive summary §7)

### A. Live database

| Question | Answer | Evidence |
|---|---|---|
| Were migrations 71–89 applied? How many tables? | **Yes.** 66 public tables, rental financial core present (`rent_charge`, `arrears_repayment_plan`, `payment_reconciliation_exception`, `generate_rent_charges()`, `resolve_rental_checkpoint_core()`). Migration 90 (P0-2) is **not** applied. | `t01_migration_markers.json` |
| RLS on every table? | **66 of 66** enabled; **none FORCED**. `rate_limit_bucket` has RLS with no policy and no client grants (correct). | `q01_rls_status.json`, `p06_advisors_security.json` |
| Does `anon` hold EXECUTE on `rental_eligibility` / `get_credential_live_status`? | `rental_eligibility`: **anon yes, authenticated yes** (was "probably"). `get_credential_live_status`: anon no, **authenticated yes**. The only unintended anon-callable SECURITY DEFINER RPC is `rental_eligibility`; the others are the three public verifiers. | `t02_wp_ver_001_grants.json`, `t15_anon_callable_definer_rpcs.json` |
| Existing cross-woreda civil references? | **0** in `event_details` and in the `household_id`/`resident_id` columns, so no historical cross-tenant copy to clean up before migration 90. | `t06_…`, `t07_…` |
| Live `role_permission` for `credential.verify` | Granted to civil_registrar, registry_clerk, supervisor in all 6 woredas; `false` for viewer, auditor, finance_clerk, print_officer. `default_role_perms()` still grants it to viewer/auditor, so a **new** woreda reopens WP-WF-005. | `t03_…` |
| Super admins with a console role | **0 of 2** — both unrestricted, so WP-AZ-001 has no current exposure. | `t04_…` |
| Suspended accounts | **1 suspended tenant_admin** — a live instance of WP-DB-001. | `t05_…` |
| Storage buckets | 10 buckets (listed with size/MIME limits). | `q07_buckets.json` |
| Data volume | 6 woredas, 4 residents, 2 households, 5 credentials, 2 civil events, 2 service requests, 9 payments, 7 users, 282 audit rows — pilot/test data, not a live population yet. | `t08_row_counts.json` |
| Signed QR tokens | All stored tokens canonical (86-character signature). | `t10_credential_tokens.json` |

### B. Supabase Auth

| Setting | Live value | Assessment |
|---|---|---|
| Public sign-up | Disabled | PASS |
| Anonymous sign-in | Disabled | PASS |
| JWT signing | **ES256 (P-256)** asymmetric; legacy `anon`/`service_role` API keys still enabled beside new publishable/secret keys | Good; retire legacy keys once clients use the new ones |
| Access-token lifetime | 3600 s | PASS |
| Refresh-token rotation / reuse interval | On / 10 s | PASS |
| Session time-box / inactivity timeout | **0 / 0** (Pro-plan setting) | Gap — WP-LIVE-002 |
| Password minimum / character rules | **6** / none | Gap — WP-AUTH-007 (server allows 6) |
| Leaked-password (HIBP) protection | **Off** (Pro-plan setting) | Gap — WP-AUTH-005/007 |
| CAPTCHA | **Off** | Gap — WP-AUTH-005 |
| MFA | TOTP enabled (enroll + verify); phone and WebAuthn off; **not enforced by the app** | Gap — WP-AUTH-001 |
| Rate limits (per hour) | verify 30, token refresh 150, OTP 30, email 25 | Platform defaults |
| Site URL / redirect allow-list | `https://woredas-portal.vercel.app` / `https://woredas-portal.vercel.app/**, http://localhost:5173/**` | PASS (narrow) |
| SMTP | Resend (`smtp.resend.com:465`), sender `noreply@eharari.gov.et` | Custom SMTP in place |
| Edge Function `verify_jwt` | false on 6 of 8 (invite-tenant-user, invite-platform-admin, resend-platform-invite, sign-credential, activate-invited-user, record-login); true on send-password-reset-link, resend-tenant-invite | WP-API-004 (all functions still authenticate in code) |
| Plan | **Free** | Drives OPS gaps below |

### C. Platform and operations

| Item | Live value | Finding |
|---|---|---|
| Backups / PITR | **No backups listed; PITR off**; Free plan. Owner: not set up, no Pro tier purchased. | WP-OPS-002 (Confirmed) |
| Staging | None (owner) | WP-OPS-001 (Confirmed) |
| Region / residency | Database and Storage in **AWS eu-west-1 (Ireland)**; Vercel functions in **iad1 (Washington, D.C.)** | WP-OPS-011 (Confirmed) |
| Direct Postgres network access | **0.0.0.0/0 and ::/0; SSL not enforced** | **WP-LIVE-001 (new, Medium)** |
| Vercel env vars | `SUPABASE_SERVICE_ROLE_KEY` set for Production and Preview (sensitive); no code reads it | WP-ARC-005 (Confirmed) |
| Vercel Firewall / WAF | No firewall configuration (`not_found`); platform DDoS mitigation only | WP-INV-003 (Confirmed) |
| Preview protection | Vercel Authentication on all deployments except custom domains; no custom domain attached | Good; QR still points at `*.vercel.app` (WP-OPS-008) |
| TLS (SSL Labs) | **A+ and A** on the two edges; TLS 1.2/1.3 only; forward secrecy; HSTS 2 years on one edge, absent on the other's sampled response | D-04 PARTIAL (web PASS; DB SSL not enforced) |
| GitHub `main` | Protected, but **no required status checks** | WP-OPS-004 (Confirmed) |
| Database logging | pgaudit loaded, `log_statement = ddl`; no log drain (Pro) | WP-INV-003 |
| Advisors | Security: 5 INVOKER functions with mutable `search_path` (WP-LIVE-003). Performance: 123 unindexed FKs, 13 multiple-permissive-policy tables (WP-LIVE-004, Info) | new |

### D. Owner and legal decisions

| Question | Owner answer (2026-09-25) | Effect |
|---|---|---|
| Spelling of woreda 5 | **"Jinala"** | Live DB, seed and README all say "Jineala" → WP-LOC-014 raised to Low; a data correction is needed (additive migration + seed + README). The matching Amharic form still needs the owner's confirmation (current: ጂንኤላ in DB, ጂናኤላ in README). |
| Ethiopian 12 o'clock hours | **06:00 and 18:00** | Bands for `formatEthiopianTime()`: ጠዋት 12 and 1–5 (06:00–11:59), ቀትር 6–11 (12:00–17:59), ማታ 12 and 1–5 (18:00–23:59), ለሊት 6–11 (00:00–05:59), Arabic numerals. Recorded on WP-LOC-002; not yet implemented. |
| Why ethnicity is collected | For the government to have population data and to support minorities | Purpose recorded on WP-PRV-005. **Still open:** the legal provision relied on (counsel), whether it can be optional ("prefer not to say"), and a purpose for religion, cause of death and divorce grounds. |
| "Region" | Only the administrative location (regional state) | Not special-category data; no finding. Separate from where data is hosted (WP-OPS-011). |
| Backups / PITR and Pro-tier features | Not set up; nothing requiring Supabase or Vercel Pro has been done | P0-1 cannot be met on the Free plan (see §4). |
| Proclamation No. 1321/2024 | Not answered | Still open (legal counsel). |
| Staging approval | Not approved (Pro not purchased) | P1-1 blocked. |

## 3. What changed in the audit

- **Counts:** 145 → **149** findings (+4 new: WP-LIVE-001 Medium, WP-LIVE-002 Low, WP-LIVE-003 Low, WP-LIVE-004 Info; WP-LOC-014 Info → Low). Now **Critical 1 · High 15 · Medium 51 · Low 61 · Info 21**.
- **Confidence upgraded to Confirmed:** WP-VER-001, WP-OPS-001, WP-OPS-002, WP-OPS-004, WP-OPS-011, WP-ARC-005, WP-API-004, WP-AUTH-001, WP-AUTH-005, WP-AUTH-007, WP-INV-003.
- **Exposure notes added:** WP-DB-001 (a suspended admin exists), WP-AZ-001 (no current exposure), WP-WF-005 (closed today by overrides only).
- **INSA score:** 32.8% → **33.1%** (Appendix A, 19.5/59); combined **38.2%** (27.5/72). **UNVERIFIED 1 → 0**: D-04 is now assessed (PARTIAL).
- **Verdict unchanged: NOT READY.**

Every change is data in `findings/live-verification.json`, applied last by `raw/build-register.py` and `raw/build-matrix.py`, so the register and matrix remain regenerable.

## 4. Consequences for the remediation plan

1. **P0-1 (backups) needs a purchase decision.** On the Free plan there is no platform backup. Either upgrade to Pro and add PITR, or, as an interim that the audit does not consider sufficient for a civil registry, run an owned nightly `pg_dump` plus a Storage bucket copy to storage the government controls, with a recorded restore test.
2. **P0-2 (migration 90) stays blocked on P0-1**, per the roadmap. Live data shows no historical cross-woreda references, so no data clean-up precedes it; the pre-apply queries at the end of the migration should still be run and return 0.
3. **Free-plan-compatible quick wins, no purchase needed:** enable SSL enforcement and narrow network restrictions (WP-LIVE-001); enable CAPTCHA and raise the server password minimum to 8+ (WP-AUTH-005/007); remove `SUPABASE_SERVICE_ROLE_KEY` from Vercel and rotate it (WP-ARC-005); make the `test` check required on `main` (WP-OPS-004); correct "Jinala" (WP-LOC-014).
4. **Pro-plan items (owner decision):** backups/PITR, staging project, leaked-password protection, session time-box/inactivity, log drains, Vercel WAF rules.
