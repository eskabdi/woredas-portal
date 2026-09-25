# Privacy and Logging Audit: woredas-portal

Audit 2026-09-24 · agent `audit-privacy-logging` (Wave 2) · repository HEAD `9950f16` · read-only, reasoned from source and migrations (no live DB access)

Machine-readable companion: `findings/privacy-logging.json`. PII inventory as CSV: `privacy/pii-inventory.csv`. Raw command output: `raw/privacy-logging-evidence.txt`.

## 1. Summary

The platform has done real privacy engineering work. It has per-tenant AES-256 column encryption with blind indexes, a public verifier that withholds DOB and photo from anonymous callers, and a database-written verification log. Exports are minimised and protected against CSV formula injection. The service worker never caches API data, and client `console.*` usage is disciplined. The weaknesses are in accountability and in what happens to personal data after it leaves the primary tables.

- **The audit trail is mostly browser-written.** Resident and household edits, deactivations, document deletions, suspensions, permission overrides, the role matrix, settings and module toggles are logged by a second client request with a client-supplied timestamp. A direct PostgREST call changes a FAN or a deceased flag with no trace (WP-PRV-001).
- **Plaintext copies undermine the encryption.** Resident-edit audit diffs store the FAN, phone, religion and ethnicity in cleartext jsonb, which every tenant member can read and nothing purges (WP-PRV-002). The resident wizard and the offline queue keep full PII, including cause of death and complaint narratives, in `localStorage` with no expiry. These are cleared only by an in-app sign-out (WP-PRV-003).
- **Exports and profile prints leave no trail** and carry no exporter identity (WP-PRV-004).
- **Special-category data** (ethnicity, religion, cause of death) is mandatory at intake, and no lawful basis is recorded (WP-PRV-005).
- **No privacy governance artefacts exist**: no retention schedule, privacy notice, DSAR or breach procedure, and no documented hosting region (WP-PRV-006).

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 6 | WP-PRV-001 … 006 |
| Low | 3 | WP-PRV-007, 008, 009 |
| Info | 1 | WP-PRV-010 |

Checklist verdicts (owned): **D-05 FAIL · LOG-01 FAIL · PRV-01 PARTIAL · A-03 (PII-flow part) PARTIAL**.

Related Wave 1 findings, referenced here and not duplicated: WP-DB-001 (inactive staff keep read access), **WP-DB-004** (SELECT policies ignore read permissions, so every role reads residents and audit_log), **WP-DB-005** (plaintext PII beside ciphertext; encryption scope), **WP-DB-008** (audit_log forgeable, NULL actor, mutable log tables), WP-DB-011 (hard deletes without trail), WP-DB-002 (storage objects not permission-gated).

## 2. Scope and method

- PII inventory built from `src/integrations/supabase/types.ts` (column lists, which match migrations per WP-DB), `supabase/migrations/*` (latest function and policy definitions resolved, e.g. `resident_pii_sync` from migration 44, `verify_credential_token` from 34, `verify_service_letter` from 64), and every client read, export and print path.
- Logging: every `audit_log` writer enumerated. 23 migration files contain DB-side inserts, 36 client files and 7 Edge Functions write from the application (`raw/privacy-logging-evidence.txt` §1-4). Triggers on PII and permission tables enumerated (§5). `console.*` enumerated across `src/` and `supabase/functions/` (§6).
- Browser storage: every `localStorage`/`sessionStorage`/`indexedDB`/`caches` use (§7), every offline-queue enqueue site (§8), `public/sw.js` read in full.
- Legal mapping: the Ethiopian Personal Data Protection Proclamation. **Citation note:** "Proclamation No. 1321/2024" matches the auditor's recollection (enacted 2024, with the Ethiopian Communications Authority as supervisory authority). It **could not be verified offline** against the Federal Negarit Gazette. Article numbers are deliberately not cited, and counsel should confirm the citation and the specific provisions before this report is relied on for compliance.

## 3. PII inventory (PRV-01)

Classification scheme used (the project has none of its own): **Public**, **Internal**, **Confidential** (personal data), **Restricted** (identifiers, location, biometrics-adjacent, special-category and health data).

"Tenant member" means any `app_user` of the woreda regardless of role or permission, and (per WP-DB-001) regardless of `status`, plus any super admin. That is what the SELECT policies actually allow (WP-DB-004). Client-side `PermissionGate`/`hasPermission` checks narrow what the UI shows but do not narrow PostgREST.

| # | Data element | Table.column | Class | Who can read (DB) | Column-encrypted? | Exported / printed | Retention |
|---|---|---|---|---|---|---|---|
| 1 | FAN / national ID | `resident.national_id_no` (+`_enc`, `_blind_index`) | Restricted | Tenant member | AES-256 copy; **plaintext authoritative** | ID-card fallback only; not in any export; **copied into audit_log diffs** (WP-PRV-002); wizard draft | Undefined |
| 2 | Names (Am/En, father, grandfather) | `resident.full_name`, `full_name_am`, `first_name`, `father_name`, `grandfather_name` | Confidential | Tenant member | No | All list exports; all prints; ID card; QR payload; public verify pages | Undefined |
| 3 | Mother's name | `resident.mother_full_name` | Confidential | Tenant member | No | Profile print; wizard draft | Undefined |
| 4 | Date of birth | `resident.date_of_birth` | Confidential | Tenant member | No | Residents CSV/PDF; ID card; **QR payload**; staff-only on `/v` | Undefined |
| 5 | Sex | `resident.sex` | Confidential | Tenant member | No | Residents export; ID card; QR | Undefined |
| 6 | Marital status | `resident.marital_status` | Confidential | Tenant member | No | Profile print | Undefined |
| 7 | Deceased flag | `resident.residency_status = 'deceased'` | Confidential | Tenant member | No | Residents export (status) | Undefined |
| 8 | Ethnicity | `resident.ethnicity`; `vital_event.event_details.ethnicity` | Restricted (special) | Tenant member | No | Profile print; report aggregates; wizard draft; offline queue | Undefined |
| 9 | Religion | `resident.religion`; `vital_event.event_details.religion` | Restricted (special) | Tenant member | No | Profile print; report aggregates; wizard draft; offline queue | Undefined |
| 10 | Phone | `resident.phone_number`, `household.phone_number`, `service_request.applicant_phone` | Confidential | Tenant member | AES-256 copy + blind index; plaintext authoritative | Profile/household/occupant prints; audit diffs; offline queue | Undefined |
| 11 | Email | `resident.email`, `household.email` | Confidential | Tenant member | AES-256 copy; plaintext authoritative | Profile/household prints | Undefined |
| 12 | Household GPS | `household.gps_lat/lng`, `household_location.gps_lat/lng` | Restricted | Tenant member | No | Map views (OSM tiles, WP-PRV-008); wizard draft | Undefined |
| 13 | Address / house no. | `household.address_line`, `house_number`; `resident.current_residence_extra`, `birth_place`, `former_residence` | Confidential | Tenant member | No | Prints; QR payload (house no., kebele) | Undefined |
| 14 | Photo | `resident.photo_url` → bucket `resident-photos` | Restricted | Tenant member, read/write/delete (WP-DB-002) | Provider storage encryption only (live check needed) | ID card; profile print; signed URLs 10-15 min | Undefined; not removed on deactivation |
| 15 | Scanned documents | `resident_document`, `credential_request.supporting_document_path`, `attachment`, `service_request_attachment`, `rental_request_document` | Restricted | Row: `*.read`; objects: path prefix only | Provider only | Signed URLs 5-10 min | Undefined; deletion unaudited |
| 16 | Civil events | `vital_event.event_details` (child, parents, spouse, witnesses, informant phone, **cause of death**, **divorce grounds**, birth weight) | Restricted (health/family) | Tenant member | No | Civil list export (names); certificates; offline queue | Undefined (vital records usually permanent; needs a decision) |
| 17 | Service/complaint content | `service_request.applicant_name`, `details`, `respondent_name`, `incident_place`, `issued_letter_html` | Confidential / Restricted | Tenant member | Only `applicant_phone` | Services export; letter print; public letter verify (name, summary); offline queue | Undefined |
| 18 | Work / education | `resident.work_info` | Confidential | Tenant member | No | Report aggregates; profile print | Undefined |
| 19 | Financial | `payment.amount`, `rent_*`, `arrears_*`, `household.rent_amount` | Confidential | Tenant member / `rental.view` | AES-256 copy; plaintext authoritative | Revenue export; receipts | Undefined |
| 20 | Credential token | `residence_credential.qr_payload` | Confidential | Tenant member; public via `/v/<token>` | Signed, not encrypted | Printed QR; host access logs; verification log | Undefined |
| 21 | Staff identity | `app_user.full_name`, `username`, `photo_path`, `signature_path`, `last_login_at` | Internal / Confidential | Own row; tenant admin; super admin | No | Platform users export; signatures on documents | Undefined |
| 22 | Audit payloads | `audit_log.old_value_json` / `new_value_json` | Confidential (holds Restricted) | Tenant member (WP-DB-004) | No | Audit export (payload columns excluded) | **Never purged** |
| 23 | IP addresses | `audit_log.source_ip`, `credential_verification_log.source_ip` | Confidential | Tenant member / super admin | No | Audit export (Source IP column) | **Never purged** |
| 24 | Verification probes | `credential_verification_log.attempted_value` (full token incl. name/DOB) | Confidential | Matched tenant staff / super admin | No | none | **Never purged** |

Passwords exist only in `auth.users` (GoTrue, bcrypt). No `public` column holds a password or secret.

## 4. Logging (D-05)

### 4.1 What is logged

| Event class | Logged? | Writer | Tamper-resistant? |
|---|---|---|---|
| Resident created | Yes | Trigger `audit_resident_created` (migration 43:47) | Yes |
| Resident / household edited, deactivated | Yes, if the browser completes it | Client (`residents.$residentId.edit.tsx:241`, `ResidentActions.tsx:158`) | **No** |
| Resident document deleted | **No** | none (`ResidentProfileTabs.tsx:863`) | n/a |
| Workflow status change (credential_request, residence_credential) | Yes | Trigger `log_workflow_transition` (migration 25:350) | Yes |
| Workflow status change (vital_event, rental request, service_request) | Yes, in `workflow_status_history` | Trigger (migration 58) | Yes (separate table) |
| Approvals / verifications with reason | Yes | Client history rows + client audit rows | Partly |
| Role / custom-role / tenant-role-permission change | Yes | Triggers (migrations 40/41) | Yes |
| role_permission matrix, per-user overrides, suspension, console roles, module toggles, settings (signature/stamp), fee schedule | Yes, if the browser completes it | Client | **No** |
| Credential print / reprint, receipt print | Yes | Client (`credential_print_log`, `RECEIPT_PRINTED`) | No |
| Credential revocation | Yes | Client + trigger (death: migration 59, but with `woreda_id` NULL, WP-DB-008) | Partly |
| Invites, re-invites, activation, password-reset link, QR signing | Yes, with `source_ip` | Edge Functions (service role) | Yes (server-side) |
| Rental ledger / settlement / arrears | Yes | SECURITY DEFINER RPCs (migrations 76-89) | Yes |
| Public QR verification | Yes (token + IP) | `verify_credential_token` (migration 34) | Yes |
| **Login success / failure / logout / password change** | **No** (only `last_login_at` overwritten) | none | n/a (WP-PRV-007) |
| **CSV/PDF exports, profile prints** | **No** | none | n/a (WP-PRV-004) |
| Read access to Restricted records | No | none | n/a (not usually required; worth considering for FAN views) |

### 4.2 What must never be logged

| Item | Status | Evidence |
|---|---|---|
| Passwords | Not logged | Only sent to GoTrue; no app handler logs them |
| JWTs, service-role key, signing key | Not logged | `console.*` inventory (§6 of raw) has no token output; `safeError()` returns fixed strings |
| FAN in plaintext | **Logged** | Resident-edit diffs (WP-PRV-002) |
| Phone, email, religion, ethnicity | **Logged** | Same path |
| Raw driver errors to the client | Not returned (Edge); **shown in toasts** from the client (WP-BQ-001, appsec owns) | `_shared/response.ts:73-80` |
| Raw driver errors to server logs | Logged in full (may include `detail` values) | WP-PRV-010 |

Client `console.*` in production: seven call sites (`client.ts:18`, `auth-middleware.ts:18`, `client.server.ts:18`, `server.ts:34,48`, `start.ts:13`, `__root.tsx:38`). All are configuration or error-boundary logs. There is no `console.log` of data. No third-party telemetry SDK (Sentry, PostHog, GA) is present.

## 5. Audit-trail integrity (LOG-01)

- **Table exists:** `audit_log` (`baseline.sql:37`), polymorphic `(entity_name, entity_id)`, with `old_value_json`/`new_value_json`, `actor_user_id`, `woreda_id`, `action_at`, `source_ip`.
- **Append-only:** Only partly. RLS defines INSERT and SELECT policies only (`baseline.sql:1552-1553`), so authenticated clients cannot UPDATE or DELETE. The table-level UPDATE/DELETE grants remain, though, and service_role/owner can rewrite history. There is no hash chain or WORM export. `household_change_log` and `credential_print_log` are updatable (WP-DB-008).
- **Trigger-written vs client-written:** Mostly client-written (§4.1). Any tenant user can insert arbitrary rows, and a NULL `actor_user_id` survives `force_actor_columns()` (`baseline.sql:1206-1211`; WP-DB-008).
- **Actor:** Pinned only if non-NULL (WP-DB-008). **Woreda:** Correct except the death-revocation rows (NULL). **Action:** Free text chosen by the client. **Before/after:** Present only where the client builds it; the role_permission audit records only the new value. **Timestamp:** `DEFAULT now()` is overridden by the client at 20 call sites (`action_at: new Date().toISOString()`). **IP / user-agent:** IP only on Edge Function rows, and advisory (spoofable header). No user-agent anywhere.

Verdict: **LOG-01 FAIL.** Remediation is in WP-PRV-001, together with WP-DB-008.

## 6. Exports and prints

- Nine list pages export CSV/PDF through `src/utils/tableExport.ts`. Seven exports (residents, households, civil, credentials, rental houses, rental requests, woreda audit) each pull up to 5,000 rows per click (`range(0, 4999)`) with the user's JWT; the others export the loaded rows. Exports require only the page's read permission. `P.REPORT_EXPORT` gates only `/woreda/reports`.
- Export content is **well minimised**: no FAN, phone, GPS, religion or ethnicity in any list export. CSV cells are protected against formula injection (`tableExport.ts:33-38`).
- PDF/CSV carry the issuer (woreda branding), a generation timestamp, a record count and "official internal export". They do **not** carry exporter identity, a confidentiality or personal-data marking, or a watermark. They are **not audited** and **not rate-limited** (WP-PRV-004).
- Profile prints (resident, household, rental occupant) are client-gated by `resident.read`/`household.read`/`rental.view`. They include decrypted phone/email and photo, and ethnicity/religion for residents. They show "Printed: <date>" but not "Printed by", and are not audited. ID-card and receipt prints are logged.

## 7. Browser storage and service worker

| Store | Key | Content | Cleared when | Assessment |
|---|---|---|---|---|
| Service worker cache | `woreda-portal-shell-v1` | `/`, `/favicon.png` only | New SW version | **Clean.** Never intercepts API/Auth/Storage (`public/sw.js:36-49`); `/` is the unauthenticated shell (`ssr:false` routes render no data server-side) |
| localStorage | `sb-<ref>-auth-token` | Supabase session (JWT, refresh token, user email) | signOut | C-04 PARTIAL; auth-session agent owns it |
| localStorage | `wizard-draft:resident-new:<woreda>` | Full resident intake incl. FAN, DOB, ethnicity, religion, phone, GPS | Submit; in-app sign-out / idle timeout | **WP-PRV-003** |
| localStorage | `offline-queue:<woreda>` | Full insert bodies: civil events (cause of death, witnesses), service requests/complaints, payment drafts | Sync; in-app sign-out / idle timeout | **WP-PRV-003**; replays under whoever is signed in next |
| localStorage | `woredas.idle.lastActivityAt` | Timestamp | none | No PII |
| localStorage | report presets (`reportPresets.ts`) | Filter settings | none | No PII |
| TanStack Query cache | in memory | Query results | `queryClient.clear()` on sign-out | Not persisted (no `persistQueryClient`) |

The `SIGNED_OUT` auth event (session expiry, remote revocation, sign-out in another tab) clears only the zustand store (`useAuthBootstrap.ts:126-128`), not drafts, queue or query cache. That is safe for the other-tab case because localStorage is shared and the originating tab clears it, but not for expiry or revocation.

## 8. Mapping to the Personal Data Protection Proclamation (No. 1321/2024, citation unverified offline)

| Principle / obligation | Status | Basis |
|---|---|---|
| Lawful basis and purpose specification | **Gap** | No record of processing or lawful-basis statement. A public-authority mandate for civil registration is plausible but undocumented, especially for special-category fields (WP-PRV-005/006) |
| Transparency (notice to data subject) | **Gap** | No resident-facing privacy notice at intake |
| Purpose limitation | Partial | Registry data is reused for rental checkpoints and population reports, with no purpose register |
| Data minimisation | Partial | Exports minimised (good); mandatory ethnicity/religion; QR carries DOB and house number (WP-PRV-009) |
| Accuracy / rectification | Partial | Staff edit flows exist; no data-subject request channel |
| Storage limitation | **Gap** | No retention for any element (WP-PRV-006) |
| Security (integrity and confidentiality) | Partial | TLS/HSTS, RLS tenant isolation, per-tenant AES-256 for a subset. Undermined by WP-DB-001/002/004/005, WP-PRV-002/003 |
| Sensitive-data conditions | **Gap** | Ethnicity, religion and health data treated as ordinary PII |
| Accountability (demonstrable compliance, logs) | **Gap** | Client-written audit trail (WP-PRV-001); no DPIA |
| Data-subject rights (access, rectification, erasure, objection) | **Gap** | No procedure |
| Breach notification | **Gap** | No runbook |
| Cross-border transfer | **Unverified / likely gap** | Supabase and Vercel regions undocumented; OSM tiles (WP-PRV-008) |

## 9. Findings

### WP-PRV-001 · Medium · Changes to identity records and privileges are audited by the browser, not the database

Resident and household UPDATE/DELETE, resident-document deletion, suspension, per-user permission overrides, the `role_permission` matrix, `woreda_settings` (official signature, stamp and logo), fee schedule, service types and module toggles have **no audit trigger**. Their audit rows come from a separate client request after the business write, with `action_at` taken from the browser clock. A direct PostgREST PATCH to `resident` (e.g. changing `national_id_no` or `residency_status` to `deceased`) leaves no record. The resident edit path also writes its audit row without confirming the update matched a row (`woreda.residents.$residentId.edit.tsx:217-249`). Triggers already exist for resident INSERT (migration 43:47), workflow status (25:350), and roles (40/41), which shows the correct pattern.
**Fix:** a generic `SECURITY DEFINER` `AFTER INSERT/UPDATE/DELETE` audit trigger on the listed tables, with Restricted fields masked; a `BEFORE INSERT` trigger on `audit_log` that pins `action_at := now()` and `actor_user_id := auth.uid()`; revoke client INSERT on `audit_log`. Effort M.

### WP-PRV-002 · Medium · Restricted PII copied in plaintext into audit_log

`buildResidentPayloadCore()` (`residentSchema.ts:251-262`) includes `national_id_no`, `phone_number`, `ethnicity` and `religion`. The edit page diffs it into `old_value_json`/`new_value_json` (`edit.tsx:229-249`). `audit_log_tenant_read` (`baseline.sql:1553`) lets any tenant member read it. The FAN that migration 44 encrypted therefore survives in cleartext forever, and will still be there after the planned stage-4 plaintext drop. This contradicts `docs/security-functionality.md:267`.
**Fix:** record `[changed]` or a keyed hash for Restricted keys; back-fill existing rows under change control; gate SELECT on `audit.view` (WP-DB-004). Effort S.

### WP-PRV-003 · Medium · Plaintext PII in localStorage with no expiry

The resident wizard autosaves every field (`useFormDraft.ts:84`, `residents.new.tsx:58`). The offline queue stores full civil, service and payment insert bodies (`offlineQueue.ts:63`; e.g. `cause_of_death` at `civil.death.new.tsx:63`). Both are cleared only by the shells' `handleSignOut` (`AppShell.tsx:387-401`). They are not cleared on `SIGNED_OUT` (`useAuthBootstrap.ts:126`), a closed browser, or a revoked session, and the idle timer restarts at mount (`useIdleTimeout.ts:79-84`). Queued items sync as whoever signs in next in the same woreda (`offlineSync.ts:374`), and `force_actor_columns()` re-attributes them to that person.
**Fix:** keep Restricted fields out of drafts; add a TTL and a user-id stamp; refuse to sync items from a different user; clear on `SIGNED_OUT`; if persistence across restarts is required, use WebCrypto AES-GCM with a non-extractable key. Effort M.

### WP-PRV-004 · Medium · Bulk exports and profile prints are unaudited and unattributed

Up to 5,000 rows per click on seven lists (`residents.index.tsx:308`, households, civil, credentials, rental houses, rental requests, woreda audit). The preamble and footer carry a timestamp and "official internal export" only (`tableExport.ts:56,283`). Resident profile print includes ethnicity, religion, phone, email and photo (`residents.$residentId.print.tsx:237-260`), and shows "Printed: <date>" without the user (`PrintDocumentShell.tsx:480`). There is no `audit_log` write for any export or profile print.
**Fix:** `log_export` RPC with row count, filter and format, plus a per-user budget via `rate_limit_hit()`; gate on an export permission; stamp exporter identity and a personal-data notice; add "Printed by". Effort M.

### WP-PRV-005 · Medium · Mandatory special-category data without lawful basis or extra protection

`ethnicity` and `religion` are required at intake (`residentSchema.ts:34-35`). Birth events copy them (`civil.birth.new.tsx:76-77`), death events record `cause_of_death` (`civil.death.new.tsx:36,63`), and reports aggregate by ethnicity and religion without small-cell suppression (`reports.$reportType.print.tsx:87-88`). These fields are plaintext, readable by every tenant member, and printed.
**Fix:** a documented legal mandate per field, or make the field optional or remove it; column-level `REVOKE SELECT` with a permission-gated view; Phase C encryption; suppress report cells below 5. Effort M.

### WP-PRV-006 · Medium · No privacy governance layer

The migrations contain no retention, purge or anonymisation logic (only `rate_limit_bucket` self-cleans, migration 22:19-22). `credential_verification_log` keeps every public scan's full token and IP forever (migration 34:91,98). There is no privacy notice, record of processing, DSAR procedure, breach runbook or DPIA, and neither the Supabase nor the Vercel region is documented.
**Fix:** RoPA, retention schedule enforced by a scheduled job, Amharic-first notice at intake, DSAR and breach runbooks, and a documented hosting region with the transfer basis. Effort L.

### WP-PRV-007 · Low · Authentication events absent from the application audit trail

`record-login` deliberately writes no audit row (`record-login/index.ts:17-19`) and overwrites `last_login_at`. Failed sign-ins (`login.tsx:100-103`), logouts, idle time-outs and password changes are not recorded app-side. GoTrue platform logs exist, but their retention and visibility need live verification.
**Fix:** write `LOGIN_SUCCEEDED` from `record-login` (IP and UA already available); log failures via an auth hook or Edge Function with a hashed email; log logout, idle time-out and password change. Effort S.

### WP-PRV-008 · Low · OSM tile requests disclose viewed household locations to a foreign third party

`LocationDisplayMap.tsx:4`, `LocationPickerMap.tsx:8` use `tile.openstreetmap.org`. The flow is undeclared in the DFD and there is no processing agreement.
**Fix:** declare the flow, or use a contracted or self-hosted tile proxy. Effort S.

### WP-PRV-009 · Low · QR token exposes DOB and house number and travels in the URL path

The payload (`sign-credential/index.ts:206-218`) is readable base64 and is decoded by `harariCredentialCrypto.ts:119-131`. It is carried in `/v/<token>` and stored whole in `credential_verification_log.attempted_value`. This conflicts with the anon-DOB suppression in migration 34:300-301 and with `docs/dfd.md:73`. CRY-02 (payload format) belongs to the crypto agent.
**Fix:** drop `h` and consider dropping `b`; carry the token in the URL fragment; hash `attempted_value`. Effort M.

### WP-PRV-010 · Info · Raw driver errors in server-side function logs

`safeError()` logs the full error object (`_shared/response.ts:79`), and Postgres `detail` can echo values such as emails. Log code and message only, with redaction. Effort S.

## 10. Checklist verdicts

| ID | Status | Note |
|---|---|---|
| **D-05** | **FAIL** | A logging policy is documented and `console.*` usage is clean. But logged events are incomplete (auth, exports, document deletion), the "no PII in logs" exclusion is violated (WP-PRV-002), and the trail is not append-only or tamper-resistant (WP-PRV-001, WP-DB-008). |
| **LOG-01** | **FAIL** | RLS blocks client UPDATE/DELETE, but most rows are client-written with a client clock, the actor can be NULL, before/after is optional, and there is no user-agent and no tamper evidence. |
| **PRV-01** | **PARTIAL** | Complete inventory produced by this audit (§3, `privacy/pii-inventory.csv`). The project has no owned inventory or classification, retention is undefined for every element, and access and encryption gaps are material. |
| **A-03** (PII-flow part) | **PARTIAL** | `docs/dfd.md` marks 4 PII flows and maps them to RLS/TLS. It omits localStorage stores, exports and prints, audit_log PII copies, OSM tiles, the QR-token-in-URL flow and GoTrue mail, and its encryption statement is stale. The service worker is correctly not a PII store. |

## 11. Documentation drift

| Claim | Source | Verdict | Evidence |
|---|---|---|---|
| audit_log insert-only "by convention but not DB-enforced" | CLAUDE.md:423 | CONTRADICTED | RLS has no UPDATE/DELETE policy (`baseline.sql:1552-1553`), so it *is* enforced for client roles, though not for service_role, and inserts are forgeable |
| "5 of the 6 Edge Functions populate source_ip" | CLAUDE.md:426; security-functionality.md:252,282 | CONTRADICTED | 7 of 8 functions write `source_ip` (all except `record-login`) |
| Audit payloads are narrow, not full PII | security-functionality.md:267 | CONTRADICTED | Resident-edit diffs include FAN, phone, ethnicity, religion |
| `console.error` only in a fixed set of files, no tokens or payloads | security-functionality.md:245-250 | CONFIRMED | raw §6 |
| Every read call site uses the decrypted views | security-functionality.md:195 | CONTRADICTED | Plaintext `national_id_no` selected at `credentials.$requestId.index.tsx:193`, `print.tsx:218` |
| Stage 4 (drop plaintext) not started | security-functionality.md:196; migration 23:5-8 | CONFIRMED | No drop in migrations 00-89 |
| FAN, phone and email protected by RLS, "not column-level encryption" | docs/dfd.md:85-88 | CONTRADICTED | Stale: `_enc` columns since migrations 23/44 |
| Verifier sends "token only, no PII" | docs/dfd.md:73-74,98 | CONTRADICTED | Token contains name, DOB, sex, kebele, house number |
| SW never intercepts Supabase calls, shell only | public/sw.js:1-14,36-40 | CONFIRMED | `sw.js:14,42-43` |
| Drafts and queue cleared on both shells' sign-out | offlineQueue.ts:114-118; useFormDraft.ts:105-108 | CONFIRMED | `AppShell.tsx:387-401,549-561`. Does not cover `SIGNED_OUT` from expiry or revocation |
| `record-login` writes no audit row | record-login/index.ts:17-19 | CONFIRMED | Only updates `last_login_at` |
| role_permission audit only after a confirmed write | CLAUDE.md:427-431 | CONFIRMED | `RolesPermissionsTab.tsx:166-180` |
| Proclamation 1321/2024 addressed | audit brief | NOT FOUND | No reference in the repo; citation unverified offline |

## 12. Positive observations

- Per-tenant key derivation with a three-valued-logic-safe tenant check in `decrypt_pii_text()` (migration 23:351-357), and `pii_root_key()`/`derive_woreda_key()` revoked even from `service_role`.
- `verify_credential_token()` returns photo and DOB only to staff (migration 34:300-301), and every probe is logged by the DB itself, append-only by grants.
- List exports exclude every Restricted column, and CSV formula-injection is guarded.
- Short-lived signed URLs (5-15 min) for all personal files; logos 60 min.
- `sign-credential` reads all payload fields from the DB, never from the request, and logs only the credential number.
- No analytics or telemetry SDKs; the service worker is deliberately narrow.

## 13. Blockers for go-live (privacy and logging)

1. WP-PRV-001 together with WP-DB-008: a DB-enforced audit trail for identity, privilege and settings changes (LOG-01/D-05 FAIL).
2. WP-PRV-002: purge and stop plaintext FAN and special-category data in audit_log.
3. WP-PRV-005/006: a legal decision on the special-category fields and the hosting region, with a retention schedule, before real resident data is loaded. **Requires system-owner and counsel input; confirm the Proclamation citation.**
