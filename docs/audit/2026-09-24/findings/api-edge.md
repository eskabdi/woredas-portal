# API Surface and Edge Functions — audit-api-edge

**Audit:** woredas-portal, 2026-09-24 · **Commit:** `9950f16e426eedd586c6fd85f6c328d9923542d1` · **Checklist ownership:** INSA E-01, E-02, E-03 (Edge part), E-04, E-05, E-06 (Edge/RPC part)
**Machine-readable:** `findings/api-edge.json` · **Artifacts:** `api/openapi.yaml` (OpenAPI 3.1, as-is), `api/endpoint-inventory.json`, `api/samples/*.json` (13 files), `raw/api-edge-*.txt`

## 1. Executive summary

The application exposes five kinds of server-side endpoint: eight Supabase Edge Functions, 3 anonymous verification RPCs, 25 authenticated RPCs with client callers, 26 further RPCs that are callable but have no client caller, and PostgREST CRUD over 66 tables and 17 views. The Edge Functions are well built on the tenant axis. Each one re-derives the caller from its own JWT through GoTrue `getUser()` and checks `app_user.status = 'active'`. Each re-derives the target's woreda server-side and returns fixed error strings through `safeError()`. Five of them rate-limit per verified caller. No function trusts a body-supplied `user_id` or `role` for the caller's identity. There are no inbound webhooks, and all secrets come from `Deno.env`.

The main weakness is on the **second RBAC axis**, the super-admin console roles. Only `console.console_users.manage` is ever checked server-side. A super_admin who has been deliberately scoped to, for example, audit-only can still:

- mint tenant_admin accounts for any woreda;
- trigger password resets against unrestricted super_admins;
- sign any woreda's credentials;
- publish the platform ID-card template.

This is WP-API-001 (High). Beyond that, the API is **under-documented and under-classified**:

- The project's `docs/openapi.yaml` does not validate.
- It covers 6 of 8 functions and 3 of about 64 RPCs.
- It misstates several contracts.
- No endpoint carries a Public/Private/Internal classification in code.

For INSA E-01, E-02 and E-04 the project fails. This audit supplies a validated as-is replacement.

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 1 | WP-API-001 |
| Medium | 2 | WP-API-002, WP-API-003 (Needs-live-verification) |
| Low | 9 | WP-API-004 … WP-API-012 |
| Info | 2 | WP-API-013, WP-API-014 |

No Critical issue was found in this scope. There is no unauthenticated write path, no auth bypass in any Edge Function, and no secret in code. Cross-tenant read issues that sit in the RLS layer (WP-DB-004, WP-DB-009, WP-DB-010) are owned by the database auditor and cross-referenced here rather than duplicated.

## 2. API surface inventory

The full list, with policies, grants, client usage and classification, is in `api/endpoint-inventory.json`. It was built from the migration replay in `raw/audit-database-catalog.json` and from a regex scan of `src/`. Trigger-returning functions are excluded because PostgREST cannot call them.

### 2.1 Edge Functions (`/functions/v1/*`, all `POST` + `OPTIONS`)

| Function | Class. | Caller authz (as coded) | Rate limit | Client caller |
|---|---|---|---|---|
| `sign-credential` | Private | getUser → active → same woreda (body `woredaId` cross-checked, `:117`, `:146`) → `user_has_perm('credential.print')` via caller JWT unless super_admin | none | `src/utils/harariCredentialCrypto.ts:90` |
| `invite-tenant-user` | Private | active tenant_admin of `woredaId`, or super_admin (`:88-93`); six-role allow-list | 20/600 s | `UsersRolesTab.tsx:787` |
| `invite-platform-admin` | Private | active super_admin (`:70`); console perm only when minting super_admin (`:84-94`) | 10/600 s | `PlatformUsersTab.tsx:679`, `admin.tenants.$woredaId.provision.tsx:166` |
| `resend-platform-invite` | Private | active super_admin (`:46`) | 10/600 s | `PlatformUsersTab.tsx:307` |
| `resend-tenant-invite` | Private | tenant_admin (target filtered to own woreda in-query, `:85-91`) or super_admin | 10/600 s | `UsersRolesTab.tsx:283` |
| `send-password-reset-link` | Private | tenant_admin (own woreda, staff targets) or super_admin (any target, `:116-117`) | 10/600 s | `UsersRolesTab.tsx:304`, `PlatformUsersTab.tsx:325` |
| `activate-invited-user` | Private (self) | JWT identity only; pending → active | none | `set-password.tsx:128` |
| `record-login` | Private (self) | JWT identity only; writes `last_login_at` | none | `login.tsx:132,142` |

### 2.2 RPCs (`/rest/v1/rpc/*`)

- **Public (3):** `verify_credential_token` (rate-limited 30/60 s per IP on the anon path, logged), `verify_service_letter` and `verify_receipt` (neither limited nor logged).
- **Private, client-called (25):** fee resolvers, blind-index helpers, the rental settlement/reversal/provisioning/arrears RPCs, three KPI functions, five rental reports, `current_permissions`, `current_console_permissions`, template publish/discard, `resolve_rental_checkpoint` and `rental_eligibility`. The sampled rental write RPCs derive the woreda from `get_user_woreda_id()` and check a permission before acting. For example, `settle_rent_payment` at `00000000000087:609-618`.
- **Internal but exposed (26):** RLS helpers (`user_has_perm`, `is_super_admin`, `get_user_woreda_id` …), `decrypt_pii_text/numeric`, `entity_*`, `get_credential_live_status`, `generate_rent_reminders`, `refresh_rent_ledger_statuses`, `resolve_reconciliation_exception` and others. Of these, 6 are modelled as anon-executable: `default_role_perms`, `gen_letter_verification_token`, `gen_receipt_verification_token`, `luhn_check_digit`, `storage_path_woreda_id` and `check_credential_print_eligibility`. The client-called `rental_eligibility` is also anon-executable.
- **Correctly closed (10):** `rate_limit_hit`, `encrypt_pii_*`, `phone_blind_index`, `national_id_blind_index`, `pii_root_key`, `derive_woreda_key`, `pii_encryption_status`, `normalize_phone`, `resolve_rental_checkpoint_core`.

### 2.3 PostgREST resources

All 66 tables have RLS enabled, and all 17 views are `security_invoker` (per the database auditor). Of the 66 tables, 21 have no client use, and these are still reachable by `authenticated` under RLS. They include 9 numbering `*_sequence` tables, `workflow_transition`, `office`, `approval`, `rental_payment` and `rent_payment_settlement`. `anon` keeps table-level DML grants on 64 tables, and only RLS denies it rows (WP-API-013). The heaviest client-written tables are `audit_log` (68 inserts), `credential_request` (13 updates) and `resident` (11 updates).

## 3. Gateway, CORS, secrets, webhooks

- **`verify_jwt`.** `supabase/config.toml` contains only `project_id`. `scripts/deploy-functions.sh:40` deploys with the CLI default, which is `verify_jwt = true`. The single-file fallback in `CLAUDE.md:1123` forces `false`, and `docs/security-hardening.md:41` claims `false`. The live value is therefore undetermined (WP-API-004). This does not create an auth bypass, because every function authenticates in its body. If the value is `false`, `sign-credential` discloses before authenticating whether its signing key is configured (`:72`).
- **CORS.** `_shared/response.ts:22-36` echoes the origin only when it is `SITE_URL` or `http://localhost:5173`. It never sends `*` and never sends `Allow-Credentials`. The localhost entry ships to production (WP-API-005). PostgREST, Auth and Storage CORS are platform-controlled.
- **Secrets.** `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SITE_URL` and `HARARI_EC_PRIVATE_KEY` are read only via `Deno.env.get`. No literals appear anywhere in the functions. The token examples in `docs/openapi.yaml` are truncated placeholders.
- **Webhooks, payment and SMS.** None exist. The functions make no outbound `fetch`; they only call Supabase APIs through supabase-js, and redirect URLs come only from the `SITE_URL` environment variable. SSRF is therefore not applicable.
- **Timeouts.** No explicit timeouts or AbortSignals are used; the functions rely on the platform wall-clock limit. Recorded as an observation only.

## 4. Findings

### WP-API-001 (High, Confirmed): the console-permission axis is not enforced by any Edge Function or RPC, except when minting a super_admin

**Evidence.**

- `invite-platform-admin/index.ts:70` requires only `role === "super_admin" && status === "active"`. The `user_has_console_perm('console.console_users.manage')` check at `:84-94` runs only when the *new* role is super_admin.
- `resend-platform-invite:46`, `send-password-reset-link:65,116-117`, `invite-tenant-user:91`, `resend-tenant-invite:69` and `sign-credential:117-127` all accept any super_admin.
- `publish_id_card_template` checks `is_super_admin()` only (`00000000000010:125`).
- A fixed-string search finds `console.users.manage`, `console.tenants.manage`, `console.credential_template.manage` and `console.audit.view` only in the CHECK list at `00000000000009_console_roles.sql:40-43` (`raw/api-edge-evidence.txt`).

**Impact.** Suppose a super_admin has been scoped to a console role without `console.users.manage`. That admin can create a tenant_admin identity under a mailbox they control in any woreda. They then hold a second identity that also lets them sit on both sides of maker-checker. They can also reset other super_admins' passwords, sign credentials in any woreda and publish the platform card template. In short, console roles restrict only the UI.

**Fix.** Check the matching `CP` key through `userClient.rpc('user_has_console_perm', …)` in every super_admin branch. Add the same keys to the RLS and RPCs, coordinated with the authz auditor.

### WP-API-002 (Medium, Confirmed): no schema validation of Edge Function request bodies

**Evidence.** Every function does `(await req.json()) as Body` and then checks only that required fields are truthy (for example `invite-tenant-user:57,69`). There are:

- no type, e-mail, UUID or length checks;
- no prefix or bucket check on `signature_path` or `photo_path`, which are stored verbatim (`:187-188`);
- no length CHECK on the `app_user` text columns (`00000000000014:8`).

A malformed JSON body returns 500, not 400 (`sign-credential:283`).

**Fix.** Validate each body with zod: `uuid()`, `email()`, `enum()`, `max()`, plus a `${woredaId}/` prefix regex for storage paths. Return 400 on a JSON parse error.

### WP-API-003 (Medium, Needs-live-verification): self-registration is not pinned off

**Evidence.** No `[auth] enable_signup` setting exists in `supabase/config.toml`, and the app itself is invite-only. Several endpoints are gated only on the `authenticated` role:

- `get_credential_live_status` (`baseline.sql:1323`, cross-woreda, sequential credential numbers, WP-DB-010);
- `rental_eligibility` (`00000000000031:197`, WP-DB-009);
- the `woreda` table (`USING (true)`, `baseline.sql:1661`).

**Impact.** If signup is enabled on the project, any internet user can create an account and enumerate credential status across all woredas.

**Fix.** Confirm signup is disabled and pin the setting in config. Revoke `get_credential_live_status` from `authenticated`. Require `is_active_app_user()` inside the DEFINER RPCs.

### WP-API-004 (Low, Needs-live-verification): `verify_jwt` state is undetermined

See section 3. **Fix:** pin `[functions.<name>] verify_jwt` in `config.toml`, move the signing-key check after authentication, and record the live value at deploy time.

### WP-API-005 (Low, Confirmed): the production CORS allow-list includes `http://localhost:5173`

**Evidence.** `_shared/response.ts:23`. **Fix:** read development origins from an environment variable that is unset in production.

### WP-API-006 (Low, Confirmed): rate-limiting gaps

- `verify_service_letter` and `verify_receipt` are unthrottled and write no attempt log (`00000000000022:11-17`).
- Their 12-character tokens come from `random()` (`baseline.sql:1236`, `00000000000013:16-35`), which is not a CSPRNG. About 60 bits of entropy makes blind enumeration impractical; the crypto auditor should assess predictability.
- `sign-credential`, `activate-invited-user` and `record-login` have no limiter.
- All limiters fail open.
- The credential limiter returns HTTP 503 (SQLSTATE 53000) instead of 429 (`00000000000034:222`).

### WP-API-007 (Low, Confirmed): the invite e-mail is sent before the profile row is created, and `username` is globally unique

`username` is the e-mail local part (`invite-tenant-user:134`) and is `UNIQUE` platform-wide (`baseline.sql:536`). The invite is mailed at `:113`, before the insert that can collide at `:236`. When the insert fails, the invitee is left with an orphaned but redeemable `auth.users` identity. The distinct error message also lets a tenant_admin probe for usernames in other woredas.

**Fix.** Insert first, or delete the auth user on failure. Derive `username` from the whole e-mail address.

### WP-API-008 (Low, Confirmed): `print_officer` and custom-role staff are excluded from the invite, resend and reset functions

All three use the same six-role allow-list (`invite-tenant-user:20`, `resend-tenant-invite:21`, `send-password-reset-link:17`), and the UI mirrors it (`UsersRolesTab.tsx:69`). Administrators are therefore pushed to handle these users outside the audited path.

### WP-API-009 (Low, Confirmed): audit writes are fire-and-forget and some contain e-mail addresses

- None of the 9 `audit_log` inserts across 7 functions checks for an error (for example `sign-credential:270`).
- The invite functions and `resend-platform-invite` write the e-mail address into `new_value_json` (`invite-tenant-user:213,252`; `resend-platform-invite:110`). This contradicts the rule `send-password-reset-link:178` applies to itself.
- `resend-platform-invite` omits `woreda_id`.

### WP-API-010 (Low, Likely): internal helpers are exposed as RPC endpoints

The inventory counts 26 authenticated-callable functions with no client caller. Examples:

- `decrypt_pii_text` (`00000000000023:324`) lets any staff member decrypt their own woreda's ciphertext whatever their read permissions.
- `user_permission_override_target_role_ok` (`00000000000019:60`) acts as a role oracle.
- `default_role_perms` (`00000000000083:96`) has no grant or revoke, so under the default ACL it is anon-executable and discloses the full permission matrix to unauthenticated callers.
- `rental_eligibility` revokes only `PUBLIC` (`00000000000031:196`).

**Fix.** Move the helpers into a non-exposed `private` schema, `REVOKE … FROM anon` explicitly, and add a CI check that lists anon-executable functions.

### WP-API-011 (Low, Confirmed): API documentation is invalid and incomplete, and endpoints are not classified in code

- `docs/openapi.yaml` has 3 schema errors (`raw/api-edge-docs-openapi-validation.txt`).
- It covers 6 of 8 functions, 3 of about 64 RPCs and 0 tables.
- It contains the content errors listed in section 6.
- No sample files exist.
- `docs/api-security.md` classifies 11 endpoints.
- No `@classification` annotation exists anywhere in code.

This fails INSA E-01, E-02 and E-04.

**Fix.** Adopt `api/openapi.yaml` and `api/samples/`. Add a classification header to each function's `index.ts` and a `COMMENT ON FUNCTION … '@classification …'` to each RPC. Validate the spec in CI.

### WP-API-012 (Low, Likely): `sign-credential` does not re-pin its joined rows to the credential's woreda

The `resident`, `household` and `kebele` lookups follow the foreign keys only (`sign-credential:159-204`). Combined with WP-DB-012, a cross-woreda reference would be signed into a printed QR payload. `verify_receipt` already uses the stricter pattern (`00000000000013:128`).

**Fix.** Add `.eq("woreda_id", cred.woreda_id)` to those lookups.

### WP-API-013 (Info, Needs-live-verification): schema introspection is available to anon

`anon` retains table DML grants (migration `00000000000007:32` revokes only TRUNCATE, TRIGGER and REFERENCES). The PostgREST root OpenAPI document, and pg_graphql if it is enabled, may therefore list every table and column when called with only the publishable key. `max_rows` is a dashboard-only setting.

### WP-API-014 (Info, Confirmed): the self-scoped functions ignore account status

`record-login` updates suspended accounts (`:41-46`). `activate-invited-user` does not check that a password was actually set (`:71-76`). Both are otherwise correctly self-scoped.

## 5. INSA checklist verdicts

| ID | Status | Basis |
|---|---|---|
| E-01 | **FAIL** | No sample files exist in the repository. The auditor produced 13 as-is sample files under `api/samples/`; each status code is marked as emitted or not emitted, with a file:line reference. |
| E-02 | **FAIL** | `docs/openapi.yaml` is invalid, incomplete and inaccurate. The auditor's `api/openapi.yaml` (3.1, 43 paths, 52 operations) validates with 0 errors. |
| E-03 (Edge) | **PARTIAL** | All 8 functions validate tokens server-side with GoTrue `getUser()`. The JWT algorithm, token expiry and refresh rotation are dashboard settings and remain UNVERIFIED. `verify_jwt` drift is recorded as WP-API-004. |
| E-04 | **FAIL** | No classification comment exists in code. The auditor's classification is in `endpoint-inventory.json` and in `x-classification` on every spec operation. |
| E-05 | **PASS** | Keys are read only through `Deno.env`. There are no webhooks, so signature validation is not applicable. |
| E-06 (Edge/RPC) | **PARTIAL** | Tenant-axis checks run before side effects on every write path. The console axis is not enforced (WP-API-001), and input validation is missing (WP-API-002). |

## 6. Documentation drift (summary; full list in JSON `drift[]`)

**Contradicted (14 drift entries; the "three rate-limited endpoints" entry covers both docs/openapi.yaml and docs/api-security.md)**

- `docs/openapi.yaml`:
  - "six" Edge Functions (actually 8);
  - "42 tables" (actually 66 tables and 17 views);
  - `resend-platform-invite` "requires `email`" (it reads only `user_id`);
  - the `verify_service_letter` status set (migration 64 added `completed`, not resolved/closed);
  - the verify limiter returns "500" (it returns 503);
  - rate limiting on "three" endpoints (it is five);
  - the spec is invalid.
- `docs/api-security.md`:
  - "every endpoint categorized" (11 of about 75 are);
  - "two public RPCs rely on project-wide limits" (`verify_credential_token` has its own limiter).
- `docs/security-hardening.md:39-42` says "All 4 Edge Functions … deploy with verify_jwt:false". There are 8 functions, and the repository deploy path gives `true`.
- `CLAUDE.md`:
  - "5 of the 6" functions populate `source_ip` (actually 7 of 8);
  - "All six functions import `_shared`" (actually eight);
  - `send-password-reset-link` "never" targets admins (it does for super_admin callers);
  - "Two" public verification RPCs (there are three);
  - verification RPCs are "not rate-limited".

**Confirmed (5)**

- There are no webhooks.
- Caller identity is always taken from the JWT.
- The CORS allow-list is an explicit echo, never `*`.
- Error bodies are fixed strings.
- The rate limiter is keyed per caller and fails open.

**Not found (1)**

- `CLAUDE.md` says each function's own `index.ts` carries a one-line CORS rationale comment. The rationale exists only in `_shared/response.ts`.

## 7. OWASP API Security Top 10 (2023) mapping

| Risk | Verdict | Notes |
|---|---|---|
| API1 BOLA | PARTIAL | Edge targets are re-derived server-side. RPC and RLS gaps: WP-DB-004/009/010, WP-API-012. |
| API2 Broken Authentication | PARTIAL | `getUser` is used everywhere. Signup and JWT settings are unverified (WP-API-003/004). |
| API3 BOPLA | PARTIAL | Edge writes whitelist their columns. PostgREST writes are bounded by RLS only (WP-DB-008). Storage paths are unvalidated (WP-API-002). |
| API4 Resource Consumption | PARTIAL | WP-API-006. |
| API5 BFLA | **FAIL** | WP-API-001. |
| API6 Sensitive Business Flows | PARTIAL | Invites and resets are throttled. Letter and receipt verification is not. |
| API7 SSRF | PASS | No URL taken from the caller is ever fetched. |
| API8 Misconfiguration | PARTIAL | WP-API-004/005/010/013. |
| API9 Inventory | **FAIL** | WP-API-011. 21 unused tables and 26 exposed internal RPCs. |
| API10 Unsafe Consumption | PARTIAL | Unpinned `esm.sh` import (WP-INV-001). |

## 8. Method and limits

- **Read-only.** No database was contacted, and no application file was modified.
- **Latest definitions.** Function behaviour was resolved from the latest `CREATE OR REPLACE` of each function across all 90 migrations. The EXECUTE model reuses the database auditor's replay (Supabase stock default ACL assumed). Anything that depends on live grants or dashboard settings is marked Needs-live-verification.
- **Validation tooling.** OpenAPI validation used `openapi-spec-validator`, installed in the session scratchpad, not in the repository.
- **HTTP status mapping.** The mapping for PostgREST errors (42501→401/403, 53000→503, PGRST202→404, other codes→400) follows PostgREST's documented SQLSTATE mapping. The exact bodies of gateway-level 401 responses are platform-defined and are not asserted.
- **Synthetic sample data.** All sample values are synthetic. The real letter-verification token embedded in migration 64 (`SJ44…[REDACTED]`) is not reproduced anywhere in this audit's outputs.
