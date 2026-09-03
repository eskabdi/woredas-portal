# Testing scope

INSA Enforcer Phase 6. This document is the asset inventory the checklist
expects; it is deliberately honest about what it cannot yet provide — see
"Test credentials" below.

## Assets in scope

| Asset                                  | Description                                                                                                                                  | Auth surface                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Woreda operating console (`/woreda/*`) | Amharic-primary, per-tenant staff console — residents, households, credentials, civil registration, service requests, rental houses, revenue | 8 tenant roles, RLS-scoped                                 |
| Platform admin console (`/admin/*`)    | English, platform-level — tenant provisioning, user management, credential template design                                                   | `super_admin`, optionally scoped further by `console_role` |
| Public credential verification         | `/v/:token` — scans a printed QR, checks an ES256 signature client-side then live revocation status                                          | None (anonymous)                                           |
| Public letter verification             | `/verify/letter/:token`                                                                                                                      | None (anonymous)                                           |
| Edge Functions (6)                     | `sign-credential`, `invite-tenant-user`, `invite-platform-admin`, `resend-platform-invite`, `activate-invited-user`, `record-login`          | Bearer JWT, see `docs/api-security.md`                     |
| Public RPCs (2)                        | `verify_credential_token`, `verify_service_letter`                                                                                           | None (anonymous)                                           |
| PostgREST data API                     | Auto-generated REST over all 42 RLS-protected tables                                                                                         | Bearer JWT (anon key + session)                            |

## Test credentials

**Not currently seeded.** The Enforcer expects placeholder Admin/Regular
User/Guest-equivalent credentials for an audit team, seeded **only in
staging environments**. This app has no staging project today — deliberately:
there is only one Supabase project, so local development runs against the
live production project (see CLAUDE.md's sandboxed-environment notes and
every Edge Function's own `SITE_URL`/CORS comment, which says as much).
Provisioning a real staging environment and a matching seeding runbook is
planned as a later, separate phase of the INSA remediation plan — it needs
a deliberate go-ahead (a new Supabase + Vercel project, real cost) rather
than being folded into a documentation-only pass. `supabase/seed-app-users.sql`
seeds three **real** people's accounts against the production project (a
super_admin, a tenant_admin, and a pending supervisor) — these are not
synthetic test identities and must not be treated as such.

Once a staging project exists, seed synthetic accounts there via the real
`invite-tenant-user`/`invite-platform-admin` Edge Functions (never raw SQL —
`seed-app-users.sql` only resolves against pre-existing `auth.users` rows,
it cannot create an account on its own) — one account per privilege level:

| Role             | Suggested email (staging only)  | Covers                                     |
| ---------------- | ------------------------------- | ------------------------------------------ |
| `super_admin`    | `test-admin@example.com`        | Full platform console                      |
| `tenant_admin`   | `test-tenant-admin@example.com` | Full per-woreda console                    |
| `registry_clerk` | `test-clerk@example.com`        | A representative mid-tier operational role |
| `viewer`         | `test-viewer@example.com`       | Read-only baseline                         |

## Operator checklist (dashboard actions, not code)

These have no repo-level equivalent and are tracked here so they aren't lost
between the security-hardening review and an actual audit pass:

- [ ] **Supabase → Auth → Rate Limits** — lower sign-in/OTP rate limits from
      their permissive defaults (`docs/security-hardening.md`).
- [ ] **Supabase → Auth → Attack protection** — enable CAPTCHA and leaked
      password protection.
- [ ] Confirm the two public RPCs (`verify_credential_token`,
      `verify_service_letter`) are covered by Supabase's project-wide API
      rate limits — they have no bespoke DB-side limiter (see the INSA
      remediation plan, Phase B item 12, for why that's deferred rather than
      unaddressed).
- [ ] After any deploy that touches an Edge Function, confirm the
      Postgres-backed limiter (`rate_limit_bucket` / `rate_limit_hit()`,
      `supabase/functions/_shared/rateLimit.ts`) is actually live on the
      three invite functions — trip it (repeat a request past the
      per-function budget) and confirm a `429`, or grep the function logs
      for `rate_limit_hit failed (failing open)`. The limiter fails open on
      any RPC error (migration not applied, stale PostgREST schema cache,
      wrong client), which is the right default for an internal-staff app
      but makes an inert limiter indistinguishable from a working one
      without this check.
- [ ] Re-run `curl -sSI` against the deployed site to confirm security
      headers survive the platform after any deploy (`docs/security-hardening.md`'s
      verification snippet).

## Out of scope for this pass

Dynamic penetration testing, dependency-vulnerability scanning, and load
testing were not performed as part of the INSA remediation documentation
pass — this document defines _what_ an audit team would need access to, not
a completed audit.
