# 05 — Security Functionality Document (INSA Phase 4) — AS-IS

**System:** Woreda Administration ERP (woredas-portal) · **Baseline:** HEAD `9950f16` · **Date:** 2026-09-24 (Meskerem 14, 2019 EC)
**Status:** As-is description built from code and migrations by the audit. Every gap is stated inline with its finding ID. It replaces nothing yet: `docs/security-functionality.md` is the project's own SFD, and several of its claims are contradicted (see `08-drift-register.md`).
Live Supabase/Vercel dashboard settings were not visible to the audit; those values are marked **UNVERIFIED — owner to supply**.

---

## 1. Access control (D-01)

### 1.1 Model

| Layer | Mechanism | Where |
|---|---|---|
| Identity | Supabase Auth (GoTrue), email + password only; no SSO, no MFA enforced (WP-AUTH-001) | `src/routes/login.tsx`, `signInWithPassword` |
| Tenant | `app_user.woreda_id`, resolved server-side by `get_user_woreda_id()` inside every RLS policy; never taken from the client | baseline + later migrations; findings/database.md |
| Role (RBAC) | 9 built-in roles + tenant-defined `custom`. Grants resolve `user_permission_override → role_permission (per tenant) → default_role_perms()`; custom roles resolve through `tenant_role_permission` and fail closed | `src/config/permissions.ts`, `current_permissions()`, `user_has_perm()` |
| Console (super-admin) | Second axis: `console_role` / `CP` keys; `console_role_id IS NULL` = unrestricted | migration 9; `<ConsolePermissionGate>` |
| Module | `tenant_module_config` per woreda; missing row = enabled | `useTenantModules`, `<ModuleGate>` |
| Workflow | One FSM trigger `enforce_workflow_transition()` on 5 status-bearing tables; `workflow_transition` reference table (no `woreda_id`) | migration 25 and successors |
| Object storage | 10 private buckets; tenant = object path prefix via `storage_path_woreda_id(name)`; reads via signed URLs | migrations 1, 12, … |

### 1.2 Enforcement matrix (summary)

The full per-route and per-permission matrices are in `authz/route-guard-matrix.md` and `authz/permission-matrix.md`; the per-endpoint classification is in `api/endpoint-inventory.json` and `api/openapi.yaml`.

| Surface | Client gate | Server gate | Gap |
|---|---|---|---|
| Woreda OS routes (57) | `PermissionGate` / `ModuleGate` | RLS (`get_user_woreda_id()`, `user_has_perm()` on writes) | SELECT policies do not check read permissions — any active or inactive member of the woreda reads residents, civil events, payments, audit log (WP-DB-004, WP-AZ-005) |
| Account status | `admin.tsx` checks status; `woreda.tsx` does not | `user_has_perm()` requires `active`; `get_user_woreda_id()` does **not** | Suspended/pending/inactive staff keep reads and storage RW/D (WP-DB-001, WP-AUTH-002) |
| Admin console (8 routes) | `ConsolePermissionGate` on 4 routes | Only `is_super_admin()`; 4 of 5 `CP` keys are never checked server-side | Console roles are UI-only (WP-AZ-001 / WP-API-001) |
| Module toggles | `ModuleGate` on 8 layouts | Only letter-category services checked server-side; `rental_houses` never gated | RBAC-03 FAIL (WP-AZ-004, WP-INV-005) |
| Workflow transitions | Buttons gated by permission | Trigger checks (entity, from, to) + permission + maker ≠ checker **only when status changes** | Non-status fields writable after approval (WP-AZ-002, WP-WF-004/005); direct INSERT at an advanced status for civil/service (WP-WF-001); actor columns reusable after return (WP-WF-003) |
| Storage | Upload UI gated | Path-prefix tenant check only; no permission or status check | Any staff can overwrite signatures/stamps/logos (WP-DB-002) |
| Edge Functions (8) | n/a | Every function calls `getUser()` on its own JWT, checks status + woreda + role; never trusts a body `user_id`/`role` | Console-role scoping not applied (WP-API-001); body not schema-validated (WP-API-002) |
| Public verification | none | `verify_credential_token` (rate-limited 30/min), `verify_service_letter`, `verify_receipt` (anon) | Verifier fails open on "no row"/RPC error (WP-CRY-001); forged/advanced letters verify (WP-WF-001/002) |
| Self-escalation | UI hides admin roles | `role_permission_role_name_check`, `validate_app_user_role()` trigger, self-row USING clause | **PASS** (RBAC-02) |

## 2. Input validation strategy (D-02)

| Layer | As-is |
|---|---|
| Client | Zod schemas on 14 forms (`src/lib/residentSchema.ts`, `householdSchema.ts`, `credentialWorkflowSchemas.ts`, …); +251 phone normalisation (`src/lib/phoneNumber.ts`); 16-digit FAN; 8-char minimum password |
| Database | 44 named CHECK constraints + inline CHECKs on enums/statuses; FSM trigger; fee exact-match guard `validate_credential_fee_amount()`; RLS `WITH CHECK` (TEN-03 PASS) |
| Edge Functions | Presence checks only; bodies cast `as Body`; no type/email/UUID/length validation; malformed JSON → 500 (WP-API-002) |
| HTML content | Letter templates sanitised by an in-house allow-list sanitiser (`src/lib/letterTemplate.ts`) — 16 bypass payloads failed under jsdom — but the editor loads stored HTML via `innerHTML` without sanitising on load (WP-APP-001) |
| CSV export | Formula-injection guard present (`src/utils/tableExport.ts`); an embedded carriage return slips through (WP-APP-007) |
| Uploads | Client-side type/size checks; server-side MIME/size limits on only 2 of 10 buckets; SVG accepted on image buckets; no magic-byte check, no malware scan (WP-APP-004) |

**Gaps:** FAN, phone and e-mail formats are validated in the browser only, and FAN uniqueness is a warning (WP-APP-005, WP-LOC-005 — C-06 FAIL, ET-12 FAIL). PostgREST `.or()` filter strings are only partly escaped (WP-APP-006). No SQL-injection surface was found: no dynamic `EXECUTE` in 90 migrations; RPCs use typed parameters (C-01).

## 3. Session and cookie logic (D-03)

| Property | As-is value | Source | Gap |
|---|---|---|---|
| Transport | Bearer JWT in `Authorization` header; no cookies | `src/integrations/supabase/client.ts:23-26` | CSRF N/A (C-03) |
| Token storage | `localStorage` (`persistSession: true`, `autoRefreshToken: true`) | `client.ts:24-26` | Not HttpOnly/Secure/SameSite cookies — C-04 PARTIAL; gap not declared in the project SFD (WP-AUTH-003) |
| Compensating control | CSP `default-src 'self'` | `src/lib/security-headers.ts:48-63` | `script-src 'unsafe-inline'` weakens it (WP-APP-003) |
| Auth flow | Implicit flow (tokens in URL fragment) | `client.ts` defaults | PKCE not used (WP-AUTH-010) |
| Client idle timeout | Warn at 20 min, sign-out at 25 min, checked every 15 s, shared across tabs via `localStorage` | `src/config/idleTimeout.ts:7-14`, `src/hooks/useIdleTimeout.ts` | Reload/reopen resets the timer (`useIdleTimeout.ts:79,84`, WP-AUTH-004); not mounted on `/set-password` |
| Server inactivity / time-box | **UNVERIFIED — owner to supply** (Supabase Auth dashboard; Pro plan feature) | — | C-05 PARTIAL |
| Access-token lifetime / refresh rotation / reuse detection | **UNVERIFIED — owner to supply** | — | |
| JWT signing algorithm | **UNVERIFIED — owner to supply** (legacy HS256 secret vs asymmetric keys) | — | E-03 UNVERIFIED |
| Regeneration on login | New session issued by GoTrue on each `signInWithPassword` | GoTrue | — |
| Privilege change | No session revocation on suspension or role change | — | WP-AUTH-002 |
| Password policy | 8-character minimum in the browser only; server minimum, leaked-password check **UNVERIFIED** | `ChangePasswordDialog.tsx`, `set-password.tsx` | WP-AUTH-007 |
| Password change | No current-password re-authentication | `ChangePasswordDialog.tsx` | WP-AUTH-006 |
| Lockout / CAPTCHA | None in the app; GoTrue rate limits **UNVERIFIED**; no `captchaToken` sent | `login.tsx:96` | WP-AUTH-005 |
| MFA | Not enforced for any role | — | WP-AUTH-001 |
| Sign-out | Global scope everywhere | `signOut()` calls | WP-AUTH-012 (Info) |

## 4. Encryption in transit (D-04)

| Item | As-is |
|---|---|
| TLS termination | Inherited: Vercel edge (frontend), Supabase (API, Auth, Storage, Edge Functions) |
| HSTS | Owned: `max-age=63072000; includeSubDomains` on every SSR document response (`security-headers.ts:77`); no `preload` |
| Mixed content | None found in `src/` |
| TLS version / cipher suites of the live host | **UNVERIFIED** — the sandbox egress policy blocked the probe (raw/ops-scope-tls-probe.txt); owner to supply an SSL Labs report for `woredas-portal.vercel.app` |
| Other headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'`, `Permissions-Policy` (camera/geolocation self only) |

## 5. Encryption at rest and sensitive data (A-08)

- Passwords exist only in `auth.users` (GoTrue bcrypt). No application password or secret columns.
- Phase C column encryption: AES-256 (`pgp_sym_encrypt`) under per-woreda keys derived (HMAC) from a Vault root key (`pii_root_key()`, `derive_woreda_key()`), exposed through 14 `*_decrypted` `security_invoker` views, with blind indexes for national ID and phone.
- **Gap:** every encrypted column still has its plaintext twin, because the "drop plaintext" stage has not started (WP-DB-005 / WP-CRY-006). Keys have no version tag and no escrow. Suspended staff can still decrypt (WP-DB-001). A-08 FAIL.
- QR payload is ES256-signed, **not encrypted**; it carries name, DOB, gender, resident number, house number (WP-CRY-003).
- Full PII inventory: `privacy/pii-inventory.csv`.

## 6. Logging (D-05)

| Logged | Mechanism | Tamper resistance |
|---|---|---|
| Credential / credential-request transitions | `log_workflow_transition()` trigger → `audit_log` (migration 25) | Trigger-written |
| Civil / rental request / service transitions | `log_workflow_status_history()` → `workflow_status_history` (migration 58) | Trigger-written |
| Resident/household edits, document deletion, suspension, overrides, role matrix, settings, module toggles | **Client-side** `audit_log` inserts, 20 call sites use the browser clock | Spoofable; skippable via direct API (WP-PRV-001) |
| Edge Function actions | `audit_log` rows with best-effort `source_ip` (7 of 8 functions) | Server-written |
| Login / logout / failed sign-in | Not in the app audit trail (`last_login_at` only) | WP-PRV-007 |
| Exports / prints | Not audited (WP-PRV-004) | — |

**Must never be logged:** passwords, tokens, plaintext FAN. **Gap:** FAN, phone, religion and ethnicity are copied in plaintext into `audit_log` payloads on resident edit (WP-PRV-002). `audit_log` has no UPDATE/DELETE policy, but any staff member can INSERT forged rows (WP-DB-008) and several log tables are editable. No retention schedule (WP-PRV-006). No SIEM, log drain or alerting (WP-INV-003, WP-OPS-006). D-05 FAIL, LOG-01 FAIL.

## 7. Error handling (C-07)

Edge Functions return fixed strings through `_shared/response.ts` `safeError()` and log the detail server-side; SSR crashes render a generic page through `src/server.ts`. **Gap:** 128 client error toasts render the raw backend `error.message` (WP-BQ-001) — C-07 PARTIAL.

## 8. Values the owner must supply to complete this document

Supabase Auth: JWT algorithm and whether the legacy secret is revoked; access-token expiry; refresh rotation and reuse interval; session time-box and inactivity timeout; sign-up and anonymous sign-in state; minimum password length and leaked-password protection; CAPTCHA; Auth rate limits; enabled MFA factors; email-template link shape; Site URL and redirect allow-list; per-function `verify_jwt`; plan tier. Vercel: WAF / Firewall state, Deployment Protection on previews, custom domain plans. Platform: Supabase region, backup/PITR tier, SSL Labs report.
