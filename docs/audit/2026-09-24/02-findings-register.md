# 02 — Findings Register

All findings after adversarial verification (`findings/verifier.md`) and de-duplication. Each entry lists the agent that reported it and any duplicate IDs merged into it. Raw per-agent findings remain in `findings/<agent>.md|.json`; the machine-readable register is `02-findings.json`.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 15 |
| Medium | 50 |
| Low | 58 |
| Info | 21 |
| **Total** | **145** |

Confidence: *Confirmed* = proven from code/migrations; *Likely* = strong evidence, exploit path needs one unverified assumption; *Needs-live-verification* = depends on live DB / dashboard state the audit could not read.

## Index (Critical and High)

| ID | Severity | Module | Title | Confidence |
|---|---|---|---|---|
| [WP-VER-001](#wp-ver-001) | Critical | Platform | SECURITY DEFINER functions trust a caller-supplied key without re-checking the caller's woreda: cross-tenant reads via the birth-registration trigger, rental_eligibility() and get_credential_live_status() | Likely |
| [WP-WF-001](#wp-wf-001) | High | Civil Registration | Workflow INSERT guard covers only the credential tables: civil events and service requests can be created directly at approved, awaiting_payment, registered or issued | Confirmed |
| [WP-WF-004](#wp-wf-004) | High | Civil Registration | Approved content is not frozen: the subject of an approved request (resident, event type, event details, letter subject) can be changed before the side effect fires | Confirmed |
| [WP-WF-006](#wp-wf-006) | High | Civil Registration | Registered deaths are neither complete nor irreversible: only 'active' credentials are revoked, and any resident.update holder can set the deceased resident back to active | Confirmed |
| [WP-WF-003](#wp-wf-003) | High | Credentials | Maker != checker compares stale actor columns: after a return cycle, one user can re-verify and approve the same credential, civil or service request | Confirmed |
| [WP-WF-005](#wp-wf-005) | High | Credentials | credential_request UPDATE policy gives write access to read-only roles (viewer, auditor via credential.verify) and to finance_clerk | Likely |
| [WP-AUTH-001](#wp-auth-001) | High | Platform | No multi-factor authentication for any role, including platform-wide super_admin and tenant_admin | Confirmed |
| [WP-DB-001](#wp-db-001) | High | Platform | get_user_woreda_id() ignores app_user.status: suspended, pending and inactive staff keep tenant-wide data access | Confirmed |
| [WP-DB-004](#wp-db-004) | High | Platform | Read permissions (resident.read, household.read, civil.read, payment.read, audit.view ...) are not enforced by SELECT RLS | Confirmed |
| [WP-OPS-001](#wp-ops-001) | High | Platform | No staging environment: production is also the development, test and verification environment (real PII, real accounts, committed test writes) | Confirmed |
| [WP-OPS-002](#wp-ops-002) | High | Platform | Backups, point-in-time recovery and disaster recovery are unevidenced; indications are that production sits in a free-tier organisation, and Storage objects (scanned legal documents, photos, signatures) have no backup at all | Needs-live-verification |
| [WP-CRY-001](#wp-cry-001) | High | QR | Public ID-card verifier fails open: a revoked card can be shown as 'Verified' by re-encoding its token, or whenever the registry lookup misses or errors | Confirmed |
| [WP-WF-002](#wp-wf-002) | High | Services | Service-request FSM ignores category: letters can take the complaint path (pending_approval -> in_progress -> resolved -> closed), which skips approval SoD and payment, and the public verifier accepts resolved/closed | Confirmed |
| [WP-APP-001](#wp-app-001) | High | Settings | Stored XSS: letter-template editor writes unsanitised service_type.letter_body_html into the live DOM via innerHTML | Confirmed |
| [WP-DB-002](#wp-db-002) | High | Settings | Storage policies check only the woreda path prefix: any tenant user can overwrite official signatures/stamps/logos and read or delete every scanned legal document | Confirmed |
| [WP-AZ-001](#wp-az-001) | High | Super Admin | Console permissions (CP) are enforced only in the browser: a console-scoped super_admin keeps unrestricted platform power at the database and Edge Function layer | Confirmed |

## Module: Platform

### WP-VER-001
**SECURITY DEFINER functions trust a caller-supplied key without re-checking the caller's woreda: cross-tenant reads via the birth-registration trigger, rental_eligibility() and get_credential_live_status()**  
Severity **Critical** · Confidence Likely · Category Tenant Isolation · Reported by `verifier` · Verification: verified · Merged: WP-DB-003, WP-DB-009, WP-DB-010, WP-DB-003, WP-DB-009, WP-DB-010
  
Refs: insa: TEN-02, TEN-04, A-08, E-06; owasp_top10: A01:2021; owasp_api: API1:2023; asvs: V4.2.1, V4.1.3; iso27001: A.8.3, A.5.15; nist_csf: PR.AA-05, PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:C/C:H/I:L/A:N (6.8; severity set to Critical by audit rule R7, cross-tenant exposure)
- **Evidence:** `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:141` — `SELECT ethnicity, religion, current_household_id ... FROM public.resident WHERE resident_id = v_mother_id;  -- SECURITY DEFINER, no woreda predicate`; `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:163` — `COALESCE(d->>'mother_name', (SELECT full_name_am FROM public.resident WHERE resident_id = v_mother_id)),`; `supabase/migrations/00000000000032_task2_tenant_scoped_definer_triggers.sql:68` — `Out of scope for this task ... mother-lookup reads inside generate_resident_on_birth_approval() ... no woreda check ... which is Task 14.`; `supabase/migrations/00000000000031_rental_eligibility.sql:74` — `SELECT r.woreda_id, h.house_type INTO v_woreda_id, v_house_type FROM public.resident r ... WHERE r.resident_id = _resident_id;  -- woreda taken from the target,`; `supabase/migrations/00000000000031_rental_eligibility.sql:197` — `GRANT EXECUTE ON FUNCTION public.rental_eligibility(uuid, uuid, text) TO authenticated;`; `supabase/migrations/00000000000000_baseline.sql:1323` — `get_credential_live_status(_credential_number text) ... SECURITY DEFINER ... WHERE credential_number = _credential_number`
- **Description:** Three SECURITY DEFINER functions bypass RLS and look up a row by a key that the caller controls, without checking that the row belongs to the caller's woreda. (1) generate_resident_on_birth_approval() copies a mother's ethnicity, religion, household id and Amharic name from any woreda into a new resident in the event's woreda. The gap was explicitly deferred in migration 32 and never closed by the Task 14 migrations. (2) rental_eligibility() reports a resident's kebele-house occupancy, household-head status and in-flight rental request number for any woreda. It is granted to authenticated and probably to anon. (3) get_credential_live_status() returns the status of any credential number in any woreda. This reopens the enumeration that migration 34 closed for verify_credential_token(). Merges WP-DB-003, WP-DB-009 and WP-DB-010.
- **Attack scenario:** A civil registrar in woreda A obtains one tenant-B resident UUID, for example from a document or a former colleague. They insert a birth event directly at awaiting_payment (WP-WF-001), with event_details.mother_resident_id set to that UUID. The routine fee is recorded and the paid -> registered system transition fires, which writes B's special-category data into a woreda-A resident row. The same UUID passed to /rest/v1/rpc/rental_eligibility returns B's rental standing. Separately, any staff member in any woreda can loop get_credential_live_status over the 13-digit Luhn key space and map other woredas' issued and revoked cards.
- **Impact:** Cross-tenant disclosure of special-category PII (ethnicity, religion), identity data and housing status. This breaks the platform's core isolation promise that RLS alone keeps tenants apart. Because the foreign data is copied into a resident row, it persists and spreads through exports and audit logs.
- **Recommendation:** In every SECURITY DEFINER function that takes an id, re-derive the caller's woreda (get_user_woreda_id(), status-checked per WP-DB-001) and add AND woreda_id = <caller or NEW.woreda_id> to every lookup. Reject rather than silently skip on a mismatch. Extend enforce_vital_event_preconditions() so that mother_resident_id (and any *_resident_id inside event_details) must belong to NEW.woreda_id. Drop get_credential_live_status() (it has no callers), or give it the same staff/same-woreda predicate as verify_credential_token(). Add the woreda predicate plus a permission check (rental.view) to rental_eligibility(), and REVOKE EXECUTE FROM anon explicitly. Add a CI lint that flags SECURITY DEFINER bodies which SELECT from tenant tables without a woreda predicate.
- **Effort:** S · **Status:** Open

### WP-AUTH-001
**No multi-factor authentication for any role, including platform-wide super_admin and tenant_admin**  
Severity **High** · Confidence Confirmed · Category AuthN · Reported by `audit-auth-session` · Verification: verified
  
Refs: insa: C-05, D-03, E-03; owasp_top10: A07:2021; owasp_api: API2:2023; asvs: V4.3.1, V2.2.1; iso27001: A.8.5, A.8.2; nist_csf: PR.AA-03

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N (7.4)
- **Evidence:** `src/routes/login.tsx:96` — `const { data, error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password });`; `src/routes/login.tsx:144` — `if (appUser.role === "super_admin") { navigate({ to: "/admin/dashboard" }); }`; `docs/audit/2026-09-24/raw/auth-session-evidence.txt:0` — `## MFA / AAL usage (expect empty) -> (no matches) for auth.mfa|getAuthenticatorAssuranceLevel|aal2 across src/ and supabase/`; `src/components/ui/input-otp.tsx:1` — `shadcn OTP input primitive exists but is imported by no route or component`
- **Description:** Sign-in is a single password factor for every role. No code path enrols a factor (supabase.auth.mfa.enroll/challenge/verify), reads the assurance level (getAuthenticatorAssuranceLevel), or requires aal2 in any RLS policy or RPC. A super_admin (console_role_id NULL = unrestricted) reads every tenant's resident PII, including decrypted national-ID views, and provisions tenants and admins; a tenant_admin controls a whole woreda. Even if TOTP were switched on in the Supabase dashboard, nothing in the app or the database would require it, so it would be optional per user.
- **Attack scenario:** A phished, reused or guessed password of a super_admin (credential stuffing against /auth/v1/token is rate-limited only per IP, see WP-AUTH-005) is sufficient to open /admin with platform-wide read of all woredas and the ability to invite new super admins.
- **Impact:** Full cross-tenant confidentiality/integrity compromise from one stolen password; no second barrier for the most privileged accounts.
- **Recommendation:** Enable TOTP (and optionally WebAuthn) in Supabase Auth. Add an MFA enrolment + challenge step after signInWithPassword for super_admin and tenant_admin (mandatory) and optionally for finance/civil roles. Enforce server-side: add `(auth.jwt()->>'aal') = 'aal2'` to is_super_admin()/is_tenant_admin() (or a RESTRICTIVE policy on sensitive tables) and check aal in privileged Edge Functions, so a password-only session cannot use privileged paths even if the UI step is skipped.
- **Effort:** M · **Status:** Open

### WP-DB-001
**get_user_woreda_id() ignores app_user.status: suspended, pending and inactive staff keep tenant-wide data access**  
Severity **High** · Confidence Confirmed · Category AuthZ · Reported by `audit-database` · Verification: verified · Merged: WP-AUTH-002
  
Refs: insa: TEN-02, D-01, C-05; owasp_top10: A01:2021; owasp_api: API1:2023, API5:2023; asvs: V4.1.3, V4.2.1, V3.3.1; iso27001: A.5.18, A.8.2; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N (7.1)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1335` — `CREATE OR REPLACE FUNCTION public.get_user_woreda_id() ... SELECT woreda_id FROM public.app_user WHERE user_id = auth.uid();`; `supabase/migrations/00000000000011_status_check_admin_helpers.sql:3` — `is_super_admin() and is_tenant_admin() (baseline.sql) check only 'role', never 'status' ... A suspended super_admin or tenant_admin therefore still passes`; `supabase/migrations/00000000000000_baseline.sql:1626` — `CREATE POLICY resident_select ON public.resident ... USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())))`; `supabase/migrations/00000000000023_pii_encryption.sql:352` — `caller_woreda   := public.get_user_woreda_id();`; `src/components/settings/UsersRolesTab.tsx:254` — `async function suspendUserAction(user) { ... .from("app_user").update({ status: "suspended" })`; `docs/audit/2026-09-24/raw/audit-database-status-ungated-policies.txt:1` — `TOTAL 52 policy clauses on 43 tables; write-capable: audit_log, 6 sequence tables, kebele, service_request_status_history; plus 36 storage.objects policies`
- **Description:** Migration 11 fixed is_super_admin()/is_tenant_admin() to require status='active', and user_has_perm() already did, but get_user_woreda_id() was never given the same check. It is the only tenant predicate in 52 policy clauses on 43 tables, all 36 tenant storage.objects policies, and decrypt_pii_text()/decrypt_pii_numeric(). Suspending a user in the UI only sets app_user.status='suspended'. It does not ban the GoTrue user or revoke the refresh token.
- **Attack scenario:** A clerk is suspended after misconduct but keeps a valid refresh token. Calling PostgREST directly (GET /rest/v1/resident_decrypted?select=*) still returns every resident in the woreda, including decrypted national ID and phone number. The clerk can also download or delete scanned documents in storage, write the credential/receipt counter tables, and insert audit_log rows. An invited user who is still 'pending' gets the same read access.
- **Impact:** Taking a staff member's access away does not work at the database layer: any pending, suspended or inactive account keeps confidentiality exposure of the whole tenant's PII, plus limited integrity impact.
- **Recommendation:** Make get_user_woreda_id() return NULL unless status='active', which fixes every dependent policy at once. Also make suspension a server-side action that bans the auth user or revokes their sessions (Edge Function using auth.admin.updateUserById with ban_duration, or signOut(scope: global)).
- **Effort:** S · **Status:** Open

### WP-DB-004
**Read permissions (resident.read, household.read, civil.read, payment.read, audit.view ...) are not enforced by SELECT RLS**  
Severity **High** · Confidence Confirmed · Category AuthZ · Reported by `audit-database` · Verification: verified · Merged: WP-AZ-005
  
Refs: insa: CLS-01, RBAC-01, B-04, D-01; owasp_top10: A01:2021; owasp_api: API1:2023, API3:2023; asvs: V4.1.3, V4.2.1; iso27001: A.5.15, A.8.3; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N (6.5)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1626` — `resident_select ... USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())))`; `supabase/migrations/00000000000000_baseline.sql:1586` — `household_select ... USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())))`; `supabase/migrations/00000000000000_baseline.sql:1655` — `vital_event_select ... USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())))`; `supabase/migrations/00000000000000_baseline.sql:1599` — `payment_select ... USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())))`; `supabase/migrations/00000000000000_baseline.sql:1553` — `audit_log_tenant_read ... USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())))`; `src/config/permissions.ts:455` — `print_officer: [P.CREDENTIAL_READ, ... ] -- no RESIDENT_READ, HOUSEHOLD_READ, CIVIL_READ, PAYMENT_READ, AUDIT_VIEW; custom: []`
- **Description:** The core PII and financial tables (resident, household, household_location, vital_event, payment, receipt, credential_request, residence_credential, service_request, rental_occupancy(_request), credential_print_log, audit_log and the history tables) all have SELECT policies that check only the tenant. Any authenticated member of the woreda can read every row, whatever their role. Newer tables (resident_document, the rent_* ledger, arrears_*, service_request_checkpoint) do require a *.read / rental.view permission, which shows the intended model.
- **Attack scenario:** A print_officer, whose role has no resident, civil, payment or audit permission, or a custom role with zero grants, queries /rest/v1/resident_decrypted, /vital_event, /payment and /audit_log and gets the full tenant dataset. A tenant_admin who revokes resident.read from a role in the matrix changes only what the UI shows.
- **Impact:** Least privilege does not exist at the data layer. The RBAC matrix, custom roles and per-user denies are cosmetic for reads, and every staff account can bulk-export PII (including special-category ethnicity and religion data).
- **Recommendation:** Add the matching read-permission predicate to each SELECT policy, e.g. resident: user_has_any_perm('{resident.read,household.read}'); vital_event: civil.read/civil.view; payment/receipt: payment.read/revenue.view; audit_log: audit.view. Keep the *_decrypted views security_invoker so they inherit the check, and make decrypt_pii_*() require the corresponding read permission.
- **Effort:** M · **Status:** Open

### WP-OPS-001
**No staging environment: production is also the development, test and verification environment (real PII, real accounts, committed test writes)**  
Severity **High** · Confidence Confirmed · Category Config · Reported by `ops-scope` · Verification: verified
  
Refs: insa: OPS-01, F-03; owasp_top10: A05:2021; owasp_api: API8:2023; asvs: V14.1.1; iso27001: A.8.31, A.8.33; nist_csf: PR.DS-7 (CSF 1.1), PR.IR-01 (CSF 2.0)

- **CVSS:** N/A (environment/process control)
- **Evidence:** `docs/staging-runbook.md:9` — `**This app has no staging project today.** Local development and every prior deploy in this repo's history ran against the single production Supabase project`; `docs/go-live-declaration.md:179` — `This system has **no staging environment**. The one attempted staging-project creation call failed cleanly at the account's free-tier project cap`; `supabase/functions/_shared/response.ts:22` — `const ALLOWED_ORIGINS = new Set( [Deno.env.get("SITE_URL"), "http://localhost:5173"]  // :20-21 'localhost:5173 covers local dev against the real project (this `; `.claude/skills/verify/SKILL.md:9` — `a browser against the real Supabase project — there is no separate staging/sandbox project.`; `docs/remediation-report.md:21` — `'SAMPLE-DATA' | Verified via committed-then-cleaned real writes (not a rolled-back transaction)`; `docs/remediation-report.md:327` — `Completed manually with the same data the function would have written ... plus the 'USER_INVITED' audit_log row the function would have written on success`
- **Description:** There is exactly one Supabase project and it is production. Every non-production activity documented in the repository runs against it: local development (`verify` skill, the `http://localhost:5173` entry in the production Edge Function CORS allow-list), agent verification sessions, the 66-probe live-probe suite (run by default against the production ref), the acceptance harness (which creates per-role test users on the production URL), and 'SAMPLE-DATA' verification, which commits real writes to production tables (payments, receipts, civil events, service requests) and deletes them afterwards. One recorded verification pass completed a failed invite by hand-inserting an app_user row and an audit_log row directly into production. The staging runbook and seed script exist but have never been executed; the only provisioning attempt failed on the account's free-tier project cap.
- **Attack scenario:** A defect in a probe, a mis-scoped cleanup DELETE, or an agent session holding the account-level SUPABASE_ACCESS_TOKEN acts directly on real residents' PII, financial records and the audit trail. Test data, gaps in official number sequences (non-transactional nextval) and hand-written audit rows are indistinguishable from genuine operations for a later investigator.
- **Impact:** INSA Phase 6 (F-03) and OPS-01 cannot be satisfied: there is nowhere to seed test credentials except production, and a penetration test cannot be run without either testing production or waiting for an environment that does not exist. Integrity of the production audit trail and numbering is weakened by test activity.
- **Recommendation:** Provision the staging Supabase + Vercel projects described in docs/staging-runbook.md before any external security test or go-live sign-off. Point previews, local development and all probes/harnesses at staging only; remove the production ref as a default from scripts/run-live-probes.py and the acceptance-harness skill; remove http://localhost:5173 from the production ALLOWED_ORIGINS (set it only on staging via an env var). Prohibit committed test writes and manual audit_log inserts in production by written policy.
- **Effort:** M · **Status:** Open

### WP-OPS-002
**Backups, point-in-time recovery and disaster recovery are unevidenced; indications are that production sits in a free-tier organisation, and Storage objects (scanned legal documents, photos, signatures) have no backup at all**  
Severity **High** · Confidence Needs-live-verification · Category Config · Reported by `ops-scope` · Verification: needs-live-test
  
Refs: insa: OPS-01; owasp_top10: A05:2021; iso27001: A.8.13, A.5.30, A.8.14; nist_csf: PR.DS-11 (CSF 2.0), RC.RP-03 (CSF 2.0), PR.IP-4 (CSF 1.1)

- **CVSS:** N/A (availability/resilience control)
- **Evidence:** `docs/go-live-declaration.md:180` — `staging-project creation call failed cleanly at the account's free-tier project cap`; `docs/go-live-declaration.md:263` — `### Rollback path  (:265-289 covers frontend redeploy, additive migrations and Edge Function redeploy only; no data restore)`; `docs/system-review-2026-09.md:435` — `**Backup/restore evidence** | ... no restore drill is recorded. | Perform and document one point-in-time restore.`; `scripts/dump-storage.sql:12` — `It does NOT copy the stored files themselves. Objects already uploaded -- resident photos, credential templates, woreda logos -- have to be moved separately`; `scripts/dump-data.sql:8` — `It is limited to configuration and lookup data, not operational records like residents, credentials or payments.`; `(repository-wide):0` — `grep -i 'PITR|point-in-time|RPO|RTO|disaster' over docs/, scripts/, CLAUDE.md, .claude/ returns no backup tier, RPO, RTO or DR plan`
- **Description:** No document states the Supabase plan, the backup mechanism, the retention period, whether point-in-time recovery (PITR) is enabled, a recovery point objective (RPO) or recovery time objective (RTO), or any restore test. The go-live 'Rollback path' covers code artifacts only. Two separate documents record that a project-creation call failed on the account's free-tier project cap, which suggests (but does not prove) that the production project is in a free-tier organisation. On Supabase, PITR is a paid add-on; daily backups with short retention are a paid-plan feature; free projects can be paused for inactivity; and database backups do not contain Storage object bytes in any plan. The repository's dump scripts export reference data and bucket/policy DDL only, explicitly not operational records or stored files.
- **Attack scenario:** Accidental mass DELETE (hard-DELETE policies exist, see WP-DB-011), a destructive migration applied through the Management API, a compromised account-level PAT, or project deletion leaves no restorable copy of residents, civil events, payments or the scanned documents in the 10 private buckets.
- **Impact:** Potential permanent loss of the civil registry, credential records and legal document scans for all six woredas; no defined RPO/RTO means no one has committed to how much data loss or downtime is acceptable.
- **Recommendation:** Owner to confirm (screenshot of Billing and Database > Backups) the plan and backup settings. Minimum for a government registry: Pro plan or higher with the PITR add-on (RPO in minutes), a documented RPO/RTO, a scheduled off-platform copy of all 10 Storage buckets (the scripts/migrate-storage.mjs pattern pointed at a separate account or object store), a logical pg_dump to separate storage under a separate credential, and a restore drill into the staging project at least quarterly with the result recorded.
- **Effort:** M · **Status:** Open

### WP-API-002
**Edge Functions perform no schema validation of request bodies (types, formats, lengths, storage paths); malformed JSON returns 500**  
Severity **Medium** · Confidence Confirmed · Category Injection · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-06, E-06; owasp_top10: A03:2021, A04:2021; owasp_api: API3:2023, API8:2023; asvs: V5.1.1, V5.1.3, V13.2.2; iso27001: A.8.28; nist_csf: PR.DS-10

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N (2.7)
- **Evidence:** `supabase/functions/invite-tenant-user/index.ts:57` — `const body = (await req.json()) as Body;`; `supabase/functions/invite-tenant-user/index.ts:69` — `if (!email || !full_name || !role || !woredaId) {`; `supabase/functions/invite-tenant-user/index.ts:187` — `signature_path: signature_path || null,           photo_path: photo_path || null,`; `supabase/functions/sign-credential/index.ts:93` — `const body = (await req.json()) as RequestBody;`; `supabase/functions/sign-credential/index.ts:283` — `return safeError(req, "sign-credential: unhandled", e, "Credential signing failed", 500);`; `supabase/migrations/00000000000014_app_user_staff_fields.sql:8` — `ADD COLUMN IF NOT EXISTS department text, job_title text, reports_to_user_id uuid, signature_path text, photo_path text (no CHECK)`
- **Description:** All eight functions cast req.json() to a TypeScript interface and check only truthiness of required fields. There is no runtime type check (a non-string email or an object full_name reaches GoTrue/Postgres), no e-mail format check, no UUID format check (Postgres rejects -> generic 500/404), no length bounds on full_name/department/job_title (no DB CHECK either), and signature_path/photo_path are stored verbatim with no bucket or `${woredaId}/` prefix check. A malformed JSON body throws inside the try and is reported as 500 rather than 400. The Edge Functions are the only server-side code for these writes, so the client-side zod schemas are the sole validation.
- **Attack scenario:** A tenant_admin (or anyone replaying their token) sets a staff member's signature_path to another object path (e.g. a different woreda's prefix or a different bucket's object name) or submits multi-kilobyte names that later render on printed letters; malformed input produces 500s that pollute error monitoring.
- **Impact:** Data-quality and defence-in-depth gap; referenced storage objects are still protected by storage RLS at read time, so no direct cross-tenant read was demonstrated.
- **Recommendation:** Validate every body with a zod (or valibot) schema in each function: uuid(), email(), enum(), max lengths, and a regex requiring signature_path/photo_path to start with `${woredaId}/`. Return 400 on JSON parse failure. Add DB CHECK length limits on app_user text columns.
- **Effort:** M · **Status:** Open

### WP-API-003
**Public self-registration is not disabled in any repo-controlled config; if enabled, anyone obtains an authenticated JWT that reaches tenant-unchecked RPCs**  
Severity **Medium** · Confidence Needs-live-verification · Category AuthN · Reported by `audit-api-edge` · Verification: needs-live-test · Merged: WP-AUTH-008
  
Refs: insa: E-03, TEN-05; owasp_top10: A07:2021; owasp_api: API2:2023, API1:2023; asvs: V2.1.1, V4.1.1; iso27001: A.5.16; nist_csf: PR.AA-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N (5.3)
- **Evidence:** `supabase/config.toml:1` — `project_id = "woredas-portal"   (entire file - no [auth] enable_signup setting)`; `supabase/migrations/00000000000000_baseline.sql:1323` — `CREATE OR REPLACE FUNCTION public.get_credential_live_status(_credential_number text) ... SECURITY DEFINER ... WHERE credential_number = _credential_number`; `supabase/migrations/00000000000031_rental_eligibility.sql:197` — `GRANT EXECUTE ON FUNCTION public.rental_eligibility(uuid, uuid, text) TO authenticated;`; `supabase/migrations/00000000000000_baseline.sql:1661` — `CREATE POLICY woreda_read_all_authenticated ON public.woreda ... TO authenticated USING (true);`; `supabase/config.toml:1` — `project_id = "woredas-portal"  -- no [auth] enable_signup / enable_anonymous_sign_ins` (via WP-AUTH-008); `supabase/migrations/00000000000000_baseline.sql:1661` — `CREATE POLICY woreda_read_all_authenticated ON public.woreda AS PERMISSIVE FOR SELECT TO authenticated USING (true);` (via WP-AUTH-008)
- **Description:** The app is invite-only (no signUp() call in src/), but whether GoTrue accepts POST /auth/v1/signup is a dashboard setting that nothing in the repository pins. Several endpoints are gated only on the `authenticated` role, not on having an active app_user row: get_credential_live_status (no woreda filter, 13-digit sequential credential numbers - WP-DB-010), rental_eligibility (no caller check - WP-DB-009), the woreda/id_card_template/workflow_transition tables (USING true), and the credential-templates bucket.
- **Attack scenario:** Attacker calls /auth/v1/signup with the public publishable key, confirms a throw-away mailbox, and then enumerates /rest/v1/rpc/get_credential_live_status with guessed credential numbers to learn which cards exist and whether they are revoked, across all woredas.
- **Impact:** Cross-tenant metadata disclosure to unauthenticated internet users, conditional on the live signup setting.
- **Recommendation:** Confirm Authentication > Sign In / Providers > "Allow new users to sign up" is OFF on the production project and record it (or manage it via config.toml [auth] enable_signup = false plus a CI check). Independently, require is_active_app_user() (or a woreda match) inside every authenticated-granted DEFINER RPC and REVOKE get_credential_live_status from authenticated.
- **Effort:** S · **Status:** Open

### WP-APP-003
**CSP allows 'unsafe-inline' scripts and auth tokens live in localStorage, so any HTML-injection bug becomes full session takeover**  
Severity **Medium** · Confidence Confirmed · Category Config · Reported by `audit-appsec` · Verification: not individually re-verified (Medium sample FP rate 0/10) · Merged: WP-AUTH-003
  
Refs: insa: C-02, C-04; owasp_top10: A05:2021; owasp_api: API8:2023; asvs: V14.4.3, V3.2.3; iso27001: A.8.9; nist_csf: PR.PS-01

- **Evidence:** `src/lib/security-headers.ts:52` — `"script-src 'self' 'unsafe-inline'",`; `src/lib/security-headers.ts:30` — `* script-src carries 'unsafe-inline' deliberately: TanStack Start's SSR emits two inline scripts`; `src/integrations/supabase/client.ts:24` — `storage: typeof window !== "undefined" ? localStorage : undefined,`; `src/lib/security-headers.ts:95` — `if (contentType.includes("text/html")) { headers.set("Content-Security-Policy", contentSecurityPolicy()); }`; `src/integrations/supabase/client.ts:24` — `storage: typeof window !== "undefined" ? localStorage : undefined,       persistSession: true,       autoRefreshToken: true,` (via WP-AUTH-003); `src/lib/security-headers.ts:52` — `"script-src 'self' 'unsafe-inline'",` (via WP-AUTH-003)
- **Description:** The other headers are well configured: HSTS 2y with includeSubDomains, X-Frame-Options SAMEORIGIN plus frame-ancestors 'self', nosniff, strict-origin-when-cross-origin, a Permissions-Policy limited to camera and geolocation, and object-src 'none', base-uri 'self' and form-action 'self'. script-src, however, allows 'unsafe-inline', which also permits inline event-handler attributes. The CSP therefore does not mitigate WP-APP-001 or any future injection. Supabase access and refresh tokens are kept in localStorage, so injected script can read them. Navigation-based exfiltration is not limited by connect-src. There is also no Trusted Types (require-trusted-types-for 'script'). The headers are applied only by src/server.ts. No vercel.json exists, and it is not verified that every HTML response on the live deployment passes through that wrapper.
- **Attack scenario:** Any stored or reflected HTML sink (for example WP-APP-001) can use inline handlers to run script, read localStorage['sb-<ref>-auth-token'] and replay the refresh token from anywhere.
- **Impact:** The main browser-side defence-in-depth control is effectively absent against inline injection.
- **Recommendation:** Move to per-request nonces for the two TanStack Start inline scripts ('nonce-<n>' 'strict-dynamic') and drop 'unsafe-inline'. Add require-trusted-types-for 'script' once the editor uses a sanitiser policy. Consider a shorter JWT expiry. Verify the headers on the production URL with curl -sI against the root, a deep link and the 404 page.
- **Effort:** M · **Status:** Open

### WP-APP-004
**File-upload constraints are client-side only for 8 of 10 buckets; SVG/any-type accepted on two paths; extensions come from client filenames; no magic-byte check or malware scanning**  
Severity **Medium** · Confidence Confirmed · Category Config · Reported by `audit-appsec` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-08; owasp_top10: A04:2021, A05:2021; owasp_api: API4:2023; asvs: V12.1.1, V12.2.1, V12.3.1, V12.4.1; iso27001: A.8.7, A.8.28; nist_csf: PR.DS-01, DE.CM-09

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N (5.4)
- **Evidence:** `supabase/migrations/00000000000001_storage.sql:24` — `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('credential-request-documents', ..., 'f', NULL, NULL)  -- same NULL/`; `supabase/migrations/00000000000014_app_user_staff_fields.sql:24` — `VALUES ('staff-assets', 'staff-assets', 'f', NULL, NULL)`; `supabase/migrations/00000000000048_task11_schema_gaps.sql:345` — `INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false)`; `src/components/forms/ResidentWizardSteps.tsx:207` — `const handlePhotoUpload = async (file: File) => { ... size check only, no MIME check; SquircleUpload accept="image/*"`; `src/utils/imageCompression.ts:69` — `if (!CONVERTIBLE.has(file.type) || !supportsWebpEncoding()) return file;  // image/svg+xml passes through unchanged`; `src/components/settings/UsersRolesTab.tsx:732` — `accept="image/*"   // onFile() (line 685) checks size only; no MIME check`
- **Description:** There are 10 private buckets. Only resident-documents (00004: 10 MB, PDF) and rental-request-documents (00072: 5 MB, PDF/JPEG/PNG) enforce size and MIME at the bucket level. The other 8 (attachments, credential-request-documents, credential-templates, resident-clearance-letters, resident-photos, service-request-documents, staff-assets, tenant-assets) rely on checks in React code that a direct Storage API call skips. Two UI paths have no MIME check at all: resident photo (ResidentWizardSteps) and staff photo/signature (UsersRolesTab). Both accept image/*, and toWebp() passes SVG through unconverted. Four paths derive the stored extension from the client filename (credentials.new x2, clearance letters, and storageExtension() for non-JPEG/PNG). Content-Type is always the client-declared file.type. No path inspects magic bytes. No AV or CDR scanning exists; the sha256 'checksum' is computed in the browser and never verified server-side. Non-PDF attachments open as a top-level document on the Supabase storage origin, so an uploaded text/html or image/svg+xml object would render there. Permission gating on storage.objects is covered separately by WP-DB-002 and is not repeated here.
- **Attack scenario:** A clerk (or anyone holding a woreda session, per WP-DB-001/002) uploads doc.svg (image/svg+xml) or a text/html file to the attachments bucket through the Storage API. The object is linked to a credential request. When a supervisor clicks it, the file opens top-level on <ref>.supabase.co and shows a credential-phishing page or drives downloads under a trusted government-looking URL. The same missing limits allow multi-GB uploads into any of the 8 buckets.
- **Impact:** Malicious or active content can be stored in the evidence repository. Storage cost and availability can be abused. Malware can be distributed to staff who open scanned documents. The app origin's tokens are not directly exposed because the storage origin differs.
- **Recommendation:** Set file_size_limit and allowed_mime_types on every bucket in a migration: images ['image/jpeg','image/png','image/webp'], documents plus 'application/pdf', never image/svg+xml or text/*. Derive extensions from a MIME allow-list map, never from file.name. Add MIME checks to the resident-photo and staff-assets uploaders. Validate magic bytes in an Edge Function or a storage webhook, and quarantine until scanned (e.g. ClamAV in an Edge Function), or record scanning as an accepted gap. Open non-PDFs through createSignedUrl(path, ttl, { download: true }) so they are served as attachments.
- **Effort:** M · **Status:** Open

### WP-ARC-001
**Project architecture documents (docs/dfd.md, docs/architecture.md, docs/erd.md) are materially stale and contain claims the code contradicts**  
Severity **Medium** · Confidence Confirmed · Category Docs · Reported by `audit-architecture` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-01, A-02, A-03, A-04, A-05, A-07, G-01; iso27001: A.5.37, A.8.27; nist_csf: ID.AM-03 (CSF 2.0)

- **CVSS:** N/A (documentation control)
- **Evidence:** `docs/dfd.md:73` — `Verifier sends token only, no PII in request / QR encodes only the token, contradicted by sign-credential/index.ts:206-218 (readable name, sex, DOB, kebele, hou`; `docs/architecture.md:29` — `6 Edge Functions / 43 tables / 9 buckets: actual 8 / 66 / 10`; `docs/architecture.md:89` — `Two RPCs for public verification: actual three (verify_receipt, 00000000000013:189)`; `docs/erd.md:10` — `52 tables, zero drift: 14 rental/checkpoint tables from migrations 71-89 absent`; `docs/dfd.md:42` — `L1 has 5 processes, 6 stores; no L2 diagram exists`
- **Description:** Neither project diagram matches what the code does. The DFD omits civil registration, rental, settings, tenant provisioning, receipt verification, all 10 storage buckets, Vault, localStorage and the offline queue. It has no Level 2 view, and it states that the QR code carries no PII when the signed payload is readable base64 containing personal data. The architecture and ERD documents undercount functions, tables, buckets and public RPCs.
- **Attack scenario:** Not directly exploitable. A privacy or INSA assessor who relies on docs/dfd.md would conclude that public verification exposes no PII and would not test the third verification surface or the rental financial stores.
- **Impact:** INSA Phase A deliverables (A-01/A-02/A-04/A-05) fail on submission. Security reviews are scoped from wrong diagrams, and threat modelling misses real PII flows.
- **Recommendation:** Replace docs/dfd.md, docs/architecture.md (deployment and component sections) and docs/erd.md with the as-is artifacts in docs/audit/2026-09-24/architecture/. Add a PR-template checklist item and a CI check comparing table, function and bucket counts in the docs against the migrations (roadmap P2-10).
- **Effort:** M · **Status:** Open

### WP-ARC-002
**No server-side application tier: several multi-step business transactions and the audit trail are driven by the browser rather than by one database transaction**  
Severity **Medium** · Confidence Confirmed · Category Design · Reported by `audit-architecture` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-05, C-01; owasp_top10: A04:2021; asvs: V1.1.2, V11.1.1; iso27001: A.8.27; nist_csf: PR.PS-06 (CSF 2.0)

- **CVSS:** N/A (architectural root cause; exploitable instances rated under WP-WF-009, WP-DB-008, WP-PRV-001)
- **Evidence:** `docs/architecture.md:46` — `No server-side application logic between the browser and Supabase (design choice)`; `src/routes/woreda.services.$requestId.index.tsx:324` — `.from("payment").insert({... status: "confirmed"}) followed by a separate receipt insert at :342`; `src/lib/offlineSync.ts:244` — `offline replay performs payment insert (:244) then receipt insert (:265) as separate calls`; `src/:0` — `68 client-side audit_log insert sites; 23 client references to *_status_history tables`; `supabase/migrations/00000000000087_rental_review_round4_fixes.sql:693` — `Counter-example: rental money movement is one locked SECURITY DEFINER transaction`
- **Description:** Every page talks to PostgREST with the anon key, so any invariant not written as RLS, a trigger or a DEFINER RPC is enforced only by browser code. The rental module follows the safe pattern: one locked DEFINER RPC per money movement. The credential, civil and service fee paths do not. They issue payment insert, receipt insert and status update as separate client calls, and most audit and status-history rows are written by the client.
- **Attack scenario:** A staff user with a valid session calls PostgREST directly and inserts a payment without a receipt or status change, or changes a status without the matching audit row. The browser-side sequencing never runs, and nothing in the database reconciles the gap.
- **Impact:** Partial transactions, forgeable or missing audit evidence, and an inconsistent financial ledger. This is the common cause behind several High and Medium workflow and privacy findings.
- **Recommendation:** Adopt the rental pattern platform-wide: one SECURITY DEFINER RPC per business transaction (record_fee_payment, transition_request) with SET search_path = '', FOR UPDATE, an idempotency key, and DB-written audit and history rows. Then revoke client INSERT on audit_log and the history tables (roadmap P1-9, P1-12).
- **Effort:** L · **Status:** Open

### WP-ARC-003
**Anonymous verification pages, the tenant portal and the super-admin console share one origin and one localStorage session under a CSP that allows inline script**  
Severity **Medium** · Confidence Confirmed · Category Design · Reported by `audit-architecture` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-06, C-02; owasp_top10: A04:2021, A05:2021; asvs: V3.2.3, V14.4.3; iso27001: A.8.26; nist_csf: PR.AA-05 (CSF 2.0)

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:N (conditional on any script-injection bug)
- **Evidence:** `src/integrations/supabase/client.ts:24` — `storage: typeof window !== "undefined" ? localStorage : undefined`; `src/lib/security-headers.ts:52` — `"script-src 'self' 'unsafe-inline'"`; `src/routes/v.$token.tsx:1` — `public verifier routes (v.$token, verify.letter.$token, verify.receipt.$token) served from the same SPA/origin as woreda.* and admin.*`
- **Description:** Three trust levels (anonymous public, tenant staff, platform super admin) run as one SPA on one origin. The bearer session lives in localStorage, readable by any script on the origin, and the CSP does not block inline script. A script-execution bug on any page, including the public ones that render attacker-influenced token content, can therefore read the session of whoever is signed in on that browser. That includes a super admin.
- **Attack scenario:** An XSS in any route (for example the stored letter-template XSS in WP-APP-001) runs in a super admin's browser and exfiltrates the access and refresh tokens from localStorage, giving cross-tenant platform access until the refresh token is revoked.
- **Impact:** Any single XSS escalates to platform-wide session theft. The blast radius is not contained per portal.
- **Recommendation:** Move the admin console, and ideally the public verifiers, to separate origins or subdomains. Adopt CSP nonces (drop 'unsafe-inline'). Consider cookie-based session storage (HttpOnly, SameSite=Strict) through a thin server tier. Require aal2 MFA for super_admin (roadmap P1-8, P1-10, P2-3).
- **Effort:** L · **Status:** Open

### WP-AUTH-004
**Client idle timeout is reset on every page load and is the only evidenced session timeout; abandoned sessions resume indefinitely**  
Severity **Medium** · Confidence Confirmed · Category AuthN · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-05, D-03; owasp_top10: A07:2021; owasp_api: API2:2023; asvs: V3.3.2, V3.3.1; iso27001: A.8.5, A.8.1; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:P/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N (6.1)
- **Evidence:** `src/hooks/useIdleTimeout.ts:79` — `let lastActivity = Date.now();`; `src/hooks/useIdleTimeout.ts:84` — `writeStoredActivity(lastActivity);  -- overwrites the shared timestamp on mount without first reading it`; `src/config/idleTimeout.ts:8` — `export const IDLE_LOGOUT_MS = 25 * 60 * 1000;`; `src/components/layout/AppShell.tsx:406` — `useIdleTimeout({ onTimeout: handleSignOut, ... })  -- only mounted inside AppShell (woreda) and AppShell.tsx:566 (admin); /set-password, /login, / are not cover`; `src/integrations/supabase/client.ts:25` — `persistSession: true,       autoRefreshToken: true,`
- **Description:** The 20-minute warning / 25-minute sign-out is correctly implemented while the portal is open (absolute timestamp, 15 s poll, cross-tab sharing). But on mount the hook sets lastActivity = now and writes it to localStorage before ever consulting the previously stored value. A user who closes the tab or browser without signing out, and comes back hours or days later, is silently restored by supabase-js from the persisted refresh token and gets a fresh 25-minute window. The timer is also not active on /set-password, where an invite/recovery session can sit indefinitely. No server-side inactivity timeout or session time-box is evidenced in the repository (supabase/config.toml holds only project_id; Supabase's defaults are 'never'), so the effective maximum session lifetime is unbounded. INSA C-05 requires both server-side and client-side controls.
- **Attack scenario:** A clerk on a shared office PC closes the browser at lunch without signing out. Anyone opening the portal later on that PC lands in the clerk's authenticated woreda session.
- **Impact:** Idle timeout is bypassed by the most common real-world pattern (closing the tab); session lifetime is effectively unlimited.
- **Recommendation:** On mount, read the stored timestamp first and, if (now - stored) >= IDLE_LOGOUT_MS, sign out immediately before rendering the shell; only then write the new timestamp. Mount the hook (or an equivalent guard) on /set-password too. Configure Supabase Auth > Sessions: Inactivity timeout (e.g. 30 min) and Time-box user sessions (e.g. 8-12 h) so the server enforces the limit even if the client code is bypassed; document the values (D-03).
- **Effort:** S · **Status:** Open

### WP-AUTH-005
**No CAPTCHA, account lockout or failed-login logging on sign-in; brute-force protection rests on unverified GoTrue per-IP limits, and CAPTCHA cannot be enabled without a code change**  
Severity **Medium** · Confidence Confirmed · Category AuthN · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-05, D-03; owasp_top10: A07:2021; owasp_api: API2:2023, API4:2023; asvs: V2.2.1, V7.2.1; iso27001: A.8.5, A.8.15; nist_csf: PR.AA-03, DE.CM-03

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:L/A:N (6.5)
- **Evidence:** `src/routes/login.tsx:96` — `supabase.auth.signInWithPassword({ email: values.email, password: values.password })  -- no options.captchaToken`; `supabase/functions/send-password-reset-link/index.ts:165` — `await anon.auth.resetPasswordForEmail(targetEmail, { redirectTo: '${SITE_URL}/set-password' })  -- no captchaToken either`; `docs/testing-scope.md:52` — `- [ ] **Supabase → Auth → Rate Limits** — lower sign-in/OTP rate limits ... - [ ] **Supabase → Auth → Attack protection** — enable CAPTCHA and leaked password p`; `src/routes/login.tsx:101` — `setSubmitError(error?.message ?? "Sign-in failed");  -- failed attempt is not recorded anywhere app-side`
- **Description:** The browser calls GoTrue's /auth/v1/token directly. The app adds no client throttle, no CAPTCHA token and no per-account lockout (GoTrue itself has none; it only rate-limits per IP). If CAPTCHA protection is turned on in the dashboard, both login.tsx and send-password-reset-link would start failing because neither passes captchaToken, so the recommended control in docs/security-hardening.md:64-67 cannot be enabled as-is. The operator checklist items for rate limits and attack protection are still unchecked. Failed sign-ins are not written to audit_log (only GoTrue's own auth.audit_log_entries, if retained). Login-side enumeration is not an issue: GoTrue returns the same 'Invalid login credentials' for unknown email and wrong password, and the 'not provisioned'/'not active' messages only appear after a correct password.
- **Attack scenario:** Distributed password spraying of known staff emails (the login placeholder itself shows the @eharari.gov.et pattern) from many IPs stays under per-IP limits indefinitely; no lockout, CAPTCHA or alert fires.
- **Impact:** Online guessing/credential stuffing against a single-factor login (see WP-AUTH-001) is limited only by per-IP rate limits of unknown value.
- **Recommendation:** Add Turnstile/hCaptcha to login.tsx and pass options.captchaToken; for send-password-reset-link, either call /recover with a server-side captcha bypass strategy or use admin.generateLink + own mail. Then enable CAPTCHA in Auth > Attack Protection. Lower Auth rate limits (sign-in/sign-up per IP, token refresh, email sends). Add an app-level failed-attempt counter or a GoTrue auth hook / log drain alert on repeated 'invalid_credentials' per email; consider progressive delay per account.
- **Effort:** M · **Status:** Open

### WP-AUTH-006
**Password change requires neither the current password nor re-authentication, and does not explicitly revoke other sessions**  
Severity **Medium** · Confidence Confirmed · Category AuthN · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-03; owasp_top10: A07:2021; owasp_api: API2:2023; asvs: V2.1.6, V3.3.3, V3.7.1; iso27001: A.5.17, A.8.5; nist_csf: PR.AA-03

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:L/UI:R/S:U/C:H/I:H/A:N (6.4)
- **Evidence:** `src/components/common/ChangePasswordDialog.tsx:56` — `const { error: updateErr } = await supabase.auth.updateUser({ password });  -- no current-password field, no nonce`; `src/routes/set-password.tsx:119` — `const { error } = await supabase.auth.updateUser({ password: values.password });  -- reachable by any signed-in user, not only invite/recovery sessions`; `docs/audit/2026-09-24/raw/auth-session-evidence.txt:0` — `no call to supabase.auth.reauthenticate() or signOut({ scope: 'others' }) anywhere in src/`
- **Description:** Anyone holding a live session (unattended PC, stolen localStorage token per WP-AUTH-003) can set a new password without knowing the old one, turning a temporary session compromise into permanent account takeover that survives token revocation. The code has no support for Supabase's 'Secure password change' (reauthenticate() + nonce), so that dashboard setting is either off or would break password change for sessions older than 24 h. After a change, the app does not call signOut({ scope: 'others' }); whether GoTrue revokes other sessions on password update is platform behaviour that must be verified live.
- **Attack scenario:** Attacker with a stolen refresh token opens /set-password (or the avatar menu), sets a new password, and now owns the account even after the victim's sessions are revoked.
- **Impact:** Session compromise escalates to persistent credential compromise; legitimate user is locked out.
- **Recommendation:** Require the current password in ChangePasswordDialog (verify by signInWithPassword against the same email, or enable Secure password change and implement reauthenticate() + nonce). Restrict /set-password to sessions that arrived via invite/recovery (e.g. check amr contains 'otp'/'recovery' or appUser.status === 'pending'). After a successful change call supabase.auth.signOut({ scope: 'others' }) and write an audit_log entry.
- **Effort:** S · **Status:** Open

### WP-AUTH-007
**Password policy (8-char minimum) is enforced only in the browser; server-side minimum and breached-password screening are unverified**  
Severity **Medium** · Confidence Needs-live-verification · Category AuthN · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-03; owasp_top10: A07:2021; owasp_api: API2:2023; asvs: V2.1.1, V2.1.7, V2.1.9; iso27001: A.5.17; nist_csf: PR.AA-01

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N (4.8)
- **Evidence:** `src/routes/set-password.tsx:24` — `password: z.string().min(8, "Password must be at least 8 characters"),`; `src/components/common/ChangePasswordDialog.tsx:47` — `if (password.length < 8) {`; `src/routes/login.tsx:35` — `password: z.string().min(6, "Password must be at least 6 characters"),  -- login-side only; implies accounts with 6-7 char passwords are expected to exist`; `docs/testing-scope.md:54` — `- [ ] **Supabase → Auth → Attack protection** — enable CAPTCHA and leaked       password protection.`
- **Description:** The 8-character minimum lives in zod/JS only. GoTrue's own minimum (Auth > Providers > Email > Minimum password length) defaults to 6 and is not in the repo; a direct PUT /auth/v1/user with a 6-character password succeeds unless it was raised. Leaked-password (HaveIBeenPwned) protection is listed as an open operator action. No forced composition rules exist (good, per NIST 800-63B). No maximum is enforced client-side (GoTrue rejects >72 bytes).
- **Attack scenario:** A user bypasses the dialog (browser console) and sets a 6-character or known-breached password, which is then guessable under WP-AUTH-005.
- **Impact:** Weak or breached passwords possible on single-factor accounts.
- **Recommendation:** Set Minimum password length >= 12 (ASVS L2) or at least 8 in the dashboard, enable Leaked password protection, keep composition rules off; mirror the same value in a shared client constant; align login.tsx min to not leak policy (or drop the min there). Record the values in the SFD.
- **Effort:** S · **Status:** Open

### WP-AZ-004
**Module toggles are enforced only in the browser; a disabled module stays fully readable and writable through PostgREST, RPCs and Edge Functions**  
Severity **Medium** · Confidence Confirmed · Category AuthZ · Reported by `audit-authz` · Verification: not individually re-verified (Medium sample FP rate 0/10) · Merged: WP-INV-005
  
Refs: insa: RBAC-03, E-06; owasp_top10: A01:2021; owasp_api: API5:2023; asvs: V4.1.1, V4.1.3; iso27001: A.8.3; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `supabase/migrations/00000000000066_payment_hardening_review_fixes.sql:391` — `IF EXISTS (SELECT 1 FROM public.tenant_module_config tmc WHERE ... module_key = 'services' AND tmc.is_enabled = false)  -- the only server-side module check`; `supabase/migrations/00000000000066_payment_hardening_review_fixes.sql:346` — `IF NEW.category <> 'letter' THEN RETURN NEW;  -- complaints skip even that check`; `src/components/common/ModuleGate.tsx:23` — `const disabled = !isLoading && ... role !== "super_admin" && ... !enabledModules.has(moduleKey);  -- redirect only`; `src/hooks/useTenantModules.ts:6` — `const ALL_MODULES: ModuleKey[] = [ ... ]  -- omits 'rental_houses' although the DB CHECK allows it`; `src/routes/woreda.reports.tsx:3` — `createFileRoute("/woreda/reports")({ ssr: false, component: () => <Outlet /> })  -- no ModuleGate; $reportType.print is reachable when reports is disabled`; `src/routes/woreda.dashboard.tsx:276` — `.from("payment_decrypted")  -- revenue KPI rendered regardless of revenue module/permission`
- **Description:** tenant_module_config has 8 module keys. Only one server-side reader exists: enforce_service_request_preconditions() rejects letter-category service_request writes when services is disabled. Nothing on the server consults the credentials, civil_registration, revenue, reports, audit, approvals or rental_houses keys. That covers table RLS, the workflow triggers, get_*_kpis, the rental RPCs and sign-credential. Client-side, ModuleGate only redirects. rental_houses is never gated (WP-INV-005). The reports print route sits outside any ModuleGate. The dashboard and approval queue display data from disabled modules.
- **Attack scenario:** A super_admin disables 'credentials' for woreda X (for example, while a card-stock audit is under way). A registry_clerk in X keeps issuing via PostgREST: POST /rest/v1/credential_request, the PATCH transitions, and POST /functions/v1/sign-credential all succeed.
- **Impact:** The platform owner's module switch is advisory, so a legally suspended service can still be delivered and recorded. RBAC-03 fails.
- **Recommendation:** Add a STABLE helper module_enabled(_woreda uuid, _key text) (missing row = enabled, to match the client) and AND it into the INSERT/UPDATE policies of each module's tables, the workflow triggers, the module RPCs and sign-credential. Add rental_houses to useTenantModules and the admin toggle UI, and wrap woreda.reports.tsx in ModuleGate.
- **Effort:** M · **Status:** Open

### WP-BQ-001
**128 toast call sites surface raw backend error.message, bypassing translateError()**  
Severity **Medium** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-07; owasp_top10: A04:2021, A05:2021; owasp_api: API8:2023; asvs: V7.4.1; iso27001: A.8.28; nist_csf: PR.DS

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N (4.3)
- **Evidence:** `src/routes/woreda.residents.index.tsx:658` — `onError: (e: Error) => toast.error(e.message),`; `src/routes/woreda.rental-accounts.$occupancyId.tsx:278` — `onError: (e: Error) => toast.error(e.message),`; `src/routes/woreda.credentials.$requestId.index.tsx:475` — `toast.error('Update failed: ${(e as Error).message}');`; `src/lib/errorMessages.ts:120` — `export function translateError(raw: string | null | undefined): string {`; `docs/audit/2026-09-24/raw/build-quality-raw-error-toasts.txt:1` — `full list of 128 sites; 0 call translateError`
- **Description:** safeError() sanitises Edge Function errors server-side, but most writes are direct PostgREST/RPC calls from the browser whose error.message (Postgres constraint names, trigger RAISE text, RLS violation text naming tables) is rendered verbatim in toasts. translateError() is only used by src/lib/edgeFunction.ts.
- **Attack scenario:** An authenticated staff user triggers constraint/RLS/trigger failures to learn table, column, constraint and policy names from toast text.
- **Impact:** Minor schema disclosure to authenticated users; untranslated English error text in the Amharic-first portal; inconsistent with the documented C-07 posture.
- **Recommendation:** Replace ad-hoc onError toasts with a shared helper that runs translateError(); extend the lookup for SQLSTATE 23505/23514/42501/P0001.
- **Effort:** M · **Status:** Open

### WP-DB-008
**Audit trail integrity: any tenant user can forge audit_log rows, and several log tables are mutable or deletable**  
Severity **Medium** · Confidence Confirmed · Category Logging · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: LOG-01, D-05, MC-03; owasp_top10: A09:2021; asvs: V7.3.3, V7.3.4; iso27001: A.8.15; nist_csf: DE.CM-09, PR.PS-04

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1552` — `CREATE POLICY audit_log_tenant_insert ON public.audit_log ... WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())))`; `supabase/migrations/00000000000000_baseline.sql:1208` — `IF TG_OP = 'INSERT' THEN IF to_jsonb(NEW) ->> col IS NOT NULL THEN NEW := jsonb_populate_record(NEW, jsonb_build_object(col, uid));  -- a NULL actor is left NUL`; `supabase/migrations/00000000000000_baseline.sql:1636` — `service_request_status_history_insert ... WITH CHECK ((EXISTS (SELECT 1 FROM service_request sr WHERE ... sr.woreda_id = get_user_woreda_id())))  -- no permissi`; `supabase/migrations/00000000000000_baseline.sql:1583` — `household_change_log_update ... user_has_any_perm('{household.update}')  (DELETE at :1580 with tenant.manage)`; `supabase/migrations/00000000000000_baseline.sql:1558` — `credential_print_log_update ... user_has_any_perm('{credential.print}')`; `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:108` — `INSERT INTO public.audit_log (entity_name, entity_id, action_type, new_value_json) -- no woreda_id: tenant cannot see automatic death revocations`
- **Description:** audit_log is insert-only at the RLS level (no UPDATE/DELETE policy), which is correct. But any tenant user, including suspended ones (WP-DB-001), can INSERT arbitrary rows. force_actor_columns() only overwrites a non-NULL actor, so a forged row can carry a NULL actor, which reads as a 'system' event. Most audit rows are written from the client, not by triggers. service_request_status_history accepts inserts with no permission check. household_change_log and credential_print_log can be UPDATEd and DELETEd. apply_death_on_approval() writes revocation audit rows with woreda_id NULL, so only super admins can see them.
- **Attack scenario:** A clerk injects USER_SUSPENDED or CREDENTIAL_REVOKED rows with actor NULL to confuse an investigation, or edits credential_print_log.reprint_reason after an unauthorised reprint.
- **Impact:** The audit trail cannot be relied on as evidence, and LOG-01 is only partially met.
- **Recommendation:** Remove client INSERT on audit_log and write audit rows only from SECURITY DEFINER triggers/RPCs, or at least force actor_user_id := auth.uid() unconditionally. Make the *_history and *_log tables append-only (drop the UPDATE/DELETE policies) and require the relevant permission on INSERT. Populate woreda_id in trigger-written audit rows.
- **Effort:** M · **Status:** Open

### WP-DB-011
**Hard-DELETE policies on registry and financial records with cascading history loss**  
Severity **Medium** · Confidence Confirmed · Category Business Logic · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: MC-03, LOG-01; owasp_top10: A04:2021; owasp_api: API5:2023; asvs: V4.1.3, V7.3.3; iso27001: A.8.3, A.5.33; nist_csf: PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:H/A:L (5.5)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1597` — `payment_delete ... user_has_any_perm('{tenant.manage}')`; `supabase/migrations/00000000000000_baseline.sql:1602` — `receipt_delete ... user_has_any_perm('{tenant.manage}')`; `supabase/migrations/00000000000000_baseline.sql:1642` — `service_request_delete ... user_has_any_perm(ARRAY['tenant.manage'])`; `supabase/migrations/00000000000000_baseline.sql:711` — `service_request_status_history_service_request_id_fkey ... ON DELETE CASCADE`; `supabase/migrations/00000000000000_baseline.sql:1653` — `vital_event_delete ... user_has_any_perm('{civil.approve}')`; `supabase/migrations/00000000000000_baseline.sql:1624` — `resident_delete ... user_has_any_perm('{resident.delete}')`
- **Description:** DELETE policies exist on payment, receipt, service_request, vital_event, credential_request, resident, rental_occupancy_request, residence_credential, fee_schedule and other tables. No trigger records the deletion. Deleting a service_request cascades its status history and attachments (FK ON DELETE CASCADE). Most other FKs are NO ACTION, which blocks some deletes but not a receipt or a payment that has no receipt.
- **Attack scenario:** A tenant admin deletes a receipt, and the public /verify/receipt/<token> page then shows it as invalid. Or they delete a completed service request, and its whole status history is removed with it.
- **Impact:** Records and trails can be destroyed without a server-side trace, and MC-03 is not met.
- **Recommendation:** Replace hard deletes with soft-delete/void statuses that go through workflow_transition. Drop DELETE policies on financial, registry and history tables, or restrict them to super_admin with a DEFINER RPC that records the reason and writes an audit row.
- **Effort:** M · **Status:** Open

### WP-DB-012
**No composite (woreda_id, id) foreign keys; cross-tenant references are only partly blocked by triggers**  
Severity **Medium** · Confidence Likely · Category Tenant Isolation · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: TEN-02, A-07; owasp_top10: A01:2021; owasp_api: API1:2023; asvs: V4.2.1; iso27001: A.8.3; nist_csf: PR.DS-10

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:C/C:L/I:L/A:N (4.7)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:661` — `ALTER TABLE public.household ADD CONSTRAINT household_kebele_id_fkey FOREIGN KEY (kebele_id) REFERENCES kebele(kebele_id);`; `supabase/migrations/00000000000000_baseline.sql:703` — `resident_current_household_id_fkey FOREIGN KEY (current_household_id) REFERENCES household(household_id);`; `supabase/migrations/00000000000066_payment_hardening_review_fixes.sql:346` — `IF NEW.category <> 'letter' THEN RETURN NEW; END IF;  -- complaints skip the resident/household woreda check`; `supabase/migrations/00000000000064_task14b_verify_letter_completed_status.sql:41` — `LEFT JOIN public.resident r ON r.resident_id = sr.resident_id  -- no woreda match (verify_receipt does add one)`
- **Description:** All 190 FKs reference a bare surrogate id. Tenant consistency is enforced only by per-table triggers: vital_event, rental_occupancy(_request), office, household_location, the credential mint, letters, and approval/attachment via entity_belongs_to_woreda. Several FKs have no guard at all: household.kebele_id, resident.current_household_id, household head/spouse ids, complaint-category service_request.resident_id/household_id, and credential issuing_kebele_id. The anon RPC verify_service_letter() joins resident without a woreda match.
- **Attack scenario:** Given a foreign UUID, a clerk links a complaint-category service_request to another woreda's resident. Once it is closed with a verification token, the anonymous letter-verification RPC returns that foreign resident's full name.
- **Impact:** Cross-tenant links can form in the data, and DEFINER readers may disclose foreign PII through them. See also WP-DB-003.
- **Recommendation:** Add UNIQUE (woreda_id, <pk>) on parent tables and composite FKs (woreda_id, child_fk) REFERENCES parent (woreda_id, pk) on tenant tables. Add AND r.woreda_id = sr.woreda_id to verify_service_letter().
- **Effort:** L · **Status:** Open

### WP-INV-001
**Edge Functions load supabase-js from esm.sh at a floating major version (@2) with no lockfile or integrity pin, inside functions that hold the service_role key and the ES256 signing key**  
Severity **Medium** · Confidence Confirmed · Category Supply Chain · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-02, B-03, E-05; owasp_top10: A06:2021, A08:2021; owasp_api: API10:2023; asvs: V14.2.1, V14.2.4; iso27001: A.8.28, A.5.21; nist_csf: ID.SC-2, PR.DS-6

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:N (8.0; rated Medium because exploitation requires a compromise or hijack of a third-party CDN/package, not a flaw reachable by a normal attacker)
- **Evidence:** `supabase/functions/sign-credential/index.ts:1` — `import { createClient } from "https://esm.sh/@supabase/supabase-js@2";`; `supabase/functions/sign-credential/index.ts:71` — `const PRIVATE_KEY_PEM = Deno.env.get("HARARI_EC_PRIVATE_KEY");`; `supabase/functions/invite-tenant-user/index.ts:2` — `import { createClient } from "https://esm.sh/@supabase/supabase-js@2";`; `supabase/functions/invite-platform-admin/index.ts:2` — `import { createClient } from "https://esm.sh/@supabase/supabase-js@2";`; `supabase/functions/resend-platform-invite/index.ts:2` — `import { createClient } from "https://esm.sh/@supabase/supabase-js@2";`; `supabase/functions/resend-tenant-invite/index.ts:2` — `import { createClient } from "https://esm.sh/@supabase/supabase-js@2";`
- **Description:** All eight Edge Functions resolve their only third-party dependency, @supabase/supabase-js, from the esm.sh CDN at the floating specifier '@2'. There is no deno.json, import map or deno.lock anywhere under supabase/ (find returned nothing), so the exact code bundled is whatever esm.sh serves for the newest 2.x at the moment an operator runs scripts/deploy-functions.sh. The web app, by contrast, is pinned by bun.lock and installed with --frozen-lockfile in CI (.github/workflows/ci.yml:30). The two dependency surfaces therefore have very different supply-chain guarantees, and the weaker one is the privileged one: these functions run with SUPABASE_SERVICE_ROLE_KEY (RLS bypass) and sign-credential additionally holds HARARI_EC_PRIVATE_KEY. The code's own comment (send-password-reset-link/index.ts:156-158) acknowledges the resolved source is not reviewed.
- **Attack scenario:** A malicious or compromised supabase-js 2.x release (or an esm.sh-side compromise/transform bug) is published. The next routine function deploy silently bundles it. The injected code reads Deno.env (service_role key, HARARI_EC_PRIVATE_KEY) and exfiltrates them, enabling forged ID-card signatures and full cross-tenant database access. Nothing in the repo diff reveals the change.
- **Impact:** Potential disclosure of the service_role key and credential-signing private key (both Critical-class secrets per R7); non-reproducible deploys; behaviour of production functions can change without any repository change.
- **Recommendation:** Pin an exact version and resolve through a reproducible path: use the npm: specifier with an exact version (e.g. npm:@supabase/supabase-js@2.112.3, matching bun.lock) via a supabase/functions/deno.json import map, commit a deno.lock, and deploy with lockfile enforcement. Re-review the pin whenever bun.lock's supabase-js changes.
- **Effort:** S · **Status:** Open

### WP-INV-003
**No owned or evidenced detection layer: no SIEM/log forwarding, no IDS/IPS, no CSP violation reporting; WAF is dashboard opt-in with no evidence it is enabled; sign-in CAPTCHA not integrated**  
Severity **Medium** · Confidence Needs-live-verification · Category Logging · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-05, A-06, D-05, OPS-01; owasp_top10: A09:2021, A05:2021; owasp_api: API8:2023; asvs: V7.1.1, V7.2.1, V14.4.3; iso27001: A.8.15, A.8.16, A.8.20; nist_csf: DE.CM-1, DE.AE-3, PR.PT-4

- **CVSS:** N/A (missing defence-in-depth)
- **Evidence:** `docs/tech-stack.md:85` — `No dedicated WAF/IDS-IPS/SIEM product sits in front of this app`; `docs/security-hardening.md:52` — `1. **Firewall / WAF** — Security tab: enable the managed WAF ruleset (OWASP core rules)`; `docs/security-hardening.md:66` — `2. **Auth → Attack protection** — enable CAPTCHA on sign-in (Turnstile or hCaptcha) and **leaked password protection**`; `src/routes/login.tsx:96` — `const { data, error } = await supabase.auth.signInWithPassword({ email: values.email, password: values.password, });`; `src/lib/security-headers.ts:50` — `"default-src 'self'", ... "form-action 'self'", (no report-uri / report-to directive)`; `.github/workflows/ci.yml:30` — `- run: bun install --frozen-lockfile   (no dependency/secret/SAST scan step in the workflow)`
- **Description:** Security infrastructure as found (full table in inventory.md section 5): TLS termination, L3/L4 DDoS mitigation and load balancing are inherited from Vercel's edge and Supabase's managed platform; HSTS/CSP/frame/permissions headers are owned (src/lib/security-headers.ts); rate limiting is owned for five Edge Functions (rate_limit_hit) and otherwise inherited from GoTrue defaults; an in-database audit_log is owned. The WAF is an optional Vercel Firewall ruleset that docs/security-hardening.md lists as a to-do dashboard click, with no evidence in the repo that it was enabled. No IDS/IPS, SIEM, log drain, alerting or CSP report endpoint exists anywhere in code, config or docs (grep for sentry/datadog/log drain/report-uri/report-to returned nothing). The recommended Supabase CAPTCHA is not integrated: login.tsx calls signInWithPassword without options.captchaToken, so if CAPTCHA were enabled in the dashboard every sign-in would fail - which implies it is off. Leaked-password protection, auth rate limits and Postgres network restrictions are dashboard-only settings whose state cannot be seen from the repo.
- **Attack scenario:** A credential-stuffing or slow brute-force campaign against /login (the anon key is public), or a scripted enumeration of the public verification RPCs, generates no alert anywhere; the only record is Supabase/Vercel platform logs with short default retention that nobody reviews.
- **Impact:** Attacks and abuse are undetectable in near-real-time; incident response depends on platform log retention; INSA B-05 cannot be evidenced as more than 'inherited/absent'.
- **Recommendation:** (1) Enable Vercel Firewall managed rules and record a screenshot/export as evidence. (2) Configure Supabase log drains (or Vercel log drains) to a SIEM or at least a retained log store with alerts on auth failures, 401/403 spikes on Edge Functions and rate_limit_hit denials. (3) Add a CSP report-to endpoint. (4) Either integrate Turnstile/hCaptcha into login.tsx (captchaToken) and then enable it in Supabase Auth, or document the compensating control. (5) Record each item as Owned/Inherited/Absent in docs/security-hardening.md with evidence.
- **Effort:** M · **Status:** Open

### WP-LOC-002
**No Ethiopian clock: every local time is shown on the Western 24-hour clock, including receipts and the audit trail**  
Severity **Medium** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-05

- **Evidence:** `src/utils/ethiopianCalendar.ts:97` — `return '${formatEthiopianDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}';`; `src/components/workflow/HistoryTimeline.tsx:107` — `{formatEthiopianDateTime(new Date(h.changed_at))}`; `src/routes/woreda.households.index.tsx:698` — `{formatEthiopianDateTime(new Date(row.created_at))}`; `src/components/common/OfflineStatusBar.tsx:99` — `{formatEthiopianDateTime(lastSyncAt)}`; `src/routes/woreda.rental-houses.requests.$requestId.index.tsx:61` — `const hh = String(d.getHours()).padStart(2, "0");`; `src/routes/woreda.dashboard.tsx:612` — `).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}',`
- **Description:** The repository has no Ethiopian-clock helper (a search for ጠዋት/ቀትር/ማታ/ለሊት and for any hour-offset logic finds nothing). The one shared date-time formatter, formatEthiopianDateTime(), pairs an EC date with a Western 24-hour clock ('14 መስከረም 2019 19:00'). Every other place that shows a time uses en-GB 24-hour formatting: the dashboard activity feed, audit trail rows and detail, the service-request 'submitted' field, rental request history, workflow history timelines, the offline-sync bar, and the printed revenue receipt ('printed' time). Under the owner convention, 19:00 should read '1:00 ማታ'. A reader who assumes the Ethiopian clock will read '01:30' as 7:30 in the morning.
- **Attack scenario:** Not a security exploit. Staff or residents reading official timestamps can misread them by six hours. Example: an audit reviewer checking when a record changed, or a resident disputing a receipt time.
- **Impact:** Timestamps on official documents (receipts) and in the audit trail can be misread by six hours. The owner's Ethiopian-clock convention is not met anywhere in the product.
- **Recommendation:** Add formatEthiopianTime(date) to ethiopianCalendar.ts, implementing EtHour = ((h + 6) mod 12) or 12. Period labels: ጠዋት for 06:00-11:59 local, ቀትር for 12:00-12:59 and ከሰዓት for the afternoon if the owner wants it, ማታ for 18:00-23:59, ለሊት for 00:00-05:59. Confirm the exact bands and labels with the owner; the checklist only fixes the four anchor points. Route formatEthiopianDateTime() and the call sites listed above through it. Show the Western time second, e.g. '1:00 ማታ (19:00)'. Add unit tests for the four anchor vectors: 07:00 → 1:00 ጠዋት, 12:00 → 6:00 ቀትር, 19:00 → 1:00 ማታ, 00:00 → 6:00 ለሊት.
- **Effort:** S · **Status:** Open

### WP-LOC-004
**Some woreda and public screens show Gregorian dates only or first, and three woreda inputs use native Gregorian date pickers**  
Severity **Medium** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-01

- **Evidence:** `src/components/services/ServiceRequestList.tsx:385` — `{new Date(r.submitted_at).toLocaleDateString("en-GB")}`; `src/components/services/ServiceRequestList.tsx:265` — `value: (r) => new Date(r.submitted_at).toLocaleDateString("en-GB"),`; `src/routes/woreda.approvals.tsx:216` — `{r.created_at ? new Date(r.created_at).toLocaleDateString("en-GB") : "—"}`; `src/routes/woreda.services.$requestId.index.tsx:566` — `value={new Date(req.submitted_at).toLocaleString("en-GB", { hour12: false })}`; `src/routes/woreda.services.new.tsx:574` — `type="date"`; `src/routes/woreda.revenue.index.tsx:203` — `{ header: "ቀን / Date", value: (r) => r.payment_date },`
- **Description:** Most woreda screens do show EC first: lists, detail pages, the EthiopianDateInput-based forms, the revenue table, the credential/civil/resident exports, and the receipt/letter verify pages. The exceptions, enumerated by grepping toLocaleDateString, toLocaleString, toLocaleTimeString, type="date" and raw ISO exports across src/routes/woreda.*, src/routes/v.*, src/routes/verify.* and src/components: (1) Gregorian only: the service/complaint list 'submitted' column and its CSV/PDF export; the approvals inbox date column; the service-request detail 'submitted' field; the revenue CSV/PDF 'Date' column (raw payment_date); the audit CSV export (UTC ISO timestamp); the 'Printed:' footer on four printed documents (resident, household, occupant, report). (2) Gregorian first: the AppShell header puts a red 'SEP 24' badge ahead of the EC date. (3) Gregorian input: the complaint incident date (services.new:574) and the revenue start/end filter (revenue.index:344,348). (4) Public QR verification (/v/$token) shows issue date, expiry date and date of birth as Gregorian ISO strings ('2026-09-24'). The physical card is printed in EC, so a verifier comparing the card with the verification page sees two different dates for the same event.
- **Attack scenario:** Not a security exploit. A checkpoint officer scanning a card sees 'Issued 2026-09-24' on the phone but '14 መስከረም 2019' on the card. Someone unfamiliar with the conversion may reject a valid card or accept a mismatched one.
- **Impact:** The EC-first convention in README and CLAUDE.md is not universal. The QR verification surface in particular does not match the printed card.
- **Recommendation:** Route each listed call site through formatEthiopianDate/formatEthiopianDateShortOnly, with Gregorian as an optional second value in parentheses. Replace the three type="date" inputs with <EthiopianDateInput>. On /v/$token, render payload dates as '14 መስከረም 2019 (2026-09-24)'. Move the AppShell Gregorian badge after the EC date. Extend the portal-conventions-review agent's grep to include toLocaleDateString, toLocaleString, type="date" and toISOString() in woreda routes.
- **Effort:** S · **Status:** Open

### WP-OPS-004
**CI is not a required status check on main, and Vercel promotes every push to main to production independently of the CI result**  
Severity **Medium** · Confidence Likely · Category Config · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: G-01, QA-01; owasp_top10: A08:2021; asvs: V14.1.1; iso27001: A.8.25, A.8.32; nist_csf: PR.PS-06 (CSF 2.0)

- **CVSS:** N/A (SDLC control)
- **Evidence:** `docs/audit/2026-09-24/raw/ops-scope-github-api.txt:13` — `"protected": true, "required_status_checks": { "enforcement_level": "everyone", "contexts": [], "checks": [] }`; `docs/audit/2026-09-24/raw/ops-scope-github-api.txt:25` — `CI push success 9950f16e main 2026-09-22T23:41:15Z  (and :129 Production 9950f16e 2026-09-22T23:41:51Z vercel[bot])`; `CLAUDE.md:113` — `every PR and push to 'main' — all required to pass before a PR is mergeable;`; `docs/architecture.md:497` — `all required to pass before a PR is even mergeable, independent of the review requirement above.`; `.github/workflows/ci.yml:3` — `on: pull_request / push: branches: [main]  (single job 'test'; no deploy job, no environment protection)`
- **Description:** The public GitHub API shows main is protected, but its required-status-check list is empty (no contexts, no checks). That means the CI workflow runs but is not configured as a merge gate, which contradicts CLAUDE.md and docs/architecture.md. Separately, the Vercel GitHub integration (vercel[bot], active since 2026-09-20) creates the Production deployment for a main commit within about 40 seconds of the push, in parallel with CI rather than after it. Review-requirement sub-rules are not visible without an admin token. Confidence is 'Likely' because the unauthenticated branch summary is authoritative for required checks but not for every protection sub-rule.
- **Attack scenario:** A PR with failing lint, typecheck, tests, the role-permission drift check or the fee catalogue check (two failed PR runs appear in the recent history) can be merged by anyone with write access who satisfies the review rule, and it reaches production immediately.
- **Impact:** The documented quality gates (QA-01, the RBAC drift guard, the fee-catalogue guards that protect fail-closed resolvers) are advisory, not enforced. Production can run code that CI rejected.
- **Recommendation:** In GitHub Settings > Branches > main, add the 'test' job (workflow 'CI') as a required status check, require branches to be up to date, and enable 'Do not allow bypassing'. Either configure Vercel to deploy production only after checks pass, or move production promotion into a GitHub Actions job with `needs: test` and a protected `production` environment with required reviewers. Share a screenshot or `gh api .../branches/main/protection` output as evidence.
- **Effort:** S · **Status:** Open

### WP-OPS-005
**Non-production code is trusted by production: per-PR Vercel preview deployments can only reach the production Supabase project, and production Edge Functions allow the http://localhost:5173 origin**  
Severity **Medium** · Confidence Needs-live-verification · Category Config · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10) · Merged: WP-API-005
  
Refs: insa: OPS-01, A-06; owasp_top10: A05:2021; owasp_api: API8:2023; asvs: V14.1.1; iso27001: A.8.31; nist_csf: PR.DS-7 (CSF 1.1)

- **CVSS:** N/A (environment segregation)
- **Evidence:** `docs/audit/2026-09-24/raw/ops-scope-github-api.txt:142` — `30 deployments listed: 26 Preview, 4 Production (Preview -> https://woredas-portal-<hash>-woreda.vercel.app)`; `supabase/functions/_shared/response.ts:23` — `[Deno.env.get("SITE_URL"), "http://localhost:5173"]`; `docs/security-hardening.md:55` — `**Deployment Protection** — leave production public, but set preview deployments to require Vercel authentication  (listed as a to-do dashboard action)`; `src/routes/woreda.services.$requestId.print.tsx:102` — `? '${typeof window !== "undefined" ? window.location.origin : ""}/verify/letter/${data.verification_token}'`; `supabase/functions/_shared/response.ts:23` — `[Deno.env.get("SITE_URL"), "http://localhost:5173"]` (via WP-API-005); `supabase/functions/_shared/response.ts:31` — `"Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "",` (via WP-API-005)
- **Description:** Vercel builds a publicly addressable preview for each PR branch. Because no staging Supabase project exists, a working preview can only use the production URL and anon key (or be non-functional); which of the two applies depends on Vercel environment-variable scoping that is not visible from the repository. Deployment Protection for previews is recorded as a to-do. The production Edge Function CORS allow-list is hard-coded to include http://localhost:5173, so any code a developer runs locally, including unreviewed branches, can call production privileged functions from a browser with a real session. Service letters print a verification URL built from window.location.origin, so a letter printed from a preview or localhost carries a non-production verification link.
- **Attack scenario:** A staff member follows a preview link from a PR comment and signs in. Unreviewed branch code then runs with that person's real production session against real PII. Alternatively, a malicious or compromised dependency in an unmerged branch exfiltrates the session token.
- **Impact:** Unreviewed code gains the same data access as production code for any staff member who uses it. Printed letters can carry URLs that later stop resolving.
- **Recommendation:** Enable Vercel Deployment Protection (Vercel Authentication) on previews now, and scope the production VITE_SUPABASE_* variables to the Production environment only. Once staging exists, point Preview-scoped variables at staging. Remove localhost from the production CORS set (see WP-OPS-001). Build letter verification URLs from VITE_PUBLIC_SITE_URL as credentials and receipts already do.
- **Effort:** S · **Status:** Open

### WP-OPS-006
**No operational monitoring or alerting: no error tracking, uptime checks, log retention or alerts for Edge Function failures, auth anomalies or the fail-open rate limiter**  
Severity **Medium** · Confidence Confirmed · Category Logging · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: OPS-01, D-05, B-05; owasp_top10: A09:2021; asvs: V7.1.1, V7.2.1; iso27001: A.8.16, A.8.15; nist_csf: DE.CM-01 (CSF 2.0), DE.AE-02 (CSF 2.0)

- **CVSS:** N/A (detection control)
- **Evidence:** `src/server.ts:48` — `console.error(error);   (:34 console.error(consumeLastCapturedError() ...) — the only server-side error sink)`; `supabase/functions/_shared/response.ts:79` — `console.error(logLabel, err);   // safeError(): real error goes only to Supabase function logs`; `docs/testing-scope.md:66` — `The limiter fails open on any RPC error ... makes an inert limiter indistinguishable from a working one without this check.`; `package.json:1` — `no @sentry/*, @vercel/analytics, OpenTelemetry or other monitoring dependency (grep sentry|datadog|logflare|posthog|opentelemetry|log drain over repo: no matche`
- **Description:** Errors are written to console.error only: the SSR wrapper writes to Vercel runtime logs and safeError() in Edge Functions writes to Supabase function logs. Both have short platform retention and nobody watches them. There is no client-side error tracking, no uptime or synthetic check on the login and public verification routes, no log drain, and no alert on Edge Function 5xx responses, on repeated 401/403 responses, on spikes in GoTrue sign-in failures, or on the 'rate_limit_hit failed (failing open)' condition that the project's own documentation says cannot otherwise be detected. This overlaps WP-INV-003 (no SIEM/IDS); this finding covers operational availability and error detection.
- **Attack scenario:** A credential-signing outage, a broken migration that makes every query return empty, or a credential-stuffing run against /auth/v1/token goes unnoticed until a woreda office reports it.
- **Impact:** Incidents are detected late or not at all. Evidence of an attack can age out of platform log retention before anyone looks.
- **Recommendation:** Add error tracking (for example Sentry) to the client and the SSR entry with PII scrubbing, an external uptime check on /, /login and /v/<known-test-token>, a Supabase and Vercel log drain to retained storage, and alert rules for Edge Function 5xx, auth failure rate, rate-limiter fail-open log lines and audit_log anomalies. Record owners and on-call in an operations runbook.
- **Effort:** M · **Status:** Open

### WP-OPS-007
**Data-plane change management is manual, agent-driven and has no migration ledger; account-level tokens are used from sandboxes and production has been hand-edited**  
Severity **Medium** · Confidence Confirmed · Category Config · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: OPS-01, G-01; owasp_top10: A08:2021; asvs: V14.1.1; iso27001: A.8.32, A.8.9, A.5.15; nist_csf: PR.PS-01 (CSF 2.0)

- **CVSS:** N/A (change management)
- **Evidence:** `docs/architecture.md:402` — `'supabase db push'/'db diff' are non-functional in this project ... the live database has no 'supabase_migrations.schema_migrations' table`; `docs/architecture.md:411` — `The mechanism of record instead is the **Management API over HTTPS**, three phases: ... dry-run ... then **apply**`; `.claude/skills/deploy/SKILL.md:24` — `'SUPABASE_ACCESS_TOKEN' — Personal Access Token, account-level. Needed for migrations via the Management API and for Edge Functions.`; `docs/remediation-report.md:327` — `Completed manually with the same data the function would have written ('username='eska…[REDACTED]_rc'' ...), plus the 'USER_INVITED' audit_log row`; `scripts/deploy-functions.sh:40` — `supabase functions deploy "${FUNCTIONS[@]}" --use-api --project-ref "$REF"  (run from an operator/agent shell; no CI deploy job)`
- **Description:** Schema migrations and Edge Functions reach production when an operator or AI agent session posts SQL to the Supabase Management API, or runs the CLI, using a Personal Access Token that controls every project on the account. Nothing records which of the 90 migration files are applied: there is no schema_migrations ledger, and drift is checked by ad-hoc catalog queries. There is no pipeline, no approval step and no environment protection. At least once, rows (including an audit_log entry) were inserted into production by hand to complete a failed function call. The frontend, by contrast, now deploys automatically through the Vercel Git integration (see WP-OPS-004), so the four deploy artifacts follow two unrelated processes.
- **Attack scenario:** A migration applied out of order, applied twice or skipped cannot be detected from a ledger. A leaked PAT in an agent sandbox (see WP-SUP-006) gives control-plane access to every project. Manual audit_log inserts make it impossible to tell trigger-written evidence from operator-written evidence.
- **Impact:** Uncontrolled and non-reproducible production state, weak separation of duties, and weakened audit-trail evidentiary value.
- **Recommendation:** Baseline a migration ledger (create supabase_migrations.schema_migrations and back-fill applied versions after a catalog diff). Run migrations and function deploys from a GitHub Actions job gated on CI with a protected 'production' environment and required reviewer. Keep the PAT as an environment secret there, not in agent sessions. Forbid manual writes to audit_log and app_user in production outside an incident procedure that is itself logged.
- **Effort:** L · **Status:** Open

### WP-PRV-001
**Changes to identity records and privileges are audited by the browser, not the database: direct API calls leave no trace and audit timestamps come from the client clock**  
Severity **Medium** · Confidence Confirmed · Category Logging · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-05, LOG-01, MC-03; owasp_top10: A09:2021; owasp_api: API8:2023; asvs: V7.1.3, V7.3.1, V7.3.3; iso27001: A.8.15; nist_csf: DE.CM-3, PR.PT-1

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `src/routes/woreda.residents.$residentId.edit.tsx:217` — `.from("resident").update(core).eq("resident_id", residentId).eq("woreda_id", woredaId);  -- no .select(): a 0-row update still falls through to the audit insert`; `src/routes/woreda.residents.$residentId.edit.tsx:241` — `await supabase.from("audit_log").insert({ ... action_type: "RESIDENT_UPDATED", old_value_json: oldChanged, new_value_json: newChanged, action_at: new Date().toI`; `supabase/migrations/00000000000043_task5_resident_creation_audit.sql:47` — `CREATE TRIGGER resident_audit_created AFTER INSERT ON public.resident  -- the only resident audit trigger; no UPDATE/DELETE trigger exists`; `src/components/residents/ResidentProfileTabs.tsx:863` — `.from("resident_document").delete().eq("document_id", doc.document_id); ... storage.from("resident-documents").remove([doc.storage_path])  -- no audit row at al`; `src/components/settings/RolesPermissionsTab.tsx:173` — `await supabase.from("audit_log").insert({ ... action_type: "ROLE_PERMISSION_UPDATED" ... })  -- role_permission / user_permission_override / woreda_settings / f`; `supabase/migrations/00000000000000_baseline.sql:46` — `action_at timestamp with time zone DEFAULT now() NOT NULL,  -- default only; 20 client call sites send action_at: new Date().toISOString() and nothing pins it`
- **Description:** The audit trail has two kinds of writer. A minority of events are written by SECURITY DEFINER triggers: resident creation (migration 43), workflow status changes on credential_request/residence_credential (migration 25), app_user role and custom-role changes and tenant_role/tenant_role_permission changes (migrations 40/41), automatic death revocations (59) and the rental financial RPCs (76-89). Most security-relevant events are written by the browser as a second PostgREST call after the business write. That covers resident and household edits, deactivations, user suspension/reactivation, per-user permission overrides, role_permission matrix edits, woreda settings (signature/stamp/logo), fee schedule and service-type edits, and module toggles. Resident-document deletion writes no audit row at all. Because the table write and the audit insert are separate requests, anyone who calls PostgREST directly (DevTools, curl with their own JWT) can change a resident's FAN, date of birth, religion or residency status (including 'deceased') and leave no audit record. The client also supplies action_at, so audit rows can be back-dated or forward-dated. Client-written rows carry no source_ip. The resident edit path writes its audit row without checking that the update matched a row, which breaks the house rule in CLAUDE.md. Forgery of audit rows (NULL actor, any content) is already covered by WP-DB-008 and is not repeated here.
- **Attack scenario:** A registry clerk with resident.update opens DevTools and sends PATCH /rest/v1/resident?resident_id=eq.<id> {"national_id_no":"<other FAN>","date_of_birth":"1990-01-01"}. RLS allows it. No trigger fires an audit row, so /woreda/audit shows nothing. A supervisor later investigating a fraudulent credential cannot tell who changed the identity data or when.
- **Impact:** Non-repudiation for the core civil-registry records is lost. Insider tampering with identity data (FAN, DOB, deceased flag), privileges (overrides, matrix) and official assets (signature/stamp) cannot be reliably attributed. The INSA D-05/LOG-01 'trigger-written, append-only, before/after' criterion is not met.
- **Recommendation:** Move audit writing into the database. Add one generic AFTER INSERT/UPDATE/DELETE trigger (SECURITY DEFINER, pinned search_path) on resident, household, household_location, vital_event, payment, receipt, resident_document, attachment, app_user (status, woreda_id), role_permission, user_permission_override, woreda_settings, fee_schedule, service_type and tenant_module_config. It should record auth.uid(), woreda_id, TG_OP, and the changed-column diff with Restricted fields masked (see WP-PRV-002). Pin action_at := now() and actor_user_id := auth.uid() in a BEFORE INSERT trigger on audit_log. Then revoke INSERT on audit_log from authenticated so only triggers and the service role can write. Keep the client-side 'context' rows (reprint reason, waiver reason) as a separate, non-authoritative entity or column.
- **Effort:** M · **Status:** Open

### WP-PRV-003
**Plaintext PII persists in browser localStorage with no expiry (resident wizard drafts, offline civil and service submissions) and is only cleared by an in-app sign-out**  
Severity **Medium** · Confidence Confirmed · Category Privacy · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-04, D-05, A-03, PRV-01; owasp_top10: A04:2021; asvs: V8.2.2, V8.2.3; iso27001: A.8.10, A.8.12; nist_csf: PR.DS-1

- **CVSS:** CVSS:3.1/AV:P/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N (5.2)
- **Evidence:** `src/hooks/useFormDraft.ts:84` — `timerRef.current = setTimeout(() => { writeDraft(key, getValues()); }, WRITE_DEBOUNCE_MS);`; `src/routes/woreda.residents.new.tsx:58` — `useFormDraft({ storageKey: 'resident-new:${woredaId ?? ""}', watch, reset, getValues, ... })  -- whole wizard incl. national_id_no, ethnicity, religion, phone_d`; `src/lib/offlineQueue.ts:63` — `localStorage.setItem(keyFor(woredaId), JSON.stringify(items));  -- payload = full insert body`; `src/routes/woreda.civil.death.new.tsx:63` — `cause_of_death: v.cause_of_death || null,  -- inside event_details queued offline at :180`; `src/routes/woreda.services.new.tsx:236` — `applicant_name: ..., applicant_phone: phoneDigitsToE164(applicantPhone), ... details: details.trim(), respondent_name: ..., incident_place: ...`; `src/hooks/useAuthBootstrap.ts:126` — `if (event === "SIGNED_OUT") { clearAuth(); return; }  -- drafts/queue/query cache are NOT cleared on session expiry or remote revocation`
- **Description:** Two client features write PII to localStorage in plaintext. The resident intake wizard autosaves every field, including the 16-digit FAN, DOB, ethnicity, religion, phone, GPS and parents' names, to 'wizard-draft:resident-new:<woreda>'. The offline queue stores the complete insert body of birth/death/marriage/divorce registrations (event_details with cause of death, divorce grounds, witnesses, informant phone, ethnicity/religion), service requests and complaints (applicant name/phone, complaint details, respondent) and payment drafts, under 'offline-queue:<woreda>'. Neither has a TTL, neither is encrypted, and both are cleared only by the shells' handleSignOut (the user menu or the 25-minute idle timeout while the page is open). They survive a closed browser, a crash, an expired refresh token, and an admin-revoked session: the SIGNED_OUT listener clears only the zustand store. Because the idle timer restarts at mount, a user who closes the tab without signing out never triggers the clean-up. On a shared kiosk, the next operator (or anyone with OS access or a malicious extension) can read the data. If the next operator is in the same woreda, the queue auto-syncs and submits the previous user's registrations under the new user's identity: force_actor_columns() overwrites requested_by_user_id with auth.uid(). The service worker, by contrast, caches only '/' and '/favicon.png' and never API responses (public/sw.js:36-49), so it is not a PII store.
- **Attack scenario:** Clerk A starts a resident intake on a shared woreda PC, is interrupted and closes the browser. Days later, anyone using the PC opens DevTools > Application > Local Storage and reads the resident's FAN, religion, ethnicity and home GPS. Or: A queues a death registration offline and walks away; Clerk B signs in, the bar auto-syncs, and the audit log attributes A's registration to B.
- **Impact:** Restricted and special-category data is exposed at rest on endpoints outside RLS, and records are attributed to the wrong person (an accountability gap).
- **Recommendation:** (1) Exclude Restricted fields (national_id_no, phone, ethnicity, religion, GPS) from the wizard draft, or drop the draft to sessionStorage. (2) Add a TTL (e.g. 8 h) and a user_id stamp to every draft and queue item. On load, discard items older than the TTL or from a different user_id, and make runSync refuse items whose enqueuing user differs from session.user.id. (3) Call clearAllWizardDrafts()/clearOfflineQueue()/queryClient.clear() from the SIGNED_OUT branch of useAuthBootstrap and on login before setAuth. (4) If offline capture must survive restarts, encrypt at rest with a non-extractable WebCrypto AES-GCM key held in IndexedDB and bound to the user, and document the residual risk in the DFD.
- **Effort:** M · **Status:** Open

### WP-PRV-004
**Bulk exports and printed profiles are not audited, carry no exporter identity or confidentiality marking, and have no server-side volume control**  
Severity **Medium** · Confidence Confirmed · Category Privacy · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-05, LOG-01, PRV-01; owasp_top10: A09:2021, A01:2021; owasp_api: API4:2023, API6:2023; asvs: V7.1.3, V8.1.2; iso27001: A.5.12, A.5.13, A.8.15; nist_csf: PR.DS-5, DE.CM-3

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N (4.3)
- **Evidence:** `src/routes/woreda.residents.index.tsx:308` — `const q = buildResidentsQuery(phoneBlindIndex, nationalIdBlindIndex).range(0, 4999);  -- same 5,000-row pull on households, civil, credentials, rental houses, r`; `src/utils/tableExport.ts:56` — `preamble.push('"Exported: ${new Date().toLocaleString("en-GB", { hour12: false })}"');  -- timestamp only; no exporter name/user id`; `src/utils/tableExport.ts:283` — `ctx.fillText("Woreda Administration ERP -- official internal export", M, PAGE_H - 28);  -- no CONFIDENTIAL / personal-data marking, no watermark`; `src/routes/woreda.residents.$residentId.print.tsx:237` — `<DocField labelAm="ብሔር" labelEn="Ethnicity" ... /> <DocField labelAm="ሃይማኖት" labelEn="Religion" ... />  -- plus decrypted phone/email and photo; no audit_log wr`; `src/components/print/PrintDocumentShell.tsx:480` — `<div>የታተመው ቀን / Printed: {printedOn}</div>  -- printed date, but not printed-by`
- **Description:** List pages for residents, households, civil events, credentials, services/complaints, rental houses, revenue and both audit views offer CSV/PDF export. Each pulls up to 5,000 rows in one PostgREST call and builds the file in the browser (src/utils/tableExport.ts). Exports are gated only by the page's read permission, not by P.REPORT_EXPORT (which gates only /woreda/reports). No audit row is written, the file does not record who exported it, and nothing marks it as containing personal data. The printable Resident Profile, Household Profile and Rental Occupant Profile include name, DOB, decrypted phone/email, photo and, for residents, ethnicity and religion. They carry issuer, record reference and print date, but not the printing user, and are not logged. Only ID-card prints (credential_print_log) and receipt prints (RECEIPT_PRINTED) leave a trail. Because the data is fetched with the user's own JWT, the 5,000 cap is a UI convention: the same data can be paged out of PostgREST without limit. Positive observations: export columns are minimised (no FAN, phone, GPS, religion or ethnicity in any CSV/PDF export), and CSV cells are protected against formula injection (tableExport.ts:33-38).
- **Attack scenario:** A departing clerk exports all residents and households (names, DOB, sex, kebele, residency status) and prints profiles for a target list. /woreda/audit shows nothing, and a leaked PDF cannot be traced to its exporter.
- **Impact:** Mass extraction of the population register cannot be detected or attributed, and leaked documents carry no provenance. This fails the D-05/LOG-01 expectation that exports are logged events.
- **Recommendation:** Write an audit row for every export and profile print: entity, filter summary, row count, format, and for prints the subject id. Server-side is best: an RPC `log_export(entity, filter, row_count)` that also enforces a per-user daily budget via rate_limit_hit(). Gate list exports on P.REPORT_EXPORT, or a new P.DATA_EXPORT, in both UI and RPC. Stamp exporter name, user id and a 'Contains personal data -- handle per Proclamation 1321/2024' notice in the CSV preamble and the PDF footer/watermark. Add 'Printed by' to DocRecordFooter.
- **Effort:** M · **Status:** Open

### WP-PRV-006
**No privacy governance layer: no retention schedule or purge, no privacy notice or lawful-basis record, no data-subject-request or breach procedure, and an undocumented hosting region**  
Severity **Medium** · Confidence Confirmed · Category Privacy · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: PRV-01, D-05, A-03, OPS-01; asvs: V8.3.1, V8.3.2, V8.3.8; iso27001: A.5.33, A.5.34, A.8.10, A.5.24; nist_csf: ID.GV-3, RS.CO-2

- **CVSS:** N/A (compliance finding)
- **Evidence:** `supabase/migrations/00000000000022_rate_limit.sql:19` — `-- No pg_cron: this repo has none ... rate_limit_hit() deletes expired rows opportunistically  -- the only table with any expiry`; `supabase/migrations/00000000000034_task3_harden_credential_verification.sql:91` — `attempted_value text NOT NULL CHECK (length(attempted_value) <= 512), ... source_ip text,  -- full signed token + IP of every public scan, kept forever`; `supabase/migrations/00000000000000_baseline.sql:37` — `CREATE TABLE IF NOT EXISTS public.audit_log ( ... source_ip text );  -- no partitioning, no purge`; `docs/audit/2026-09-24/raw/privacy-logging-evidence.txt:0` — `## 9/10: zero matches for retention|purge|pg_cron|anonymi in migrations and for consent|privacy notice|data subject|personal data protection in src/supabase/doc`
- **Description:** Nothing in the repository defines retention for any personal data. That covers audit_log (PII diffs and staff IPs), credential_verification_log (every public QR scan, with the full signed token containing name and DOB, plus the scanner's IP), deactivated residents, rejected or withdrawn requests, storage objects (photos, scanned IDs and legal documents; a deleted document's object is removed, but a deactivated resident's are not), Supabase Auth logs and Edge Function logs. Only rate_limit_bucket cleans itself up. Civil-registration records legitimately need long or permanent retention, but that should be a documented decision per record class. There is no privacy notice for residents, no Record of Processing or lawful-basis statement, no procedure for access, rectification or erasure/objection requests, no breach-notification runbook, and no DPIA. The Supabase project region and the Vercel function region are not documented anywhere in docs/ (A-04 overlap), so cross-border transfer of the whole civil register cannot be assessed. The OSM tile flow (WP-PRV-008) is a second undeclared transfer.
- **Attack scenario:** Not an exploit. A regulator or data subject asks how long a resident's data and verification-scan history are kept and who has accessed them, and the operator cannot answer from any artefact.
- **Impact:** Likely non-compliance with the Proclamation's storage-limitation, transparency, accountability, data-subject-rights and cross-border-transfer provisions. The breach blast radius grows every year because nothing is deleted.
- **Recommendation:** Produce, with the system owner and counsel: (1) a Record of Processing per data class (purpose, lawful basis, recipients, retention, transfer); (2) a retention schedule, implemented with a scheduled job (pg_cron or a scheduled Edge Function) that purges or pseudonymises credential_verification_log.source_ip/attempted_value after e.g. 90 days and audit_log.source_ip after e.g. 1 year, and archives closed requests; (3) a resident-facing privacy notice (Amharic-first) at intake; (4) a DSAR/rectification runbook using the existing edit flows plus an export-my-record print; (5) a breach-response runbook with the regulator notification step; (6) documented Supabase/Vercel regions and the legal basis for any transfer outside Ethiopia.
- **Effort:** L · **Status:** Open

### WP-SUP-001
**Dependency and secret scanning are not automated: no bun audit step in CI and no Dependabot/Renovate, while docs state the tree is clean**  
Severity **Medium** · Confidence Confirmed · Category Supply Chain · Reported by `audit-supplychain` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-02, SEC-01; owasp_top10: A06:2021-Vulnerable and Outdated Components, A08:2021-Software and Data Integrity Failures; owasp_api: API8:2023; asvs: V14.2.1, V14.2.4; iso27001: A.8.8, A.8.28; nist_csf: ID.RA-01, PR.PS-02

- **Evidence:** `.github/workflows/ci.yml:30` — `- run: bun install --frozen-lockfile`; `.github/workflows/ci.yml:31` — `- run: bun run lint   (steps 31-41: lint, build, tsc, test, drift/catalog checks; no 'bun audit', no secret scan)`; `.github:0` — `only .github/workflows/ci.yml exists; no .github/dependabot.yml, no renovate.json`; `docs/testing-scope.md:83` — `**Dependency-vulnerability scanning has been run**: 'bun audit' against 'bun.lock' ... reports no vulnerabilities as of this pass.`; `docs/audit/2026-09-24/raw/supplychain-bun-audit.txt:2` — `js-yaml >=4.0.0 <4.3.2 ... high ... 1 vulnerabilities (1 high)`
- **Description:** Vulnerability scanning is a manual, point-in-time step. CI (the only gate a PR must pass) never runs `bun audit`, never runs a secret scanner, and no dependency-update bot is configured. The consequence is already visible: docs/testing-scope.md:83-85 records `bun audit` as clean, but today it reports one High advisory (WP-SUP-002). Nothing surfaced that change. The no-secrets-in-history result (SEC-01 PASS) likewise depends on a manual `secret-sweep` subagent run, not on CI or GitHub push protection.
- **Attack scenario:** A new advisory lands against a runtime dependency (for example supabase-js, jspdf, pdfjs-dist or html5-qrcode, all of which parse untrusted input in the browser). Nobody reruns `bun audit`, so the vulnerable version stays in production indefinitely. Separately, a developer pastes an `sbp_` token into a script and pushes it. With no CI secret scan and no push protection, it is caught only if someone remembers to run secret-sweep.
- **Impact:** Known-vulnerable components can stay deployed with no signal. Leaked credentials depend on human diligence to be caught. B-02's 'no known Critical/High CVEs unaddressed' cannot be shown to hold over time.
- **Recommendation:** Add a `bun audit --audit-level=high` step to ci.yml, or a scheduled workflow so build-only advisories do not block every PR. Add .github/dependabot.yml (the npm ecosystem reads bun.lock in current Dependabot) or Renovate with the bun manager, and keep bunfig.toml's minimumReleaseAge. Add gitleaks (SHA-pinned action) to CI and enable GitHub secret scanning with push protection. Update docs/testing-scope.md to cite the automated check rather than a one-off result.
- **Effort:** S · **Status:** Open

### WP-API-004
**Gateway JWT verification (verify_jwt) is undetermined: docs say false, repo deploy path yields true, fallback path forces false**  
Severity **Low** · Confidence Needs-live-verification · Category Config · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: E-03, E-02; owasp_top10: A05:2021; owasp_api: API8:2023, API2:2023; asvs: V14.1.1; iso27001: A.8.9; nist_csf: PR.PS-01

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N (3.7)
- **Evidence:** `supabase/config.toml:1` — `project_id = "woredas-portal"  (no [functions.<name>] verify_jwt entries)`; `scripts/deploy-functions.sh:40` — `supabase functions deploy "${FUNCTIONS[@]}" --use-api --project-ref "$REF"   (no --no-verify-jwt)`; `CLAUDE.md:1123` — `-F "metadata={\"name\":\"$FN\",\"entrypoint_path\":\"index.ts\",\"verify_jwt\":false};type=application/json"`; `docs/security-hardening.md:41` — `'verify_jwt:false' — the auth is in the function body`; `supabase/functions/sign-credential/index.ts:72` — `if (!PRIVATE_KEY_PEM) return json(req, 500, { error: "Signing key not configured" });   // before any auth check`
- **Description:** No repository artefact pins verify_jwt. The CLI path in scripts/deploy-functions.sh deploys with the CLI default (true); the documented Management-API fallback in CLAUDE.md deploys with false; docs/security-hardening.md asserts all functions run with false. The live value may therefore differ per function depending on who deployed last and how. Authentication is still enforced in every function body via GoTrue getUser() (all 8 verified), so this is not an auth bypass. With verify_jwt=false, unauthenticated traffic reaches function code: sign-credential answers 500 "Signing key not configured" before checking any credential, and every request costs an isolate plus (for tokens that look valid) a GoTrue round-trip, with no pre-auth throttling.
- **Attack scenario:** An unauthenticated scanner probes /functions/v1/sign-credential and learns whether HARARI_EC_PRIVATE_KEY is set; a flood of junk-token requests is absorbed by function isolates and GoTrue rather than the gateway.
- **Impact:** Configuration drift and minor information disclosure; slightly larger unauthenticated attack surface.
- **Recommendation:** Pin the intended value in supabase/config.toml ([functions.<name>] verify_jwt = true for all eight, unless the project has moved to asymmetric JWT signing keys, in which case document why false). Move the signing-key presence check after authentication. Record the live per-function value (GET /v1/projects/{ref}/functions) in the deploy verification step.
- **Effort:** S · **Status:** Open

### WP-API-009
**Edge Function audit writes are fire-and-forget and some carry the invitee e-mail (PII) or no woreda_id**  
Severity **Low** · Confidence Confirmed · Category Logging · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-05, LOG-01, PRV-01; owasp_top10: A09:2021; asvs: V7.1.1, V7.2.1; iso27001: A.8.15; nist_csf: DE.CM-03

- **Evidence:** `supabase/functions/sign-credential/index.ts:270` — `await admin.from("audit_log").insert({ ... action_type: "QR_SIGNED" ... });   // result ignored`; `supabase/functions/invite-tenant-user/index.ts:252` — `new_value_json: { email, role, full_name },`; `supabase/functions/resend-platform-invite/index.ts:105` — `await admin.from("audit_log").insert({ actor_user_id: callerId, entity_name: "app_user", entity_id: user_id, action_type: "PLATFORM_ADMIN_INVITE_RESENT", new_va`; `supabase/functions/send-password-reset-link/index.ts:178` — `// Never write the email address itself into the audit row`
- **Description:** All nine audit_log inserts across seven functions ignore the returned error, so a privileged action (credential signed, admin invited) can succeed with no audit row. invite-tenant-user, invite-platform-admin and resend-platform-invite store the e-mail address in new_value_json, contradicting the rule send-password-reset-link documents for itself; resend-platform-invite omits woreda_id so the row is invisible to tenant-scoped audit views.
- **Attack scenario:** Transient DB error during the audit insert leaves a signed credential with no QR_SIGNED record.
- **Impact:** Incomplete audit trail; unnecessary PII in logs.
- **Recommendation:** Check the insert error and log/alert (or wrap action + audit in one RPC transaction); drop e-mail from audit payloads (user_id already identifies the account); include target woreda_id.
- **Effort:** S · **Status:** Open

### WP-API-010
**Internal helper functions are exposed as /rest/v1/rpc endpoints (26 authenticated-callable without a client caller; 6 more anon-callable helpers)**  
Severity **Low** · Confidence Likely · Category Config · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: E-04, TEN-04, TEN-05; owasp_top10: A05:2021; owasp_api: API9:2023, API8:2023; asvs: V1.4.1, V4.1.3; iso27001: A.8.9; nist_csf: ID.AM-02

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N (4.3)
- **Evidence:** `supabase/migrations/00000000000023_pii_encryption.sql:324` — `CREATE OR REPLACE FUNCTION public.decrypt_pii_text(_cipher bytea, _woreda_id uuid) ... SECURITY DEFINER   (GRANT authenticated)`; `supabase/migrations/00000000000083_rental_phase5_checkpoint.sql:96` — `CREATE OR REPLACE FUNCTION public.default_role_perms(_role text) RETURNS text[]   (no GRANT/REVOKE in any migration)`; `supabase/migrations/00000000000019_override_hardening.sql:60` — `CREATE OR REPLACE FUNCTION public.user_permission_override_target_role_ok(_user_id uuid) ... au.role IN ('tenant_admin', 'super_admin')`; `supabase/migrations/00000000000031_rental_eligibility.sql:196` — `REVOKE ALL ON FUNCTION public.rental_eligibility(uuid, uuid, text) FROM PUBLIC;   (anon not revoked)`; `docs/audit/2026-09-24/api/endpoint-inventory.json:1` — `"rpc_internal_exposed": 26`
- **Description:** Because helper functions live in the PostgREST-exposed public schema, every function EXECUTE-able by authenticated is also an RPC endpoint. 26 have no client caller, including decrypt_pii_text (any staff member of a woreda, even with zero read permissions, can decrypt that woreda's ciphertext directly), user_permission_override_target_role_ok (tells any caller whether a UUID is an admin), entity_belongs_to_woreda, generate_rent_reminders, refresh_rent_ledger_statuses, resolve_reconciliation_exception and get_credential_live_status. Under Supabase's default ACL (modelled by the database auditor), default_role_perms, gen_letter_verification_token, gen_receipt_verification_token, luhn_check_digit, storage_path_woreda_id and check_credential_print_eligibility are also anon-executable; default_role_perms discloses the full compiled role/permission matrix to unauthenticated callers, and rental_eligibility (client-called) is anon-executable too.
- **Attack scenario:** An unauthenticated caller POSTs /rest/v1/rpc/default_role_perms {"_role":"finance_clerk"} to map the permission model; a viewer-role account calls decrypt_pii_text on national-ID ciphertext it can already SELECT.
- **Impact:** Enlarged, undocumented API surface; information disclosure; bypass of any future column-level restriction.
- **Recommendation:** Move RLS helper and internal functions into a non-exposed schema (e.g. `private`, not listed in API exposed schemas), keeping EXECUTE for authenticated where policies need it; REVOKE EXECUTE ... FROM anon explicitly (not just PUBLIC) on every non-public function; add a CI check that lists anon-executable functions.
- **Effort:** M · **Status:** Open

### WP-API-011
**API documentation is invalid, incomplete and inaccurate; no endpoint carries a classification in code**  
Severity **Low** · Confidence Confirmed · Category Docs · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: E-01, E-02, E-04, G-01; owasp_api: API9:2023; asvs: V1.1.2; iso27001: A.5.9, A.5.37; nist_csf: ID.AM-03

- **Evidence:** `docs/openapi.yaml:325` — `requestBody:         required: false      (no content -> schema error; also :360, and 200 without description at :363)`; `docs/openapi.yaml:13` — `This spec covers the six hand-written Edge Functions`; `docs/openapi.yaml:282` — `required: [email]   (resend-platform-invite reads only user_id)`; `docs/api-security.md:6` — `What _is_ hand-written is six Edge Functions and a handful of RPCs ... Every one of them is categorized below.`; `docs/audit/2026-09-24/raw/api-edge-docs-openapi-validation.txt:2` — `3 (validation errors)`
- **Description:** docs/openapi.yaml (3.0.3) fails schema validation (3 errors), documents 6 of 8 Edge Functions (resend-tenant-invite and send-password-reset-link missing), documents a wrong body for resend-platform-invite, applies bearer security to the anonymous RPCs, omits the apikey header, states the wrong status set for verify_service_letter and the wrong HTTP status (500 vs 503) for the verify_credential_token limiter, and covers 3 of ~64 RPCs and no PostgREST resources. No request/response sample files exist in the repository. docs/api-security.md classifies 11 endpoints; no function, RPC or route carries a Public/Private/Internal classification comment (INSA E-04 requires it in code).
- **Attack scenario:** n/a (compliance and inventory).
- **Impact:** INSA E-01/E-02/E-04 not met; reviewers and testers work from an outdated inventory (OWASP API9).
- **Recommendation:** Adopt docs/audit/2026-09-24/api/openapi.yaml (3.1, validated) and api/samples/ as the baseline; add a `// @classification: Private` header to each supabase/functions/*/index.ts and a `COMMENT ON FUNCTION ... IS '@classification Public|Private|Internal'` per RPC; validate the spec in CI.
- **Effort:** M · **Status:** Open

### WP-APP-006
**PostgREST .or() filter strings interpolate search input with partial escaping (only % and , removed)**  
Severity **Low** · Confidence Confirmed · Category Injection · Reported by `audit-appsec` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-01; owasp_top10: A03:2021; owasp_api: API8:2023; asvs: V5.3.4; iso27001: A.8.28; nist_csf: PR.DS-10

- **Evidence:** `src/routes/woreda.residents.index.tsx:191` — `const escaped = search.replace(/[%,]/g, ""); ... q = q.or(clauses.join(","));`; `src/components/services/ServiceRequestList.tsx:195` — `q = q.or(['request_number.ilike.%${esc}%', 'applicant_name.ilike.%${esc}%', ...].join(","))`; `src/routes/admin.audit.tsx:225` — `const esc = filters.q.replace(/[%,]/g, ""); query = query.or([...'entity_id.ilike.%${esc}%'].join(","))`; `src/routes/woreda.rental-houses.occupants.new.tsx:266` — `.replace(/[%,()*]/g, "")  // the better pattern, used in one place only`
- **Description:** There is no SQL injection. No migration uses dynamic EXECUTE (0 occurrences), every RPC takes typed parameters, and Edge Functions use supabase-js builders only. Eight .or() constructions (residents, households, services, credentials export, CredentialQueueTable, both audit pages, ResidentSearchPicker) interpolate user search text into PostgREST logic-tree syntax after stripping only '%' and ','. The characters '(', ')', '"', '*' (a PostgREST wildcard) and '.' pass through. Without commas an attacker cannot add sibling predicates, and every query still runs under the caller's RLS, so the realistic effect is malformed-filter 400s (surfaced raw per WP-BQ-001) and wildcard broadening. That is no more than a user can already do by calling PostgREST directly.
- **Attack scenario:** Typing 'a)' or 'a"' into a search box produces a PostgREST parse error, which is shown raw in a toast. No cross-tenant or cross-row access results.
- **Impact:** Robustness and hygiene only. This does not violate C-01's intent, but it fails its literal criterion ('no user input interpolated into PostgREST filter strings').
- **Recommendation:** Centralise one escaper that strips or escapes [%,()*\"\\.:] (as occupants.new.tsx does), or wrap values in double quotes with escaping. Better, move multi-column search into an RPC taking a text parameter.
- **Effort:** S · **Status:** Open

### WP-APP-007
**CSV formula-injection guard leaves an embedded carriage return (and ';' for semicolon-locale Excel) unquoted**  
Severity **Low** · Confidence Likely · Category Injection · Reported by `audit-appsec` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-02; owasp_top10: A03:2021; asvs: V5.3.10; iso27001: A.8.28

- **Evidence:** `src/utils/tableExport.ts:33` — `const FORMULA_PREFIX = /^[=+\-@\t\r]/;`; `src/utils/tableExport.ts:38` — `return /[",\n]/.test(safe) ? '"${safe.replace(/"/g, '""')}"' : safe;`; `src/utils/reportExport.ts:26` — `return /[",\n]/.test(s) ? '"${s.replace(/"/g, '""')}"' : s;`; `docs/audit/2026-09-24/raw/appsec-csv-escape.txt:2` — `'x;=2+2' emitted unquoted`
- **Description:** All 13 CSV exports go through rowsToCsv/sectionsToCsv, which prefix a leading = + - @ TAB CR with an apostrophe. This is good practice and is verified in both modules. The prefix test applies only to the first character, and quoting is triggered only by '"', ',' or LF. A value such as 'Abebe\r=cmd|...' is emitted unquoted, and spreadsheet apps that treat a bare CR as a record separator start a new row whose first cell is the formula. In locales where Excel's list separator is ';', 'x;=1+1' likewise produces a formula cell.
- **Attack scenario:** A clerk stores a resident full_name containing a CR followed by a formula. An auditor later exports residents to CSV and opens it in a spreadsheet application.
- **Impact:** Formula execution or link injection on an analyst workstation. The conditions are narrow and depend on the spreadsheet and locale.
- **Recommendation:** Quote every field unconditionally, add \r and ; to the quoting trigger, and apply the formula-prefix check after splitting on CR and LF as well.
- **Effort:** S · **Status:** Open

### WP-APP-008
**Landing page reflects attacker-supplied error_description text (content spoofing)**  
Severity **Low** · Confidence Confirmed · Category Injection · Reported by `audit-appsec` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-02; owasp_top10: A03:2021; asvs: V5.2.1; iso27001: A.8.28

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `src/lib/authRedirect.ts:34` — `const description = params.get("error_description") ?? hashParams.get("error_description") ?? params.get("error") ?? hashParams.get("error");`; `src/routes/index.tsx:109` — `<p className="mt-4 text-xs text-slate-400">{description}</p>`
- **Description:** Any https://<site>/?error_description=... link renders the supplied string on the official domain inside the 'this link is no longer valid' card. React escapes the text, so this is not XSS, but it is arbitrary text shown on a trusted government origin.
- **Attack scenario:** An attacker sends staff https://<portal>/?error_description=Your%20account%20is%20locked.%20Call%20%2B251...%20to%20reactivate, which appears on the genuine portal.
- **Impact:** Social-engineering aid only.
- **Recommendation:** Map GoTrue error codes (error_code / error) to a fixed set of bilingual messages and never render free text from the URL.
- **Effort:** S · **Status:** Open

### WP-ARC-005
**The SSR tier is configured to receive the service_role key although no code uses it**  
Severity **Low** · Confidence Likely · Category Config · Reported by `audit-architecture` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-06, SEC-02; owasp_top10: A05:2021; asvs: V14.1.3; iso27001: A.8.24; nist_csf: PR.DS-01 (CSF 2.0)

- **CVSS:** N/A (unnecessary secret exposure; conditional on the value being set in Vercel)
- **Evidence:** `.env.example:30` — `SUPABASE_SERVICE_ROLE_KEY=  (comment :29 'Required by src/integrations/supabase/client.server.ts')`; `src/integrations/supabase/client.server.ts:10` — `const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;`; `src/:0` — `grep: no module imports client.server (the module is dead code)`
- **Description:** .env.example tells operators that the service_role key is required, but client.server.ts is imported by nothing. If the key is set in the Vercel project environment as instructed, a key that bypasses RLS sits in an execution environment that never needs it, including preview deployments.
- **Attack scenario:** A future SSR bug, dependency compromise or preview-deployment misconfiguration reads process.env and exposes a key that bypasses RLS on every tenant.
- **Impact:** Needless expansion of where the most powerful data-plane secret lives. If it leaked, that would be a cross-tenant compromise (R7 Critical on exposure).
- **Recommendation:** Remove SUPABASE_SERVICE_ROLE_KEY from the Vercel environment, including previews, and from .env.example until server code needs it. Confirm in the Vercel dashboard and rotate the key if it has ever been set on preview deployments.
- **Effort:** S · **Status:** Open

### WP-AUTH-009
**Platform JWT signing algorithm, access-token lifetime and refresh-token rotation/reuse detection are neither documented nor evidenced (INSA E-03 declaration missing)**  
Severity **Low** · Confidence Needs-live-verification · Category Crypto · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: E-03, C-05, D-03; owasp_top10: A02:2021, A07:2021; owasp_api: API2:2023; asvs: V3.5.3, V3.3.1; iso27001: A.8.24, A.8.5; nist_csf: PR.DS-02, PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N (3.7)
- **Evidence:** `supabase/config.toml:1` — `project_id = "woredas-portal"  -- no [auth] jwt_expiry, enable_refresh_token_rotation, refresh_token_reuse_interval`; `supabase/functions/sign-credential/index.ts:89` — `const { data: userData, error: userErr } = await admin.auth.getUser(jwt);`; `src/integrations/supabase/auth-middleware.ts:56` — `const { data, error } = await supabase.auth.getClaims(token);  -- dormant (requireSupabaseAuth imported nowhere)`; `docs/security-functionality.md:78` — `- **Session regeneration**: handled entirely by Supabase Auth's own refresh-token rotation ('autoRefreshToken') ...`
- **Description:** Code-side JWT handling is sound: all 8 Edge Functions validate the caller by calling GoTrue (auth.getUser), which checks signature, exp and that the session still exists; no custom claims are trusted (no access-token hook, no auth.jwt() authorisation - roles are re-read from app_user per query, so privilege changes apply immediately). But the platform parameters INSA E-03 asks for are all dashboard-only and undocumented: whether the project still signs user JWTs with the legacy shared HS256 secret or has migrated to asymmetric JWT signing keys (ES256/RS256), the access-token lifetime (default 3600 s), and whether refresh-token reuse detection is on. After signOut, an already-issued access token remains usable against PostgREST/Storage until exp (stateless), so the lifetime directly bounds the post-logout replay window.
- **Attack scenario:** If the legacy HS256 JWT secret leaks (it is shared with every service that verifies tokens), arbitrary tokens for any user can be forged; with a 1 h expiry a stolen access token outlives logout by up to an hour.
- **Impact:** Unknown compliance status for E-03; potential forgery blast radius under HS256; post-logout replay window.
- **Recommendation:** Provide the dashboard values (see UNVERIFIED list). Migrate to asymmetric JWT signing keys (Settings > JWT Keys) and revoke the legacy secret once clients are rotated to publishable/secret API keys; note that Edge Functions deployed with gateway verify_jwt=true must then switch to in-function verification (they already call getUser). Set access-token expiry to 600-900 s; keep refresh rotation with reuse detection ON (reuse interval <= 10 s). Record all values in the SFD.
- **Effort:** S · **Status:** Open

### WP-AUTH-010
**Implicit OAuth flow: invite/recovery sessions (including the refresh token) are delivered in the URL fragment**  
Severity **Low** · Confidence Likely · Category AuthN · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-04, E-03; owasp_top10: A07:2021; owasp_api: API2:2023; asvs: V3.1.1; iso27001: A.8.5; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N (3.1)
- **Evidence:** `src/integrations/supabase/client.ts:23` — `auth: { storage: ..., persistSession: true, autoRefreshToken: true }  -- no flowType, so the default applies`; `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:21` — `flowType: 'implicit',  (auth-js 2.112.3 DEFAULT_OPTIONS)`; `supabase/functions/invite-tenant-user/index.ts:114` — `redirectTo: '${SITE_URL}/set-password',`; `src/lib/authRedirect.ts:41` — `const tokenHash = params.get("token_hash");  -- token_hash + verifyOtp shape already supported`
- **Description:** With the implicit flow, GoTrue's /verify redirect appends #access_token=...&refresh_token=... to the landing URL. supabase-js consumes and scrubs the fragment, and fragments are not sent in Referer, so exposure is limited to browser history/extensions/shoulder-surfing during the redirect. PKCE is not usable for these admin-initiated links (the code verifier would have to exist in the recipient's browser), but the app already supports the safer token_hash + verifyOtp shape (src/routes/index.tsx:74, :89). Which shape the project's email templates send is dashboard configuration.
- **Attack scenario:** A recovery link opened on a shared machine leaves a refresh token in a history entry or is captured by a malicious browser extension reading URLs.
- **Impact:** Low-probability leakage of a full session during invite/recovery.
- **Recommendation:** Change the Invite and Reset Password email templates to link to {{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=invite (resp. recovery), which index.tsx already redeems with verifyOtp, and set flowType: 'pkce' on the client so no flow ever returns tokens in the URL.
- **Effort:** S · **Status:** Open

### WP-AUTH-011
**Session and password lifecycle values are not documented in the SFD (INSA D-03)**  
Severity **Low** · Confidence Confirmed · Category Docs · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-03, C-05, E-03; owasp_top10: A05:2021; asvs: V1.2.4; iso27001: A.5.37; nist_csf: GV.PO-01

- **CVSS:** N/A
- **Evidence:** `docs/security-functionality.md:63` — `## Session & cookie logic  -- covers transport, storage, CSRF rationale, idle timeout; no JWT expiry, refresh rotation/reuse, inactivity/time-box, password poli`; `docs/security-functionality.md:86` — `mounted once per portal in 'WoredaShell.tsx'/'AdminShell.tsx'  -- files no longer exist; AppShell.tsx:406/566`
- **Description:** D-03 passes when documented session values equal actual configuration. The only concrete documented values (20/25 min idle, 15 s poll) match code. Everything else INSA asks for (access-token lifetime, refresh-token rotation and reuse interval, server-side inactivity timeout, absolute time-box, regeneration on login/privilege change, password minimum, MFA stance, lockout) is either absent or delegated to 'Supabase Auth' without values, and the implementation files named are stale.
- **Attack scenario:** N/A (documentation).
- **Impact:** Assessor cannot confirm D-03; configuration drift in the dashboard goes unnoticed.
- **Recommendation:** Add a 'Session parameters' table to docs/security-functionality.md populated from the dashboard (and a periodic check), and fix the file references.
- **Effort:** S · **Status:** Open

### WP-AZ-008
**Client authorization fails open to compiled defaults and the woreda portal ignores account status**  
Severity **Low** · Confidence Confirmed · Category AuthZ · Reported by `audit-authz` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-01; owasp_top10: A01:2021; asvs: V4.1.5; iso27001: A.8.2; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:L/I:N/A:N (3.1)
- **Evidence:** `src/hooks/useAuthBootstrap.ts:85` — `if (error || !data) return ROLE_PERMISSIONS[role] ?? [];`; `src/stores/authStore.ts:83` — `permissions: permissions ?? (appUser ? (ROLE_PERMISSIONS[appUser.role] ?? []) : []),`; `src/routes/woreda.tsx:21` — `if (!role) return <Navigate to="/login" />;  -- no status check`; `src/routes/admin.tsx:31` — `if (status !== "active") return <Navigate to="/login" />;  -- admin portal does check`
- **Description:** If current_permissions() errors, the store falls back to the compiled default. A user whose tenant or per-user override denies a key then sees the controls again. The server still refuses writes, but the UI misrepresents authority, and reads succeed for most keys because of WP-DB-004/WP-AZ-005. The woreda layout does not check appUser.status, unlike /admin. A suspended user with a live session keeps the shell, and every dashboard query with no permission gate still returns data because get_user_woreda_id() ignores status (root cause WP-DB-001).
- **Attack scenario:** A staff member is suspended mid-shift. Their open tab keeps rendering /woreda/dashboard with live KPIs and lists until the token expires.
- **Impact:** Defence in depth only. The server-side gaps are tracked in WP-DB-001/WP-DB-004.
- **Recommendation:** Fail closed: on RPC error, set permissions to [] and show a retry banner. In woreda.tsx, redirect when appUser.status !== 'active', matching admin.tsx.
- **Effort:** S · **Status:** Open

### WP-BQ-002
**Edge Functions (Deno) and scripts/ are excluded from every typecheck**  
Severity **Low** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: QA-01; owasp_top10: A04:2021; asvs: V1.14; iso27001: A.8.25; nist_csf: PR.IP

- **Evidence:** `tsconfig.json:2` — `"include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "eslint.config.js"],`; `.github/workflows/ci.yml:36` — `- run: npx tsc --noEmit`
- **Description:** The 8 service-role Edge Functions (sign-credential, invite-*, resend-*, activate-invited-user, record-login, send-password-reset-link) and the scripts/*.ts CI checkers are never typechecked; no deno check step exists in CI and no deno binary is available in the environment.
- **Impact:** Type errors in privileged server code reach deploy undetected; 'tsc --noEmit clean' overstates coverage.
- **Recommendation:** Add `deno check supabase/functions/*/index.ts` (and deno lint) to CI; add a node-typed tsconfig covering scripts/.
- **Effort:** S · **Status:** Open

### WP-BQ-003
**Lint cleanliness relies on 56 inline suppressions; 23 stale untyped-client casts over typed tables/PII views**  
Severity **Low** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: QA-01; iso27001: A.8.28

- **Evidence:** `src/routes/woreda.residents.$residentId.edit.tsx:58` — `const db = supabase as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any`; `src/routes/woreda.dashboard.tsx:274` — `const db = supabase as unknown as { from: (t: string) => any };`; `src/integrations/supabase/types.ts:5089` — `household_decrypted: {`; `src/integrations/supabase/types.ts:5314` — `payment_decrypted: {`; `eslint.config.js:45` — `"@typescript-eslint/no-unused-vars": "off",`
- **Description:** 56 eslint-disable directives, 26 explicit any, 83 'as unknown as' casts in src/. 23 call sites cast the Supabase client to an untyped shape to query tables/views (resident_decrypted, household_decrypted, payment_decrypted, rental_occupancy_decrypted, service_request_decrypted, console_role, ...) that are all present in the regenerated types.ts, so the 'pre-typegen' justification is obsolete. no-unused-vars is off and noUnusedLocals is false.
- **Impact:** Column renames on PII views fail silently at runtime instead of at compile time; dead locals undetected.
- **Recommendation:** Remove the untyped casts and use supabase.from('<view>') with generated types; re-enable no-unused-vars as warn.
- **Effort:** M · **Status:** Open

### WP-BQ-004
**Form labels not programmatically associated (shared FieldWrap); icon-only buttons without accessible name**  
Severity **Low** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)

- **Evidence:** `src/components/forms/FormSection.tsx:58` — `<Label className="mb-1.5 block">`; `src/components/common/DocumentViewerDialog.tsx:47` — `<Button type="button" variant="outline" size="icon" ...><ChevronLeft .../></Button>`; `src/routes/woreda.households.$householdId.index.tsx:259` — `<Button variant="ghost" size="icon" className="text-white hover:bg-white/15">`; `src/routes/woreda.credentials.new.tsx:654` — `<img src={photoSignedUrl} className="h-full w-full object-cover" />`
- **Description:** FieldWrap renders a sibling <Label> with no htmlFor and the child input receives no id; error text is not linked by aria-describedby and required is a red asterisk only. Heuristic scan: 187/213 inputs and 18/21 SelectTriggers lack programmatic labels; 6 icon buttons lack aria-label/sr-only; 1 img lacks alt. StatusChip renders text (not colour-only).
- **Impact:** WCAG 2.1 1.3.1 / 4.1.2 failures across resident, household and rental forms for screen-reader users.
- **Recommendation:** useId() in FieldWrap, clone child with id/aria-describedby/aria-invalid/aria-required; add aria-label to icon buttons; alt on the resident photo.
- **Effort:** S · **Status:** Open

### WP-BQ-005
**<html lang="en"> in an Amharic-primary portal; no lang="am" anywhere**  
Severity **Low** · Confidence Confirmed · Category Locale · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-08

- **Evidence:** `src/routes/__root.tsx:136` — `<html lang="en">`; `src/styles.css:195` — `:lang(am),`
- **Description:** The document language is English for both portals and no element sets lang="am", so the :lang(am) font rule is dead and assistive tech reads Ge'ez script with an English voice.
- **Impact:** Accessibility and typography (hyphenation, font selection) degraded for the primary audience.
- **Recommendation:** Set lang="am" on the woreda AppShell root (keep en for /admin) and lang="en" on English sub-captions.
- **Effort:** S · **Status:** Open

### WP-BQ-006
**No i18n framework or string catalogue; 37 English-only toast literals in the woreda portal**  
Severity **Low** · Confidence Confirmed · Category Locale · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-09

- **Evidence:** `package.json:20` — `"dependencies": {  // no i18next/react-i18next/lingui/formatjs`; `src/routes/woreda.civil.index.tsx:305` — `toast.success("CSV export ready");`; `src/routes/woreda.credentials.$requestId.index.tsx:653` — `toast.error("Reason must be at least 5 characters");`; `docs/audit/2026-09-24/raw/build-quality-english-only-toasts.txt:1` — `37 English-only toast literals`
- **Description:** All bilingual copy is inline 'ስም / Name' literals (3,135 Ethiopic-bearing lines across 117 files). There is no catalogue, so Amharic cannot be reviewed centrally or measured for completeness; 37 single-line English-only toasts remain in woreda routes/components. Admin routes also carry Amharic literals (7 files) despite the admin portal being documented English-only.
- **Impact:** Untranslated user-facing strings; approved-Amharic review (ET-09) not mechanically enforceable.
- **Recommendation:** Extract strings into typed am/en catalogues (i18next optional); add a lint rule or test flagging English-only literals in woreda routes.
- **Effort:** L · **Status:** Open

### WP-BQ-008
**Unused dependencies and dead code (21 runtime deps, 19 shadcn primitives, dead exports)**  
Severity **Low** · Confidence Confirmed · Category Supply Chain · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-02; owasp_top10: A06:2021; asvs: V14.2.4; iso27001: A.8.8; nist_csf: ID.AM

- **Evidence:** `package.json:57` — `"date-fns": "^4.1.0",  // zero imports in src/`; `package.json:70` — `"react-day-picker": "^9.14.0",  // only used by unused ui/calendar.tsx`; `package.json:56` — `"cmdk": "^1.1.1",  // only used by unused ui/command.tsx`; `src/utils/reportExport.ts:74` — `export async function exportSectionsToPdf(opts: {  // zero callers`; `docs/audit/2026-09-24/raw/build-quality-knip.txt:1` — `knip output (triaged)`
- **Description:** Verified unused: date-fns (no import), and react-day-picker, cmdk, vaul, embla-carousel-react, input-otp, react-resizable-panels plus 13 @radix-ui/* packages that are imported only by 19 unused src/components/ui/* files; also ComingSoon.tsx, exportSectionsToPdf and 27 unused exports. Excluded knip false positives: public/sw.js, src/server.ts chain, Edge Functions, client.server.ts, lightningcss, @tanstack/router-plugin.
- **Impact:** Larger dependency/supply-chain surface and advisory noise with no functional value.
- **Recommendation:** Remove unused deps and primitives; re-add via shadcn CLI when needed; add knip to CI with a config that ignores the known entry points.
- **Effort:** S · **Status:** Open

### WP-BQ-012
**CLAUDE.md is stale on build/quality facts (lint count, test suite, UX merge, shell files, route count)**  
Severity **Low** · Confidence Confirmed · Category Docs · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: G-01; iso27001: A.5.37

- **Evidence:** `CLAUDE.md:981` — `branch), so 'bun run lint' now reports ~49 real problems ('no-explicit-any',`; `CLAUDE.md:902` — `has no test suite and 'tsc --noEmit' stays clean through most of the bugs that`; `CLAUDE.md:773` — `### UX restructuring ('docs/ux/') — all 5 phases complete, not yet merged`; `CLAUDE.md:410` — `'WoredaShell.tsx'/'AdminShell.tsx', reusing each shell's existing sign-out`; `CLAUDE.md:176` — `**Every route sets 'ssr: false'.** All 67 route files do; only '__root.tsx'`
- **Description:** See drift[] for per-claim verdicts. Agents and reviewers acting on CLAUDE.md inherit wrong assumptions (e.g. searching for non-existent shell files, treating lint warnings as expected noise).
- **Impact:** Operational/documentation drift; misdirected review effort.
- **Recommendation:** Refresh the affected CLAUDE.md sections; generate volatile counts (routes, tests, lint) rather than hand-writing them.
- **Effort:** S · **Status:** Open

### WP-DB-014
**Seven of ten storage buckets have no MIME or size limit**  
Severity **Low** · Confidence Needs-live-verification · Category Config · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-08; owasp_top10: A05:2021; owasp_api: API8:2023; asvs: V12.1.1, V12.2.1; iso27001: A.8.9; nist_csf: PR.PS-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:U/C:L/I:L/A:N (4.6)
- **Evidence:** `supabase/migrations/00000000000001_storage.sql:24` — `VALUES ('credential-request-documents', 'credential-request-documents', 'f', NULL, NULL)  (same NULL, NULL for credential-templates, resident-clearance-letters,`; `supabase/migrations/00000000000014_app_user_staff_fields.sql:23` — `VALUES ('staff-assets', 'staff-assets', 'f', NULL, NULL)`; `supabase/migrations/00000000000048_task11_schema_gaps.sql:345` — `INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false)`
- **Description:** Only resident-documents (PDF, 10 MB) and rental-request-documents (PDF/JPEG/PNG, 5 MB, migration 72) have server-side limits. For the other buckets, type and size are checked only in the browser. Combined with WP-DB-002, a low-privilege user can upload arbitrary SVG/HTML or very large files.
- **Attack scenario:** Using the Storage API directly, a user uploads an SVG containing script to tenant-assets. It is later opened through a signed URL.
- **Impact:** Low: a stored-content risk (on the storage origin) and storage exhaustion. Buckets are private, and the ON CONFLICT DO NOTHING inserts mean live settings may differ.
- **Recommendation:** UPDATE storage.buckets to set allowed_mime_types (image/webp, image/png, image/jpeg, application/pdf as appropriate) and file_size_limit on every bucket, and verify live.
- **Effort:** S · **Status:** Open

### WP-DB-015
**Defence in depth: anon keeps table DML grants, FORCE ROW LEVEL SECURITY is not used, and DEFINER search_path omits pg_temp**  
Severity **Low** · Confidence Needs-live-verification · Category Config · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: TEN-01, TEN-04, TEN-05; owasp_top10: A05:2021; owasp_api: API8:2023; asvs: V1.4.1; iso27001: A.8.2; nist_csf: PR.PS-01

- **Evidence:** `supabase/migrations/00000000000007_tighten_anon_grants.sql:32` — `REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;  -- SELECT/INSERT/UPDATE/DELETE deliberately kept`; `supabase/migrations/00000000000000_baseline.sql:1665` — `GRANT DELETE ON public.app_user TO anon; GRANT INSERT ... GRANT UPDATE ON public.app_user TO anon`; `docs/audit/2026-09-24/raw/audit-database-rls-inventory.txt:1` — `66/66 tables ENABLE ROW LEVEL SECURITY; FORCE = 0/66`; `supabase/migrations/00000000000023_pii_encryption.sql:148` — `pii_root_key() ... SECURITY DEFINER SET search_path TO 'public', 'vault'`
- **Description:** anon holds SELECT/INSERT/UPDATE/DELETE on 63 of 66 tables. Only credential_verification_log, rate_limit_bucket and service_request_checkpoint had them revoked. Isolation from anon therefore depends entirely on no policy ever being written TO anon or TO public. Today all policies are TO authenticated. No table uses FORCE ROW LEVEL SECURITY. All 130 SECURITY DEFINER functions (54 callable, 76 trigger functions) pin search_path to 'public' (plus 'vault' for pii_root_key), which is good, but pg_temp is not placed last, and several of them create temp tables.
- **Attack scenario:** A future migration adds a policy without a TO clause, which defaults to PUBLIC. anon then gets DML immediately, because the grant is already there.
- **Impact:** Hardening gap only; nothing is exploitable today from the migrations.
- **Recommendation:** REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon and grant back only what the public RPCs need. Use ALTER DEFAULT PRIVILEGES to stop new grants. Use SET search_path = '' (with schema-qualified references) or 'public, pg_temp'. Add a CI lint that rejects CREATE POLICY without TO authenticated.
- **Effort:** S · **Status:** Open

### WP-INV-004
**One High advisory open in the dependency tree (js-yaml, build-time only) and no automated dependency-vulnerability scanning in CI**  
Severity **Low** · Confidence Likely · Category Supply Chain · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10) · Merged: WP-SUP-002
  
Refs: insa: B-02; owasp_top10: A06:2021; asvs: V14.2.1; iso27001: A.8.8; nist_csf: ID.RA-1, DE.CM-8

- **CVSS:** CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L (2.5 as reachable here: build-time only, parses repo-controlled YAML)
- **Evidence:** `docs/audit/2026-09-24/raw/inventory-bun-audit.txt:2` — `js-yaml  >=4.0.0 <4.3.2 ... eslint › @eslint/eslintrc › js-yaml ... @tanstack/react-start › @tanstack/start-plugin-core › xmlbuilder2 › js-yaml ... high: GHSA-2`; `.github/workflows/ci.yml:30` — `- run: bun install --frozen-lockfile`; `bun.lock:843` — `"js-yaml": ["js-yaml@4.3.1", ...` (via WP-SUP-002); `bun.lock:173` — `"@eslint/eslintrc": ["@eslint/eslintrc@3.3.6", ... "js-yaml": "^4.3.0"` (via WP-SUP-002); `bun.lock:1173` — `"xmlbuilder2": ["xmlbuilder2@4.0.3", ... "js-yaml": "^4.1.1"` (via WP-SUP-002)
- **Description:** bun audit (bun 1.3.11) reports exactly one advisory: js-yaml >=4.0.0 <4.3.2, High, GHSA-2883-xcg3-v3hh (CPU exhaustion via merge keys). Both paths are build tooling (eslint's eslintrc; the TanStack Start Vite plugin via xmlbuilder2) and only parse YAML from the repository itself, so runtime exposure is not expected (not verified by bundle inspection, hence 'Likely'). Separately, the CI workflow runs lint/build/tsc/tests/drift checks but no bun audit step, there is no .github/dependabot.yml, and no other scanner is configured - so a future runtime-reachable advisory would not be surfaced. bun outdated shows 38 packages behind, including supabase-js 2.112.3 -> 2.117.1 and react 19.2.8 -> 19.3.0 (raw/inventory-bun-outdated.txt). bunfig.toml's 24h minimumReleaseAge is a good existing supply-chain control.
- **Attack scenario:** Low: an attacker would need to commit crafted YAML to the repo to affect the build. The larger risk is process: an advisory in a runtime package (supabase-js, jspdf, pdfjs-dist) goes unnoticed.
- **Impact:** INSA B-02 criterion 'no known Critical/High CVEs unaddressed' not met on paper; no continuous detection of new advisories.
- **Recommendation:** Update to js-yaml >= 4.3.2 via the parent packages (bun update eslint @tanstack/react-start) or an override; add 'bun audit --audit-level=high' as a CI step (allow-list documented build-only exceptions) and enable Dependabot/Renovate for bun.lock.
- **Effort:** S · **Status:** Open

### WP-INV-007
**Phase-2 stack inventory (docs/tech-stack.md) is stale: records package.json range floors instead of resolved versions, omits print_officer/custom actors, and omits esm.sh, the SMTP relay, Vercel and GitHub as integrations**  
Severity **Low** · Confidence Confirmed · Category Docs · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-01, B-02, B-03, B-04; owasp_top10: A06:2021; owasp_api: API9:2023; asvs: V14.2.4; iso27001: A.5.9; nist_csf: ID.AM-2

- **CVSS:** N/A (documentation)
- **Evidence:** `docs/tech-stack.md:12` — `| UI | React | 19.2.0 |   (bun.lock / node_modules: 19.2.8)`; `docs/tech-stack.md:14` — `| Server state | TanStack Query | 5.83.0 |   (resolved: 5.101.4)`; `docs/tech-stack.md:20` — `| Backend | Supabase ... | 2.108.2 |   (resolved: 2.112.3)`; `docs/tech-stack.md:58` — `- **Google Fonts** — 'Noto Sans Ethiopic' (Amharic body text and headings across the woreda portal, per 'src/styles.css:23')`; `src/styles.css:23` — `font-family: "Jiret";   (self-hosted /fonts/Jiret-Regular.woff2; Tayitu at line 17)`; `docs/tech-stack.md:71` — `Eight tenant roles plus platform-level super admin ... 'super_admin', 'tenant_admin', 'civil_registrar', 'registry_clerk', 'finance_clerk', 'supervisor', 'audit`
- **Description:** docs/tech-stack.md says package.json is the source of truth and copies the caret-range floors from it; every one of the 11 framework versions differs from what bun.lock resolves and CI installs (React 19.2.0 vs 19.2.8, Start 1.168.44 vs 1.168.46, Router 1.170.27 vs 1.170.29, Query 5.83.0 vs 5.101.4, Zustand 5.0.14 vs 5.0.15, RHF 7.71.2 vs 7.85.0, Zod 3.24.2 vs 3.25.76, Tailwind 4.2.1 vs 4.3.3, Vite 8.0.16 vs 8.2.1, TS 5.8.3 vs 5.9.3, supabase-js 2.108.2 vs 2.112.3). Its actor sentence enumerates only seven tenant roles plus super_admin, omitting print_officer (built-in since migration 35) and the tenant-defined custom role. Its font entry cites src/styles.css:23 for Noto Sans Ethiopic, but that line declares the self-hosted Jiret face; Tayitu/Jiret are not mentioned. Its integration list omits esm.sh (deploy-time code source for all Edge Functions), the unnamed SMTP relay GoTrue sends invite/recovery mail through (docs/architecture.md:471), Vercel and Supabase as hosting processors, and GitHub Actions; none of the listed integrations records data shared, auth method or secret location.
- **Attack scenario:** Not directly exploitable; an assessor or CVE-matching process working from the documented versions checks the wrong versions.
- **Impact:** INSA B-01/B-03 evidence inaccurate; vulnerability triage against the documented inventory would be wrong.
- **Recommendation:** Generate the version table from bun.lock (a small script alongside generate-permissions-doc.ts, with a --check mode in CI), add print_officer and custom to the actor list, and expand the integrations table to name/data/auth/secret-location per integration (use inventory.md section 3 as a starting point).
- **Effort:** S · **Status:** Open

### WP-INV-008
**CLAUDE.md (the guidance that steers an overwhelmingly agent-authored codebase) contradicts the code in at least twelve places**  
Severity **Low** · Confidence Confirmed · Category Docs · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: G-01; owasp_top10: A04:2021; asvs: V1.1.2; iso27001: A.5.37; nist_csf: PR.IP-2

- **CVSS:** N/A (documentation)
- **Evidence:** `CLAUDE.md:773` — `### UX restructuring ('docs/ux/') — all 5 phases complete, not yet merged`; `CLAUDE.md:410` — `'WoredaShell.tsx'/'AdminShell.tsx', reusing each shell's existing sign-out`; `CLAUDE.md:902` — `has no test suite and 'tsc --noEmit' stays clean through most of the bugs that`; `CLAUDE.md:1089` — `reset link even though nothing in this app's own UI triggers one`; `CLAUDE.md:851` — `Seven review agents, each covering a failure mode`; `CLAUDE.md:548` — `Nine buckets, all private; reads go through signed URLs`
- **Description:** Git history shows 129 of 177 commits authored by Claude (ground-truth.md section 3), so CLAUDE.md is operationally load-bearing. It was last edited 2026-09-22 (07ca972, 'Update CLAUDE.md for drift') yet still contradicts the code: UX restructure described as unmerged (merged in PR #79, 0bd0c30); idle timeout said to mount in WoredaShell/AdminShell (those files no longer exist; useIdleTimeout is called from src/components/layout/AppShell.tsx:406 and :566); 'this repo has no test suite' (23 *.test.ts files and a vitest CI step); recovery links 'nothing in this app's own UI triggers' (send-password-reset-link is invoked from UsersRolesTab.tsx:304 and PlatformUsersTab.tsx:325); 'Seven review agents' (8 tracked, rental-financial-integrity-review missing from the table); 'Nine buckets' (10 in migrations, incl. rental-request-documents); 'All 67 route files' (69 set ssr:false); '52 tables' (66); 'Two RPCs' for public verification (three incl. verify_receipt); 'All six functions now import from _shared' (eight); rate limiting 'called by the invite/resend functions' (also send-password-reset-link); module list omits rental_houses. Full list in drift[].
- **Attack scenario:** An agent following CLAUDE.md edits a non-existent shell, skips tests it believes do not exist, or omits a bucket/module from a security review, re-introducing a fixed defect.
- **Impact:** Reduced reliability of agent-driven changes and reviews; audit evidence drawn from CLAUDE.md is unreliable.
- **Recommendation:** Correct the listed statements; replace hard-coded counts (tables, buckets, routes, functions, agents) with pointers to generated sources or add a doc-drift CI check for the counts.
- **Effort:** S · **Status:** Open

### WP-LOC-006
**Dashboard 'monthly' chart counts Gregorian months but labels them with EC month names**  
Severity **Low** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-01, ET-04

- **Evidence:** `src/routes/woreda.dashboard.tsx:374` — `// monthly (default) -- last 6 months, Ethiopian month labels`; `src/routes/woreda.dashboard.tsx:379` — `const key = '${d.getFullYear()}-${d.getMonth()}';`; `src/routes/woreda.dashboard.tsx:381` — `label: ethiopianMonthLabel(d),`; `src/routes/woreda.dashboard.tsx:387` — `const key = '${d.getFullYear()}-${d.getMonth()}';`
- **Description:** Registrations are grouped by Gregorian month (getFullYear/getMonth), but each bar is labelled with the EC month that contains today's day-of-month in that Gregorian month. Gregorian September covers Nehase 26 to Meskerem 20, including all of Pagume. From the 1st to the 10th of a Gregorian month the bar carries the previous EC month's name; from the 11th it carries the next one's. On 6-10 September the bar reads 'ጳጉሜ' but counts a whole Gregorian month. setMonth(getMonth() - i) on the 29th-31st also overflows (e.g. 31 March minus 1 month becomes 3 March), which can drop or duplicate a bucket.
- **Attack scenario:** Not a security exploit.
- **Impact:** Dashboard figures are presented as EC monthly counts but are Gregorian monthly counts, and the label for the same bar changes with the day of the month.
- **Recommendation:** Bucket by gregorianToEthiopian(d).year and .month, and step back through EC months with ethiopianToGregorian({year, month, day: 1}). Pagume can be its own bucket or folded into Nehase.
- **Effort:** S · **Status:** Open

### WP-LOC-007
**Tayitu/Jiret are applied only through utility classes; receipts, the ID card and canvas PDF exports use Noto Sans Ethiopic, and bold weights are not shipped**  
Severity **Low** · Confidence Likely · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-08

- **Evidence:** `src/styles.css:16` — `@font-face { font-family: "Tayitu"; src: url("/fonts/Tayitu-Regular.woff2") ... font-weight: 400 700; }`; `src/styles.css:45` — `--font-am-heading: "Tayitu", "Noto Sans Ethiopic", sans-serif;`; `src/styles.css:46` — `--font-am-body: "Jiret", "Noto Sans Ethiopic", sans-serif;`; `src/styles.css:192` — `font-family: "Inter", sans-serif;`; `src/styles.css:195` — `:lang(am),`; `src/utils/tableExport.ts:67` — `const AM_FONT = '"Noto Sans Ethiopic", "Abyssinica SIL", system-ui, sans-serif';`
- **Description:** Both fonts are present (public/fonts/Tayitu-Regular.woff2, Jiret-Regular.woff2) and declared with @font-face. Tayitu leads the heading stack (75 uses of .font-am-heading) and Jiret the body stack (980 uses of .font-am-body), with Noto Sans Ethiopic as fallback in both. Gaps: (1) The body default is Inter, and the :lang(am) rule never matches because no element sets lang="am" (WP-BQ-005). Amharic text without a utility class therefore falls through Inter to the OS 'sans-serif' Ethiopic face, not Tayitu, Jiret or even the loaded Noto webfont. (2) The printed receipt (14 inline Noto declarations), the ID-card print surface (3), both canvas PDF exporters and .font-noto-ethiopic (3 uses) all bypass Tayitu/Jiret, so print and PDF output does not follow the two-typeface system. (3) Only Regular weights are shipped, but each face declares font-weight: 400 700. The browser therefore treats the one file as covering bold and will probably not synthesise bold, so font-bold Amharic headings likely render at regular weight. (4) The owner convention reads 'Tayitu primary, Jiret secondary'. The code uses Tayitu for headings and Jiret for body, and Jiret is never a fallback for Tayitu (Tayitu → Noto). This matches docs/ux/ux_amharic_typography_plan.md and the recorded licence decision (Tayitu decorative-only). The owner should confirm this reading.
- **Attack scenario:** Not a security exploit.
- **Impact:** Typography differs between screen and print. Unclassed Amharic text renders in whatever Ethiopic font the device has (tofu on some Linux kiosks). Headings may lose weight.
- **Recommendation:** Set the body/:lang(am) default to var(--font-am-body) and add lang="am" on Amharic-primary containers (or <html lang="am"> for /woreda). Switch AM_FONT in tableExport/reportExport, the receipt and the card print to the Tayitu/Jiret stacks, awaiting document.fonts.load() before drawing to canvas. Either ship bold files or declare font-weight: 400 so bold is synthesised. Record the owner's Tayitu/Jiret role decision in the typography plan.
- **Effort:** S · **Status:** Open

### WP-LOC-008
**EthiopianDateInput silently keeps the previous date on invalid or cleared input**  
Severity **Low** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-03

- **Evidence:** `src/components/common/EthiopianDateInput.tsx:58` — `if (!yN || !mN || !dN) {`; `src/components/common/EthiopianDateInput.tsx:59` — `// Mid-edit: do NOT clear external value.`; `src/components/common/EthiopianDateInput.tsx:63` — `if (!isValidEthiopianDate(e)) {`; `src/components/common/EthiopianDateInput.tsx:64` — `return;`
- **Description:** Pagume (month 13) is selectable, and isValidEthiopianDate() correctly allows day 6 only when year % 4 === 3. But commit() simply returns when the triple is incomplete or invalid; it does not call onChange('') or report an error. Consequences: (a) typing Pagume 6 in a common year, or day 31 in any month, leaves the form holding the previously committed ISO date while the fields show the new, invalid values, and the only hint is a stale 'Gregorian:' preview line; (b) an optional date that already has a value cannot be cleared by emptying the fields, because the parent keeps the old ISO value; (c) aria-invalid is driven only by the parent's schema, which sees the old, valid date.
- **Attack scenario:** Not a security exploit. A registrar corrects a birth date from '5 ጳጉሜ 2018' to '6 ጳጉሜ 2018' (not a valid date), saves, and the record keeps Pagume 5 without any warning.
- **Impact:** Wrong dates can be saved while the screen shows something else, for DOB, event and due dates.
- **Recommendation:** When all three parts are empty, call onChange(''). When the parts are complete but invalid, call onChange('') (or an 'invalid' sentinel the schema rejects) and render an inline bilingual error, e.g. 'ልክ ያልሆነ ቀን / Invalid date (Pagume has 5 days this year)'. Set the day input's max to 5 or 6 when month 13 is selected.
- **Effort:** S · **Status:** Open

### WP-LOC-009
**No approved Amharic source: the glossary is a stale self-extraction, spellings are inconsistent, and native sign-off is pending**  
Severity **Low** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-09

- **Evidence:** `docs/amharic-strings-glossary.csv:1` — `Amharic,English,Occurrences,Example Location,Context,All Locations`; `docs/go-live-declaration.md:310` — `| Amharic native-speaker sign-off | **Not yet complete** ...`; `src/components/forms/ResidentWizardSteps.tsx:447` — `labelAm="ኃይማኖት"`; `src/routes/woreda.residents.$residentId.print.tsx:242` — `labelAm="ሃይማኖት"`; `src/routes/woreda.civil.birth.new.tsx:313` — `<FieldWrap labelAm="ፆታ" labelEn="Sex" ...`; `src/routes/woreda.residents.index.tsx:273` — `{ header: "ጾታ / Sex", value: (r) => r.sex },`
- **Description:** ET-09 asks for Amharic 'verbatim from an approved source'. The repository has none. docs/amharic-strings-glossary.csv (693 rows, last changed eb3d283 on 2026-09-14) was extracted from the code for review, not approved for use, and go-live-declaration.md:310 records that native-speaker sign-off is not complete. The glossary is also stale: a heuristic extraction finds 1,749 distinct Ethiopic runs in src/, of which 1,065 are neither in the glossary nor a substring of an entry (204 of them in rental files that post-date it); two glossary entries no longer occur in src/ (raw/locale-glossary-coverage.txt). 193 lines of Amharic in 28 migrations (RAISE messages) are outside the glossary entirely. The same term is spelled differently in different places: ኃይማኖት ×4 vs ሃይማኖት ×2 (religion), ፆታ ×8 vs ጾታ ×14 (sex), ንኡስ ×1 vs ንዑስ ×2 (sub-). These are legitimate orthographic variants, not errors, but they show there is no controlled vocabulary. No clearly machine-translated strings were spotted in a sample review; the auditor is not a native-speaker authority, so this remains UNVERIFIED. English-only toasts (37) are already listed in WP-BQ-006. CLAUDE.md's narrower claim that only four translateError() entries carry Amharic is CONFIRMED (errorMessages.ts has 4 lookup entries plus GENERIC_FALLBACK).
- **Attack scenario:** Not a security exploit.
- **Impact:** Legal documents (certificates, letters, receipts) may carry unreviewed or inconsistent Amharic. There is no mechanical way to prove compliance with an approved source.
- **Recommendation:** Regenerate the glossary from src/ and supabase/migrations/ (add a --check script like generate-permissions-doc, run in CI), obtain native-speaker approval, and record the approved spelling for each term (choose between ሃይማኖት and ኃይማኖት, ጾታ and ፆታ, ንዑስ and ንኡስ). Longer term, move strings into a catalogue so approval is per key.
- **Effort:** M · **Status:** Open

### WP-LOC-011
**Every document number carries the Gregorian two-digit year and resets on 1 January (UTC), not on Meskerem 1**  
Severity **Low** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-01

- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1019` — `v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;`; `supabase/migrations/00000000000000_baseline.sql:1025` — `NEW.receipt_number := v_woreda_code || '-RCT-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0');`; `supabase/migrations/00000000000002_credential.sql:96` — `v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;`; `supabase/migrations/00000000000076_rental_phase2_financial_core.sql:140` — `v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;`; `supabase/migrations/00000000000080_rental_phase4_arrears.sql:247` — `v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;`
- **Description:** The latest definitions of all nine numbering triggers (assign_credential_number [mig 2], assign_credential_request_number, assign_receipt_number, assign_rental_request_number, assign_service_request_number, assign_vital_event_number, assign_resident_number [baseline], assign_rent_account_number [mig 76], assign_arrears_plan_number [mig 80]) take the year from EXTRACT(YEAR FROM NOW()) % 100, i.e. the Gregorian year evaluated in the database session time zone (UTC on Supabase). A receipt issued on 14 መስከረም 2019 is numbered '…-RCT-26-…'. Per-year sequences restart at 03:00 EAT on 1 January, in the middle of the EC year, rather than at Meskerem 1 or the fiscal-year start. The 13-digit credential number embeds the same YY, and its format is fixed by the barcode and Luhn invariants.
- **Attack scenario:** Not a security exploit.
- **Impact:** Document numbers do not show the EC year printed on the same document. Annual sequences do not line up with EC or fiscal-year reporting.
- **Recommendation:** Owner decision: either keep Gregorian YY and document it as a deliberate choice, or add a SQL ethiopian_year(date) helper and switch the non-credential numbers to EC YY with the reset at Meskerem 1 (or Hamle 1). The credential number format must not change without the card-print-review invariants being revisited.
- **Effort:** M · **Status:** Open

### WP-OPS-009
**Staging seed design cannot exercise tenant isolation or most roles: one woreda, 4 of 9 roles, one shared password, no teardown**  
Severity **Low** · Confidence Confirmed · Category Config · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: F-02, F-03; iso27001: A.8.33

- **CVSS:** N/A
- **Evidence:** `scripts/seed-staging-users.ts:49` — `const STAGING_TEST_WOREDA_ID = "81ac2ad6-a320-4069-b8dc-0c43e358371b";  (single woreda for every account)`; `scripts/seed-staging-users.ts:97` — `role: "super_admin" | "tenant_admin" | "registry_clerk" | "viewer";`; `scripts/seed-staging-users.ts:87` — `const TEST_PASSWORD = randomBytes(12).toString("base64url");  (:218 'All four accounts share this one password')`; `scripts/seed-staging-users.ts:61` — `if (projectRef === PRODUCTION_PROJECT_REF) {  (the only production guard is a single hard-coded ref string)`; `.claude/skills/acceptance-harness/SKILL.md:133` — `bun run scripts/seed-staging-users.ts --teardown   # extend the script if this flag is absent`
- **Description:** The planned staging accounts put every user in the Aboker woreda, so no cross-tenant test is possible. They cover super_admin, tenant_admin, registry_clerk and viewer only: civil_registrar, finance_clerk, supervisor, auditor, print_officer, custom roles, restricted console roles and the pending, suspended and inactive status variants are missing, and several open High database findings (WP-DB-001, WP-DB-004) depend on exactly those. All accounts, including super_admin, share one password. The teardown flag that the acceptance harness relies on does not exist. Credential handling is otherwise sound: generated at run time, never written to disk, and a production-ref refusal is present.
- **Impact:** The Phase 6 test campaign would miss the highest-risk defects (status bypass, read-permission gaps, cross-woreda access).
- **Recommendation:** Extend the seeder to the matrix in docs/audit/2026-09-24/findings/ops-scope-testing-scope.md: two woredas, every built-in role, a custom role, a restricted console role, pending/suspended/inactive variants, a second approver for maker≠checker, a unique password per account, and a --teardown mode. Also refuse to run if the target project contains more than N residents, as a second production guard.
- **Effort:** S · **Status:** Open

### WP-OPS-010
**Real individuals' e-mail addresses and account records are committed to a public repository as production seed data and in verification reports**  
Severity **Low** · Confidence Confirmed · Category Privacy · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: F-03, PRV-01; owasp_top10: A01:2021; iso27001: A.5.34, A.8.11; nist_csf: PR.DS-01 (CSF 2.0)

- **CVSS:** N/A
- **Evidence:** `supabase/seed-app-users.sql:25` — `FROM auth.users u WHERE u.email = 'eska…[REDACTED]@gmail.com'   (super_admin, active)`; `supabase/seed-app-users.sql:41` — `FROM auth.users u WHERE u.email = 'sayb…[REDACTED]@gmail.com'   (supervisor, pending)`; `docs/remediation-report.md:316` — `'eska…[REDACTED]@gmail.com' was invited as 'registry_clerk' in Aboker woreda`; `docs/audit/2026-09-24/raw/ops-scope-github-api.txt:5` — `"private": false, "visibility": "public"`
- **Description:** seed-app-users.sql binds production roles (including the platform super_admin) to named people's personal webmail addresses. Verification reports name the real accounts used for committed production test writes. The repository is public, so this maps privileged accounts to targetable identities. Personal webmail accounts for a government super_admin are a separate account-security concern. No passwords are present, and no auth.users inserts exist in any migration.
- **Attack scenario:** Targeted phishing or password-reset abuse against the identified super_admin mailbox.
- **Impact:** Account-takeover targeting information; disclosure of personal data.
- **Recommendation:** Remove seed-app-users.sql from the tracked tree (keep an operator-held copy or a template with placeholders), move privileged accounts to organisational mailboxes with MFA, and scrub named accounts from docs. History rewrite is optional because these are not secrets, but treat the addresses as disclosed.
- **Effort:** S · **Status:** Open

### WP-OPS-011
**Hosting location and cross-border transfer of Ethiopian residents' PII are undocumented (Supabase region recorded as eu-west-1; Vercel functions region unspecified)**  
Severity **Low** · Confidence Needs-live-verification · Category Privacy · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-04, PRV-01; iso27001: A.5.31, A.5.34; nist_csf: GV.OC-03 (CSF 2.0)

- **CVSS:** N/A
- **Evidence:** `docs/fix-task-v3-execution-notes.md:18` — `(woreda-portal-DB, eu-west-1, ACTIVE_HEALTHY) via the Management API`; `docs/architecture.md:9` — `## Deployment topology  (diagram names Vercel and Supabase; no region, jurisdiction or data-residency statement)`
- **Description:** The only record of where the data lives is a passing mention in an execution note: eu-west-1 (Ireland). No deployment document states the hosting jurisdiction, the Vercel function region, the SMTP relay location, or a legal basis for holding a national civil registry outside Ethiopia. Whether Ethiopia's Personal Data Protection Proclamation (No. 1321/2024) or INSA hosting guidance permits this is a legal determination for the owner, not something this audit decides.
- **Impact:** Possible regulatory non-compliance; the A-04 deployment architecture is incomplete.
- **Recommendation:** Record the region of every data-holding service (Supabase, Vercel, SMTP relay, the future backup store) in the deployment diagram, and obtain and file the owner's or INSA's determination on data residency.
- **Effort:** S · **Status:** Open

### WP-OPS-012
**The repository's INSA Phase 6 testing-scope artifact is stale and incomplete**  
Severity **Low** · Confidence Confirmed · Category Docs · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: F-01, F-02, G-01; iso27001: A.5.37

- **CVSS:** N/A
- **Evidence:** `docs/testing-scope.md:15` — `| Edge Functions (6) | 'sign-credential', 'invite-tenant-user', 'invite-platform-admin', 'resend-platform-invite', 'activate-invited-user', 'record-login'`; `docs/testing-scope.md:17` — `| PostgREST data API | Auto-generated REST over all 42 RLS-protected tables`; `docs/testing-scope.md:40` — `| Role | Email (staging only) | Covers |  (4 roles, one woreda)`; `docs/testing-scope.md:83` — `**Dependency-vulnerability scanning has been run**: 'bun audit' ... reports no vulnerabilities as of this pass.`
- **Description:** docs/testing-scope.md lists 6 Edge Functions (actual 8: resend-tenant-invite and send-password-reset-link are missing) and 42 tables (actual 66 tables and 17 views). It omits Storage (10 buckets), the public receipt verification route and verify_receipt RPC, the rental module and the service worker/offline queue. Its test-account table covers 4 roles in one woreda, and its dependency-scan statement is contradicted by WP-SUP-002. The auditor's replacement draft is docs/audit/2026-09-24/findings/ops-scope-testing-scope.md.
- **Impact:** A penetration-test team scoped from this document would miss about a third of the attack surface.
- **Recommendation:** Replace docs/testing-scope.md with the auditor draft once reviewed, and add a CI or doc check that counts supabase/functions/* and the migration table set against the document.
- **Effort:** S · **Status:** Open

### WP-PRV-007
**Sign-ins, sign-outs and failed authentication are not in the application audit trail**  
Severity **Low** · Confidence Confirmed · Category Logging · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-05, LOG-01; owasp_top10: A09:2021; asvs: V7.2.1, V7.2.2; iso27001: A.8.15, A.8.16; nist_csf: DE.CM-1, DE.CM-3

- **CVSS:** N/A (detective-control gap)
- **Evidence:** `supabase/functions/record-login/index.ts:17` — `// No audit_log entry: a row per login would be pure noise against the admin-action-focused audit trail`; `supabase/functions/record-login/index.ts:43` — `.update({ last_login_at: new Date().toISOString() })  -- overwritten each login; no history`; `src/routes/login.tsx:100` — `if (error || !data.user) { setSubmitError(error?.message ?? "Sign-in failed"); ... return; }  -- nothing recorded app-side`
- **Description:** Successful logins overwrite a single app_user.last_login_at value. Logouts, idle-timeouts, failed password attempts, sign-ins by suspended or unprovisioned accounts (login.tsx:114-137) and password changes (ChangePasswordDialog) produce no audit_log row. GoTrue records these events in its own platform logs (auth.audit_log_entries and the Auth log explorer), but their retention depends on the Supabase plan, tenant admins cannot see them, and they cannot be correlated with audit_log in /woreda/audit. Password-reset-link sends and invites are logged (Edge Functions, with source_ip), which is good. Whether GoTrue auth logging is enabled and how long it is retained needs live verification.
- **Attack scenario:** Someone password-sprays a clerk's account or signs in with stolen credentials outside working hours. Tenant admins have no in-app way to see failed attempts or the session history of an account under investigation.
- **Impact:** Account compromise is detected late, and incident forensics depend on an external log with unknown retention.
- **Recommendation:** Write LOGIN_SUCCEEDED from record-login, since it already has the verified caller, IP and user-agent. Write LOGIN_FAILED/LOGIN_BLOCKED from a small Edge Function or GoTrue auth hook (hashed email only, never the password), LOGOUT/IDLE_TIMEOUT from handleSignOut, and PASSWORD_CHANGED from ChangePasswordDialog. Show them in /woreda/audit under a separate 'Sessions' filter so they don't add noise to the admin view. Document the Auth log retention and export it to a SIEM or bucket if the plan's retention is short.
- **Effort:** S · **Status:** Open

### WP-SUP-004
**actions/checkout referenced by mutable tag (@v4) although the same workflow documents SHA-pinning as the policy**  
Severity **Low** · Confidence Confirmed · Category Supply Chain · Reported by `audit-supplychain` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-02; owasp_top10: A08:2021-Software and Data Integrity Failures; asvs: V14.2.4; iso27001: A.8.30; nist_csf: GV.SC-07

- **Evidence:** `.github/workflows/ci.yml:15` — `- uses: actions/checkout@v4`; `.github/workflows/ci.yml:16` — `# SHA-pinned rather than @v2: a moved tag on a third-party action runs arbitrary code in this job`; `.github/workflows/ci.yml:20` — `- uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`
- **Description:** setup-bun is pinned to a full commit SHA, with a comment explaining why (the tj-actions tag-move compromise). actions/checkout is still on the mutable @v4 tag. The blast radius is small: workflow permissions are `contents: read` (ci.yml:8-9) and no secrets are passed to the job. It is still an inconsistency with the repo's own stated policy.
- **Attack scenario:** The v4 tag is repointed to malicious code (an upstream compromise). The next CI run executes it with the job's GITHUB_TOKEN (read-only) and can tamper with build or test results.
- **Impact:** CI integrity only. No deploy credentials are in this workflow.
- **Recommendation:** Pin actions/checkout to a full commit SHA with a version comment, and let Dependabot's github-actions ecosystem keep it current.
- **Effort:** S · **Status:** Open

### WP-SUP-005
**SessionStart hook installs bun via unpinned `curl | bash` and runs `bun install` without --frozen-lockfile**  
Severity **Low** · Confidence Confirmed · Category Supply Chain · Reported by `audit-supplychain` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-02; owasp_top10: A08:2021-Software and Data Integrity Failures; asvs: V14.2.4; iso27001: A.8.30; nist_csf: GV.SC-07

- **Evidence:** `.claude/hooks/session-start.sh:28` — `curl -fsSL https://bun.sh/install | bash`; `.claude/hooks/session-start.sh:34` — `"$BUN" install`; `package.json:6` — `"packageManager": "bun@1.3.11",`
- **Description:** In remote agent sessions (CLAUDE_CODE_REMOTE=true), when bun is missing the hook pipes the latest bun installer from the network into bash. There is no version pin, although package.json and CI pin 1.3.11, and there is no checksum. It then runs a plain `bun install`, which can re-resolve and rewrite bun.lock if package.json and the lockfile have drifted. CI uses --frozen-lockfile (ci.yml:30). This affects developer and agent containers only, not production. bunfig.toml's minimumReleaseAge guard still applies.
- **Attack scenario:** The bun.sh installer endpoint is compromised or serves a different major version. The agent container runs it with the session's environment, which during deploy work can hold SUPABASE_ACCESS_TOKEN or VERCEL_TOKEN.
- **Impact:** Code execution in a developer or agent environment that may hold account-level deploy tokens. Lockfile drift is also possible.
- **Recommendation:** Install the pinned version (`curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.11"`), or verify a checksum of the release zip. Use `bun install --frozen-lockfile` in the hook to match CI.
- **Effort:** S · **Status:** Open

### WP-SUP-006
**Account-level Management API token is placed on the curl/subprocess command line in operator scripts (visible via ps and /proc/<pid>/cmdline); the probe script also uses a fixed /tmp path**  
Severity **Low** · Confidence Confirmed · Category Config · Reported by `audit-supplychain` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: SEC-01; owasp_top10: A05:2021-Security Misconfiguration; asvs: V14.3.3, V6.4.1; iso27001: A.8.24, A.5.17; nist_csf: PR.DS-01

- **Evidence:** `scripts/phase-c-create-vault-key.sh:78` — `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \`; `scripts/phase-c-apply-migration.sh:56` — `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \`; `scripts/phase-c-backfill.sh:81` — `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \`; `scripts/phase-c-apply-migration-024.sh:48` — `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \`; `scripts/run-phase-c-dryrun.sh:58` — `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \`; `scripts/apply-workflow-migrations.sh:135` — `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \`
- **Description:** All seven Management API scripts read the token from the environment, never hard-code it, and never echo it. They follow the CLAUDE.md rule, and the in-repo secret scans are clean. But the expanded token becomes a curl argv element, and `vercel --token=` does the same. On a shared or multi-user host any local user can read other processes' arguments, and process-accounting or EDR tools often log them. SUPABASE_ACCESS_TOKEN has control-plane rights over every project on the account. run-live-probes.py also writes SQL payloads to a predictable /tmp path, which is a symlink/race hazard on shared /tmp. The payload is SQL, not the token.
- **Attack scenario:** An operator runs a migration script on a shared jump host. A co-tenant user polls `ps -eo args` and captures the sbp_ token for the account.
- **Impact:** Disclosure of an account-level deploy credential. The precondition (a shared host) makes it Low.
- **Recommendation:** Pass the header through stdin or a config file so the token is not in argv. Use `curl -H @-` or `curl --config -` fed from a here-string, or `-H @<(printf 'Authorization: Bearer %s' "$SUPABASE_ACCESS_TOKEN")`. Use the VERCEL_TOKEN env var, which the Vercel CLI reads natively, instead of --token. Use tempfile.mkstemp() in run-live-probes.py.
- **Effort:** S · **Status:** Open

### WP-WF-016
**FSM hygiene: a live UI button strands complaints in approval_returned, system transitions no process drives (active->expired, overdue), and an incomplete terminal list in the engine**  
Severity **Low** · Confidence Confirmed · Category Quality · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: MC-02; owasp_top10: A04:2021; asvs: V11.1.1; iso27001: A.8.26; nist_csf: PR.PS-06

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:L (3.7)
- **Evidence:** `supabase/migrations/00000000000061_task14b_service_request_fsm.sql:117` — `('service_request', 'pending_approval', 'approval_returned', 'service.return', ...)  -- no row has approval_returned as from_status`; `src/routes/woreda.services.$requestId.index.tsx:872` — `transition(isLetter ? "returned" : "approval_returned", {`; `supabase/migrations/00000000000025_workflow_engine.sql:536` — `('residence_credential','active','expired',NULL,true,'Past expiry_date; no scheduled job sets this yet')`; `supabase/migrations/00000000000046_task10_credential_lifecycle.sql:182` — `IF OLD.status = ANY (ARRAY['rejected','expired','revoked','replaced']) ...  -- completed/closed/registered/cancelled/defaulted rely on seed absence only`; `docs/audit/2026-09-24/raw/workflows-fsm-reconstructed.txt:1` — `Reconstructed FSM (83 transitions) with sink/unreachable analysis`
- **Description:** The reconstructed FSM (83 transitions, raw/workflows-fsm-reconstructed.txt) shows the following. (a) service_request 'approval_returned' is a non-terminal sink, and the complaint 'Return' button at approval writes it, so the complaint is permanently stuck. (b) rental_occupancy_request 'draft' has no exit, and vital_event 'approval_returned'/'issued' and rental 'pending_approval' are dead states. (c) No process drives the only credential system transition, active -> expired, so DB status stays 'active' after expiry. The public verifier compensates using the signed payload's expiry, but staff lookups and the one-active-credential index do not. (d) Nothing in the app calls refresh_rent_ledger_statuses(), and there is no scheduler, so 'overdue' is derived at read time instead of stored. (e) The engine's own terminal-state test lists only rejected/expired/revoked/replaced. The terminal states of the newer FSMs (completed, closed, registered, cancelled, defaulted, rental approved) are protected only by the absence of seed rows.
- **Attack scenario:** Not an attack: complaints returned at approval cannot be progressed, and expired IDs remain 'active' for staff.
- **Impact:** Operational dead-ends and weaker protection against a future seed mistake reopening a terminal state.
- **Recommendation:** Seed approval_returned -> under_review for service_request (or change the button to write 'returned'). Add a scheduled SECURITY DEFINER job (pg_cron or an Edge cron) for active->expired and ledger refresh. Extend the terminal array in enforce_workflow_transition() to every terminal state of every entity.
- **Effort:** S · **Status:** Open

### WP-API-013
**PostgREST schema introspection and GraphQL exposure to anon are not controlled by the repository**  
Severity **Info** · Confidence Needs-live-verification · Category Config · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: E-02, TEN-05; owasp_top10: A05:2021; owasp_api: API9:2023, API8:2023; asvs: V14.3.2; iso27001: A.8.9; nist_csf: PR.PS-01

- **Evidence:** `supabase/migrations/00000000000007_tighten_anon_grants.sql:32` — `REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;   (SELECT/INSERT/UPDATE/DELETE kept)`; `supabase/config.toml:1` — `project_id = "woredas-portal"   (no [api] schemas / max_rows settings)`
- **Description:** anon keeps table-level DML grants on 64 of 66 tables (RLS denies rows). PostgREST's root OpenAPI document and pg_graphql introspection (if enabled on the project) enumerate objects by privilege, so the full table/column list, including *_enc and national-ID columns, may be discoverable with only the publishable key. max_rows and exposed schemas are dashboard-only.
- **Attack scenario:** GET /rest/v1/ with the publishable key returns the schema map used to target further requests.
- **Impact:** Reconnaissance aid only; no data returned.
- **Recommendation:** Verify live behaviour of GET /rest/v1/ and /graphql/v1 with the anon key; REVOKE table privileges from anon on all non-public tables; disable pg_graphql if unused; set max_rows.
- **Effort:** S · **Status:** Open

### WP-API-014
**Self-scoped functions accept any status: record-login updates suspended accounts; activate-invited-user does not confirm a password was set**  
Severity **Info** · Confidence Confirmed · Category AuthN · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: E-06, C-05; owasp_top10: A07:2021; owasp_api: API2:2023; asvs: V2.1.1; iso27001: A.5.17; nist_csf: PR.AA-01

- **Evidence:** `supabase/functions/record-login/index.ts:43` — `.from("app_user").update({ last_login_at: new Date().toISOString() }).eq("user_id", callerId)`; `supabase/functions/activate-invited-user/index.ts:72` — `.update({ status: "active" }).eq("user_id", callerId).eq("status", "pending")`
- **Description:** Both functions are correctly self-scoped (identity only from the JWT). record-login writes last_login_at for suspended/inactive accounts, so "last login" can show activity for an account an administrator believes is locked. activate-invited-user trusts the client flow order; an invitee holding only the invite-link session can activate without ever setting a password (they can still set one later via updateUser).
- **Attack scenario:** n/a (integrity of administrative signals).
- **Impact:** Misleading administrative data.
- **Recommendation:** In record-login, skip or flag non-active accounts; in activate-invited-user, check auth user metadata (e.g. that the user has a recent password update) before flipping status.
- **Effort:** S · **Status:** Open

### WP-AUTH-012
**Every sign-out (including idle timeout) is global: it revokes the user's sessions on all devices**  
Severity **Info** · Confidence Confirmed · Category AuthN · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-05; asvs: V3.3.1

- **CVSS:** N/A
- **Evidence:** `src/components/layout/AppShell.tsx:389` — `await supabase.auth.signOut();`; `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3395` — `async signOut(options = { scope: 'global' }) {`
- **Description:** signOut() without arguments uses scope 'global', so logout correctly revokes the refresh token server-side (INSA-positive) but also ends the same user's sessions on other devices, including when the idle timer fires on one machine. If the network call fails, auth-js still clears the local session but the server-side refresh token stays valid. Shell sign-out also clears the query cache, wizard drafts and the offline queue (AppShell.tsx:395-401), which is good practice.
- **Attack scenario:** N/A.
- **Impact:** Positive control with a UX side-effect; residual risk only when sign-out happens offline.
- **Recommendation:** Keep global for explicit sign-out if that is the policy; consider scope 'local' for idle timeout. Document the choice (D-03).
- **Effort:** S · **Status:** Open

### WP-AZ-009
**The Security Functionality Document has no route/RPC/Edge-Function-to-guard-to-policy matrix, and its central access-control claim is contradicted**  
Severity **Info** · Confidence Confirmed · Category Docs · Reported by `audit-authz` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-01, G-01; owasp_api: API9:2023; asvs: V1.4.1; iso27001: A.5.37; nist_csf: GV.PO-01

- **Evidence:** `docs/security-functionality.md:7` — `## Access control (RBAC/ABAC) -- delegates to the forensic review; no per-route matrix`; `docs/security-functionality.md:19` — `'user_has_perm(_perm)' gates what a query can actually return`
- **Description:** D-01 requires an SFD that states which guard or policy enforces each endpoint. The SFD links to other reviews and summarises the two-gate model, but it contains no route, RPC or Edge Function matrix. Its claim that user_has_perm() is 'the real enforcement point' for what a query returns is false for SELECT on 30+ tenant tables (WP-DB-004). This audit produced the missing matrices at authz/route-guard-matrix.md and authz/permission-matrix.md.
- **Attack scenario:** n/a
- **Impact:** Reviewers and the INSA assessor cannot verify access control from the documentation.
- **Recommendation:** Adopt the generated matrices into docs/security-functionality.md, regenerate them in CI (like generate:permissions-doc), and correct the enforcement claim.
- **Effort:** S · **Status:** Open

### WP-BQ-009
**TanStack route generator scans src/routes/__tests__ (3 build warnings)**  
Severity **Info** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: RT-01

- **Evidence:** `docs/audit/2026-09-24/raw/build-quality-build.txt:1` — `Warning: Route file ".../src/routes/__tests__/credential-print-preview-parity.regression.test.ts" does not export a Route.`; `docs/audit/2026-09-24/raw/build-quality-build.txt:9` — `routeFileIgnorePattern: undefined`
- **Description:** Test files under src/routes/__tests__ are treated as route candidates; harmless today but noisy.
- **Impact:** Build-log noise that can mask real routing warnings.
- **Recommendation:** Set routeFileIgnorePattern to '__tests__' in the tanstackStart router options, or move the tests out of src/routes.
- **Effort:** S · **Status:** Open

### WP-BQ-010
**Bundle profile: 706 KB raw / 203 KB gzip JS preloaded at root; duplicate html2canvas variants**  
Severity **Info** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)

- **Evidence:** `docs/audit/2026-09-24/raw/build-quality-build.txt:28` — `vite v8.2.1 building client environment for production...`; `src/components/print/PrintDocumentShell.tsx:8` — `import html2canvas from "html2canvas-pro";`
- **Description:** Root preloads 15 chunks (index 404 KB, supabase-vendor 209 KB). Route-split heavy chunks: pdf.worker 1,046 KB, DocumentViewerDialog/pdfjs 421 KB, credentials.verify/html5-qrcode 401 KB, jspdf 400 KB, recharts 371 KB, html2canvas-pro 248 KB, html2canvas 199 KB (lazy, via jspdf .html()). CSS 132 KB; 242 JS files, 6.3 MB total. No performance budget.
- **Impact:** First-load cost on low-bandwidth woreda connections.
- **Recommendation:** Investigate what keeps the root entry at 404 KB; add a size budget check to CI.
- **Effort:** M · **Status:** Open

### WP-BQ-011
**Design tokens are stock shadcn 'slate'; ~90% of colour usage is raw Tailwind palette classes**  
Severity **Info** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)

- **Evidence:** `src/styles.css:104` — `--foreground: oklch(0.129 0.042 264.695);`; `src/styles.css:109` — `--primary: oklch(0.208 0.042 265.755);`; `src/styles.css:137` — `--shell-header: oklch(0.212 0.043 256.459); /* #0B192C */`
- **Description:** Base tokens are the unmodified shadcn slate preset plus 10 custom shell/status tokens; no 'Academic Curator' token set exists. 2,465 raw palette classes across 105 .tsx files vs 258 semantic-token classes, plus 83 hex literals. Heaviest: woreda.credentials.$requestId.index.tsx (236), credentials.new (124), credentials print (102). .font-noto-ethiopic call sites: 0 (typography migration complete).
- **Impact:** Theme changes and the defined .dark theme cannot apply consistently; contrast fixes must be made per call site.
- **Recommendation:** Map slate/red/green/amber usages to semantic/status tokens incrementally, starting with the credential screens.
- **Effort:** L · **Status:** Open

### WP-BQ-013
**CI gates narrower than they appear: no routeTree sync check, no coverage/bundle budget, no Deno check**  
Severity **Info** · Confidence Confirmed · Category Config · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: QA-01; iso27001: A.8.25

- **Evidence:** `.github/workflows/ci.yml:35` — `- run: bun run build`; `.github/workflows/ci.yml:36` — `- run: npx tsc --noEmit`; `.github/workflows/ci.yml:15` — `- uses: actions/checkout@v4`
- **Description:** CI regenerates routeTree.gen.ts but never fails if the committed copy is stale (no git diff --exit-code); no coverage threshold, bundle budget or Deno typecheck. checkout is tag-pinned while setup-bun is SHA-pinned (deferred to supply-chain agent).
- **Impact:** Drift in generated files and untested/untyped server code can merge green.
- **Recommendation:** Add `git diff --exit-code src/routeTree.gen.ts` after build, a coverage floor, and deno check.
- **Effort:** S · **Status:** Open

### WP-DB-017
**Schema documentation drift: docs/erd.md lists 52 tables (14 rental tables missing) and the 'additive-only' migration claim is false**  
Severity **Info** · Confidence Confirmed · Category Docs · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-07, G-01; owasp_api: API9:2023; asvs: V1.1.2; iso27001: A.5.37; nist_csf: ID.AM-07

- **Evidence:** `docs/erd.md:10` — `That live enumeration found **52 tables**, zero drift against the migrations`; `CLAUDE.md:582` — `project is **additive-only**: no 'DROP'`; `supabase/migrations/00000000000010_id_card_template_draft.sql:28` — `DROP CONSTRAINT id_card_template_status_check, DROP COLUMN status;`
- **Description:** Migrations and src/integrations/supabase/types.ts agree exactly: 66 tables, 17 views, 64 non-trigger functions, and every column; the only raw diff, id_card_template.status, is explained by its DROP COLUMN in migration 10. docs/erd.md, however, omits rent_account, rent_charge, rent_rate_history, rent_payment_settlement, rental_payment, rental_policy, rent_reminder, arrears_* (4), payment_reconciliation_exception, service_request_checkpoint and rent_account_sequence. The live database was not reachable, so migrations vs live remains Needs-live-verification.
- **Impact:** Reviewers and INSA assessors are working from a stale ERD.
- **Recommendation:** Use the regenerated architecture/erd.md (this audit), and regenerate docs/erd.md from the catalog in CI.
- **Effort:** S · **Status:** Open

### WP-INV-009
**Production server runtime built with a pinned pre-release (nitro 3.0.260603-beta); CI checkout action not SHA-pinned**  
Severity **Info** · Confidence Confirmed · Category Supply Chain · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-01, B-02; owasp_top10: A06:2021, A08:2021; asvs: V14.2.1; iso27001: A.8.32; nist_csf: ID.SC-2

- **CVSS:** N/A
- **Evidence:** `package.json:104` — `"nitro": "3.0.260603-beta",`; `.github/workflows/ci.yml:15` — `- uses: actions/checkout@v4`; `.github/workflows/ci.yml:20` — `- uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`
- **Description:** nitro produces the Vercel Build Output that serves every document response (and applies the security headers via src/server.ts); it is pinned to a beta build (latest is 3.0.260903-beta per bun outdated). This is a deliberate, pinned choice rather than a floating one, so it is recorded as an observation. In CI, setup-bun is SHA-pinned with a comment explaining why, but actions/checkout@v4 is a moving tag - first-party GitHub, so lower risk, but inconsistent with the stated rationale.
- **Attack scenario:** N/A
- **Impact:** Pre-release server runtime in a government production deployment; minor CI supply-chain inconsistency.
- **Recommendation:** Track nitro to a stable 3.x as soon as one ships, and SHA-pin actions/checkout for consistency.
- **Effort:** S · **Status:** Open

### WP-INV-010
**Outbound e-mail integration (GoTrue SMTP relay) is unnamed and undocumented; sending domain DMARC is p=none**  
Severity **Info** · Confidence Needs-live-verification · Category Config · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-03; owasp_top10: A05:2021; iso27001: A.5.19, A.5.14; nist_csf: ID.SC-2

- **CVSS:** N/A
- **Evidence:** `docs/architecture.md:471` — `SPF/DKIM/DMARC alignment gap for the sending domain through its mail relay,`; `docs/architecture.md:475` — `policy is 'p=none', which only **monitors** alignment; it does not yet`; `docs/tech-stack.md:52` — `no external email service beyond Supabase Auth's own GoTrue mailer (invite and password-recovery emails)`
- **Description:** Invite and password-recovery links (which grant account access) are delivered by GoTrue through a mail relay configured in the Supabase dashboard. The provider, the data shared (staff e-mail addresses, one-time links) and where its credentials live are not recorded anywhere in the repo; tech-stack.md describes it as 'GoTrue's own mailer', while architecture.md refers to a separate mail relay. The sending domain's DMARC policy is documented as p=none (monitor only), so spoofed invite/reset e-mails claiming the domain are not rejected.
- **Attack scenario:** Phishing mail spoofing the portal's sender domain passes DMARC and imitates an invite/reset e-mail to harvest staff credentials.
- **Impact:** Integration inventory incomplete for the channel that carries account-takeover-grade links.
- **Recommendation:** Name the SMTP provider, data shared, and secret location in docs/tech-stack.md; complete the DMARC ramp to p=quarantine/p=reject.
- **Effort:** S · **Status:** Open

### WP-LOC-014
**Jineala's Amharic name differs between README (ጂናኤላ) and seed/database (ጂንኤላ)**  
Severity **Info** · Confidence Confirmed · Category Docs · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-11, ET-09

- **Evidence:** `README.md:58` — `| 5         | JINEALA     | Jineala          | ጂናኤላ             | 14, 15, 16     |`; `supabase/seed.sql:74` — `... 'JINEALA', 'Jineala', 'ጂንኤላ', 'active', ... '5')`
- **Description:** The six woreda codes, the English names, woreda_numeric_code 1-6 and the 19-kebele mapping in supabase/seed.sql match the README spec table exactly. The one mismatch is the Amharic name of woreda 5: ጂናኤላ in the README, ጂንኤላ in the seed. The seed value is what prints on every credential, letter and receipt letterhead for that woreda.
- **Attack scenario:** Not a security exploit.
- **Impact:** Possible misspelling of an official woreda name on printed documents.
- **Recommendation:** Have the owner confirm the official spelling, then correct either README.md or seed.sql (plus the live woreda row, with a woreda_settings display-name override if one is used).
- **Effort:** S · **Status:** Open

### WP-OPS-013
**Live TLS version and HSTS delivery could not be verified from the audit environment; code sets HSTS (2 years, includeSubDomains, no preload)**  
Severity **Info** · Confidence Needs-live-verification · Category Config · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-04, A-06; owasp_top10: A02:2021; asvs: V9.1.1, V9.1.3; iso27001: A.8.24; nist_csf: PR.DS-02 (CSF 2.0)

- **CVSS:** N/A
- **Evidence:** `src/lib/security-headers.ts:77` — `headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");`; `src/server.ts:46` — `return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));`; `docs/audit/2026-09-24/raw/ops-scope-tls-probe.txt:3` — `curl: (56) CONNECT tunnel failed, response 403  (egress policy denies woredas-portal.vercel.app and the Supabase host)`
- **Description:** The code applies HSTS and a CSP to every SSR response, and no http:// URL exists under src/. The audit sandbox's egress policy refused CONNECT to both production hosts, so the negotiated TLS versions, the certificate chain and header survival on the live edge are unverified. Even if a probe had succeeded, the sandbox proxy re-terminates TLS, so an openssl result would have described the proxy rather than Vercel. Vercel and Supabase both terminate TLS at 1.2+ by platform default (inherited control).
- **Impact:** Evidence gap only.
- **Recommendation:** The owner should attach an SSL Labs (or testssl.sh) report for the production host and for <ref>.supabase.co, plus `curl -sSI https://<prod-host>/` output showing the security headers.
- **Effort:** S · **Status:** Open

### WP-PRV-010
**Server-side error logging passes raw driver errors to Supabase function logs, where Postgres 'detail' can echo the offending value**  
Severity **Info** · Confidence Likely · Category Logging · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-07, D-05; owasp_top10: A09:2021; asvs: V7.1.1; iso27001: A.8.15; nist_csf: PR.DS-5

- **CVSS:** N/A
- **Evidence:** `supabase/functions/_shared/response.ts:79` — `console.error(logLabel, err);`; `src/routes/__root.tsx:38` — `console.error(error);  -- client error boundary; message only, no payload`
- **Description:** console.* usage is minimal and appropriate. Client code logs only configuration and SSR/error-boundary errors (7 call sites), and none of them logs a password, token or form payload. Edge Functions log through safeError() and the rate-limit fail-open path only. safeError() logs the whole error object, though. A PostgREST/Postgres unique-violation or check-violation carries a 'detail' such as 'Key (username)=(someone@example.org) already exists', so staff emails or other values can end up in Supabase function logs, whose retention and access are managed outside this repo. This is a low-risk observation, recorded so that the logging exclusion list stays accurate.
- **Attack scenario:** Not directly exploitable. Anyone with dashboard log access (the account owner's team) can see incidental PII fragments.
- **Impact:** Small amounts of PII in platform logs with undocumented retention.
- **Recommendation:** Log err.code, err.message and a request id, and omit err.details/err.hint, or redact them with a regex for emails and 9-16-digit numbers before console.error.
- **Effort:** S · **Status:** Open

### WP-SUP-007
**Pre-release and unmaintained components: nitro 3.0.260603-beta builds the production server; html5-qrcode 2.3.8 (last published 2023-04) handles camera QR decoding; several majors behind**  
Severity **Info** · Confidence Confirmed · Category Supply Chain · Reported by `audit-supplychain` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-02; owasp_top10: A06:2021-Vulnerable and Outdated Components; asvs: V14.2.1; iso27001: A.8.8; nist_csf: ID.AM-02

- **Evidence:** `package.json:104` — `"nitro": "3.0.260603-beta",`; `package.json:61` — `"html5-qrcode": "^2.3.8",`; `src/components/verification/HararildScanner.tsx:0` — `imports html5-qrcode (camera scanner for credential verification)`; `docs/audit/2026-09-24/raw/supplychain-bun-outdated.txt:1` — `39 outdated; majors behind: zod 3.25.76 -> 4.6.5, recharts 2.15.4 -> 3.10.1, pdfjs-dist 5.4.296 -> 6.3.289, react-pdf 10 -> 11, lucide-react 0.575 -> 1.47, fram`
- **Description:** No known advisory affects these versions today (bun audit lists only js-yaml). The Nitro server entry that wraps every document response with security headers (src/server.ts) is built by a date-stamped beta. html5-qrcode has had no release since April 2023 (npm time.modified 2023-04-15) and runs in the browser against camera input. The minor/patch backlog is small: supabase-js 2.112.3 -> 2.117.1, react 19.2.8 -> 19.3.0, and TanStack patches.
- **Impact:** Higher chance of unpatched defects, and no upstream fix path if html5-qrcode is ever found vulnerable.
- **Recommendation:** Track nitro to a stable 3.x release. Plan a replacement for html5-qrcode (for example the maintained @zxing/browser or the native BarcodeDetector with a fallback). Apply the in-range patch updates on a regular cadence through the bot from WP-SUP-001.
- **Effort:** M · **Status:** Open

### WP-SUP-008
**.gitignore:59 `.env*` overrides the `!.env.example` negation at :27; project ref hard-coded in a tracked skill**  
Severity **Info** · Confidence Confirmed · Category Config · Reported by `audit-supplychain` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: SEC-01

- **Evidence:** `.gitignore:27` — `!.env.example`; `.gitignore:59` — `.env*`; `.claude/skills/acceptance-harness/SKILL.md:54` — `URL="https://tugz…[project ref].supabase.co"`
- **Description:** `git check-ignore --no-index -v .env.example` resolves to `.gitignore:59:.env*`, so the later pattern re-ignores the template. It stays in the repo only because it is already tracked. This is fail-safe, since it ignores more rather than less, but the negation is dead and confusing. The Supabase project ref in the acceptance-harness skill is not a secret (it is in every built client bundle), but it pins a tracked file to one environment.
- **Impact:** Hygiene only.
- **Recommendation:** Drop the trailing `.env*` line (or move `!.env.example` after it). Read the project ref from an env var in the skill.
- **Effort:** S · **Status:** Open

## Module: Civil Registration

### WP-WF-001
**Workflow INSERT guard covers only the credential tables: civil events and service requests can be created directly at approved, awaiting_payment, registered or issued**  
Severity **High** · Confidence Confirmed · Category Business Logic · Reported by `audit-workflows` · Verification: verified
  
Refs: insa: MC-02, BL-02; owasp_top10: A01:2021, A04:2021; owasp_api: API5:2023, API6:2023; asvs: V11.1.1, V11.1.2; iso27001: A.5.3, A.8.26; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N (6.5)
- **Evidence:** `supabase/migrations/00000000000029_workflow_insert_guard.sql:87` — `IF TG_TABLE_NAME = 'credential_request' THEN ... (only credential_request and residence_credential are checked)`; `supabase/migrations/00000000000029_workflow_insert_guard.sql:203` — `CREATE TRIGGER zz_enforce_workflow_insert BEFORE INSERT ON public.credential_request / residence_credential (no other table)`; `supabase/migrations/00000000000058_task14a_civil_registration_fsm.sql:100` — `CREATE POLICY vital_event_insert ... user_has_any_perm(ARRAY['civil.register', 'civil.create_event'])  -- no status predicate`; `supabase/migrations/00000000000061_task14b_service_request_fsm.sql:35` — `CREATE POLICY service_request_insert ... 'service.create', 'service.submit', 'complaint.manage', 'tenant.manage'  -- no status predicate`; `supabase/migrations/00000000000064_task14b_verify_letter_completed_status.sql:47` — `AND sr.status IN ('issued', 'resolved', 'closed', 'completed')`; `supabase/migrations/00000000000062_task14b_payment_issuance_and_preconditions.sql:70` — `IF NEW.status = 'issued' AND (OLD.status IS DISTINCT FROM 'issued') THEN  -- issuance gate is BEFORE UPDATE only`
- **Description:** enforce_workflow_transition() is a BEFORE UPDATE trigger. Migration 29 added the missing BEFORE INSERT arm (enforce_workflow_insert) after the project's own review showed a credential could be POSTed at 'paid', but it only handles credential_request and residence_credential. When vital_event (migration 58) and service_request (migration 61) were brought under the engine, no INSERT guard was added. The vital_event and service_request INSERT policies check permission and woreda only, and no BEFORE INSERT trigger on either table (preconditions, numbering, force_actor, rental checkpoint) checks the status. rental_occupancy_request has its own insert guard (migration 89), and arrears_repayment_plan has no INSERT policy, so neither is affected. The engine's audit writers (log_workflow_transition, log_workflow_status_history) are AFTER UPDATE triggers, so a row inserted at a late state leaves no trigger-written history.
- **Attack scenario:** (1) A registry_clerk (holds civil.create_event) POSTs /vital_event {event_type:'death', resident_id:<victim>, status:'awaiting_payment', ...}. The death precondition only checks that the resident is active. The event never goes through verification or approval. A finance_clerk or tenant_admin then records the routine zero fee, and the paid -> registered system transition marks the victim deceased and revokes their active ID. (2) A registry_clerk (holds service.create) POSTs /service_request {category:'letter', status:'issued', issued_at:now(), resident_id:<any>, letter_summary:'<any text>'}. The token trigger assigns a verification_token, and the anonymous verify_service_letter() RPC returns the letter as genuine. Nobody verified, approved, charged for or issued it.
- **Impact:** A single clerk can forge civil-registration outcomes (deaths, births, marriages, divorces recorded as 'registered') and publicly verifiable official letters without the maker-checker, payment or issuance gates. Nothing is recorded in workflow_status_history, and the only audit trace is whatever the client chooses to write.
- **Recommendation:** Extend enforce_workflow_insert() to vital_event and service_request (allow only 'draft'/'submitted'). Require actor columns other than requested_by to be NULL at insert. Attach it as zz_enforce_workflow_insert on both tables in the same deploy unit. Add an AFTER INSERT history/audit row for every workflow table so creation is logged.
- **Effort:** S · **Status:** Open

### WP-WF-004
**Approved content is not frozen: the subject of an approved request (resident, event type, event details, letter subject) can be changed before the side effect fires**  
Severity **High** · Confidence Confirmed · Category Business Logic · Reported by `audit-workflows` · Verification: verified · Merged: WP-AZ-002, WP-APP-002
  
Refs: insa: MC-02, BL-02; owasp_top10: A04:2021, A08:2021; owasp_api: API6:2023, API3:2023; asvs: V11.1.1, V11.1.4; iso27001: A.8.26; nist_csf: PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N (6.5)
- **Evidence:** `supabase/migrations/00000000000070_mint_guard_deceased_check.sql:120` — `NEW.woreda_id, NEW.resident_id, NEW.issuing_kebele_id,  -- the ID card is minted for whatever resident_id the row holds at payment time`; `supabase/migrations/00000000000046_task10_credential_lifecycle.sql:31` — `pin_credential_identity_fields(): pins only credential_number, serial_number, qr_payload on residence_credential`; `supabase/migrations/00000000000033_task2_followup_pin_and_rental_scope.sql:66` — `IF OLD.resident_id IS NOT NULL  -- NULL -> value is allowed; event_type / event_details are never pinned`; `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:91` — `IF NEW.event_type = 'death' AND NEW.status = 'registered' ...  -- side effect keyed on the current event_type/resident_id`; `supabase/migrations/00000000000000_baseline.sql:1569` — `CREATE POLICY credential_request_update ... user_has_any_perm('{credential.issue,credential.approve,credential.verify,payment.collect,revenue.collect}')`; `supabase/migrations/00000000000089_rental_review_round6_fixes.sql:157` — `OR NEW.resident_id IS DISTINCT FROM OLD.resident_id  -- rental locks checklist-signed fields once verified; no equivalent elsewhere`
- **Description:** The engine polices status changes only. Any column that is not the status or an actor column can be rewritten by any holder of the table's UPDATE policy at any stage, including after approval. There is no pin trigger for credential_request (resident_id, request_type, credential_type, issuing_kebele_id), vital_event (event_type, event_details, event_date, household_id; resident_id is pinned only once non-null), service_request (resident_id, subject, purpose, addressed_to), or residence_credential (resident_id, expiry_date, issue_date, credential_type). The mint trigger, the birth/death side effects and the letter render all read these columns when the side effect fires, not the values that were verified and approved. The rental module already solved this: after verification it locks the verified fields.
- **Attack scenario:** (a) After a supervisor approves a credential request for resident A, a registry_clerk (or a viewer, see WP-WF-005) PATCHes resident_id=B. When the fee is recorded, the mint issues B's ID card. B was never verified or approved (the mint guard only checks age, photo, phone and status). (b) On an approved birth event (resident_id is NULL until registration), a clerk holding civil.verify PATCHes {event_type:'death', resident_id:<victim>}. The precondition re-check passes, and on payment the victim is marked deceased and their ID revoked. (c) A clerk PATCHes residence_credential.expiry_date to a later date for an active card. Staff lookups and renewal logic then see the forged expiry.
- **Impact:** Verification and approval can be applied to one subject and the outcome to another: ID cards for unapproved residents, deaths recorded against people nobody reviewed, and letters rendered for someone else.
- **Recommendation:** Add a pin trigger per workflow table that rejects changes to subject columns once status has left draft/submitted/under_review/returned. Use the rental guard in migration 89 as the template. Also pin residence_credential.resident_id, issue_date, expiry_date and credential_type once the row exists.
- **Effort:** M · **Status:** Open

### WP-WF-006
**Registered deaths are neither complete nor irreversible: only 'active' credentials are revoked, and any resident.update holder can set the deceased resident back to active**  
Severity **High** · Confidence Confirmed · Category Business Logic · Reported by `audit-workflows` · Verification: verified · Merged: WP-AZ-002
  
Refs: insa: BL-02, MC-03; owasp_top10: A04:2021; owasp_api: API6:2023; asvs: V11.1.1; iso27001: A.8.26, A.5.3; nist_csf: PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N (6.5)
- **Evidence:** `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:94` — `UPDATE public.resident SET residency_status = 'deceased' ...`; `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:99` — `SET status = 'revoked', ... WHERE resident_id = NEW.resident_id AND status = 'active' ...  -- suspended/ready_to_print/printing/printed survive`; `supabase/migrations/00000000000000_baseline.sql:1627` — `CREATE POLICY resident_update ... user_has_any_perm('{resident.update}')  -- no trigger guards residency_status`; `src/components/residents/ResidentActions.tsx:132` — `.update({ residency_status: "active" })  -- client reactivation path; DB accepts deceased -> active too`; `supabase/migrations/00000000000025_workflow_engine.sql:534` — `('residence_credential','suspended','active','credential.suspend',...)  -- no residency check on lift`; `supabase/migrations/00000000000025_workflow_engine.sql:531` — `('residence_credential','printed','active','credential.activate',...)  -- handover not re-checked against death`
- **Description:** apply_death_on_approval() (latest definition in migration 59) runs atomically inside the paid -> registered system transition, and it is idempotent. But (1) it revokes only credentials whose status is 'active'. A suspended card, or one at ready_to_print/printing/printed, survives the death. suspended -> active (credential.suspend) and printed -> active (credential.activate) do not re-check residency. The print eligibility check at ready_to_print->printing does, but a card that is already printed is not re-checked. (2) resident.residency_status is ordinary data. Any holder of resident.update (registry_clerk, civil_registrar, tenant_admin) can PATCH 'deceased' back to 'active'. No trigger ties the change to the registered death event, requires a reason, or writes an audit row (resident only has an AFTER INSERT audit trigger).
- **Attack scenario:** A resident's card is suspended when they die. After registration, a supervisor lifts the suspension (suspended -> active) and the deceased person has a valid, publicly verifiable ID. Or a registry_clerk PATCHes resident.residency_status='active' on a deceased resident. The mint guard's deceased check (migration 70) then passes, and a new ID can be requested and issued for the dead person.
- **Impact:** The death outcome can be reversed without authorisation or trace, and IDs of deceased residents can stay or become valid. This is an identity-fraud risk.
- **Recommendation:** Revoke every non-terminal credential of the deceased (ready_to_print, printing, printed, active, suspended) in apply_death_on_approval(). Block suspended->active and printed->active when the resident is deceased. Add a BEFORE UPDATE trigger on resident that forbids leaving 'deceased' unless a system context set by an authorised correction workflow is present, with a reason and an audit row.
- **Effort:** M · **Status:** Open

### WP-WF-007
**Death finalisation fails when the fee is recorded by a finance_clerk (nested revocation needs credential.revoke), leaving an orphaned payment and receipt; revocation audit rows have no woreda or actor**  
Severity **Medium** · Confidence Needs-live-verification · Category Business Logic · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: BL-02, LOG-01; owasp_top10: A04:2021, A09:2021; asvs: V7.1.3; iso27001: A.8.15; nist_csf: DE.CM-09

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L (5.4)
- **Evidence:** `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:239` — `PERFORM set_config('app.system_transition', 'on', true); UPDATE public.vital_event SET status = 'registered' ...`; `supabase/migrations/00000000000025_workflow_engine.sql:533` — `('residence_credential','active','revoked','credential.revoke',false,...)  -- not is_system: checked with user_has_perm(auth.uid())`; `supabase/migrations/00000000000083_rental_phase5_checkpoint.sql:107` — `WHEN 'finance_clerk' THEN ARRAY[...,'civil.record_payment',...]  -- no credential.revoke`; `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:108` — `INSERT INTO public.audit_log (entity_name, entity_id, action_type, new_value_json)  -- no woreda_id, no actor`; `src/routes/woreda.civil.$eventId.tsx:1264` — `.from("payment").insert(...)  -- payment, receipt and paid transition are three separate calls`
- **Description:** The death side effect revokes credentials with a plain UPDATE of residence_credential. That fires zz_enforce_workflow_transition on residence_credential. active -> revoked is not a system row, so the engine checks user_has_perm('credential.revoke') for auth.uid(), which is the user who recorded the civil fee. The system GUC does not exempt non-system rows. finance_clerk holds civil.record_payment but not credential.revoke, so for a deceased resident with an active card the whole paid transition rolls back. The payment and receipt were already committed by earlier client calls, so they are left behind. The side effect's own audit_log and credential_status_history inserts omit woreda_id and the actor, so tenant-scoped audit views (woreda_id = get_user_woreda_id()) do not show them.
- **Attack scenario:** Not an attack: a routine death registration processed by the cashier fails with 'requires credential.revoke'. The operational workaround is to have tenant_admin record the payment, which concentrates approve, cash and revoke powers in one account.
- **Impact:** Death registrations stall, confirmed payments and receipts are orphaned, SoD is pushed toward tenant_admin, and revocations caused by death do not appear in the woreda audit view.
- **Recommendation:** Perform the death revocation under a dedicated system context: add an is_system row for active->revoked driven only by the death trigger, or have the trigger set the GUC and the engine accept it for that one edge. Include woreda_id and the actor in every side-effect audit and history insert. Move payment + receipt + status change into one SECURITY DEFINER RPC (see WP-WF-009).
- **Effort:** S · **Status:** Open

### WP-WF-008
**Divorce events cannot be paid or registered (no fee mapping), and marriage/divorce registration has no side effects and minimal party validation**  
Severity **Medium** · Confidence Likely · Category Business Logic · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: BL-02; owasp_top10: A04:2021; asvs: V11.1.3, V5.1.3; iso27001: A.8.26; nist_csf: PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L (5.4)
- **Evidence:** `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:401` — `WHEN 'marriage' THEN 'Civil Registration - Marriage' ELSE NULL  -- no 'divorce'`; `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:411` — `RAISE EXCEPTION 'resolve_civil_fee: unknown event_type %'`; `supabase/migrations/00000000000066_payment_hardening_review_fixes.sql:100` — `WHEN 'marriage' THEN 'Civil Registration - Marriage' END  -- fee guard: divorce -> v_expected NULL -> raises`; `supabase/migrations/00000000000000_baseline.sql:618` — `vital_event_event_type_check ... 'birth','death','marriage','divorce'`; `src/routes/woreda.civil.$eventId.tsx:188` — `supabase.rpc("resolve_civil_fee", { _event_type: eventType! })`
- **Description:** Divorce is a legal event_type with a creation form (woreda.civil.divorce.new.tsx). But neither resolve_civil_fee() nor the exact-match fee guard maps it to a fee_schedule row, so the payment card errors and no civil_registration_fee payment can be inserted. A divorce can reach approved/awaiting_payment but never paid/registered. Marriage and divorce also have no registration side effects (resident.marital_status is never updated). The only party validation is that a supplied spouse resident_id belongs to the woreda. Nothing checks that the spouses are distinct, alive, adult, not already married (marriage) or actually married to each other (divorce). Free-text parties without a resident_id are accepted.
- **Attack scenario:** Functional: every divorce registration dead-ends at awaiting_payment. Integrity: a marriage can be registered between a resident and themselves, or with a deceased resident.
- **Impact:** A statutory civil event cannot be completed, and registered marriages/divorces are not reflected in, or checked against, the resident registry.
- **Recommendation:** Add a 'Civil Registration - Divorce' fee row, and map it in resolve_civil_fee(), validate_credential_fee_amount() and check:fee-catalog. Add marriage/divorce preconditions (distinct residents, alive, age >= 18, current marital status) and a side effect that updates marital_status at 'registered'.
- **Effort:** S · **Status:** Open

### WP-LOC-012
**'Today' comes from the UTC date: registration dates, the 'not in the future' checks and rent payment dates are one day behind from 00:00 to 03:00 EAT**  
Severity **Low** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-01

- **Evidence:** `src/routes/woreda.civil.birth.new.tsx:35` — `const todayIso = () => new Date().toISOString().slice(0, 10);`; `src/routes/woreda.civil.birth.new.tsx:100` — `registration_date: todayIso(),`; `src/lib/residentSchema.ts:5` — `const todayIso = () => new Date().toISOString().slice(0, 10);`; `src/routes/woreda.rental-accounts.$occupancyId.tsx:303` — `_payment_date: new Date().toISOString().slice(0, 10),`; `src/routes/woreda.rental-accounts.$occupancyId.tsx:526` — `_payment_date: new Date().toISOString().slice(0, 10),`; `src/routes/woreda.reports.index.tsx:66` — `const TODAY = new Date().toISOString().slice(0, 10);`
- **Description:** new Date().toISOString().slice(0,10) returns the UTC calendar date. Between 00:00 and 03:00 EAT that is the previous day. Affected: the default registration_date and the 'cannot be in the future' checks on all four civil forms and the resident schema (so a birth on today's date would be rejected in that window), the _payment_date passed to settle_rent_payment and settle_arrears_installments, the dashboard's 'revenue today' query (dashboard.tsx:279), and the reports page's TODAY upper bound. TODAY is also a module-level constant, so it goes stale if the tab stays open past midnight. Office hours make the practical window small, but the offline queue (offlineSync.ts:241 uses the same pattern) can replay entries at any hour.
- **Attack scenario:** Not a security exploit.
- **Impact:** Occasional off-by-one registration and payment dates, and rejected same-day births, at night or during offline replay.
- **Recommendation:** Use a single todayLocalIso() helper based on local getters (see WP-LOC-001) everywhere, and compute TODAY inside the component. For authoritative dates such as payment_date, prefer letting the server default to (now() AT TIME ZONE 'Africa/Addis_Ababa')::date.
- **Effort:** S · **Status:** Open

## Module: Credentials

### WP-WF-003
**Maker != checker compares stale actor columns: after a return cycle, one user can re-verify and approve the same credential, civil or service request**  
Severity **High** · Confidence Confirmed · Category Business Logic · Reported by `audit-workflows` · Verification: verified
  
Refs: insa: MC-01; owasp_top10: A04:2021, A01:2021; owasp_api: API6:2023; asvs: V11.1.2, V1.11.2; iso27001: A.5.3; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N (6.5)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1214` — `AND (to_jsonb(NEW) ->> col) IS DISTINCT FROM (to_jsonb(OLD) ->> col) THEN  -- force_actor_columns pins only a changed, non-null value`; `supabase/migrations/00000000000046_task10_credential_lifecycle.sql:154` — `'workflow: verified_by_user_id cannot be cleared once recorded'`; `supabase/migrations/00000000000046_task10_credential_lifecycle.sql:219` — `IF v_approver = v_verifier THEN  -- compares whatever the columns hold, not who acted in this cycle`; `supabase/migrations/00000000000025_workflow_engine.sql:516` — `('credential_request','pending_approval','returned', 'credential.return', ... 're-enters verification')`; `supabase/migrations/00000000000027_workflow_abandon_paths.sql:49` — `('credential_request','approved','returned','credential.return',false,`; `supabase/migrations/00000000000058_task14a_civil_registration_fsm.sql:174` — `('vital_event', 'pending_approval',  'returned', 'civil.return', ...)`
- **Description:** The generic engine never requires that the user who moves a row into 'verified' is recorded as verified_by_user_id. It also forbids clearing the actor columns, and force_actor_columns() only re-pins a column when the caller sends a new non-null value. After any return (verified/pending_approval/approved/awaiting_payment -> returned for credentials, pending_approval -> returned for civil and services), verified_by_user_id and approved_by_user_id keep the previous cycle's values. The approval check then compares the current approver with a verifier who may not have acted in this cycle. It also does not check requester != approver for these three entities, and the DB does not require the verification checklist (rental does both).
- **Attack scenario:** Cycle 1: clerk V verifies a credential request (verified_by=V), and an approver returns it. Cycle 2: tenant_admin T (holds credential.review and credential.approve) PATCHes returned->under_review->verified without sending verified_by_user_id, so it stays V. T then PATCHes verified->pending_approval->approved with approved_by_user_id=T. The check sees T != V and passes, although T performed both the verification and the approval. If the request had been approved before, T can also omit approved_by_user_id: the stale approver from cycle 1 stays on record and the approval is attributed to the wrong person. For service requests a supervisor holds both service.verify and service.approve by default.
- **Impact:** The four-eyes control on ID issuance, civil registration and letters can be defeated by one person with both verbs (tenant_admin by default; supervisor for services; anyone via user_permission_override), and the approval record can name someone who did not approve.
- **Recommendation:** Do what migration 89 already does for rental. In enforce_workflow_transition(), on entry into 'verified' require NEW.verified_by_user_id = auth.uid(). On entry into 'approved' require NEW.approved_by_user_id = auth.uid(), NEW.approved_by_user_id <> NEW.verified_by_user_id, and NEW.approved_by_user_id <> NEW.requested_by_user_id. Reset both columns (through a system context) on every transition into 'returned'. Enforce the verification checklist in the database.
- **Effort:** M · **Status:** Open

### WP-WF-005
**credential_request UPDATE policy gives write access to read-only roles (viewer, auditor via credential.verify) and to finance_clerk**  
Severity **High** · Confidence Likely · Category AuthZ · Reported by `audit-workflows` · Verification: verified · Merged: WP-AZ-003
  
Refs: insa: MC-02, RBAC-01; owasp_top10: A01:2021; owasp_api: API5:2023, API3:2023; asvs: V4.1.3, V4.2.1; iso27001: A.5.15, A.8.2; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N (6.5)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1569` — `CREATE POLICY credential_request_update ... user_has_any_perm('{credential.issue,credential.approve,credential.verify,payment.collect,revenue.collect}')`; `supabase/migrations/00000000000083_rental_phase5_checkpoint.sql:109` — `WHEN 'viewer' THEN ARRAY['resident.read',...,'credential.verify',...]`; `supabase/migrations/00000000000083_rental_phase5_checkpoint.sql:108` — `WHEN 'auditor' THEN ARRAY[...,'credential.verify',...]`; `supabase/migrations/00000000000025_workflow_engine.sql:34` — `'credential.verify' already gates the public ID-lookup screen and is deliberately held by viewer and auditor`; `supabase/migrations/00000000000000_baseline.sql:1569` — `credential_request_update ... '{credential.issue,credential.approve,credential.verify,payment.collect,revenue.collect}'` (via WP-AZ-003); `supabase/migrations/00000000000000_baseline.sql:1560` — `cred_req_history_insert ... user_has_any_perm(ARRAY['credential.issue','credential.approve','credential.verify',...])` (via WP-AZ-003)
- **Description:** The baseline credential_request_update policy is still the latest definition. It admits any user holding credential.verify, which migration 25 itself describes as the public ID-lookup permission held by the read-only viewer and auditor roles, and also payment.collect/revenue.collect holders. The FSM stops these users from changing status, but they can rewrite every other column: resident_id, request_type, credential_type, issuing_kebele_id, verification_checklist, return_reason/reject_reason and payment_id. They can also claim verified_by_user_id, which force_actor_columns pins to them, so a read-only user can be recorded as the request's verifier.
- **Attack scenario:** An auditor PATCHes /credential_request?credential_request_id=eq.<approved-id> {resident_id:<other resident>}. The request is later paid and the card is minted for the other resident (see WP-WF-004). Or a viewer PATCHes verified_by_user_id on a request that the approver verified personally. The pin records the viewer as verifier, and the approver's self-approval then passes the maker != checker check.
- **Impact:** In-tenant privilege escalation: roles meant to be read-only can change ID issuance requests, and a read-only user can stand in as the second person in the four-eyes control.
- **Recommendation:** Rewrite credential_request_update to require the workflow verbs that actually need row writes (credential.submit/review/resubmit/return/reject/approve/record_payment/confirm_print/activate), and never credential.verify. Review residence_credential_update the same way (see WP-WF-012). Then fix WP-WF-004 so that even legitimate updaters cannot change subject fields after verification.
- **Effort:** S · **Status:** Open

### WP-AZ-006
**print_officer is a built-in role that cannot be assigned and cannot perform its own duties; granular FSM verbs are insufficient without coarse RLS keys, which pushes tenants toward over-privileged roles**  
Severity **Medium** · Confidence Confirmed · Category AuthZ · Reported by `audit-authz` · Verification: not individually re-verified (Medium sample FP rate 0/10) · Merged: WP-WF-012
  
Refs: insa: RBAC-01, B-04; owasp_top10: A04:2021; asvs: V4.1.3; iso27001: A.5.15, A.8.2; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:L/A:N (3.8)
- **Evidence:** `src/config/permissions.ts:455` — `print_officer: [ CREDENTIAL_READ, CREDENTIAL_VIEW, CREDENTIAL_PREVIEW_PRINT, CREDENTIAL_CONFIRM_PRINT, CREDENTIAL_AUTHORIZE_REPRINT, CREDENTIAL_ACTIVATE, APPROV`; `supabase/migrations/00000000000000_baseline.sql:1622` — `residence_credential_update ... '{credential.issue,credential.approve,credential.print,credential.revoke,credential.renew}'  -- print_officer holds none`; `supabase/migrations/00000000000025_workflow_engine.sql:528` — `('residence_credential','ready_to_print','printing','credential.preview_print',...)`; `supabase/functions/sign-credential/index.ts:122` — `_perm: "credential.print",  -- print_officer cannot sign`; `src/routes/woreda.credentials.$requestId.print.tsx:59` — `permission={P.CREDENTIAL_PRINT}`; `src/components/settings/UsersRolesTab.tsx:69` — `const EDITABLE_ROLES = [ registry_clerk, civil_registrar, finance_clerk, supervisor, auditor, viewer ]  -- no print_officer`
- **Description:** print_officer exists in the Role type, default_role_perms(), the app_user role whitelist and the new-woreda backfill trigger. It is absent from every assignment surface: the tenant user editor, the role-permission matrix and invite-tenant-user's allow-list. Even if assigned by direct SQL, its grants are all granular FSM verbs. Moving a card through printing/printed/active needs both the FSM key and the coarse UPDATE policy key (credential.issue/approve/print/...), and the page and signing function require credential.print. A custom role built from the same granular verbs fails the same way. credential.record_payment alone likewise cannot update credential_request without payment.collect.
- **Attack scenario:** Not an attack. A tenant that needs dedicated print staff has to give them registry_clerk or civil_registrar. Those roles also carry resident.create/update, credential.issue, household writes and service-request powers, which is the opposite of least privilege.
- **Impact:** Least privilege cannot be implemented for the print/handover stage. B-04 boundaries in the documentation do not match what the database lets each role do.
- **Recommendation:** Add the granular verbs to the coarse UPDATE policies, or better, replace coarse UPDATE with per-transition DEFINER RPCs. Accept credential.preview_print/confirm_print in sign-credential and the print route. Add print_officer to EDITABLE_ROLES, the matrix and ALLOWED_ROLES, or remove the role.
- **Effort:** S · **Status:** Open

### WP-CRY-002
**In-portal staff scanner shows 'Verified' on the signature alone; the revocation (live-status) check is an optional button**  
Severity **Medium** · Confidence Confirmed · Category Business Logic · Reported by `audit-crypto-qr` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: CRY-03; owasp_top10: A04:2021; asvs: V11.1.1; iso27001: A.8.26; nist_csf: PR.AA-01

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:L/UI:R/S:U/C:N/I:L/A:N (2.6)
- **Evidence:** `src/components/verification/HararildScanner.tsx:297` — `const isVerifiedOk = result && result.valid && !result.expired;`; `src/components/verification/HararildScanner.tsx:414` — `{isVerifiedOk ? ( <SuccessPanel ... onCheckLive={checkLiveStatus} ... />`; `src/components/verification/HararildScanner.tsx:482` — `<Badge className="gap-1 bg-emerald-600 ..."> ... የተረጋገጠ ትክክለኛ መታወቂያ / Verified`; `src/components/verification/HararildScanner.tsx:249` — `const checkLiveStatus = useCallback(async () => { ... rpc("verify_credential_token", { _token: result.payload.credentialNumber })`
- **Description:** /woreda/credentials/verify (HararildScanner) shows a green 'Verified' badge once the signature and printed expiry pass. The registry status is fetched only if the officer clicks the live-check button. A revoked or replaced card therefore looks verified to staff unless they take an extra step. The live check uses the bare credential number, which verify_credential_token() matches only for the caller's own woreda. A card from another woreda returns 'Credential not found in registry' next to the green badge.
- **Attack scenario:** A counter officer scans a revoked card during a service transaction, sees the green 'Verified' badge, and serves the holder without clicking the live-check button.
- **Impact:** Staff-side revocation enforcement depends on user diligence, not design.
- **Recommendation:** Run the live check automatically when online. Show 'Verified' only when the live status is 'active'. Label the offline state 'signature valid, status unknown (offline)'. Show a neutral 'issued by another woreda' message instead of 'not found' for cross-woreda cards.
- **Effort:** S · **Status:** Open

### WP-API-012
**sign-credential reads resident, household and kebele by foreign key without re-pinning them to the credential's woreda**  
Severity **Low** · Confidence Likely · Category Tenant Isolation · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: TEN-02, CRY-02; owasp_top10: A01:2021; owasp_api: API1:2023; asvs: V4.2.1; iso27001: A.8.3; nist_csf: PR.DS-01

- **Evidence:** `supabase/functions/sign-credential/index.ts:159` — `.from("resident").select("resident_number, full_name, sex, date_of_birth, current_household_id").eq("resident_id", cred.resident_id)`; `supabase/functions/sign-credential/index.ts:174` — `.from("kebele").select("kebele_name_en").eq("kebele_id", cred.issuing_kebele_id)`; `supabase/migrations/00000000000013_receipt_verification.sql:128` — `-- Every joined table is re-pinned to r.woreda_id explicitly (not just left to follow the FK chain)`
- **Description:** The function runs as service_role and trusts the FK chain. With single-column FKs (WP-DB-012), a residence_credential whose resident_id or issuing_kebele_id points into another woreda would have that woreda's resident name, DOB and house number signed into a QR payload and printed. verify_receipt already applies the stricter pattern.
- **Attack scenario:** Depends on a cross-tenant reference being creatable upstream (see WP-DB-012); not demonstrated end-to-end.
- **Impact:** Defence-in-depth gap on the most legally significant output of the system.
- **Recommendation:** Add .eq("woreda_id", cred.woreda_id) to the resident, household and kebele lookups and return 409 on mismatch.
- **Effort:** S · **Status:** Open

### WP-BQ-014
**Monolithic route components concentrate complexity and suppressions in the credential workflow**  
Severity **Info** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)

- **Evidence:** `src/routes/woreda.credentials.$requestId.index.tsx:1` — `2,988 lines; 13 eslint-disable; 9 any`; `src/routes/woreda.credentials.$requestId.print.tsx:1` — `1,973 lines`
- **Description:** Largest files: credentials.$requestId.index 2,988, credentials print 1,973, settings.woreda-configuration 1,521, UsersRolesTab 1,411, civil.$eventId 1,400 lines (58.5k non-generated source lines total).
- **Impact:** Hard to review; workflow-transition logic and UI are interleaved.
- **Recommendation:** Extract per-stage action panels and data hooks from the credential detail route.
- **Effort:** L · **Status:** Open

### WP-CRY-009
**Credential number: Luhn is implemented correctly; residual properties noted (09/90 transposition blind spot, Gregorian UTC year, per-woreda uniqueness)**  
Severity **Info** · Confidence Confirmed · Category Business Logic · Reported by `audit-crypto-qr` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: BL-01

- **Evidence:** `supabase/migrations/00000000000002_credential.sql:36` — `FOR i IN 1..length(_digits) LOOP ... IF i % 2 = 1 THEN v_digit := v_digit * 2; IF v_digit > 9 THEN v_digit := v_digit - 9; ... RETURN (10 - (v_sum % 10)) % 10;`; `supabase/migrations/00000000000002_credential.sql:98` — `INSERT INTO public.credential_number_sequence(...) ON CONFLICT (woreda_id, seq_year) DO UPDATE SET last_value = ... + 1 RETURNING last_value INTO v_next;`; `supabase/migrations/00000000000002_credential.sql:96` — `v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;`; `supabase/migrations/00000000000000_baseline.sql:592` — `UNIQUE (woreda_id, credential_number)`; `supabase/migrations/00000000000029_workflow_insert_guard.sql:36` — `residence_credential may only be INSERTed at 'ready_to_print' ... ONLY from generate_residence_credential_on_payment()`; `docs/audit/2026-09-24/raw/crypto-qr-luhn-vectors.txt:1` — `8 vectors, all valid under an independent Luhn validator; textbook 7992739871 -> 3; 0/117 single-digit errors undetected`
- **Description:** luhn_check_digit() is a correct mod-10 Luhn: it doubles from the rightmost body digit and always yields 0-9, so the mod-11 'check value 10' problem does not arise. The 12-digit body is WW KK YY NNNNNN. NNNNNN is allocated per (woreda, year) by an atomic upsert, which is race-safe and serialised by row lock. Numbers are immutable after assignment (migration 46) and cannot be client-supplied, because only the mint trigger may INSERT residence_credential (migration 29) and it passes no number. Residual properties: Luhn misses the 09<->90 adjacent transposition (vector shown). YY is the Gregorian year of NOW() in UTC, so cards issued between 00:00 and 03:00 on 1 January EAT get the previous year's YY. Uniqueness is (woreda_id, credential_number), which is globally unique only while woreda_numeric_code stays unique and unchanged (UNIQUE exists, but super_admin can edit it). credential_number_sequence is writable by tenant staff (WP-DB-006): resetting it causes UNIQUE violations and blocks minting, but cannot create duplicates.
- **Attack scenario:** None directly.
- **Impact:** Informational.
- **Recommendation:** Make woreda.woreda_numeric_code immutable once any credential exists. Decide whether YY should be the EC year or the Africa/Addis_Ababa local year. Revoke client DML on credential_number_sequence (WP-DB-006).
- **Effort:** S · **Status:** Open

## Module: QR

### WP-CRY-001
**Public ID-card verifier fails open: a revoked card can be shown as 'Verified' by re-encoding its token, or whenever the registry lookup misses or errors**  
Severity **High** · Confidence Confirmed · Category Crypto · Reported by `audit-crypto-qr` · Verification: verified
  
Refs: insa: CRY-03, E-03; owasp_top10: A04:2021, A08:2021; owasp_api: API8:2023; asvs: V6.2.1, V11.1.1; iso27001: A.8.24, A.8.26; nist_csf: PR.DS-06, PR.AA-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:H/A:N (6.5)
- **Evidence:** `src/utils/harariCredentialCrypto.ts:100` — `function base64UrlDecodeToBytes(input) { ... const bin = atob(b64); ... }  // lenient: trailing bits ignored, no canonical re-encode check`; `src/utils/harariCredentialCrypto.ts:194` — `const ok = await crypto.subtle.verify(CREDENTIAL_SIGN_PARAMS, key, signature..., signingInput...)  // accepts high-S and non-canonical encodings`; `supabase/migrations/00000000000034_task3_harden_credential_verification.sql:245` — `WHERE rc.qr_payload = _token   -- exact string match on the whole token incl. signature`; `supabase/migrations/00000000000034_task3_harden_credential_verification.sql:253` — `IF NOT FOUND THEN INSERT INTO public.credential_verification_log (...) 'not_found' ...; RETURN;`; `src/routes/v.$token.tsx:179` — `const notFound = !registry && !data.registryError;`; `src/routes/v.$token.tsx:215` — `const withdrawn = !!registry && !expired && WITHDRAWN.includes(registry.status);`
- **Description:** The public page /v/$token first verifies the ES256 signature in the browser, then asks verify_credential_token() for the card's live status by exact string equality on the whole token (qr_payload = _token). The token string is not unique for a given signed payload. (a) The 64-byte signature is 86 base64url characters, and the last character carries 4 unused bits. atob() follows WHATWG forgiving-base64 and discards those bits, so 15 other last characters decode to the same signature. (b) ECDSA signatures are malleable: (r, n-s) is also a valid signature, and WebCrypto verify() has no low-S rule. Both variants were reproduced with a throwaway P-256 key using the repo's own encode/decode code. A variant token passes the offline signature check, but the registry lookup matches nothing. The page then falls through every red and amber branch into the default green 'Verified genuine card' banner, with only a small grey note that the registry has no record. The same green banner appears whenever the RPC errors: network failure, rate-limit exhaustion (30 calls/min per source IP, which shared CGNAT egress makes easy to reach), or a deleted credential row. A forged token made with a leaked signing key also lands in this branch.
- **Attack scenario:** A resident's card is revoked (fraud, death, or replacement) and its RPC status is now 'invalid'. The holder, or anyone with a photo of the QR, changes the last character of the URL (for example ...Q to ...R) or computes n-s, then prints a new QR. A police officer, bank or landlord scans it with a phone camera. The page shows the green 'የተረጋገጠ ትክክለኛ መታወቂያ / Issued by the Harari Regional State' banner with the holder's name, card number, woreda, kebele and dates. No key and no special skill is needed.
- **Impact:** The only revocation control for relying parties on the public surface can be bypassed trivially. Revoked, replaced, suspended or expired-by-status cards verify as genuine and current. This defeats CRY-03 and undermines trust in every printed card.
- **Recommendation:** 1) Make the registry lookup independent of signature encoding: match on the signed payload segment (split_part(qr_payload,'.',1)) or on the credential number taken from the verified payload, and index that expression. 2) In the verifier, reject non-canonical base64url (re-encode and compare) and high-S signatures. 3) Make the page fail closed: show green only when registry?.status === 'active' and the card is not expired. 'Not found' must be red ('not recognised by the registry'). A registry error or rate-limit must be amber ('authenticity proven, current status unknown'), never green. 4) Alert on credential_verification_log 'not_found' rows whose payload segment matches an existing credential.
- **Effort:** S · **Status:** Open

### WP-CRY-003
**Signed QR payload is readable, unencrypted PII, and the whole token travels in the URL path and into verification logs**  
Severity **Medium** · Confidence Confirmed · Category Privacy · Reported by `audit-crypto-qr` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: CRY-02, PRV-01; owasp_top10: A02:2021, A04:2021; owasp_api: API3:2023; asvs: V8.3.1, V8.1.1; iso27001: A.5.34, A.8.11; nist_csf: PR.DS-01, PR.DS-02

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N (3.1)
- **Evidence:** `supabase/functions/sign-credential/index.ts:206` — `const payload = { c: ..., i: resident.resident_number, n: resident.full_name, g: ..., b: compactDate(resident.date_of_birth), w, k, h: houseNumber, s, e, p, t }`; `supabase/functions/sign-credential/index.ts:233` — `const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));  // encoding, not encryption`; `src/config/credentialCryptoConfig.ts:44` — `export function credentialVerifyUrl(token) { return '${CREDENTIAL_VERIFY_ORIGIN}/v/${token}'; }`; `supabase/migrations/00000000000034_task3_harden_credential_verification.sql:91` — `attempted_value text NOT NULL CHECK (length(attempted_value) <= 512),  -- stores the full token`; `src/routes/v.$token.tsx:21` — `Anonymous visitors see only enough to confirm a card is genuine. The photo and full date of birth come back solely for signed-in woreda staff`; `src/routes/v.$token.tsx:282` — `A withdrawn/invalid card reveals nothing beyond the banner ... showing the resident's name/woreda/kebele/dates ... would leak exactly the identity the collapse `
- **Description:** The token is base64url(JSON) plus a signature. Anyone who scans the QR can read the full name, date of birth, gender, resident number, house number, woreda, kebele and dates without any key. This contradicts the design comments: the DOB 'solely for staff' rule is enforced only on the RPC output, and the page's 'withdrawn card reveals nothing' collapse does not hide identity because the identity is in the URL. The QR encodes the full token in the URL path, so the PII is also recorded in hosting request logs (Vercel serves /v/<token>), browser history and screenshots. Every lookup also stores the full token in credential_verification_log.attempted_value. Any woreda staff member can read that log (RLS: woreda only, no permission check), and it has no retention policy.
- **Attack scenario:** A third party photographs the QR on a card left at a counter, decodes it offline, and gets DOB, house number and resident number. The same data is also retained in the hosting provider's request logs outside Ethiopia.
- **Impact:** The PII duplicates the card face, but it leaks through channels outside the database access-control model (hosting logs, history, log table). It also weakens the stated anonymous-caller minimisation.
- **Recommendation:** Minimise the signed payload to what offline verification actually needs: card number, expiry, a hash of the photo or of the name, and a version. Alternatively, keep the PII in the payload but put the token in the URL fragment (#), which is not sent to the server. Store a hash of the token (or only the payload hash) in credential_verification_log, add a retention job, and document the design decision in the PII inventory.
- **Effort:** M · **Status:** Open

### WP-OPS-003
**No documented custody, escrow or recovery for the two root keys (ES256 credential-signing key and the Vault pii_root_key)**  
Severity **Medium** · Confidence Confirmed · Category Crypto · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: CRY-01, OPS-01; owasp_top10: A02:2021; asvs: V6.4.1, V6.4.2; iso27001: A.8.24, A.8.13; nist_csf: PR.DS-01 (CSF 2.0)

- **CVSS:** N/A (key management process)
- **Evidence:** `supabase/migrations/00000000000023_pii_encryption.sql:100` — `LOSING THE KEY MEANS LOSING THE CIPHERTEXT. It is not recoverable from a backup of this database. Back it up wherever HARARI_EC_PRIVATE_KEY is kept.`; `scripts/phase-c-create-vault-key.sh:21` — `LOSING THIS KEY MEANS LOSING EVERY ROW OF CIPHERTEXT IT EVER ENCRYPTED. It is not recoverable from a database backup ... there is no "restore from backup" path `; `scripts/phase-c-create-vault-key.sh:9` — `THE KEY VALUE IS GENERATED INSIDE THIS SQL STATEMENT, BY POSTGRES ITSELF ... AND NEVER LEAVES THE DATABASE.`; `scripts/deploy-functions.sh:47` — `It is not in this repository -- it lives in the SOURCE project's Edge Function secrets ... supabase secrets set HARARI_EC_PRIVATE_KEY='<value from the old proje`; `docs/system-review-2026-09.md:436` — `**Key-rotation runbook** | ... no standalone procedure exists for 'HARARI_EC_PRIVATE_KEY'.`
- **Description:** The PII root key is generated inside Postgres and by design never leaves the database, yet the migration tells the operator to 'back it up wherever HARARI_EC_PRIVATE_KEY is kept', and no document says where that is. The signing key lives only in Edge Function secrets and is carried forward from an 'old project'. There is no key-custody record (who holds it, where escrowed, dual control), no recovery procedure and no rotation runbook. Keeping keys out of the repository is correct (SEC-01 passes); the gap is recovery.
- **Attack scenario:** Project deletion, a Vault reset or loss of the operator's only copy.
- **Impact:** Losing the Vault key makes every *_enc column permanently unreadable; the impact grows to total PII loss once stage 4 drops the plaintext columns. Losing the signing key stops verifiable credential issuance and forces a re-key, which the project's own review notes invalidates every card in circulation.
- **Recommendation:** Write a key-management procedure covering: generation, escrow of the ES256 private key in an offline HSM or sealed dual-control store held by the owning bureau, a Vault key export/escrow approach (or a documented decision to accept non-recoverability, with plaintext retained until an escrow exists), a rotation runbook with `kid` versioning, and annual recovery testing in staging.
- **Effort:** M · **Status:** Open

### WP-OPS-008
**Printed credentials and receipts encode a vendor shared subdomain (woredas-portal.vercel.app) as the public verification origin; there is no government-controlled domain**  
Severity **Medium** · Confidence Likely · Category Config · Reported by `ops-scope` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-04, A-06, CRY-03; owasp_top10: A05:2021; asvs: V14.1.1; iso27001: A.8.20, A.8.26; nist_csf: PR.AA (CSF 2.0), ID.AM-03 (CSF 2.0)

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:H/A:N (5.3)
- **Evidence:** `src/config/credentialCryptoConfig.ts:40` — `import.meta.env.VITE_PUBLIC_SITE_URL || "https://woredas-portal.vercel.app"`; `src/config/receiptVerify.ts:10` — `import.meta.env.VITE_PUBLIC_SITE_URL || "https://woredas-portal.vercel.app"`; `docs/security-hardening.md:89` — `Until a custom domain exists, none of the Cloudflare products can be attached to '*.vercel.app'.`; `docs/remediation-report.md:52` — `aliased to 'https://woredas-portal.vercel.app', HTTP 200`
- **Description:** The public verification surface, where citizens and third parties scan a printed ID card or receipt QR, is hosted on a name inside Vercel's shared vercel.app namespace. That name is also the compiled-in fallback whenever VITE_PUBLIC_SITE_URL is unset. Physical cards cannot be recalled, so the QR target is effectively permanent, but the government does not control the name: it depends on the Vercel project continuing to exist under the same account. The shared namespace also makes look-alike phishing hosts (woredas-portal-<anything>.vercel.app) trivial to create, and it rules out HSTS preload and a Cloudflare/WAF front, as the project's own documentation acknowledges.
- **Attack scenario:** The Vercel project is renamed, deleted, or lost with the account. Another party claims the freed project name and serves a clone of /v/$token that shows 'VALID' for any token. Forged cards then 'verify' when scanned with a phone camera, because the verifier page itself is attacker-controlled.
- **Impact:** Integrity of public credential verification for every card already printed. The same pattern also applies to receipts.
- **Recommendation:** Before mass printing, register a government-controlled domain (for example a *.gov.et subdomain), attach it to Vercel, set VITE_PUBLIC_SITE_URL and SITE_URL to it, and remove the vendor fallback so a build without the variable fails instead of silently encoding the vendor host. Consider an HSTS preload and CAA records on that domain.
- **Effort:** M · **Status:** Open

### WP-API-006
**Rate-limiting gaps: letter/receipt verification unlimited and unlogged; sign-credential, activate-invited-user and record-login unlimited; all limiters fail open**  
Severity **Low** · Confidence Confirmed · Category Config · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: E-06, CRY-03; owasp_top10: A04:2021; owasp_api: API4:2023, API6:2023; asvs: V11.1.4, V2.2.1; iso27001: A.8.6; nist_csf: PR.IR-04

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L (5.3)
- **Evidence:** `supabase/migrations/00000000000022_rate_limit.sql:11` — `-- Deliberately NOT covered: the two public verification RPCs`; `supabase/migrations/00000000000064_task14b_verify_letter_completed_status.sql:22` — `CREATE OR REPLACE FUNCTION public.verify_service_letter(_token text) ... LANGUAGE sql STABLE SECURITY DEFINER`; `supabase/migrations/00000000000013_receipt_verification.sql:134` — `CREATE OR REPLACE FUNCTION public.verify_receipt(_token text)`; `supabase/migrations/00000000000000_baseline.sql:1236` — `v_token := v_token || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);`; `supabase/functions/_shared/rateLimit.ts:31` — `console.error("rate_limit_hit failed (failing open):", error);       return { allowed: true };`; `supabase/migrations/00000000000034_task3_harden_credential_verification.sql:222` — `RAISE EXCEPTION 'Too many requests' USING ERRCODE = 'insufficient_resources';   -- surfaces as HTTP 503`
- **Description:** verify_service_letter and verify_receipt are anonymous DEFINER functions with no throttling and no attempt log (unlike verify_credential_token since migration 34). Their 12-character tokens (~60 bits) make blind enumeration impractical, but the tokens come from Postgres random(), not a CSPRNG (crypto auditor to assess). sign-credential, activate-invited-user and record-login have no limiter. Every limiter fails open by design, and the credential limiter keys on an IP that falls back to the client-controlled X-Forwarded-For first hop and reports HTTP 503 rather than 429.
- **Attack scenario:** A scripted client hammers /rpc/verify_receipt or /rpc/verify_service_letter with random tokens, consuming database connections with nothing recorded; during a limiter outage the invite functions accept unlimited calls from a compromised admin session.
- **Impact:** Resource consumption and absence of forensic signal on two public endpoints.
- **Recommendation:** Move the three public RPCs behind one plpgsql wrapper pattern (limit + log) as done for verify_credential_token; add per-user limits to sign-credential; switch token generation to gen_random_bytes(); emit a PGRST-mapped 429 (RAISE ... USING ERRCODE = 'PGRST', with a {"code":"429"} message) instead of 53000/503.
- **Effort:** M · **Status:** Open

### WP-BQ-007
**Security-critical client logic has no tests; no coverage tooling**  
Severity **Low** · Confidence Confirmed · Category Quality · Reported by `audit-build-quality` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: QA-01, CRY-02; asvs: V1.1; iso27001: A.8.29; nist_csf: PR.IP

- **Evidence:** `vitest.config.ts:13` — `test: { environment: "jsdom", setupFiles: [...], globals: false }  // no coverage block`; `src/utils/harariCredentialCrypto.ts:1` — `0 test files import this module (public QR signature verification)`; `src/utils/barcode.ts:1` — `0 test files import this module (MIN_X_DIMENSION_UM density guard)`; `src/routes/__tests__/credential-print-preview-parity.regression.test.ts:1` — `import { readFileSync } from "node:fs";  // source-text regex assertions`
- **Description:** 23 test files / 202 tests cover permission resolution, auth redirect, error translation, offline queue, Ethiopian calendar and schemas. Untested: harariCredentialCrypto.ts, barcode.ts, security-headers.ts, tableExport.ts (CSV-injection guard), ModuleGate, PermissionGate; no pgTAP/SQL tests for RLS or the workflow FSM; no Edge Function tests. @vitest/coverage-* is not installed, so coverage cannot be measured.
- **Impact:** Regressions in QR verification, CSV-injection guard or security headers would pass CI.
- **Recommendation:** Add ES256 test vectors (valid/tampered/alg-confusion), CSV-injection, header and barcode-density tests; add @vitest/coverage-v8 with a threshold; consider pgTAP for RLS/FSM.
- **Effort:** M · **Status:** Open

### WP-CRY-004
**Credential signing key has no key identifier, versioning, rotation or compromise runbook; one platform-wide key**  
Severity **Low** · Confidence Confirmed · Category Crypto · Reported by `audit-crypto-qr` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: CRY-01; owasp_top10: A02:2021; asvs: V6.4.1, V6.4.2; iso27001: A.8.24; nist_csf: PR.DS-01, RS.MI-01

- **Evidence:** `src/config/credentialCryptoConfig.ts:5` — `The two halves move together: replacing one without the other silently invalidates every card already in circulation`; `src/config/credentialCryptoConfig.ts:14` — `export const CREDENTIAL_PUBLIC_KEY_PEM = '-----BEGIN PUBLIC KEY-----\nMFkw…[public key, not secret]`; `supabase/functions/sign-credential/index.ts:245` — `const token = '${payloadB64}.${base64UrlEncodeBytes(sig)}';  // no kid / version segment`; `src/utils/harariCredentialCrypto.ts:154` — `async function importPublicKey() { const pem = CREDENTIAL_PUBLIC_KEY_PEM ... }  // single key, no key set`; `docs/system-review-2026-09.md:436` — `Key-rotation runbook | ... no standalone procedure exists for HARARI_EC_PRIVATE_KEY`
- **Description:** The private key sits only in the sign-credential Edge Function secret HARARI_EC_PRIVATE_KEY. It does not appear in the working tree, in any of the 177 commits, or in the built client bundle (raw/crypto-qr-key-and-base64-scan.txt). That part passes. However, tokens carry no key identifier, and the verifier trusts exactly one compiled-in public key. A rotation, whether planned or after a compromise, therefore turns every card in circulation into a red 'Not a valid card / altered' result. If the key leaks, forged tokens with unknown numbers also reach the fail-open green branch described in WP-CRY-001. No written procedure exists for generation, custody, escrow, rotation or revocation of the key. Anyone who holds a Supabase PAT can read or replace the secret. One key signs for all woredas.
- **Attack scenario:** The key is exposed, for example through a PAT leak. The operator has no way to distrust the old key without invalidating every legitimate card, so the compromised key stays trusted.
- **Impact:** Key compromise cannot be recovered from without mass card reissue. Signing-key risk is not contained per tenant.
- **Recommendation:** Add a 1-2 character key id segment (kid.payload.sig) and have the verifier hold a key set with not-before and not-after dates per key. Document generation (offline, P-256, PKCS#8), custody, escrow (a sealed offline copy), rotation cadence and emergency procedure. Consider per-woreda or per-period keys.
- **Effort:** M · **Status:** Open

### WP-CRY-005
**QR payload has no format/status version, 'English-only' is not enforced, and iat is never checked**  
Severity **Low** · Confidence Confirmed · Category Crypto · Reported by `audit-crypto-qr` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: CRY-02, E-03; owasp_top10: A04:2021; asvs: V6.2.1; iso27001: A.8.24; nist_csf: PR.DS-06

- **Evidence:** `supabase/functions/sign-credential/index.ts:15` — `interface CompactPayload { c; i; n; g; b; w; k; h; s; e; p; t }  // no version / status field`; `supabase/functions/sign-credential/index.ts:209` — `n: resident.full_name ?? "",`; `src/lib/residentSchema.ts:7` — `const nameRegex = /^[\p{L}\p{M}\s]+$/u;  // accepts Ge'ez script for 'Full Name (English)'`; `supabase/migrations/00000000000000_baseline.sql:343` — `full_name text NOT NULL,  -- no Latin-only CHECK`; `src/utils/harariCredentialCrypto.ts:216` — `if (payload.expiryDate) { const exp = new Date(payload.expiryDate); if (... < Date.now()) expired = true; }  // iat (t) unchecked`
- **Description:** The signed payload is compact (215 bytes of JSON, 374-character token, 410-character URL; limit ~1.8 KB), so the size requirement passes. Canonicalisation is not needed because the signature covers the exact base64url bytes that the verifier checks before parsing. Gaps: (1) no payload format or status version, so a future schema change or status-epoch revocation cannot be expressed; (2) 'n' comes from resident.full_name. The client labels it 'Full Name (English)', but \p{L} accepts Amharic, and the database has no Latin-only CHECK. Records created by the birth-approval trigger bypass the client schema entirely. English-only is therefore not guaranteed. (3) The verifier never checks 't' (iat) for future-dating. Expiry is date-only and compared as UTC midnight.
- **Attack scenario:** Not directly exploitable. This limits future revocation design and payload hygiene.
- **Impact:** Low. Forward-compatibility and payload hygiene only.
- **Recommendation:** Add a version key (for example v:1). Transliterate or validate an ASCII-only English name at signing time and reject non-ASCII in sign-credential. Reject tokens whose t is in the future or later than the expiry.
- **Effort:** S · **Status:** Open

### WP-DB-013
**Public verification tokens: non-CSPRNG generation, client-chosen tokens accepted, letter token not pinned, real token quoted in a migration**  
Severity **Low** · Confidence Confirmed · Category Crypto · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10) · Merged: WP-CRY-008
  
Refs: insa: CRY-02, E-03; owasp_top10: A02:2021; asvs: V6.3.1, V6.3.2; iso27001: A.8.24; nist_csf: PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N (3.7)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1236` — `v_token := v_token || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);`; `supabase/migrations/00000000000000_baseline.sql:997` — `IF NEW.verification_token IS NULL OR NEW.verification_token = '' THEN NEW.verification_token := public.gen_letter_verification_token();`; `supabase/migrations/00000000000013_receipt_verification.sql:79` — `pin_receipt_verification_token() -- receipts are pinned; service_request.verification_token has no equivalent`; `supabase/migrations/00000000000064_task14b_verify_letter_completed_status.sql:12` — `full FSM to 'completed' (request ABOKER-SRV-26-00003, token SJ44…[REDACTED])`; `supabase/migrations/00000000000000_baseline.sql:1236` — `v_token := v_token || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);` (via WP-CRY-008); `supabase/migrations/00000000000013_receipt_verification.sql:28` — `v_token := v_token || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);` (via WP-CRY-008)
- **Description:** Letter and receipt tokens are 12 characters from a 32-symbol alphabet (about 60 bits), but they are drawn from random(), which is not a CSPRNG. The BEFORE INSERT triggers keep any token the client supplies. service_request.verification_token can be changed on UPDATE by any holder of the service.* permissions. A real production letter token is written verbatim in a migration comment. verify_service_letter returns the resident's name to anonymous callers.
- **Attack scenario:** An insider creates a letter with verification_token 'AAAAAAAAAAAA', which makes the resident's name trivially discoverable through the anonymous verify endpoint. Or they reassign the token of an already-printed letter so the paper copy no longer verifies.
- **Impact:** Low: weakens the integrity of the public verification surface and discloses a little PII.
- **Recommendation:** Generate tokens with extensions.gen_random_bytes and ignore client-supplied tokens. Add a pin trigger on service_request.verification_token. Remove the real token from the migration comment, and treat that letter's token as disclosed (regenerate it if it is a real resident's letter).
- **Effort:** S · **Status:** Open

### WP-PRV-009
**The QR token embeds DOB, sex, kebele and house number in readable base64 and travels in a URL path; the public verifier hides DOB but the payload discloses it**  
Severity **Low** · Confidence Confirmed · Category Privacy · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: CRY-02, A-03, PRV-01; owasp_top10: A04:2021; owasp_api: API3:2023; asvs: V8.3.1; iso27001: A.8.11; nist_csf: PR.DS-5

- **CVSS:** CVSS:3.1/AV:P/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N (2.4)
- **Evidence:** `supabase/functions/sign-credential/index.ts:206` — `const payload: CompactPayload = { c: ..., i: resident.resident_number, n: resident.full_name, g: ..., b: compactDate(resident.date_of_birth), w: ..., k: ..., h:`; `src/utils/harariCredentialCrypto.ts:119` — `function expandPayload(c) { return { ..., fullNameEnglish: c.n, gender: ..., dobGregorian: expandDate(c.b), kebele: c.k, houseNumber: c.h, ... } }`; `supabase/migrations/00000000000034_task3_harden_credential_verification.sql:300` — `CASE WHEN v_is_staff THEN v_row.photo_url END, CASE WHEN v_is_staff THEN v_row.date_of_birth END;  -- DOB withheld from anon here...`; `docs/dfd.md:73` — `Verifier -. "token only, no PII in request" .-> CredentialsDB`
- **Description:** The signed QR token is a base64url JSON payload, signed but not encrypted, containing full English name, sex, date of birth, woreda, kebele and house number. The QR encodes `${VITE_PUBLIC_SITE_URL}/v/<token>`. Anyone who scans the card can decode DOB and house number, and the full token then appears in the scanner's browser history, in hosting access logs as a URL path, and in credential_verification_log.attempted_value, which is kept forever (WP-PRV-006). verify_credential_token() deliberately returns DOB and photo only to staff callers. The payload makes that minimisation ineffective, and docs/dfd.md describes the request as carrying no PII. Most of these fields are also printed on the card, so the extra exposure is mainly the house number and the logging of the URL. Crypto-agent scope (CRY-02) owns the payload format; this finding records only the privacy aspect.
- **Attack scenario:** A shop or checkpoint that scans residents' cards keeps the decoded tokens and builds a DOB plus house-number list. Or: hosting request logs, retained by the provider, contain every scanned token.
- **Impact:** Low-grade over-disclosure of quasi-identifiers beyond what the verifier UI intends, and PII is replicated into URL-bearing logs.
- **Recommendation:** Drop the house number (h) from the payload and consider replacing DOB (b) with birth year or omitting it, since the online check already returns DOB to staff. Alternatively, put the token in the URL fragment (/v#<token>) so it is not sent to the server or kept in access logs, and have the page POST it to the RPC. Store a hash of attempted_value rather than the full token in credential_verification_log.
- **Effort:** M · **Status:** Open

## Module: Services

### WP-WF-002
**Service-request FSM ignores category: letters can take the complaint path (pending_approval -> in_progress -> resolved -> closed), which skips approval SoD and payment, and the public verifier accepts resolved/closed**  
Severity **High** · Confidence Confirmed · Category Business Logic · Reported by `audit-workflows` · Verification: verified
  
Refs: insa: MC-01, MC-02; owasp_top10: A04:2021; owasp_api: API6:2023; asvs: V11.1.1; iso27001: A.5.3; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N (6.5)
- **Evidence:** `supabase/migrations/00000000000061_task14b_service_request_fsm.sql:126` — `('service_request', 'pending_approval',  'in_progress',       'service.approve', false, 'As-built (complaint): ...')`; `supabase/migrations/00000000000061_task14b_service_request_fsm.sql:128` — `('service_request', 'in_progress',       'resolved',          'service.issue', ...)`; `supabase/migrations/00000000000061_task14b_service_request_fsm.sql:129` — `('service_request', 'resolved',          'closed',            'service.issue', ...)`; `supabase/migrations/00000000000061_task14b_service_request_fsm.sql:114` — `('service_request', 'under_review', 'pending_approval', 'service.verify', ... 'verify skips straight to pending_approval')`; `supabase/migrations/00000000000046_task10_credential_lifecycle.sql:204` — `IF NEW.status = 'approved' ...  -- maker != checker is evaluated only on entry into 'approved'`; `supabase/migrations/00000000000064_task14b_verify_letter_completed_status.sql:47` — `AND sr.status IN ('issued', 'resolved', 'closed', 'completed')`
- **Description:** workflow_transition is keyed by entity, not by service_request.category. Migration 61 seeded the complaint edges (under_review->pending_approval, pending_approval->in_progress, in_progress->resolved, resolved->closed, issued->closed) on the same entity as the letter FSM, and its own comments say they are meant only for complaints. The database cannot tell a letter from a complaint. The engine checks maker != checker only on entry into 'approved', and the payment and issuance gates fire only on 'paid' and 'issued', so a letter taken along the complaint edges skips all three. verify_service_letter() then accepts 'resolved' and 'closed' as valid verification states, and requires only a non-null issued_at, which any updater can set. The issued letter's content (letter_summary, subject, issued_letter_html, resident_id) is also not pinned after issuance, so a genuine issued letter can be edited later and still verify.
- **Attack scenario:** A tenant_admin alone, or a supervisor (service.verify + service.approve) working with any registry_clerk/civil_registrar (service.issue), PATCHes a fee-bearing letter request submitted -> under_review -> pending_approval -> in_progress -> resolved -> closed and sets issued_at in any update. The public /verify/letter/<token> page then reports it as an authentic issued letter. No verifier/approver separation is checked and no fee is collected. Separately, any service.* holder can PATCH letter_summary on an already-issued letter and change what the public page shows.
- **Impact:** Official letters (residence confirmation, clearance and similar) can be made publicly verifiable without approval or payment, and genuine letters can be altered after issuance. This undermines the letter verification surface and service-fee revenue.
- **Recommendation:** Make the FSM category-aware. Either split complaints into their own entity value in workflow_transition, or add a category predicate column that enforce_workflow_transition() matches. Remove 'resolved' and 'closed' from verify_service_letter() for category='letter'. Set issued_at and issued_by only inside the paid->issued transition, and add a pin trigger that freezes letter content columns once status reaches 'issued'.
- **Effort:** M · **Status:** Open

### WP-WF-015
**Service letter print route has no status or permission gate**  
Severity **Low** · Confidence Confirmed · Category AuthZ · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: MC-02; owasp_top10: A01:2021; owasp_api: API5:2023; asvs: V4.1.1; iso27001: A.8.26; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N (5.4)
- **Evidence:** `src/routes/woreda.services.$requestId.print.tsx:16` — `export const Route = createFileRoute("/woreda/services/$requestId/print")({  -- no PermissionGate in file`; `src/routes/woreda.services.$requestId.print.tsx:61` — `"request_number, subject, ..., issued_at, status, verification_token, ..."  -- status fetched but never checked`
- **Description:** The letter print page renders a complete official letter, including the woreda letterhead template and a verification QR, for any service request the user can read. It checks neither the status (submitted, rejected, unpaid) nor any permission. If issued_at is null it uses today's date.
- **Attack scenario:** Any woreda staff member (print_officer, viewer) opens /woreda/services/<id>/print for a request that was rejected or never paid and prints an official-looking letter. The QR fails online verification, but a reader who does not scan it is misled.
- **Impact:** Official-looking but unissued letters can be printed. Online verification limits the damage.
- **Recommendation:** Gate the route with PermissionGate (service.issue_letter) and render only when status IN ('issued','completed'), using issued_letter_html (the issuance snapshot) instead of re-rendering the live template.
- **Effort:** S · **Status:** Open

### WP-APP-010
**Letter sanitiser observations: sound in the browser, but in-house (not DOMPurify), with an SSR regex fallback that is bypassable, unvalidated style values, and a stored-but-unrendered issued_letter_html**  
Severity **Info** · Confidence Confirmed · Category XSS · Reported by `audit-appsec` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-02; owasp_top10: A03:2021; asvs: V5.2.1; iso27001: A.8.28

- **Evidence:** `src/lib/letterTemplate.ts:64` — `return html.replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");  // server fallback leaves <img onerror> intact`; `src/lib/letterTemplate.ts:87` — `.filter((d) => d && ALLOWED_STYLES.has(d.split(":")[0]!.trim().toLowerCase()))  // property allow-listed, value not`; `docs/audit/2026-09-24/raw/appsec-sanitiser-fuzz.txt:10` — `text-align:left\3b background:url(...) retained verbatim (inert in CSS; escaped ';' does not end a declaration)`; `src/routes/woreda.services.$requestId.index.tsx:296` — `issued_letter_html: issuedHtml || null,  // client-rendered snapshot; no reader renders it today`
- **Description:** A manual review of sanitizeLetterHtml plus 16 jsdom payloads (mXSS via svg/math/noscript/template/table foster-parenting, comment breakouts, entity-obfuscated javascript: URLs, event handlers, base/form/style injection, token-in-attribute breakout) found no browser-side bypass. The design helps: disallowed elements are collapsed to text nodes, only 29 HTML-namespace tags survive, hrefs are scheme-allow-listed after entity decoding, and token values are escaped after sanitisation. The remaining observations are hardening items. (a) The non-DOMParser fallback strips only five tags and would pass <img onerror> if ever called server-side. It is unreachable today because every route sets ssr:false. (b) Style values are not validated. (c) issued_letter_html is client-produced, client-mutable (WP-APP-002) and unread, which makes it a latent sink if a future screen renders it raw.
- **Impact:** None today. These are regression risks.
- **Recommendation:** Replace the walker with DOMPurify configured to the same allow-list (DOMPurify is already a transitive dependency via jspdf; pin it as a direct dependency). Make the fallback return escaped text, not partially-stripped HTML. Validate style values against an enum (left|right|center|justify, bold|normal, italic|normal, underline|none). Always re-sanitise issued_letter_html on read.
- **Effort:** S · **Status:** Open

## Module: Settings

### WP-APP-001
**Stored XSS: letter-template editor writes unsanitised service_type.letter_body_html into the live DOM via innerHTML**  
Severity **High** · Confidence Confirmed · Category XSS · Reported by `audit-appsec` · Verification: verified
  
Refs: insa: C-02; owasp_top10: A03:2021; owasp_api: API8:2023; asvs: V5.3.3, V5.2.1; iso27001: A.8.28; nist_csf: PR.DS-10

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:H/UI:R/S:U/C:H/I:H/A:N (6.1)
- **Evidence:** `src/components/settings/LetterTemplatesTab.tsx:71` — `setHtml(selected.letter_body_html ?? plainTextToHtml(selected.letter_body_template ?? ""));`; `src/components/settings/LetterTemplatesTab.tsx:243` — `<RichTextEditor value={html} ...`; `src/components/ui/rich-text-editor.tsx:46` — `if (el && el.innerHTML !== value) el.innerHTML = value || "";`; `src/components/settings/LetterTemplatesTab.tsx:79` — `const clean = sanitizeLetterHtml(html);  // client-side only, on save`; `supabase/migrations/00000000000000_baseline.sql:1649` — `CREATE POLICY service_type_update ... USING (((is_super_admin() OR (woreda_id = get_user_woreda_id())) AND (is_super_admin() OR user_has_any_perm(ARRAY['tenant.`; `src/lib/security-headers.ts:52` — `"script-src 'self' 'unsafe-inline'",`
- **Description:** The in-house sanitiser (sanitizeLetterHtml) is applied on the print route, at issuance, in the preview, and before save, and it held up against 16 bypass payloads under jsdom (raw/appsec-sanitiser-fuzz.txt). The gap is one sink that does not go through it. When the Letter Templates tab opens, it auto-selects the first letter type (LetterTemplatesTab.tsx:65-67) and passes the stored letter_body_html straight to RichTextEditor, which assigns it to a contentEditable div's innerHTML in the live document. Sanitisation happens only in the browser that saves the template. Nothing server-side (no CHECK, no trigger) prevents a direct PostgREST PATCH of service_type.letter_body_html. Setting innerHTML on a live element runs inline event handlers such as <img src=x onerror=...>. The CSP allows 'unsafe-inline', so it does not stop them. The regression test service-letter-sanitizer-parity covers only the print and issuance paths, not the editor.
- **Attack scenario:** A tenant_admin (or a super_admin, including one whose console role is restricted) sends PATCH /rest/v1/service_type?service_type_id=eq.<first letter type> {"letter_body_html":"<img src=x onerror=fetch('https://<supabase>/rest/v1/audit_log',{method:'POST',...,body:localStorage['sb-...-auth-token']})>"}. When a second tenant_admin of the same woreda opens Settings > Letter templates, the payload runs in their session. It can read their access and refresh tokens from localStorage and act as them, for example inviting users, editing role_permission, or approving work. The actions appear in the audit trail under the victim's identity.
- **Impact:** Session hijack and non-repudiable impersonation of another tenant administrator. The attacker needs tenant.manage, which limits the privilege gain. The persistence and audit-attribution impact is still real, and stored XSS is rated High under the audit rubric (CVSS 6.1 reflects PR:H).
- **Recommendation:** Run sanitizeLetterHtml() on every value before it reaches an HTML sink, including RichTextEditor's innerHTML assignment and the initial setHtml(). Prefer DOMPurify with the same allow-list in place of the hand-rolled walker. Add server-side defence: a BEFORE INSERT/UPDATE trigger on service_type that rejects letter_body_html containing on*= attributes, <script, <img, <svg, <iframe or javascript:, or move template saving behind an RPC that sanitises. Extend the parity regression test to cover the editor and preview sinks. See WP-APP-003 for the CSP half.
- **Effort:** S · **Status:** Open

### WP-DB-002
**Storage policies check only the woreda path prefix: any tenant user can overwrite official signatures/stamps/logos and read or delete every scanned legal document**  
Severity **High** · Confidence Confirmed · Category AuthZ · Reported by `audit-database` · Verification: verified
  
Refs: insa: TEN-06, C-08, CLS-01; owasp_top10: A01:2021; owasp_api: API5:2023; asvs: V4.2.1, V12.5.1; iso27001: A.8.3; nist_csf: PR.DS-01, PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:H/A:L (7.1)
- **Evidence:** `supabase/migrations/00000000000001_storage.sql:124` — `CREATE POLICY tenant_assets_insert_scoped ON storage.objects ... WITH CHECK (((bucket_id = 'tenant-assets'::text) AND (is_super_admin() OR (storage_path_woreda_`; `supabase/migrations/00000000000001_storage.sql:130` — `CREATE POLICY tenant_assets_update_scoped ... USING (((bucket_id = 'tenant-assets'::text) AND (is_super_admin() OR (storage_path_woreda_id(name) = get_user_wore`; `src/routes/woreda.settings.woreda-configuration.tsx:687` — `const path = '${woredaId}/${field}.${storageExtension(upload, "png")}'; ... .upload(path, upload, { upsert: true ... })`; `supabase/migrations/00000000000014_app_user_staff_fields.sql:31` — `staff_assets_insert_scoped ... (storage_path_woreda_id(name) = get_user_woreda_id())`; `supabase/migrations/00000000000004_resident_documents.sql:118` — `resident_documents_select_scoped ... (public.storage_path_woreda_id(name) = public.get_user_woreda_id())`; `supabase/migrations/00000000000004_resident_documents.sql:71` — `resident_document_select ... AND public.user_has_any_perm('{resident.read,household.read}'::text[])`
- **Description:** All 36 tenant storage.objects policies (buckets tenant-assets, staff-assets, resident-photos, resident-documents, resident-clearance-letters, credential-request-documents, rental-request-documents, service-request-documents, attachments) check nothing but the object's woreda path prefix. No permission is required to SELECT, INSERT, UPDATE or DELETE. The official branding assets live at predictable paths (`${woredaId}/<field>.<ext>`, uploaded with upsert). The resident_document table requires resident.read or household.read, but the same PDFs in the bucket do not.
- **Attack scenario:** A 'viewer' or 'print_officer' (or a custom role with no grants) calls the Storage API directly: upload('tenant-assets', `${woredaId}/supervisor_signature_url.webp`, forged, {upsert:true}). Every ID card, letter and receipt printed afterwards carries the forged supervisor signature or stamp. The same account can list and download every scanned legal document, or delete residents' photos and documents.
- **Impact:** The integrity of the official seal and signature on issued civic documents fails. Residents' scanned legal documents are disclosed to roles that are not meant to see them, and evidence can be destroyed within the tenant.
- **Recommendation:** Add permission predicates per bucket and command. For example, tenant-assets writes need user_has_perm('tenant.manage'), staff-assets writes need 'user.manage' or ownership of the object, resident-documents SELECT needs resident.read, and DELETE needs a dedicated permission. Consider object versioning or immutable paths for signed assets, and log uploads to the audit trail.
- **Effort:** M · **Status:** Open

### WP-DB-007
**Kebele reference data is writable by every tenant user**  
Severity **Medium** · Confidence Confirmed · Category AuthZ · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-10, TEN-02; owasp_top10: A01:2021; owasp_api: API5:2023; asvs: V4.1.3; iso27001: A.8.3; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L (5.4)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1596` — `CREATE POLICY kebele_tenant_isolation ON public.kebele AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id()))) W`
- **Description:** kebele has one FOR ALL policy that checks only the tenant, with no permission predicate. Kebele numbers are embedded in credential numbers (assign_credential_number) and printed on documents.
- **Attack scenario:** A viewer renames kebeles, inserts fake ones, or changes kebele_number. Credentials minted afterwards carry the wrong kebele segment.
- **Impact:** The reference hierarchy Region > Woreda > Kebele can be tampered with, and so can the identifiers printed on credentials.
- **Recommendation:** Allow SELECT for tenant users and restrict INSERT/UPDATE/DELETE to super_admin (or tenant.manage).
- **Effort:** S · **Status:** Open

### WP-API-007
**Invite flow sends the e-mail before creating the profile; app_user.username (e-mail local part) is globally UNIQUE, leaving orphaned invited accounts and a cross-tenant username oracle**  
Severity **Low** · Confidence Confirmed · Category Business Logic · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: E-06, C-07; owasp_top10: A04:2021; owasp_api: API6:2023; asvs: V1.11.2; iso27001: A.8.28; nist_csf: PR.PS-06

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:N/A:N (2.7)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:536` — `ALTER TABLE public.app_user ADD CONSTRAINT app_user_username_key UNIQUE (username);`; `supabase/functions/invite-tenant-user/index.ts:113` — `await admin.auth.admin.inviteUserByEmail(email, { redirectTo: '${SITE_URL}/set-password' });`; `supabase/functions/invite-tenant-user/index.ts:134` — `const username = email.split("@")[0]?.slice(0, 32) ?? email;`; `supabase/functions/invite-tenant-user/index.ts:236` — `if (insertErr) { return safeError(..., "Invite sent but profile setup failed", 400); }`
- **Description:** username is derived from the e-mail local part and must be unique platform-wide. Inviting abebe@moe.gov.et in woreda A after abebe@gmail.com exists anywhere fails the app_user insert AFTER GoTrue has created the auth user and mailed a live invite link. The recipient can redeem the link into a session with no app_user row (RLS denies data, but the auth identity persists). The distinct "Invite sent but profile setup failed" message also tells a tenant_admin that the local part is taken somewhere on the platform.
- **Attack scenario:** A tenant admin probes common local parts to learn which usernames exist in other woredas; ordinary onboarding silently creates dangling auth.users rows.
- **Impact:** Orphan identities, failed onboarding, minor cross-tenant information leak.
- **Recommendation:** Create the app_user row (or reserve the username) before calling inviteUserByEmail, or delete the auth user on insert failure; derive username from the full e-mail or a UUID; map the collision to the generic duplicate message.
- **Effort:** S · **Status:** Open

### WP-API-008
**User-lifecycle functions exclude print_officer and custom-role staff (cannot be invited, re-invited or sent a reset link)**  
Severity **Low** · Confidence Confirmed · Category Business Logic · Reported by `audit-api-edge` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-04, RBAC-01; owasp_api: API9:2023; asvs: V1.4.4; iso27001: A.5.18; nist_csf: PR.AA-05

- **Evidence:** `supabase/functions/invite-tenant-user/index.ts:20` — `const ALLOWED_ROLES = new Set(["registry_clerk","civil_registrar","finance_clerk","supervisor","auditor","viewer"]);`; `supabase/functions/resend-tenant-invite/index.ts:21` — `const ALLOWED_TARGET_ROLES = new Set([ ...same six... ]);`; `supabase/functions/send-password-reset-link/index.ts:17` — `const ALLOWED_TARGET_ROLES = new Set([ ...same six... ]);`; `src/components/settings/UsersRolesTab.tsx:69` — `const EDITABLE_ROLES = [ registry_clerk, civil_registrar, finance_clerk, supervisor, auditor, viewer ]`
- **Description:** print_officer (built-in since migration 35) and role=custom (Task 13) are valid app_user roles, but all three tenant-side lifecycle functions use the pre-Task-13 six-role allow-list. Such users must be invited under another role and re-assigned, and a locked-out print_officer or custom-role user gets "Cannot send a reset link for this role." Operators are pushed toward dashboard/SQL workarounds that bypass the audited path.
- **Attack scenario:** n/a (functional gap that encourages out-of-band administration).
- **Impact:** Incomplete admin API; out-of-band account handling without audit rows.
- **Recommendation:** Derive the allow-list from a shared constant including print_officer and custom (with custom_role_id validated to the same woreda by the existing validate_app_user_role trigger).
- **Effort:** S · **Status:** Open

### WP-APP-009
**Invite Edge Functions derive a globally-UNIQUE username from the email local part, leaving orphaned GoTrue users on collision**  
Severity **Low** · Confidence Likely · Category Business Logic · Reported by `audit-appsec` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-06, C-07; owasp_top10: A04:2021; owasp_api: API6:2023; asvs: V11.1.1; iso27001: A.8.28

- **Evidence:** `supabase/functions/invite-tenant-user/index.ts:134` — `const username = email.split("@")[0]?.slice(0, 32) ?? email;`; `supabase/migrations/00000000000000_baseline.sql:536` — `ALTER TABLE public.app_user ADD CONSTRAINT app_user_username_key UNIQUE (username);`; `supabase/functions/invite-tenant-user/index.ts:236` — `if (insertErr) { return safeError(req, ..., "Invite sent but profile setup failed", 400); }`
- **Description:** inviteUserByEmail() runs first and sends the email. The app_user insert then fails if any user in any woreda already has the same local part (abebe@gmail.com vs abebe@moe.gov.et). The invitee receives a working invite link for an auth user with no app_user row, and the admin gets a generic error. The collision also tells the inviter that the local part exists somewhere on the platform.
- **Attack scenario:** A tenant admin invites 'info@<domain>' and the invite partially fails because another woreda already has an 'info' user.
- **Impact:** Orphaned auth.users rows, a confusing onboarding failure, and a minor cross-tenant existence signal.
- **Recommendation:** Make the username unique per woreda or derive it with a random suffix. Insert app_user before sending the invite, or roll back the GoTrue user on insert failure.
- **Effort:** S · **Status:** Open

### WP-AUTH-013
**print_officer accounts cannot be invited or sent a password-reset link by any Edge Function**  
Severity **Info** · Confidence Likely · Category Business Logic · Reported by `audit-auth-session` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-04; iso27001: A.5.16; nist_csf: PR.AA-01

- **CVSS:** N/A
- **Evidence:** `supabase/functions/invite-tenant-user/index.ts:20` — `const ALLOWED_ROLES = new Set(["registry_clerk","civil_registrar","finance_clerk","supervisor","auditor","viewer"]);`; `supabase/functions/send-password-reset-link/index.ts:17` — `const ALLOWED_TARGET_ROLES = new Set([ ... "viewer" ]);  -- no print_officer, no custom`; `supabase/functions/invite-platform-admin/index.ts:50` — `if (role !== "super_admin" && role !== "tenant_admin") {`
- **Description:** print_officer (and custom-role users) are outside both the invite and the admin reset allow-lists, so their onboarding/recovery must happen via a role change after inviting under another role, or via the Supabase dashboard - an undocumented, unaudited path.
- **Attack scenario:** N/A (lifecycle gap).
- **Impact:** Out-of-band account handling for a role that prints legal credentials; weaker audit trail.
- **Recommendation:** Add print_officer (and custom, with custom_role_id validation) to the allow-lists, or document the intended path.
- **Effort:** S · **Status:** Open

## Module: Super Admin

### WP-AZ-001
**Console permissions (CP) are enforced only in the browser: a console-scoped super_admin keeps unrestricted platform power at the database and Edge Function layer**  
Severity **High** · Confidence Confirmed · Category AuthZ · Reported by `audit-authz` · Verification: verified · Merged: WP-API-001
  
Refs: owasp_top10: A01:2021; owasp_api: API5:2023; asvs: V4.1.1, V4.1.3, V4.2.1; iso27001: A.5.15, A.8.2, A.8.3; nist_csf: PR.AA-05; insa: D-01, E-06, B-04, RBAC-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:L (6.7)
- **Evidence:** `supabase/migrations/00000000000012_enforce_console_rbac.sql:39` — `USING (public.user_has_console_perm('console.console_users.manage'))  -- the only RLS use of user_has_console_perm()`; `supabase/migrations/00000000000012_enforce_console_rbac.sql:150` — `IF NOT public.user_has_console_perm('console.console_users.manage') THEN  -- trigger, console_role_id column only`; `supabase/migrations/00000000000010_id_card_template_draft.sql:125` — `IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Only super_admin may publish the ID card template';`; `supabase/migrations/00000000000000_baseline.sql:1589` — `CREATE POLICY template_write_super_admin ON public.id_card_template_field ... USING (is_super_admin())`; `supabase/migrations/00000000000000_baseline.sql:1651` — `CREATE POLICY tenant_module_config_write_super_admin ... USING (is_super_admin()) WITH CHECK (is_super_admin())`; `supabase/migrations/00000000000000_baseline.sql:1550` — `app_user_super_admin_write ... FOR ALL ... USING (is_super_admin())`
- **Description:** The console-role feature (migration 09) presents named console roles such as a template editor or tenant manager as an access boundary inside /admin. Only one of the five CP keys, console.console_users.manage, is checked on the server, and only for the console_role* tables and the app_user.console_role_id column. The other four (console.tenants.manage, console.users.manage, console.audit.view, console.credential_template.manage) exist only as <ConsolePermissionGate>/hasConsolePermission() checks in React. Every table and RPC they are meant to protect tests is_super_admin(), which is true for any active super_admin whatever their console_role_id. The service-role Edge Functions invite-platform-admin (tenant_admin path), resend-platform-invite, invite-tenant-user and sign-credential also accept any super_admin without a console-scope check.
- **Attack scenario:** A super_admin scoped to a 'Template Editor' console role (console.credential_template.manage only) calls PostgREST directly with their own JWT: PATCH /rest/v1/app_user?user_id=eq.<victim> to suspend or re-role any user in any woreda, PATCH tenant_module_config to disable a woreda's modules, GET /rest/v1/audit_log and /resident_decrypted for every woreda, or POST /functions/v1/invite-platform-admin {role:'tenant_admin', woredaId:X} to mint a tenant admin for any woreda.
- **Impact:** Console roles do not restrict anything a scoped super_admin can do with a direct API call. That includes cross-tenant reads of all PII, tenant configuration, user administration and minting tenant admins. Operators who rely on console roles for separation of duties at platform level are not getting it. Live exposure depends on whether any console_role is currently assigned (Needs-live-verification: SELECT count(*) FROM app_user WHERE console_role_id IS NOT NULL).
- **Recommendation:** Enforce each CP key where the power is exercised. For tenant_module_config, woreda, id_card_template*, credential-templates storage and publish/discard RPCs, replace is_super_admin() with user_has_console_perm('<key>'). For app_user writes by super_admin, require console.users.manage. For platform-wide SELECTs on audit_log, require console.audit.view. Add the matching check to invite-platform-admin, resend-platform-invite and invite-tenant-user (super_admin branch). Add a CI drift check that every CP key is referenced by at least one policy or function.
- **Effort:** M · **Status:** Open

### WP-ARC-004
**Tenant (woreda) creation exists only as seed data and operator SQL; the console provisioning flow cannot create a tenant**  
Severity **Low** · Confidence Confirmed · Category Design · Reported by `audit-architecture` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-05, OPS-01; iso27001: A.8.32; nist_csf: PR.PS-01 (CSF 2.0)

- **CVSS:** N/A (process control)
- **Evidence:** `supabase/seed.sql:70` — `INSERT INTO public.woreda (...) VALUES (... 'AMIR_NUR' ...) : 6 woredas seeded`; `src/routes/admin.tenants.$woredaId.provision.tsx:150` — `provisioning upserts tenant_module_config and invokes an invite Edge Function; no insert on woreda anywhere in src/`; `supabase/migrations/00000000000015_permission_matrix_backfill.sql:71` — `AFTER INSERT ON woreda trigger seeds role_permission (also 00000000000048:103 offices, 00000000000071:247 rental policy)`
- **Description:** The console's provisioning page only configures modules and invites a tenant admin for an existing woreda. New woreda rows, and therefore the AFTER INSERT triggers that seed permissions, offices and rental policy, come only from seed.sql or an operator running SQL with the account PAT over the Management API.
- **Attack scenario:** Not directly exploitable. The risk is operational: adding a seventh woreda needs production SQL access (TB8), which bypasses RLS and every application audit control.
- **Impact:** Privileged tenant lifecycle operations happen outside the audited application path, with no maker-checker step and no audit_log entry.
- **Recommendation:** Add a super-admin-only create_woreda() DEFINER RPC with CP permission, input validation and a DB-written audit row. Record the operator path in the runbook until then.
- **Effort:** S · **Status:** Open

### WP-AZ-007
**Role-to-tenant scope invariant is not enforced in the database: a super_admin row may carry a woreda_id, and that woreda's tenant_admin can then edit or delete it**  
Severity **Low** · Confidence Likely · Category AuthZ · Reported by `audit-authz` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: RBAC-02, TEN-02; owasp_top10: A01:2021; owasp_api: API5:2023; asvs: V4.1.3; iso27001: A.5.15; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:L (3.3)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1551` — `app_user_tenant_admin_write ... USING (is_tenant_admin() AND (woreda_id = get_user_woreda_id()) AND (role <> 'tenant_admin'))  -- 'super_admin' rows are not exc`; `src/components/admin/PlatformUsersTab.tsx:856` — `const nextWoredaId = role === "tenant_admin" ? woredaId : null;  -- invariant kept only by the UI`; `supabase/functions/invite-platform-admin/index.ts:56` — `if (role === "super_admin" && woredaId) { return json(req, 400, ...)  -- invite path only`; `supabase/migrations/00000000000009_console_roles.sql:57` — `CHECK (console_role_id IS NULL OR role = 'super_admin')  -- no equivalent CHECK for woreda_id`
- **Description:** Nothing in the schema requires super_admin rows to have woreda_id IS NULL, or tenant roles to have woreda_id NOT NULL. The UI and invite function keep the invariant, but a direct super_admin PATCH, a SQL-console fix, or a future code path can break it. If a super_admin row ever carries woreda X, X's tenant_admin satisfies app_user_tenant_admin_write for that row, because the policy only excludes role = 'tenant_admin'. The tenant_admin could then suspend, rename or delete the platform admin, or demote them to a staff role. guard_console_role_assignment allows the demotion because console_role_id stays NULL and prevent_last_super_admin_lockout only protects the last one.
- **Attack scenario:** A super_admin is created by promoting an existing tenant user through a raw PATCH that leaves woreda_id set. That woreda's tenant_admin then runs PATCH /rest/v1/app_user?user_id=eq.<super> {role:'viewer'}.
- **Impact:** Low likelihood. It would let a tenant admin demote a platform admin, which is an inversion of authority.
- **Recommendation:** Add CHECK ((role = 'super_admin') = (woreda_id IS NULL)) (NOT VALID, then VALIDATE after cleanup), and extend app_user_tenant_admin_write to role NOT IN ('tenant_admin','super_admin').
- **Effort:** S · **Status:** Open

## Module: Rental

### WP-INV-002
**Living documentation not maintained: 13% of code-changing commits update any doc; the Kebele Rental Houses financial subsystem (14 tables, migrations 71-89) is absent from the ERD, DFD, architecture and API docs**  
Severity **Medium** · Confidence Confirmed · Category Docs · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: G-01, A-02, A-07, D-01, E-02; owasp_top10: A04:2021; owasp_api: API9:2023; asvs: V1.1.2, V1.1.3; iso27001: A.5.37, A.8.25; nist_csf: ID.AM-3, PR.IP-2

- **CVSS:** N/A (process control)
- **Evidence:** `docs/audit/2026-09-24/raw/inventory-g01-doc-cooccurrence.txt:0` — `Code-touching commits: 39 ... with any doc update: 5 (13%) ... with a DFD/ERD/SFD/API/arch doc update: 3 (8%)`; `supabase/migrations/00000000000076_rental_phase2_financial_core.sql:71` — `CREATE TABLE IF NOT EXISTS public.rent_account_sequence (`; `docs/erd.md:10` — `That live enumeration found **52 tables**, zero drift against the`; `docs/architecture.md:31` — `DB[("Postgres — 43 tables, RLS on every one,<br/>SECURITY DEFINER helper functions")]`; `docs/architecture.md:30` — `Functions["6 Edge Functions (Deno) — service-role, own CORS allow-list,`; `docs/architecture.md:89` — `| Public, unauthenticated verification | Two RPCs ('verify_credential_token', 'verify_service_letter') called directly by the anon client`
- **Description:** Sampling the last 50 non-merge commits before HEAD (git log -50 --no-merges --name-only), 39 touch application code (src/, supabase/migrations, supabase/functions, seed). Only 5 of those (13%) touch any document (docs/**, CLAUDE.md, README) and only 3 (8%) touch a DFD/ERD/SFD/API/architecture document; INSA G-01 requires >= 80%. The consequence is visible in the schema: migrations 00000000000071-00000000000083 (first added 2026-09-21) create 14 tables - rental_policy, rent_account_sequence, rent_account, rent_rate_history, rent_charge, rental_payment, rent_payment_settlement, payment_reconciliation_exception, arrears_plan_sequence, arrears_repayment_plan, arrears_repayment_installment, arrears_installment_charge, rent_reminder, service_request_checkpoint - plus 9 *_decrypted views and 5 get_rental_* report RPCs. None of rent_account, rent_charge, arrears_repayment_plan, rental_policy, rent_reminder, payment_reconciliation_exception or service_request_checkpoint appears in docs/erd.md, docs/dfd.md or docs/architecture.md (grep count 0 each). erd.md was last changed 2026-09-14 and dfd.md 2026-09-05, before the rental financial core landed. 52 (ERD) + 14 = the 66 tables in types.ts. architecture.md is older still (43 tables, 6 Edge Functions, 9 buckets, 66 route files, two public RPCs; actual: 66, 8, 10, 69 ssr:false files, three public RPCs incl. verify_receipt). No 'TODO: add security later' style deferrals were found in src/ or supabase/functions (G-01's second criterion passes).
- **Attack scenario:** Not directly exploitable. An INSA assessor, a reviewer or one of the repo's own review agents reasons from the ERD/DFD/SFD and misses a money-handling subsystem (rent settlement, reversal, arrears) that has had six rounds of security-fix migrations (84-89), so controls on it go unreviewed.
- **Impact:** INSA G-01 FAIL; A-02/A-07/D-01 evidence for the newest, financially sensitive module does not exist; architecture doc cannot be used as the deployment/component record.
- **Recommendation:** Before go-live: extend erd.md, dfd.md (L1/L2 for rental billing/settlement), security-functionality.md, api-security.md and openapi.yaml to the rental financial core and the verify_receipt public RPC; refresh architecture.md's counts. Add a CI check (same static shape as check-role-perms-drift.ts) that fails when a migration adds a CREATE TABLE whose name is absent from docs/erd.md, and a PR-template checkbox for doc updates.
- **Effort:** M · **Status:** Open

### WP-LOC-001
**Rent-charge and arrears-installment due dates are stored one day early in the Ethiopian time zone**  
Severity **Medium** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-03, ET-01

- **Evidence:** `src/routes/woreda.rental-accounts.$occupancyId.tsx:56` — `return ethiopianToGregorian({ year, month, day: startEth.day }).toISOString().slice(0, 10);`; `src/routes/woreda.rental-accounts.$occupancyId.tsx:262` — `const dueDate = ethiopianToGregorian({ year, month, day: dueDay });`; `src/routes/woreda.rental-accounts.$occupancyId.tsx:263` — `const dueDateIso = dueDate.toISOString().slice(0, 10);`; `src/routes/woreda.rental-accounts.$occupancyId.tsx:376` — `dueDates.push(i === 0 ? planFirstDueDate : addEthiopianMonths(planFirstDueDate, i));`; `src/utils/ethiopianCalendar.ts:120` — `return new Date(year, month - 1, day);`; `supabase/migrations/00000000000082_rental_phase4_review_fixes_2.sql:125` — `SET status = CASE WHEN rc.due_date < current_date THEN 'overdue' ELSE 'due' END,`
- **Description:** ethiopianToGregorian() returns a Date at LOCAL midnight (ethiopianCalendar.ts:120). Two rental call sites then serialise it with toISOString().slice(0,10), which converts to UTC first. In East Africa Time (UTC+3), local midnight is 21:00 UTC on the previous day, so every value is one Gregorian day early. Affected: (a) the _due_date sent to generate_rent_charges() for every monthly billing run (lines 260-266); (b) every arrears installment after the first, via addEthiopianMonths() (lines 47-57, 376). Reproduced with bun under TZ=Africa/Addis_Ababa: Tikimt 10 2019 is sent as 2026-10-19 instead of 2026-10-20, and addEthiopianMonths('2026-09-24',1) returns 2026-10-23 instead of 2026-10-24. Under TZ=UTC the same code gives the correct answer, which explains why it does not show up in CI. A second defect sits in the same helper: a start date in Pagume (month 13) plus one month becomes month 14, the loop maps that to Tikimt (month 2) of the next year, and Meskerem is skipped. The converter itself is correct (see ET-03); the defect is in the callers.
- **Attack scenario:** No attacker needed. A finance clerk in Harar runs 'Generate billing' for Tikimt with policy due_day 10. The server stores due_date = Tikimt 9. On Tikimt 10 (still inside the real grace period) the ledger refresh marks the charge 'overdue' (due_date < current_date), and the service-request rental checkpoint (migration 83) treats the occupant as having overdue rent. That can block or flag a resident's unrelated service request.
- **Impact:** Charges and installments turn overdue one day before the policy allows, and arrears ageing and checkpoint decisions are shifted by one day. Payment plans that start in Pagume skip a month. This touches money and service eligibility in every woreda.
- **Recommendation:** Never use toISOString() to turn a calendar date into text. Add a toIsoDateLocal(d) helper next to parseDateOnly() in ethiopianCalendar.ts that uses getFullYear/getMonth/getDate (EthiopianDateInput.tsx:67 already does this inline), and use it at rental-accounts:56 and :263. Treat Pagume explicitly in addEthiopianMonths: month 13 + n should become month n of the next year. Add a vitest case that runs under TZ=Africa/Addis_Ababa (set process.env.TZ in the test file or the vitest config). Optionally, have generate_rent_charges() compute due_date on the server from the EC period and the policy due_day, instead of trusting the client.
- **Effort:** S · **Status:** Open

### WP-WF-013
**Rental billing gaps: client-chosen billing start period, termination month never billed, and account provisioning separate from the approval**  
Severity **Medium** · Confidence Likely · Category Business Logic · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: BL-02; owasp_top10: A04:2021; owasp_api: API6:2023; asvs: V11.1.3; iso27001: A.8.26; nist_csf: PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `supabase/migrations/00000000000087_rental_review_round4_fixes.sql:141` — `IF _billing_start_period_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN  -- format only; not reconciled with rent_start_date`; `src/routes/woreda.rental-houses.requests.$requestId.index.tsx:339` — `_billing_start_period_key: billingStartPeriodKey,  -- computed in the browser, separate call after approval`; `supabase/migrations/00000000000076_rental_phase2_financial_core.sql:585` — `AND ra.status = 'active'  -- generate_rent_charges skips terminated accounts`; `supabase/migrations/00000000000084_rental_review_regression_fixes.sql:120` — `SET status = 'terminated'  -- billing_end_period_key never set`; `supabase/migrations/00000000000087_rental_review_round4_fixes.sql:93` — `--   - Terminating an occupancy never sets rent_account.billing_end_period_key, ... never charged`
- **Description:** The rental financial core (settlement, arrears and reversal RPCs) is well built: amounts are recomputed server-side, month charges are indivisible, charges are locked FOR UPDATE in canonical order, idempotency is a DB constraint, and reverser != collector. Three gaps remain around it. (1) provision_rent_account() takes the billing start period from the client and only checks its format. A rental.approve/rental.billing holder can start billing months or years after the occupancy began (free rent) or before it. (2) Terminating an occupancy sets rent_account.status='terminated' but never billing_end_period_key, and generate_rent_charges() only bills active accounts. The termination month, and any month not yet generated, is never charged. The code's own header (migration 87) records this as a known gap. (3) The rent account is provisioned by a second client call after the approval commits. If that call fails, the occupancy is active with no billable account.
- **Attack scenario:** An approver provisions an account with _billing_start_period_key two years after rent_start_date, and the tenant is never billed for those months. A clerk approves a termination just before the monthly billing run, and the final month is never charged.
- **Impact:** Rent revenue is lost with no exception record. The 'no partial month' rule holds, but whole months fall outside the ledger.
- **Recommendation:** Derive the billing start period server-side from rental_occupancy.rent_start_date (Pagume -> next Meskerem), or reject a key that differs from the derived one. Provision the account inside apply_rental_occupancy_on_approval(). On termination, set billing_end_period_key and generate the final charge before closing the account.
- **Effort:** M · **Status:** Open

### WP-WF-014
**Rental payment reversal does not require a reason**  
Severity **Low** · Confidence Confirmed · Category Logging · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: MC-03, LOG-01; owasp_top10: A09:2021; asvs: V7.1.3; iso27001: A.8.15; nist_csf: DE.CM-09

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N (2.7)
- **Evidence:** `supabase/migrations/00000000000089_rental_review_round6_fixes.sql:436` — `_reason text  -- never validated in the body`; `supabase/migrations/00000000000089_rental_review_round6_fixes.sql:567` — `'reason', _reason, 'charges_reopened', v_reopened_count,`; `src/routes/woreda.rental-accounts.$occupancyId.tsx:336` — `_reason: reverseReason || null,`
- **Description:** reverse_rental_payment() correctly requires rental.reverse (tenant_admin only, reserved key), enforces reverser != collector, locks rows, and writes an audit row. But the reason is optional both in the RPC and in the UI, so a reversal can be recorded with a NULL reason.
- **Attack scenario:** A tenant_admin reverses a colleague's collection without giving any justification. The audit row records reason: null.
- **Impact:** Reversals cannot be justified after the fact. This is an MC-03 gap for the most sensitive rental money operation.
- **Recommendation:** Reject NULL or short reasons in the RPC (length(trim(_reason)) >= 10) and make the field mandatory in the dialog.
- **Effort:** S · **Status:** Open

## Module: Residents

### WP-APP-005
**Allow-list validation is client-only for FAN, phone, household email, free-text lengths and several forms; FAN uniqueness is advisory only**  
Severity **Medium** · Confidence Confirmed · Category Business Logic · Reported by `audit-appsec` · Verification: not individually re-verified (Medium sample FP rate 0/10) · Merged: WP-LOC-005
  
Refs: insa: C-06, D-02, ET-12; owasp_top10: A04:2021; owasp_api: API6:2023; asvs: V5.1.3, V5.1.4, V11.1.3; iso27001: A.8.28; nist_csf: PR.DS-02

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `src/lib/residentSchema.ts:36` — `national_id_no: z.string().trim()...refine((v) => !v || /^\d{16}$/.test(v), ...)`; `src/lib/phoneNumber.ts:59` — `return v === "" || /^\d{9}$/.test(v);`; `supabase/migrations/00000000000000_baseline.sql:597` — `ALTER TABLE public.resident ADD CONSTRAINT resident_email_format CHECK (...)  -- the only format CHECK on a PII column`; `supabase/migrations/00000000000023_pii_encryption.sql:232` — `RETURN digits;  -- normalize_phone() accepts any digit string, never rejects`; `supabase/migrations/00000000000044_task6_household_rent_national_id_pii.sql:89` — `trimmed := NULLIF(trim(_id), '');  -- blind index over the raw trimmed value`; `src/components/forms/ResidentWizardSteps.tsx:167` — `.or('national_id_no_blind_index.eq.${blindIndex}')  // duplicate-FAN check is a client-side warning only`
- **Description:** Zod is used in 14 route files (matching docs/security-functionality.md), and DB CHECKs cover most status/enum columns (44 distinct named ADD CONSTRAINT ... CHECK constraints, plus inline CHECKs in later CREATE TABLEs). The identifiers named by the INSA checklist are not enforced server-side. No migration constrains resident.national_id_no to 16 digits. Phone numbers have no +251/9-digit CHECK, and normalize_phone() returns whatever digits it is given. household.email has no format CHECK. No unique index covers national_id_no_blind_index, and the blind index is computed over the trimmed raw string, so '1234 5678 ...' and '12345678...' produce different indexes. Forms outside the 14 (services.new, rental-houses.occupants.new, the letter-template editor, the invite dialogs) use ad-hoc or no validation, and free-text columns have no length limits in the DB. The invite Edge Functions check only that fields are present. email format, full_name/department/job_title length and the signature_path/photo_path prefix (which must begin with the caller's woreda) are not validated. These functions write with the service role, which bypasses the storage path convention.
- **Attack scenario:** A clerk bypasses the form with a direct PostgREST insert of a resident whose national_id_no is '1234-5678-9012-3456' (or a FAN that already exists, reformatted). No constraint fires, the duplicate check never matches, and the same person can be registered twice and issued two residence credentials.
- **Impact:** Registry data quality and uniqueness guarantees (one FAN per resident) depend on the UI. Duplicate identities can be minted. Malformed phones break blind-index search.
- **Recommendation:** Add CHECK constraints: national_id_no ~ '^[0-9]{16}$', phone_number ~ '^\+2519[0-9]{8}$' (or the 9-digit local form actually stored), and household email format. Add length CHECKs on free-text columns. Add a partial UNIQUE index on (woreda_id, national_id_no_blind_index) WHERE national_id_no_blind_index IS NOT NULL, or platform-wide if policy requires. Normalise FAN digits before computing the blind index. Validate Edge Function bodies with a Zod/Valibot schema, including a signature_path/photo_path prefix of `${woredaId}/`. Update docs/security-functionality.md to list validation per module.
- **Effort:** M · **Status:** Open

### WP-DB-005
**Restricted PII is still stored and served in plaintext; encryption covers only a subset of columns and special-category data is out of scope**  
Severity **Medium** · Confidence Confirmed · Category Privacy · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10) · Merged: WP-CRY-006
  
Refs: insa: A-08, CLS-01, PRV-01; owasp_top10: A02:2021; asvs: V6.1.1, V8.3.4; iso27001: A.8.24, A.5.34; nist_csf: PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:H/UI:N/S:U/C:H/I:N/A:N (4.4)
- **Evidence:** `supabase/migrations/00000000000023_pii_encryption.sql:5` — `This migration is ADDITIVE AND INERT ... Plaintext stays authoritative until a later migration retires it.`; `supabase/migrations/00000000000023_pii_encryption.sql:25` — `Still plaintext on the SAME rows, a stolen dump exposes all of it: ... full_name, full_name_am, date_of_birth ... household.address_line, gps_lat, gps_lng`; `supabase/migrations/00000000000044_task6_household_rent_national_id_pii.sql:8` — `plaintext stays authoritative through this stage (no application write path changes)`; `supabase/migrations/00000000000000_baseline.sql:360` — `ethnicity text, religion text,`; `supabase/migrations/00000000000000_baseline.sql:351` — `national_id_no text,`; `supabase/migrations/00000000000023_pii_encryption.sql:7` — `Plaintext stays authoritative until a later migration retires it.` (via WP-CRY-006)
- **Description:** Column encryption (pgp_sym under a per-woreda HMAC-derived key from Vault) adds *_enc copies of phone, email, national_id_no and the amount columns, but every plaintext column is kept and remains authoritative, so a dump or backup still holds all of them. Several fields are not in scope at all: ethnicity and religion (special-category data), full names, DOB, GPS, address, vital_event.event_details and issued_letter_html. No column GRANTs or masking views limit which roles see which columns.
- **Attack scenario:** A database backup or snapshot leaks, or someone with read access to the SQL editor or Management API exports resident: national_id_no, ethnicity, religion, GPS and names are all plaintext.
- **Impact:** A-08 is not met: the encryption-at-rest claim covers copies, not the data of record.
- **Recommendation:** Finish stage 3/4 of the documented rollout: cut reads over to *_decrypted, then NULL or drop the plaintext columns. Add ethnicity, religion, GPS and event_details to the encryption scope, or record a justified exception. Add masked views (e.g. national_id last-4) for roles that do not need the full value.
- **Effort:** L · **Status:** Open

### WP-PRV-002
**Restricted PII (FAN, phone, email, religion, ethnicity) is copied in plaintext into audit_log, which every tenant member can read and nothing ever purges; this defeats the column encryption**  
Severity **Medium** · Confidence Confirmed · Category Privacy · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: D-05, A-08, PRV-01, CLS-01; owasp_top10: A09:2021, A02:2021; owasp_api: API3:2023; asvs: V7.1.1, V7.1.2, V8.3.4; iso27001: A.8.11, A.8.15; nist_csf: PR.DS-1, PR.DS-5

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N (4.3)
- **Evidence:** `src/lib/residentSchema.ts:251` — `return { first_name, full_name, ... ethnicity: values.ethnicity, religion: values.religion, national_id_no: values.national_id_no || null, phone_number, ... }`; `src/routes/woreda.residents.$residentId.edit.tsx:229` — `for (const [k, v] of Object.entries(core)) { ... if (!eq) { oldChanged[k] = prev ?? null; newChanged[k] = v; } }`; `src/routes/woreda.residents.$residentId.edit.tsx:247` — `old_value_json: oldChanged as never, new_value_json: newChanged as never,`; `supabase/migrations/00000000000000_baseline.sql:1553` — `CREATE POLICY audit_log_tenant_read ON public.audit_log ... USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())))`; `supabase/migrations/00000000000044_task6_household_rent_national_id_pii.sql:60` — `ADD COLUMN IF NOT EXISTS national_id_no_enc bytea,  -- the FAN is encrypted in resident, but not in the audit copy`; `docs/security-functionality.md:267` — `Full PII payloads -- audit_log.new_value_json/old_value_json carry narrow, action-specific fields ... not a full resident/household record dump.`
- **Description:** When a resident is edited, the client diffs the whole payload and writes the old and new values of every changed field into audit_log.old_value_json/new_value_json. The payload includes national_id_no (FAN), phone_number, ethnicity, religion, DOB, names, birth place and work info. So a FAN or phone correction leaves both the old and new values in plaintext jsonb. The audit_log SELECT policy checks only the tenant (WP-DB-004): print officers, viewers and zero-grant custom roles can read it through PostgREST even though /woreda/audit is hidden from them in the UI. audit_log has no retention, and PII inside jsonb is out of scope for the Phase C encryption. The FAN, which migration 44 encrypted, therefore persists in cleartext in a second table and in every backup, for good. The documentation claims audit payloads carry only narrow fields; that is true of the Edge Functions (sign-credential logs only credential_number) but not of the resident edit path.
- **Attack scenario:** A print_officer (no resident.read, no audit.view) calls GET /rest/v1/audit_log?entity_name=eq.resident&action_type=eq.RESIDENT_UPDATED&select=old_value_json,new_value_json and harvests previous and current FANs, phone numbers and religion for every resident whose record was ever corrected.
- **Impact:** Restricted identifiers and special-category data leak to roles that should not see them, survive the planned stage-4 plaintext drop, and cannot be erased on request.
- **Recommendation:** Never store Restricted values in audit payloads. Record the field name and a change marker, or a keyed hash (e.g. national_id_blind_index) instead of the value. Apply this in the DB trigger recommended in WP-PRV-001, and in the meantime strip Restricted keys client-side. Back-fill: UPDATE audit_log SET old_value_json = old_value_json - ARRAY[...], new_value_json = new_value_json - ARRAY[...] WHERE entity_name='resident' (do this in a controlled change with a written justification, since it rewrites audit history). Gate audit_log SELECT on user_has_perm('audit.view') (WP-DB-004).
- **Effort:** S · **Status:** Open

### WP-PRV-005
**Special-category data (ethnicity, religion, cause of death, divorce grounds) is collected as mandatory with no documented lawful basis and receives no protection beyond ordinary PII**  
Severity **Medium** · Confidence Confirmed · Category Privacy · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-08, PRV-01, CLS-01; owasp_top10: A04:2021; owasp_api: API3:2023; asvs: V8.3.4; iso27001: A.5.34; nist_csf: ID.GV-3

- **CVSS:** N/A (compliance finding)
- **Evidence:** `src/lib/residentSchema.ts:34` — `ethnicity: z.string().min(1, "ብሔር ይምረጡ / Select ethnicity"), religion: z.string().min(1, "ኃይማኖት ይምረጡ / Select religion"),`; `supabase/migrations/00000000000000_baseline.sql:339` — `CREATE TABLE IF NOT EXISTS public.resident ( ... ethnicity text, religion text, ... )  -- plaintext, no _enc copy, no column grant`; `src/routes/woreda.civil.death.new.tsx:36` — `cause_of_death: z.string().trim().max(500).optional().default(""),  -- stored in vital_event.event_details jsonb`; `src/routes/woreda.civil.birth.new.tsx:76` — `ethnicity: v.ethnicity || null, religion: v.religion || null,  -- copied into event_details`; `src/routes/woreda.reports.$reportType.print.tsx:87` — `"Residents by ethnicity": "bar", "Residents by religion": "bar",  -- aggregate reporting, no small-cell suppression`
- **Description:** Resident intake cannot be completed without selecting an ethnicity and a religion. Civil registration records ethnicity/religion (birth), cause of death (death) and grounds (divorce) in vital_event.event_details. Under the Personal Data Protection Proclamation these are sensitive personal data, as they are in every comparable regime. Nothing in the repository states why a residency ID or civil registration needs them, which roles need them, or how long they are kept. They get the same treatment as a street address: plaintext (outside the Phase C encryption scope; WP-DB-005), readable by every tenant member (WP-DB-004), printed on the resident profile, autosaved to localStorage (WP-PRV-003), and aggregated in population reports with no small-count suppression, so a kebele with one member of a minority religion identifies that person.
- **Attack scenario:** Any tenant account, including a print officer, lists residents by religion or ethnicity through PostgREST, or re-identifies individuals from a kebele-level report where the count is 1-2.
- **Impact:** Discrimination and profiling risk for residents. This is a likely non-compliance with the Proclamation's sensitive-data conditions and with data minimisation.
- **Recommendation:** Get a written decision from the system owner and legal counsel on the legal mandate for each special-category field. If there is no mandate, make the field optional with 'prefer not to say', or remove it. If it is mandated, restrict it: exclude it from default selects, add column-level REVOKE SELECT (ethnicity, religion) with access through a permission-gated RPC or view, encrypt it with the Phase C mechanism, exclude it from drafts and prints unless required, and suppress report cells below a threshold (e.g. <5). Record the lawful basis and purpose in a Record of Processing.
- **Effort:** M · **Status:** Open

### WP-DB-016
**No DB-level format constraints for national ID (FAN), phone or other identity inputs**  
Severity **Low** · Confidence Confirmed · Category Quality · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: C-06, ET-12; owasp_top10: A03:2021; owasp_api: API8:2023; asvs: V5.1.3; iso27001: A.8.28; nist_csf: PR.DS-10

- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:350` — `phone_number text, national_id_no text,`; `supabase/migrations/00000000000000_baseline.sql:597` — `resident_email_format CHECK (...)  -- the only format CHECK on resident; none for phone/national_id_no`
- **Description:** Enumerated fields such as sex, marital_status, residency_status and house_type do have CHECK constraints. phone_number (+251 format), national_id_no (16-digit FAN), household.phone_number and service_request.applicant_phone have no DB constraint at all. Validation for them exists only in client Zod schemas.
- **Attack scenario:** A direct PostgREST insert stores a malformed or oversized national ID. Duplicate detection through the blind index then fails to match normalised values.
- **Impact:** Data quality and integrity problems. C-06 is not met at the DB layer.
- **Recommendation:** Add CHECK (national_id_no ~ '^[0-9]{16}$') and a +251 phone pattern, as NOT VALID first and then VALIDATE after cleansing the data.
- **Effort:** S · **Status:** Open

### WP-LOC-010
**Three-part name is required in the resident form but not in the database; English name is one free-text field; no short-name helper**  
Severity **Low** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-06

- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:343` — `full_name text NOT NULL,`; `supabase/migrations/00000000000000_baseline.sql:357` — `father_name text,`; `supabase/migrations/00000000000000_baseline.sql:358` — `grandfather_name text,`; `supabase/migrations/00000000000000_baseline.sql:367` — `first_name text,`; `src/lib/residentSchema.ts:19` — `full_name: nameRule("Full Name (English)"),`; `src/lib/residentSchema.ts:244` — `const full_name_am = [values.first_name, values.father_name, values.grandfather_name]`
- **Description:** The structure is correctly Ethiopian at the form level. residentSchema requires first_name, father_name and grandfather_name (the Amharic labels use 'የአባት ስም' and 'የወንድ አያት ስም'), full_name_am is composed first + father + grandfather, the birth form repeats this for the child, and there are no last_name or surname fields or Western sort assumptions anywhere (searches and sorts use full_name_am/full_name, which are given-name-first). Gaps: (1) in the database first_name, father_name and grandfather_name are nullable and only full_name is NOT NULL, so direct API writes and generate_resident_on_birth_approval() can create residents without the three parts; (2) the English name is a single free-text 'Full Name (English)' with no three-part structure and no consistency check against the Amharic parts; (3) there is no short-name (first + father) helper, so screens that need a short form (card, greetings, lists) cannot apply the owner's convention consistently; (4) app_user.full_name and the informant/witness/parent names in the civil forms are single strings.
- **Attack scenario:** Not a security exploit.
- **Impact:** Inconsistent name structure between records created through the UI and through other paths, and no canonical short name.
- **Recommendation:** Add formatShortName(r) = first_name + ' ' + father_name (and an English equivalent) in src/lib, and use it wherever a short form is shown. Consider first_name_en/father_name_en/grandfather_name_en. Once the data is backfilled, enforce the three Amharic parts on the server (NOT NULL or CHECK ... NOT VALID).
- **Effort:** S · **Status:** Open

## Module: Revenue

### WP-CRY-007
**Receipts are not unique per payment: any cashier can mint extra publicly verifiable receipts, with client-chosen numbers and tokens, for an existing payment**  
Severity **Medium** · Confidence Confirmed · Category Business Logic · Reported by `audit-crypto-qr` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: BL-01, MC-03; owasp_top10: A04:2021; owasp_api: API6:2023; asvs: V11.1.2, V11.1.4; iso27001: A.8.26; nist_csf: PR.DS-06

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:580` — `ALTER TABLE public.receipt ADD CONSTRAINT receipt_woreda_id_receipt_number_key UNIQUE (woreda_id, receipt_number);  -- no UNIQUE(payment_id) anywhere`; `supabase/migrations/00000000000000_baseline.sql:1015` — `IF NEW.receipt_number IS NOT NULL AND NEW.receipt_number <> '' THEN RETURN NEW;  -- client-supplied number kept`; `supabase/migrations/00000000000000_baseline.sql:1439` — `SELECT amount INTO v_amount FROM public.payment WHERE payment_id = NEW.payment_id; ... NEW.total_amount := v_amount;  -- no existing-receipt check`; `supabase/migrations/00000000000000_baseline.sql:1603` — `CREATE POLICY receipt_insert ... WITH CHECK (... user_has_any_perm('{payment.collect,revenue.collect,receipt.print}'))`; `supabase/migrations/00000000000013_receipt_verification.sql:43` — `IF NEW.verification_token IS NULL OR NEW.verification_token = '' THEN NEW.verification_token := public.gen_receipt_verification_token();`; `supabase/migrations/00000000000013_receipt_verification.sql:179` — `WHERE r.verification_token = _token AND p.status = 'confirmed'`
- **Description:** Receipt numbering itself is race-safe. assign_receipt_number() allocates via INSERT ... ON CONFLICT DO UPDATE ... RETURNING on receipt_sequence (a row lock, gapless per woreda-year), and (woreda_id, receipt_number) is UNIQUE. But nothing limits a payment to one receipt. Any holder of payment.collect, revenue.collect or receipt.print can POST further receipt rows against any confirmed payment in their woreda. Each gets a new sequence number (or a client-chosen one) and a new verification token, and each verifies publicly as 'Verified' with the payer's name and amount. receipt_date is client-supplied. A client-chosen receipt_number that anticipates the next sequence value makes the next legitimate receipt insert fail on the UNIQUE constraint (a denial of service, same class as WP-DB-006).
- **Attack scenario:** A cashier inserts a second receipt for last month's 1,200 ETB rent payment, with this month's receipt_date. The occupant or a colluding third party presents it as proof of a second payment. /verify/receipt/<token> shows green 'Verified'.
- **Impact:** Duplicate, independently verifiable proof-of-payment documents can be produced for the same payment, which enables revenue fraud and disputes.
- **Recommendation:** Add a partial UNIQUE index on receipt(payment_id), or a trigger that allows a new receipt only via an authorised reprint path that reuses the original number and token. Ignore client-supplied receipt_number and verification_token (always assign server-side). Pin receipt_date to current_date in the trigger. Revoke direct DML on receipt_sequence (WP-DB-006).
- **Effort:** S · **Status:** Open

### WP-DB-006
**Document-number counter tables are writable by every tenant user, and numbering triggers accept client-supplied numbers**  
Severity **Medium** · Confidence Confirmed · Category Business Logic · Reported by `audit-database` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: BL-01, C-06; owasp_top10: A04:2021, A01:2021; owasp_api: API6:2023; asvs: V4.1.3, V11.1.1; iso27001: A.8.3; nist_csf: PR.DS-10

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:L (5.4)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1554` — `CREATE POLICY credential_seq_tenant ON public.credential_number_sequence AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_use`; `supabase/migrations/00000000000000_baseline.sql:1601` — `CREATE POLICY receipt_seq_tenant ON public.receipt_sequence AS PERMISSIVE FOR ALL ...`; `supabase/migrations/00000000000084_rental_review_regression_fixes.sql:173` — `3. Sequence tables: SELECT-only for clients. Both are written only by their own SECURITY DEFINER trigger functions`; `supabase/migrations/00000000000000_baseline.sql:1015` — `IF NEW.receipt_number IS NOT NULL AND NEW.receipt_number <> '' THEN RETURN NEW;`; `supabase/migrations/00000000000000_baseline.sql:1076` — `IF NEW.resident_number IS NOT NULL AND NEW.resident_number <> '' AND NEW.resident_number <> 'AUTO' THEN`
- **Description:** Six baseline counter tables (credential_number_sequence, credential_request_sequence, receipt_sequence, rental_request_sequence, resident_number_sequence, vital_event_sequence) have FOR ALL policies that check only the tenant. Migration 84 made the two newer counters SELECT-only and gave the reason, but did not apply the same fix to the older six. Separately, 9 of the 11 assign_* numbering triggers keep any non-empty number the client sends, and there is no format CHECK on receipt_number, resident_number, request_number or event_number. The upsert-based increment itself is race-safe (ON CONFLICT DO UPDATE ... RETURNING).
- **Attack scenario:** A viewer PATCHes receipt_sequence to set last_value back by 10. From then on every receipt insert collides with receipt_woreda_id_receipt_number_key and cashiering stops until an administrator repairs the counter. Or a cashier inserts a receipt with a hand-picked receipt_number that sits outside the official series.
- **Impact:** Any tenant user can deny issuance of credentials, receipts and certificates. The official numbering series can contain forged or out-of-sequence numbers.
- **Recommendation:** Replace the six FOR ALL policies with SELECT-only policies, as migration 84 did. Always overwrite the number in the BEFORE INSERT trigger except when a dedicated service-only flag is set. Add format CHECK constraints (the Luhn/13-digit rule for credential_number, prefix patterns for the others).
- **Effort:** S · **Status:** Open

### WP-LOC-003
**No EC fiscal year (Hamle 1 - Sene 30) anywhere in revenue, reports or dashboards**  
Severity **Medium** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-04

- **Evidence:** `src/routes/woreda.reports.index.tsx:172` — `{ label: "7d", days: 7 }, ... { label: "1y", days: 365 },`; `src/routes/woreda.reports.index.tsx:66` — `const TODAY = new Date().toISOString().slice(0, 10);`; `src/routes/woreda.revenue.index.tsx:344` — `<Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />`; `src/routes/woreda.revenue.index.tsx:348` — `<Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />`; `src/routes/woreda.dashboard.tsx:361` — `label: 'Q${q} ${d.getFullYear()}',`
- **Description:** A search of src/, supabase/migrations/ and docs/ for fiscal, በጀት ዓመት, budget year and Hamle turns up no fiscal-period concept. Reports offer only rolling 7d/30d/90d/1y windows and free EC date ranges. The revenue page filters with two native Gregorian <input type="date"> pickers. The dashboard 'quarterly' view builds Gregorian calendar quarters labelled 'Q3 2026'. No report or export can be scoped to the Ethiopian government fiscal year (Hamle 1 to Sene 30) without the operator calculating the Gregorian boundaries by hand.
- **Attack scenario:** Not a security exploit. A woreda finance officer preparing the annual revenue return for EFY 2018 has to pick 2025-07-08 to 2026-07-07 by hand in a Gregorian picker. An off-by-one there silently moves a day's receipts into the wrong fiscal year.
- **Impact:** Fiscal reporting is error-prone and does not line up with how Ethiopian public-finance periods are defined. Quarterly dashboard figures do not match EFY quarters.
- **Recommendation:** Add ethiopianFiscalYearRange(efy) to ethiopianCalendar.ts, returning { start: Hamle 1 of efy-1, end: Sene 30 of efy } as ISO dates. Offer an 'EFY' preset on reports and revenue next to the rolling windows. Replace the revenue page's Gregorian pickers with <EthiopianDateInput>. Define dashboard quarters as EFY quarters (Hamle-Meskerem, Tikimt-Tahsas, Tir-Megabit, Miyazya-Sene), or label them explicitly as Gregorian.
- **Effort:** M · **Status:** Open

### WP-WF-009
**Fee payment for credentials, civil events and services is a non-atomic client-side sequence, with no one-payment-per-request or one-receipt-per-payment constraint**  
Severity **Medium** · Confidence Likely · Category Business Logic · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: BL-01, MC-02; owasp_top10: A04:2021; owasp_api: API6:2023; asvs: V11.1.2, V11.1.4; iso27001: A.8.26; nist_csf: PR.DS-01

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `src/lib/offlineSync.ts:244` — `.from("payment").insert({... status: "confirmed" ...})`; `src/lib/offlineSync.ts:265` — `await supabase.from("receipt").insert({...})`; `src/lib/offlineSync.ts:277` — `.update({ status: "paid", payment_id: paymentId })  -- three separate PostgREST calls`; `supabase/migrations/00000000000059_task14a_civil_payment_and_preconditions.sql:32` — `CREATE UNIQUE INDEX IF NOT EXISTS payment_vital_event_id_unique  -- only civil payments are unique per request`; `supabase/migrations/00000000000000_baseline.sql:580` — `receipt_woreda_id_receipt_number_key UNIQUE (woreda_id, receipt_number)  -- no UNIQUE(payment_id)`; `supabase/migrations/00000000000066_payment_hardening_review_fixes.sql:76` — `validate_credential_fee_amount(): checks amount/link/woreda, never the linked request's status`
- **Description:** Recording a fee means inserting a confirmed payment, inserting a receipt, and then PATCHing the request to 'paid'. These are three separate client calls, both online (PaymentCard in the credential, civil and service detail routes) and in offline replay. The database has no single transaction or RPC for them. Only vital_event has a unique payment-per-request index. credential_request and service_request can collect any number of confirmed payments, and receipt has no unique constraint on payment_id. The fee guard also accepts a payment for a request at any status (e.g. 'submitted'). A double submit, a retry after a network failure, or a mint-guard rejection at the final step leaves extra confirmed payments with official receipts. A second 'paid' PATCH also silently repoints payment_id.
- **Attack scenario:** A cashier double-clicks or retries after a timeout. Two confirmed payments and two publicly verifiable receipts exist for one ID request. Or a finance clerk collects and receipts a fee for a request that was never approved. The receipt verifies publicly even if the request is later rejected.
- **Impact:** Double charging, orphaned receipts that are hard to reconcile, and money collected before approval, all against the 'payment after approval' control.
- **Recommendation:** Replace the client sequence with one SECURITY DEFINER RPC per module (the pattern settle_rent_payment() already uses): resolve the fee server-side, lock the request FOR UPDATE, require status IN ('approved','awaiting_payment'), insert payment + receipt, transition to paid, and accept an idempotency key. Add partial unique indexes on payment(credential_request_id) and payment(service_request_id) WHERE status='confirmed', and UNIQUE(receipt.payment_id).
- **Effort:** M · **Status:** Open

### WP-WF-010
**Fee-waiver control is weak: any module's approve permission authorises it, the approver can waive their own approval, the audit entry is written by the client, and unaudited fee-catalog edits can zero a fee outright**  
Severity **Medium** · Confidence Likely · Category Business Logic · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: MC-03, MC-01; owasp_top10: A04:2021, A09:2021; owasp_api: API6:2023; asvs: V11.1.6, V7.1.3; iso27001: A.5.3, A.8.15; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:H/A:N (4.9)
- **Evidence:** `supabase/migrations/00000000000066_payment_hardening_review_fixes.sql:165` — `OR public.user_has_any_perm(ARRAY['credential.approve', 'service.approve', 'civil.approve', 'tenant.manage'])`; `src/lib/offlineSync.ts:332` — `action_type: waived ? "PAYMENT_WAIVED" : "PAYMENT_COLLECTED"  -- audit row inserted by the client after the fact, error ignored`; `src/routes/woreda.credentials.$requestId.index.tsx:1736` — `action_type: waived ? "PAYMENT_WAIVED" : "PAYMENT_COLLECTED",`; `supabase/migrations/00000000000000_baseline.sql:1579` — `CREATE POLICY fee_schedule_update ... user_has_any_perm('{tenant.manage}')  -- no audit trigger on fee_schedule/service_type`
- **Description:** The waiver branch of validate_credential_fee_amount() requires a reason of at least 5 characters and amount = 0 (good). Authorisation, though, is 'any of credential.approve, service.approve, civil.approve, tenant.manage', not the approve permission of the module being waived, contrary to docs/architecture.md. The user inserting the payment also needs payment.collect/revenue.collect, which by default only tenant_admin has alongside an approve verb. So in practice the same tenant_admin can approve a request and waive its fee, and no second person is involved. No trigger writes the PAYMENT_WAIVED audit row: the browser inserts it after the payment succeeds and ignores errors, and any tenant user can forge audit_log (WP-DB-008). tenant_admin can also set fee_schedule.standard_fee or service_type.fee_amount to 0, collect 'exact-match' zero payments with no waiver or reason, and restore the fee. None of these catalog edits is audited.
- **Attack scenario:** A tenant_admin approves a relative's ID request, records a waiver with the reason 'hardship', and then deletes the client-written audit row (audit_log is mutable, WP-DB-008). Or the tenant_admin temporarily zeroes 'New ID Issuance' in Settings, processes several requests, and restores the fee. The only remaining trace is payment rows with amount 0 and waived=false.
- **Impact:** Revenue can be waived or suppressed by one person with no durable, trigger-written evidence.
- **Recommendation:** Require the waiver to be authorised by a second user holding the approve permission of that module and different from the request's approver. Store waived_by/waiver_authorised_by as pinned actor columns. Write the waiver audit row inside the trigger. Add audit triggers (old/new values) on fee_schedule and service_type fee columns.
- **Effort:** M · **Status:** Open

### WP-WF-011
**Non-rental payment status and links can be changed by any payment.collect holder via direct PATCH, and uncategorised payment types yield publicly verifiable receipts for arbitrary amounts**  
Severity **Medium** · Confidence Likely · Category Business Logic · Reported by `audit-workflows` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: MC-03; owasp_top10: A01:2021, A04:2021; owasp_api: API3:2023; asvs: V11.1.4; iso27001: A.8.15, A.5.3; nist_csf: PR.AA-05

- **CVSS:** CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N (4.3)
- **Evidence:** `supabase/migrations/00000000000000_baseline.sql:1600` — `CREATE POLICY payment_update ... user_has_any_perm('{payment.collect,revenue.collect}')`; `supabase/migrations/00000000000086_rental_review_round3_fixes.sql:74` — `IF (OLD.payment_type = 'rental_rent' OR NEW.payment_type = 'rental_rent') AND (...)  -- status guard only for rental`; `supabase/migrations/00000000000066_payment_hardening_review_fixes.sql:76` — `IF NEW.payment_type NOT IN ('service_fee', 'civil_registration_fee', 'credential_fee') THEN RETURN NEW;`; `supabase/migrations/00000000000013_receipt_verification.sql:180` — `AND p.status = 'confirmed'  -- verify_receipt follows the mutable status`
- **Description:** Only rental_rent payments are protected against status, amount, date or payer changes outside reverse_rental_payment(). For credential_fee, service_fee, civil_registration_fee, penalty and house_rent rows, any payment.collect/revenue.collect holder (finance_clerk) can PATCH status between pending/confirmed/reversed. No reason, second person or trigger-written audit row is required. Reversing a fee after the credential was minted or the letter issued has no effect on those outcomes. 'penalty' and 'house_rent' payments skip the fee guard entirely, so any cashier can create a confirmed payment of any amount, not linked to any obligation, and it gets an official receipt that verify_receipt() confirms publicly.
- **Attack scenario:** A finance clerk takes cash, records a 'penalty' payment for 50 ETB but tells the payer 500 ETB and hands over a printed receipt. Later the clerk flips a genuine credential_fee payment to 'reversed' to cover a till shortage. No audit row records either change.
- **Impact:** Cash-handling fraud and reconciliation gaps outside the rental module, which already has the proper controls.
- **Recommendation:** Generalise guard_rental_payment_status_change() to all payment types. Make status/amount/type changes possible only through a reversal RPC that requires a reason, reverser != poster, and writes audit. Either retire the free-form 'penalty'/'house_rent' types or require them to be linked to an obligation and priced by the fee guard.
- **Effort:** M · **Status:** Open

## Module: Households

### WP-INV-006
**Runtime third-party requests disclose staff/public IPs to Google Fonts and viewed household/rental map locations to OpenStreetMap tile servers**  
Severity **Low** · Confidence Confirmed · Category Privacy · Reported by `audit-inventory` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-03, A-03, PRV-01; owasp_top10: A05:2021; asvs: V8.3.4, V14.2.3; iso27001: A.5.34, A.5.19; nist_csf: ID.SC-2, PR.DS-5

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N (3.1)
- **Evidence:** `src/routes/__root.tsx:124` — `href: "https://fonts.googleapis.com/css2?family=Noto+Sans+Ethiopic:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap",`; `src/components/gis/LocationPickerMap.tsx:8` — `const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";`; `src/components/gis/LocationDisplayMap.tsx:4` — `const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";`; `src/lib/security-headers.ts:55` — `'img-src 'self' data: blob: https://*.tile.openstreetmap.org ${supabase}',`
- **Description:** The root shell loads Noto Sans Ethiopic and Inter from Google Fonts on every page, including the unauthenticated verification pages, even though the primary Amharic faces (Tayitu, Jiret) are already self-hosted under public/fonts. The Leaflet location picker/display fetch tiles from the public tile.openstreetmap.org servers; tile z/x/y coordinates at street zoom reveal the approximate location of the household or rental house being viewed, together with the viewer's IP, to a third party with which no data-processing arrangement is recorded. Referrer-Policy strict-origin-when-cross-origin limits the path leak to the origin. OSM's public tile servers are also governed by a usage policy not intended for production government services.
- **Attack scenario:** A third party (or a network observer on the path to it) correlates staff IPs with tile requests to learn which neighbourhoods/residences a woreda office is looking up, and when.
- **Impact:** Minor disclosure of resident-location metadata and staff access patterns outside Ethiopia's jurisdiction; external availability dependency for fonts/maps.
- **Recommendation:** Self-host Noto Sans Ethiopic and Inter (woff2 in public/fonts, drop fonts.googleapis.com/gstatic from CSP); use a self-hosted or contracted tile service (or a tile proxy) and record it as an integration with data shared and legal basis.
- **Effort:** S · **Status:** Open

### WP-PRV-008
**Household GPS maps load tiles from tile.openstreetmap.org, sending the location being viewed and the staff IP to a foreign third party**  
Severity **Low** · Confidence Confirmed · Category Privacy · Reported by `audit-privacy-logging` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: A-03, B-03; owasp_api: API10:2023; asvs: V8.3.4; iso27001: A.5.14, A.5.19; nist_csf: ID.SC-2

- **CVSS:** CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N (3.1)
- **Evidence:** `src/components/gis/LocationDisplayMap.tsx:4` — `const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";`; `src/components/gis/LocationPickerMap.tsx:8` — `const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";`
- **Description:** When staff view or capture a household location, the browser fetches map tiles centred on the household's coordinates at high zoom from the OpenStreetMap Foundation's public tile servers. The tile x/y/z values and the request timing reveal the approximate location of the household being looked at, together with the woreda office's IP and User-Agent. The data flow is not recorded in docs/dfd.md, there is no processing agreement, and OSM's tile usage policy discourages production use of its public servers. The GPS coordinates themselves are not sent. The risk is limited to location inference by the tile operator.
- **Attack scenario:** The tile provider (or anyone on the path who can see SNI and timing) builds a list of zoom-18 tiles fetched from a government IP range, which approximates the homes being registered or inspected.
- **Impact:** A minor, undeclared cross-border disclosure of household location metadata, and an availability dependency on a free service with usage limits.
- **Recommendation:** Declare the flow in the DFD and privacy notice, or use a self-hosted or contracted tile service (e.g. a tile proxy under the platform's own domain, or a commercial provider with a DPA) and cap interactive zoom for display maps. Update the CSP img-src to match.
- **Effort:** S · **Status:** Open

### WP-SUP-003
**react-leaflet and @react-leaflet/core ship under Hippocratic-2.1 (non-OSI, ethical-use licence) in the client bundle of a government civil registry**  
Severity **Low** · Confidence Confirmed · Category Supply Chain · Reported by `audit-supplychain` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: B-02; asvs: V14.2.4; iso27001: A.5.32; nist_csf: GV.SC-05

- **Evidence:** `package.json:73` — `"react-leaflet": "^5.0.0",`; `node_modules/react-leaflet/package.json:0` — `"license": "Hippocratic-2.1" (react-leaflet 5.0.0; @react-leaflet/core 3.0.0 same)`; `src/components/gis/LocationPickerMap.tsx:0` — `imports react-leaflet (household/rental location capture)`; `src/components/gis/LocationDisplayMap.tsx:0` — `imports react-leaflet`; `docs/audit/2026-09-24/raw/supplychain-licenses.txt:1` — `total packages: 524 ... 2 Hippocratic-2.1`
- **Description:** Of the 524 installed packages, 435 are MIT, 28 ISC, 24 Apache-2.0, 16 BSD, plus a few MIT-0/0BSD/Unlicense/BlueOak. There is no GPL, AGPL, LGPL, SSPL or BUSL, so the copyleft/SaaS concern the method checks for does not apply. The one licence needing legal review is Hippocratic-2.1 on react-leaflet and its core, both runtime dependencies bundled to every browser. Hippocratic-2.1 is not OSI-approved. It conditions the grant on the licensee not violating human-rights standards (UN UDHR, ILO norms, and so on) and gives the licensor enforcement and termination rights. That clause deserves review for a government resident and ID registry. Other non-permissive entries are informational: MPL-2.0 lightningcss (build-time, file-level copyleft, unmodified), CC-BY-4.0 caniuse-lite (build data), Python-2.0 argparse (dev), and dompurify (MPL-2.0 OR Apache-2.0, transitive via jspdf).
- **Attack scenario:** Not a security exploit. The risk is licence compliance: a procurement or INSA reviewer flags a non-OSI conditional licence in a state system, or a licensor asserts termination.
- **Impact:** Possible procurement or legal blocker, and a forced map-component replacement late in the programme.
- **Recommendation:** Have the system owner's legal counsel review Hippocratic-2.1 for this deployment and record the decision. If it is unacceptable, replace react-leaflet with direct Leaflet usage (leaflet itself is BSD-2-Clause, already a dependency) through a small wrapper hook. Add a licence allow-list check to CI.
- **Effort:** M · **Status:** Open

### WP-LOC-013
**Hierarchy has no Gott level; a free-text 'Sub-Woreda' field is used instead**  
Severity **Info** · Confidence Confirmed · Category Locale · Reported by `audit-locale` · Verification: not individually re-verified (Medium sample FP rate 0/10)
  
Refs: insa: ET-10

- **Evidence:** `src/components/forms/ResidentWizardSteps.tsx:594` — `<FieldWrap labelAm="ንኡስ ወረዳ" labelEn="Sub-Woreda">`; `src/lib/residentSchema.ts:47` — `sub_woreda: z.string().trim().max(100).optional().default(""),`; `supabase/migrations/00000000000000_baseline.sql:199` — `CREATE TABLE IF NOT EXISTS public.kebele (`
- **Description:** Kebele is reference-only, as required. The kebele table carries no authority, app_user has no kebele column, no role or permission is kebele-scoped (no kebele_admin/clerk/officer anywhere in src/ or supabase/), and RLS is keyed on woreda. Region and Zone exist only as free-text fields inside the birth-place, work and former-residence JSON. There is no Gott (ጎጥ) level anywhere in the schema or UI. Instead, households and residents capture a free-text 'Sub-Woreda / ንዑስ ወረዳ', which is not part of the Region → Zone → Woreda → Kebele → Gott hierarchy in the checklist.
- **Attack scenario:** Not a security exploit.
- **Impact:** Sub-kebele location cannot be reported consistently. The label may confuse staff.
- **Recommendation:** Owner decision: either rename sub_woreda to Gott (ጎጥ) and back it with a per-kebele reference list, or document why Sub-Woreda is used.
- **Effort:** M · **Status:** Open

