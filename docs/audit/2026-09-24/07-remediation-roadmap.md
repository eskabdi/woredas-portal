# 07 — Remediation Roadmap

Prioritised plan for the verified findings in `02-findings-register.md`. Every fix must follow the repo's
deploy rules: additive migrations only (`CREATE OR REPLACE`, never edit an applied file); the Management-API
three-phase process (dry-run in `BEGIN…ROLLBACK`, apply, verify against `pg_policies` / `pg_proc` /
`information_schema`); schema change and the frontend that depends on it shipped as **one deploy unit**;
credential teardown after every deploy. Each P0/P1 item has a ready-to-paste prompt in `09-fix-prompts.md`.

**Owners:** *DB* = database/RLS engineer · *FE* = frontend engineer · *Edge* = Edge Function engineer ·
*Ops* = system owner / platform admin (dashboard access) · *Gov* = system owner + legal.
**Effort:** S ≤ 1 day · M ≤ 1 week · L > 1 week.

## Precondition for everything below

**Stand up staging first (WP-OPS-001).** Every fix in this roadmap has to be dry-run and acceptance-tested
against a copy of the schema. Today the only database is production, on the Supabase Free plan with
no backups and no PITR (WP-OPS-002, confirmed live 2026-09-25). Until staging exists, P0 fixes are applied to production under the
three-phase process with a verified backup taken immediately before each apply.

## Free-plan quick wins from the live check (2026-09-25; no purchase needed)

| # | Finding(s) | Action | Owner | Effort |
|---|---|---|---|---|
| QW-1 | **WP-LIVE-001** | Enable SSL enforcement for database connections; restrict network access to the operator IPs that need it; rotate the DB password. | Ops | S |
| QW-2 | **WP-ARC-005** | Delete `SUPABASE_SERVICE_ROLE_KEY` from the Vercel project (Production and Preview) and rotate the key. | Ops | S |
| QW-3 | **WP-AUTH-005**, **WP-AUTH-007** | Enable CAPTCHA (hCaptcha or Turnstile) and send `captchaToken` from `login.tsx`; raise the server password minimum to at least 8 with character classes. | Ops + FE | S |
| QW-4 | **WP-OPS-004** | Require the `test` status check on `main` in branch protection. | Ops | S |
| QW-5 | **WP-LOC-014** | Rename woreda 5 to "Jinala" (additive migration + `seed.sql` + README), once the owner confirms the Amharic form. **Status 2026-09-25: English name done (migration `00000000000092`, seed, README) and applied to production with the owner's go-ahead; Amharic form still awaits the owner.** | DB | S |
| QW-6 | **WP-API-004** | Pin `verify_jwt` per function in `supabase/config.toml` and redeploy so live state matches the repo. **Status 2026-09-25: pinned in `scripts/deploy-functions.sh` (no `config.toml` exists) to the live values.** | Edge | S |

## P0 — within 48 hours (go-live blockers; small and contained)

| # | Finding(s) | Action | Owner | Effort | Depends on |
|---|---|---|---|---|---|
| P0-1 | **WP-OPS-002** | Confirm the Supabase plan tier, that daily backups and (ideally) PITR are on, and take and **test-restore** a manual backup. Export the Storage buckets. Record RPO/RTO. **Live 2026-09-25: Free plan, no backups, PITR off. Needs the owner's Pro + PITR decision; interim is an owned nightly `pg_dump` + Storage copy with a recorded restore test.** | Ops | S | Owner purchase decision |
| P0-2 | **WP-VER-001** (Critical; merges WP-DB-003/009/010) | Add a same-woreda re-check to `generate_resident_on_birth_approval()` (mother/father lookups), `rental_eligibility()` and `get_credential_live_status()`; `REVOKE EXECUTE … FROM anon, PUBLIC` on the latter two. **Status 2026-09-25: done in code (migration `00000000000090`, PR #85, commits `f406f22`/`72e5dc5`); not yet applied to production.** | DB | S | P0-1 |
| P0-3 | **WP-CRY-001** | Make `/v/$token` fail **closed**: show "cannot confirm" (not green) on no row, RPC error or rate-limit; canonicalise the token (strict base64url, low-S) before lookup, or look up by credential number and compare the signature. Same for the staff scanner (WP-CRY-002). **Status 2026-09-25: migration `00000000000091` applied to production and verified (all 5 live cards: a re-spelled token resolves to the same card and status; wrong r or payload alone finds nothing); strict base64url + 64-byte check in the browser verifier, shared fail-closed verdict (`src/lib/credentialVerdict.ts`) on `/v/$token` and the staff scanner, which now looks up by token. Frontend ships with the PR; the low-S signer change in `sign-credential` was deployed with the owner's go-ahead (version 18, `verify_jwt` unchanged at false).** | FE + DB | S | — |
| P0-4 | **WP-DB-001** (merges WP-AUTH-002) | `get_user_woreda_id()` returns NULL unless `status = 'active'`; add the status check to storage policies; on suspension, call the GoTrue admin sign-out for the user (Edge Function); add a status check to `woreda.tsx` like `admin.tsx:31`. | DB + Edge + FE | S | P0-1 |
| P0-5 | **WP-APP-001** | Sanitise stored letter HTML with the same allow-list on **load** into the editor (`rich-text-editor.tsx:46`) and server-side on write (trigger on `service_type.letter_body_html`). | FE + DB | S | — |
| P0-6 | **WP-WF-001**, **WP-WF-002** | Extend the INSERT guard to `vital_event` and `service_request` (only the initial status may be inserted); make the service FSM category-aware (letters cannot take the complaint path); `verify_service_letter()` accepts only `issued`. | DB | S | P0-1 |
| P0-7 | **WP-DB-013** (letter token in migration 64 / docs) | Regenerate the exposed letter-verification token; switch token generation to `gen_random_bytes`; ignore client-chosen tokens. | DB | S | — |

## P1 — within 2 weeks (in-tenant escalation, SoD, platform controls)

| # | Finding(s) | Action | Owner | Effort | Depends on |
|---|---|---|---|---|---|
| P1-1 | **WP-OPS-001**, WP-OPS-005 | Provision staging per `docs/staging-runbook.md` with its own keys; point previews at staging; remove `http://localhost:5173` from production CORS. | Ops | M | P0-1 |
| P1-2 | **WP-DB-004** | Add `user_has_perm('<module>.read')` (or `user_has_any_perm`) to every tenant SELECT policy and to the `*_decrypted` views' base tables; gate `audit_log` SELECT on `audit.view`. Regenerate `docs/permissions-matrix.md`. | DB | M | P0-4, P1-1 |
| P1-3 | **WP-DB-002** | Storage policies: require the matching module permission per bucket (e.g. `tenant.manage` for `tenant-assets`, `resident.update` for `resident-photos`), plus status. | DB | M | P0-4 |
| P1-4 | **WP-WF-004** (merges WP-AZ-002, WP-APP-002), **WP-WF-006** | Freeze content columns once a row leaves draft (BEFORE UPDATE trigger comparing OLD/NEW for non-status columns); make `residency_status = 'deceased'` writable only by the civil death side effect; revoke all non-revoked credentials on death. | DB | M | P0-6 |
| P1-5 | **WP-WF-003** | Maker ≠ checker on current-cycle actors: clear verifier/approver columns on return, or compare against `workflow_status_history` for the current cycle. | DB | M | P1-4 |
| P1-6 | **WP-WF-005** (merges WP-AZ-003) | Split `credential.verify` into a read-only lookup key and a write key; drop the lookup key from `credential_request_update`; fix the `seed.sql` drift. | DB + FE | M | P1-2 |
| P1-7 | **WP-AZ-001** (merges WP-API-001) | Enforce `CP` keys server-side: `user_has_console_perm()` in admin RLS policies, `publish_id_card_template`, `sign-credential`, invite/resend/reset Edge Functions. | DB + Edge | M | — |
| P1-8 | **WP-AUTH-001** | Enable TOTP MFA; require `aal2` for `super_admin`/`tenant_admin` in RLS (`auth.jwt()->>'aal'`) and in the UI. | Ops + DB + FE | M | P1-1 |
| P1-9 | WP-DB-008, WP-PRV-001, WP-PRV-002 | Move audit writes into DB triggers on resident/household/app_user/overrides/role_permission/settings/module config; revoke client INSERT on `audit_log`; strip Restricted PII from payloads (store field names + blind index only). | DB + FE | M | P1-2 |
| P1-10 | WP-APP-003, WP-AUTH-004/005/006/007, WP-API-003 | CSP nonces (drop `'unsafe-inline'` scripts); persist idle timestamp without resetting on load; CAPTCHA + failed-login logging; re-auth before password change; server-side password policy; disable public sign-up/anonymous sign-in (confirm in dashboard). | FE + Ops | M | — |
| P1-11 | WP-APP-004, WP-APP-005 | Bucket `allowed_mime_types` + `file_size_limit` on all 10 buckets, no SVG; DB CHECKs for FAN `national_id_no` (`^\d{16}$`), phone (the stored 9-digit local part after +251, `^\d{9}$` as `src/lib/phoneNumber.ts:59` validates), email; FAN uniqueness per woreda on the normalised value. | DB | S | — |
| P1-12 | WP-CRY-007, WP-DB-006, WP-DB-007, WP-WF-009/010/011 | One receipt per payment (UNIQUE); numbering tables read-only for tenants, numbers server-assigned only; kebele table admin-only; atomic `record_fee_payment()` RPC with one-payment-per-request; waiver needs the module's supervisor permission, not self-approval, DB-written audit. | DB + FE | M | P1-4 |
| P1-13 | WP-AZ-004 | Server-side module check (`module_enabled(woreda, key)`) in write policies/RPCs for every module incl. `rental_houses`; add the rental toggle to the admin UI. | DB + FE | M | P1-2 |
| P1-14 | WP-OPS-004, WP-SUP-001, WP-INV-001 | Make CI a required status check; delay Vercel production promotion until CI passes; add `bun audit` + a secret scanner + Dependabot; pin esm.sh imports with a `deno.json` import map + lock. | Ops | S | — |
| P1-15 | WP-LOC-001 | Serialise EC-picked dates as local calendar dates (`YYYY-MM-DD` from the EC→Gregorian result, never `toISOString()`); backfill affected `rent_charge`/installment rows. | FE + DB | S | P1-1 |
| P1-16 | WP-BQ-001 | Route every error toast through `translateError()`. | FE | S | — |

## P2 — within one quarter (defence in depth, governance, locale, docs)

| # | Finding(s) | Action | Owner | Effort |
|---|---|---|---|---|
| P2-1 | WP-DB-005 | Phase C stage 4: drop or null the plaintext twins once every reader uses `*_decrypted`; key version tag; key escrow (WP-OPS-003). | DB + Ops | L |
| P2-2 | WP-DB-011, WP-DB-012 | Replace hard DELETE on registry/financial tables with soft-delete/void; composite `(woreda_id, id)` FKs. | DB | L |
| P2-3 | WP-CRY-003, WP-CRY-004/005, WP-OPS-008 | Minimise QR payload (drop DOB/house number or move to the online check); add `kid` + payload version; move verification to an owned custom domain before more cards are printed. | Edge + FE + Ops | M |
| P2-4 | WP-INV-003, WP-OPS-006 | Log drain / SIEM, error tracking, uptime and auth-anomaly alerts; enable Vercel WAF managed rules; CSP `report-to`. | Ops | M |
| P2-5 | WP-PRV-003, WP-PRV-004, WP-PRV-005, WP-PRV-006 | Encrypt or expire local drafts and the offline queue, clear on session end; audit exports/prints with watermark; lawful-basis record for special-category fields; retention schedule, privacy notice, DSR and breach procedure (Proclamation No. 1321/2024 — counsel to confirm). | FE + Gov | L |
| P2-6 | WP-WF-007, WP-WF-008, WP-WF-013, WP-AZ-006 | Death finalisation without `credential.revoke` on the payer; divorce fee mapping; rental billing start/termination month; make `print_officer` assignable and sufficient. | DB + FE | M |
| P2-7 | WP-LOC-002, WP-LOC-003, WP-LOC-004 + Lows | Ethiopian clock helper; EC fiscal year (Hamle 1 – Sene 30) filters; EC-first dates everywhere; Tayitu/Jiret in print/PDF. | FE | M |
| P2-8 | WP-API-002, WP-CRY-002 | Zod/valibot schemas in Edge Functions (400 on malformed JSON); scanner performs the live check automatically. | Edge + FE | S |
| P2-9 | WP-OPS-003, WP-OPS-007 | Key custody runbook; migration ledger table + CI job comparing it to `supabase/migrations/`. | Ops + DB | M |
| P2-10 | WP-INV-002 and all Docs findings | Refresh `docs/erd.md`, `dfd.md`, `architecture.md`, `tech-stack.md`, `testing-scope.md`, `openapi.yaml`, SFD, CLAUDE.md from this audit's as-is artifacts; add a PR checklist item for living docs (G-01). | All | M |
| P2-11 | Remaining Low/Info | Per `02-findings-register.md`. | — | — |

## Dependency order (critical path)

```
P0-1 backups ──► P0-2 / P0-4 / P0-6 (DB fixes on prod with fresh backup)
P0-3, P0-5, P0-7 (independent, ship immediately)
P1-1 staging ──► P1-2 read perms ──► P1-6, P1-9, P1-13
P0-6 ──► P1-4 content freeze ──► P1-5 SoD, P1-12 payments
P1-7, P1-8, P1-10, P1-11, P1-14, P1-15, P1-16 (parallel)
P1 complete ──► external penetration test on staging (06-testing-scope.md) ──► go-live sign-off
```
