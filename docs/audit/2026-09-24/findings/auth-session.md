# Authentication & Session Management — woredas-portal audit (2026-09-24)

**Agent:** audit-auth-session · **HEAD:** `9950f16` · **Checklist IDs owned:** INSA C-04, C-05, D-03, E-03 (platform JWT part)
**Machine-readable:** `findings/auth-session.json` · **Raw evidence:** `raw/auth-session-evidence.txt`

## 1. Scope and method

Reviewed the Supabase browser client (`src/integrations/supabase/client.ts`), the pinned `@supabase/auth-js` 2.112.3 defaults in `node_modules`, every `supabase.auth.*` call site in `src/`, the auth bootstrap/store, the portal layouts (`admin.tsx`, `woreda.tsx`), the idle-timeout hook, login / set-password / change-password flows, the invite/reset/activation Edge Functions, the CSP, and every migration for JWT-claim use, MFA/AAL checks and `TO authenticated USING (true)` policies. `supabase/config.toml` holds only `project_id`, so **all Supabase Auth dashboard settings are unverifiable from the repo** and are listed in §6. The live database and dashboard were not accessed.

## 2. Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 2 | WP-AUTH-001, WP-AUTH-002 |
| Medium | 6 | WP-AUTH-003 … WP-AUTH-008 |
| Low | 3 | WP-AUTH-009, WP-AUTH-010, WP-AUTH-011 |
| Info | 2 | WP-AUTH-012, WP-AUTH-013 |

**What is sound.** All 8 Edge Functions work out who the caller is by calling GoTrue (`auth.getUser`), which checks the signature, `exp` and whether the session still exists. None of them trusts a `user_id` from the request body. No custom JWT claims are used for authorisation. Role and status are re-read from `app_user` on every query, so a role change takes effect straight away in the database. Login does not leak which accounts exist. Sign-out is global, so it revokes the refresh token on the server, and it clears the query cache, drafts and offline queue. The client idle timer (20 min warning, 25 min sign-out) is built carefully while the page is open.

**What is not.** No role uses MFA. Suspending a user does not end their sessions, and the woreda portal has no status gate. Tokens live in `localStorage` and the INSA gap is not declared. The idle timer can be bypassed by reloading the page, and there is no evidence of a server-side timeout. Brute-force protection is left to GoTrue's IP limits, whose values are unknown, and CAPTCHA cannot be switched on without a code change. Changing a password needs neither the current password nor re-authentication.

## 3. INSA checklist verdicts

| ID | Status | Basis |
|---|---|---|
| **C-04** Cookies Secure/HttpOnly/SameSite | **PARTIAL** | Access and refresh tokens are in `localStorage` (`client.ts:24`). No auth cookie is set anywhere; the only cookie is the `sidebar_state` UI preference (`ui/sidebar.tsx:86`). This is a declared-gap case under INSA, but no declaration exists. The CSP does restrict `connect-src`, but `script-src 'unsafe-inline'` (`security-headers.ts:52`) and 4 HTML sinks weaken it as a compensating control. (WP-AUTH-003) |
| **C-05** Session timeout 15–30 min | **PARTIAL** | The client idle sign-out is at 25 min (`idleTimeout.ts:8`), but loading the page again resets it (`useIdleTimeout.ts:79,84`). The server-side inactivity timeout, time-box and JWT expiry are UNVERIFIED. Suspension does not end sessions. (WP-AUTH-002/004/009) |
| **D-03** Session & cookie logic documented = actual | **PARTIAL** | `docs/security-functionality.md:63-95` has idle values that match the code. It gives no values for JWT expiry, rotation/reuse, inactivity/time-box, password policy, MFA or lockout, and its file references are out of date. Regeneration on login: every `signInWithPassword` creates a new GoTrue session, so there is no fixation vector. Privilege changes are resolved in the DB. (WP-AUTH-011) |
| **E-03** JWT short expiry + refresh, strong algorithm | **UNVERIFIED** | The verification code passes (8/8 functions call `getUser`). The signing algorithm (legacy HS256 or asymmetric), access-token lifetime and refresh reuse detection are set only in the dashboard and are not documented, and no gap has been declared. (WP-AUTH-009) |

## 4. Findings

### WP-AUTH-001 — No MFA for any role, including super_admin and tenant_admin (High, Confirmed)
`src/routes/login.tsx:96` signs in with a password only. There are no `auth.mfa.*` or `getAuthenticatorAssuranceLevel` calls in `src/`, and no `aal` checks in any migration (raw evidence §"MFA / AAL usage": no matches). An `input-otp` primitive exists but nothing imports it. A super_admin (console_role_id NULL = unrestricted) reads all tenants' PII, including decrypted national-ID views, so one phished or stuffed password compromises the whole platform. Switching MFA on in the dashboard would still leave it optional, because nothing requires `aal2`.
**Fix:** enable TOTP/WebAuthn. Require enrolment and a challenge for super_admin and tenant_admin. Enforce it on the server by adding `auth.jwt()->>'aal' = 'aal2'` to `is_super_admin()`/`is_tenant_admin()` and to privileged Edge Functions.

### WP-AUTH-002 — Suspension does not revoke sessions; woreda portal has no status gate (High, Confirmed)
Suspending a user only updates `app_user` from the browser (`UsersRolesTab.tsx:257`, `PlatformUsersTab.tsx:265,828`). There is no `auth.admin.signOut`, ban or `ban_duration` anywhere. `admin.tsx:24-25` admits it: *"A suspended/inactive super_admin keeps a live session (suspension doesn't revoke the JWT)"*. `admin.tsx:31` sends such users away, but `woreda.tsx:21-22` has no status check. The refresh token keeps renewing unless a time-box is configured. Together with **WP-DB-001** (`get_user_woreda_id()` ignores status), a suspended clerk who is already signed in keeps read access to 43 tables and RW/D access to 9 storage buckets.
**Fix:** move suspension and reactivation into a service-role Edge Function that also sets `ban_duration` (or revokes sessions). Add `if (status !== 'active') <Navigate to="/login"/>` to `woreda.tsx`. Fix WP-DB-001.

### WP-AUTH-003 — Tokens in localStorage; C-04 gap undeclared (Medium, Confirmed)
`client.ts:24-26`: `storage: localStorage, persistSession: true, autoRefreshToken: true`. Any XSS therefore yields a durable refresh token, not only a short-lived access token. The compensating controls present are the CSP `connect-src` allow-list (`security-headers.ts:56`), `object-src 'none'` and `form-action 'self'`. Gaps: `'unsafe-inline'` scripts, navigation-based exfiltration is not blocked, and there are HTML sinks in `rich-text-editor.tsx:46`, `LetterTemplatesTab.tsx:239`, `woreda.services.$requestId.print.tsx:174` and `chart.tsx:73` (appsec rules on these). `docs/security-functionality.md:65-71` covers localStorage only to argue CSRF is N/A.
**Fix:** declare C-04 PARTIAL in the SFD and harden: nonce CSP, DOMPurify on all sinks, JWT expiry of 15 min or less, refresh reuse detection, a server timeout, and MFA. Alternatively, move to `@supabase/ssr` HttpOnly cookies, which needs server routes.

### WP-AUTH-004 — Idle timeout resets on page load; no evidenced server-side timeout (Medium, Confirmed)
`useIdleTimeout.ts:79` sets `lastActivity = Date.now()`, and line 84 writes it to shared storage *before* reading the previous value. A user who closes the browser without signing out and comes back days later is restored from the persisted refresh token and gets a fresh 25-minute window. The hook is only mounted in `AppShell.tsx:406/566`, so `/set-password` has no timer. With no server-side inactivity or time-box setting in evidence, session lifetime is effectively unlimited.
**Fix:** on mount, sign out if the stored timestamp is at least `IDLE_LOGOUT_MS` old. Cover `/set-password` too. Configure Auth > Sessions inactivity (≈30 min) and time-box (8–12 h), and document both values.

### WP-AUTH-005 — No CAPTCHA, lockout or failed-login logging; CAPTCHA cannot be enabled as-is (Medium, Confirmed)
`login.tsx:96` and `send-password-reset-link/index.ts:165` pass no `captchaToken`, so turning on CAPTCHA in the dashboard would break both. GoTrue has no per-account lockout, and its per-IP limits are unknown. `docs/testing-scope.md:52-55` still has the rate-limit, CAPTCHA and leaked-password items unchecked. Failed sign-ins never reach `audit_log`. Login does not reveal whether an account exists (GoTrue returns the same error for both cases).
**Fix:** add Turnstile/hCaptcha and pass `options.captchaToken`, then enable CAPTCHA. Lower the Auth rate limits. Alert on repeated `invalid_credentials` for one account.

### WP-AUTH-006 — Password change without current password or re-auth (Medium, Confirmed)
`ChangePasswordDialog.tsx:56` and `set-password.tsx:119` call `updateUser({ password })` without the current password or a nonce. `/set-password` works for *any* signed-in session. No code calls `signOut({ scope: 'others' })` afterwards. A stolen or unattended session therefore becomes a permanent account takeover.
**Fix:** require the current password, or implement `reauthenticate()` + nonce and enable "Secure password change". Limit `/set-password` to invite/recovery sessions. Revoke other sessions after a change.

### WP-AUTH-007 — Password policy client-side only; server minimum and HIBP unverified (Medium, Needs-live-verification)
The 8-character minimum is enforced only in zod/JS (`set-password.tsx:24`, `ChangePasswordDialog.tsx:47`). `login.tsx:35` accepts 6. GoTrue's default server minimum is 6. Leaked-password protection is still an open operator item. There are no composition rules, which is correct under NIST 800-63B.
**Fix:** set the dashboard minimum to 12 (or at least 8), enable leaked-password protection, and document both.

### WP-AUTH-008 — Sign-up, anonymous sign-in and /recover not shown to be disabled (Medium, Needs-live-verification)
The public key is enough to call `/auth/v1/signup` and `/auth/v1/recover`. If sign-up or anonymous sign-in is enabled, any Internet user gets `role=authenticated`. Five policies grant that role unconditional read: `woreda` (`baseline.sql:1661`), `id_card_template` (`:1590`), `id_card_template_field` (`:1588`), `id_card_template_field_draft` (`00000000000010:72`) and `workflow_transition` (`00000000000025:103`). The `credential-templates` bucket is also readable (`00000000000001_storage.sql:67`), and so are the authenticated-only RPCs in WP-DB-009/010. `/recover` also means a self-service reset exists at the API layer, whatever the UI says.
**Fix:** confirm sign-up OFF, anonymous OFF and email confirmation ON. Change `USING (true)` to `USING (public.is_active_app_user())`.

### WP-AUTH-009 — JWT algorithm, lifetime and refresh reuse detection undocumented (Low, Needs-live-verification)
The verification code is correct (`sign-credential/index.ts:89` and 7 other `getUser` calls). The unknowns are: HS256 shared secret versus asymmetric signing keys; access-token expiry (default 3600 s), which also bounds how long a token can be replayed after logout because PostgREST is stateless; and whether refresh reuse detection is on. `auth-middleware.ts:56` (`getClaims`) is dormant; `requireSupabaseAuth` is not imported anywhere.
**Fix:** migrate to asymmetric JWT signing keys and revoke the legacy secret. Set expiry to 600–900 s and keep reuse detection ON. Declare the settings for E-03.

### WP-AUTH-010 — Implicit flow puts session tokens in the URL fragment (Low, Likely)
No `flowType` is set, so the default is `'implicit'` (`GoTrueClient.js:21`). Invite and recovery redirects therefore carry `#access_token…&refresh_token…`. supabase-js removes the fragment afterwards. The app already supports the `token_hash` + `verifyOtp` shape (`authRedirect.ts:41`, `index.tsx:74,89`).
**Fix:** point the email templates at `/?token_hash={{ .TokenHash }}&type=…` and set `flowType: 'pkce'`.

### WP-AUTH-011 — Session parameters missing from the SFD (Low, Confirmed)
See D-03 above. Add a parameter table populated from the dashboard, and correct the `WoredaShell.tsx`/`AdminShell.tsx` references to `AppShell.tsx`.

### WP-AUTH-012 — All sign-outs are global (Info)
`signOut()` defaults to `{ scope: 'global' }` (`GoTrueClient.js:3395`), so an idle timeout on one PC also ends the user's other devices. If sign-out happens offline, the local session is cleared but the server-side token stays valid. Positive control; record the choice.

### WP-AUTH-013 — print_officer cannot be invited or reset through any Edge Function (Info, Likely)
`invite-tenant-user/index.ts:20`, `send-password-reset-link/index.ts:17` and `invite-platform-admin/index.ts:50` all leave out `print_officer` and `custom`, so these accounts can only be handled outside the audited paths.

## 5. Documentation drift

| Claim | Source | Verdict |
|---|---|---|
| Idle hook mounted in `WoredaShell.tsx`/`AdminShell.tsx` | CLAUDE.md:410; security-functionality.md:86 | CONTRADICTED — only `AppShell.tsx:406/566` exists |
| 20/25 min, 15 s poll, cross-tab sharing | CLAUDE.md:406-417 | CONFIRMED (`idleTimeout.ts:7,8,14,20`) |
| Absolute check catches laptop wake past the limit | CLAUDE.md:411-413 | CONFIRMED, but not across a page reload (WP-AUTH-004) |
| login.tsx shows "Forgot your password? Contact your administrator." | CLAUDE.md:356 | CONTRADICTED — no such string; generic footer at `login.tsx:330` |
| Locked-out reset is admin-initiated, not self-service | CLAUDE.md:350 | CONTRADICTED at API layer — public `/auth/v1/recover` |
| Reset link never targets tenant_admin/super_admin | CLAUDE.md:375-377 | CONTRADICTED — super_admin caller may (`send-password-reset-link/index.ts:116-118`) |
| Regeneration handled by refresh-token rotation | security-functionality.md:78 | NOT FOUND — no repo evidence of the setting |
| "All 4 Edge Functions … verify_jwt:false" | security-hardening.md:39-41 | CONTRADICTED — 8 functions; deploy script gives `verify_jwt=true` by default |
| Rate limiting on 3 endpoints | api-security.md:43-50 | CONTRADICTED — 5 functions use `checkRateLimit` |
| Suspended super_admin keeps a live session | admin.tsx:24-25 | CONFIRMED (and applies to all staff) |
| Rate-limit / CAPTCHA / HIBP operator actions | security-hardening.md:64-67; testing-scope.md:52-55 | NOT FOUND as done — unchecked; CAPTCHA blocked by code |

## 6. Dashboard settings the system owner must provide (UNVERIFIED items)

1. **Settings > JWT Keys:** legacy HS256 secret or asymmetric keys (ES256/RS256)? Has the legacy secret been revoked?
2. **Auth > Sessions:** access-token (JWT) expiry; *Detect and revoke compromised refresh tokens* and the reuse interval; *Time-box user sessions*; *Inactivity timeout*; single-session enforcement.
3. **Auth > Providers > Email:** *Allow new users to sign up*; *Confirm email*; *Secure email change*; *Secure password change*; *Minimum password length*; *Password requirements*.
4. **Auth > Sign In / Providers:** *Anonymous sign-ins*; any other enabled providers (phone, OAuth).
5. **Auth > Attack Protection:** CAPTCHA (provider, on/off); *Prevent use of leaked passwords*.
6. **Auth > Rate Limits:** sign-in/sign-up per IP, token refresh, emails per hour, OTP/verify.
7. **Auth > Multi-Factor:** TOTP / WebAuthn / Phone enabled.
8. **Auth > Email Templates:** link shape of the Invite and Reset Password templates (`{{ .ConfirmationURL }}` vs `token_hash`); OTP/link expiry.
9. **Auth > URL Configuration:** Site URL and redirect allow-list.
10. **Edge Functions:** the `verify_jwt` value each function is actually deployed with.
11. **Plan tier:** Pro or above is needed for time-box/inactivity and leaked-password protection.

## 7. Cross-references

WP-DB-001 (status not checked in `get_user_woreda_id()`) makes WP-AUTH-002 worse. WP-BQ-001 and appsec C-07 cover raw error messages, including `login.tsx:101` and `set-password.tsx:121`. Appsec gives the verdict on the HTML sinks that WP-AUTH-003's compensating controls depend on. The api-edge agent owns the `verify_jwt` gateway setting. crypto-qr owns the E-03 QR-token claims.
