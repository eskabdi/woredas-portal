# Database security audit: schema, RLS, SECURITY DEFINER, views, grants, storage

**Audit:** woredas-portal, 2026-09-24 (Meskerem 14, 2019 EC) · **Agent:** `audit-database` (Wave 1) · **HEAD:** `9950f16e`
**Checklist IDs owned:** A-07, A-08, TEN-01 to TEN-06, CLS-01 · **Machine-readable:** `findings/database.json` · **ERD:** `architecture/erd.md`

## 1. Scope, method and limits

The live Supabase database could not be reached: there was no access token and the Postgres ports are blocked. Every conclusion below is therefore drawn from the 90 migration files, replayed in filename order so that the **latest** definition of every policy, function, view and trigger is the one assessed. `CREATE OR REPLACE`, `DROP POLICY` followed by `CREATE POLICY`, and `ALTER VIEW ... SET (security_invoker)` were all resolved. The replay is scripted and reproducible:

| Script (in `raw/`) | Output |
|---|---|
| `audit-database-parse.py` | `audit-database-rls-inventory.txt` (per-table RLS, policies, storage policies, buckets, views, functions, triggers, grants), `audit-database-catalog.json`, plus function, view and table DDL dumps |
| `audit-database-fn-acl.py` | `audit-database-fn-acl.txt/json`: modelled EXECUTE ACL per function (Supabase stock default ACL plus every GRANT/REVOKE) |
| inline scans | `audit-database-definer-rpc-checks.txt`, `audit-database-status-ungated-policies.txt`, `audit-database-table-anon-grants.txt` |
| `audit-database-column-drift.py` | types.ts vs migrations, column by column |
| `audit-database-fk.py`, `audit-database-erd.py` | 190 FKs, and the Mermaid ERD |

Two caveats about the tooling:

- The statement splitter respects quoting, dollar quoting and comments. The function-body dump strips `--` comments, so a few `RAISE` strings in that dump appear truncated. The policy, grant and ACL analysis is unaffected.
- The live database may differ from the migrations. The schema was originally built in the dashboard and the baseline is a reconstruction. Anything that depends on live state is marked `Needs-live-verification`, and Appendix C queries 1–4 (`reference/appendix-c-catalog-queries.md`) should be run to close those items.

## 2. Executive summary

The tenant boundary is mostly structurally sound:

- All **66/66** public tables have RLS enabled.
- **17/17** views are `security_invoker` at their latest definition.
- All **130** `SECURITY DEFINER` functions pin `search_path`.
- Every policy is written `TO authenticated`, and none admits `anon` or `PUBLIC`.
- The tenant predicate is always derived on the server (`get_user_woreda_id()`), never taken from the client.

The newer rental ledger (migrations 76–89) follows a good pattern: SELECT only, with every write going through permission-checked DEFINER RPCs.

The main weaknesses are inside a tenant, and in how the tenant is resolved:

1. **The tenant predicate ignores account status (WP-DB-001, High).** `get_user_woreda_id()` does not check `app_user.status`. Suspended, pending and inactive staff therefore keep read access to 43 tables and full read, write and delete on 9 storage buckets. Suspension in the UI only flips a column.
2. **Read permissions are not enforced (WP-DB-004, High).** Every tenant member, including `print_officer` and custom roles with no grants, can read all resident, household, civil, payment and audit data, including decrypted national IDs.
3. **Storage has no permission gating (WP-DB-002, High).** A viewer can overwrite the woreda's official signature, stamp or logo that prints on credentials and letters, and can read or delete every scanned legal document.
4. **A DEFINER trigger crosses tenants (WP-DB-003, High).** The birth-approval trigger reads another woreda's resident through an unchecked `mother_resident_id`.

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | none (WP-DB-003 is a cross-tenant read. It is rated High, not Critical as R7 would suggest, because it needs a foreign v4 UUID and a second approver. The orchestrator may escalate.) |
| High | 4 | WP-DB-001, 002, 003, 004 |
| Medium | 8 | WP-DB-005 to 012 |
| Low | 4 | WP-DB-013 to 016 |
| Info | 1 | WP-DB-017 |

**Checklist:**

| ID | Status |
|---|---|
| A-07 | PARTIAL |
| A-08 | FAIL |
| TEN-01 | PARTIAL (enabled 66/66, forced 0/66, not live-verified) |
| TEN-02 | PARTIAL |
| TEN-03 | PASS |
| TEN-04 | PARTIAL |
| TEN-05 | PARTIAL |
| TEN-06 | PASS |
| CLS-01 | FAIL |

## 3. Controls verified as correct

These are recorded so that later waves do not re-flag them:

- **RLS coverage.** Every `CREATE TABLE` in `public` is followed by `ENABLE ROW LEVEL SECURITY` (66/66). `rate_limit_bucket` has RLS with no policies and `REVOKE ALL` (`00000000000022_rate_limit.sql:35-40`), so clients are denied everything. That is intended.
- **No client-supplied tenant.** Every tenant clause compares the row's `woreda_id` with `get_user_woreda_id()`, which is `SELECT woreda_id FROM app_user WHERE user_id = auth.uid()` (`baseline.sql:1335`). No policy trusts a request value.
- **No cross-woreda row moves (TEN-03).** Every INSERT policy has `WITH CHECK`. UPDATE and ALL policies without an explicit `WITH CHECK` reuse `USING`, which is woreda-scoped. `woreda_id` changes on `app_user`/`tenant_role` are additionally pinned or cleaned up by triggers (migrations 19 and 42).
- **Views.** All 17 are `security_invoker = on`. Migrations 27 and 45 contain `DO $sec$` assertions that fail the migration if the option is ever lost.
- **DEFINER hygiene.** 130/130 DEFINER functions set `search_path` (`'public'`, plus `'vault'` for `pii_root_key`). Key and crypto primitives (`pii_root_key`, `derive_woreda_key`, `encrypt_pii_*`, `*_blind_index`, `pii_encryption_status`, `rate_limit_hit`) are revoked from `anon` and `authenticated`. `decrypt_pii_*` re-derive the caller's woreda (`00000000000023_pii_encryption.sql:352`).
- **Privilege escalation to super_admin is blocked.** `app_user_tenant_admin_write` (`baseline.sql:1551`) only excludes `role <> 'tenant_admin'`, which on its own would allow `'super_admin'`. However, `trg_guard_console_role_assignment` (`00000000000012_enforce_console_rbac.sql:158`) raises unless the caller holds `console.console_users.manage`, so a tenant admin cannot mint a super admin.
- **Race-safe numbering.** Every counter uses `INSERT ... ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING`, which takes a row lock, and every issued number has a UNIQUE constraint (`baseline.sql:547,580,584,592,621`).
- **Credential mint.** The mint checks that the resident belongs to the request's woreda (`00000000000070_mint_guard_deceased_check.sql:28`). A direct INSERT into `residence_credential` is blocked by `enforce_workflow_insert()` (`00000000000029_workflow_insert_guard.sql:81`).
- **Birth and death side effects** run inside the same transaction as the status change (BEFORE/AFTER UPDATE triggers), and each is guarded by the `OLD.status IS DISTINCT FROM 'registered'` transition, which makes them idempotent.

## 4. Findings

### WP-DB-001 (High): `get_user_woreda_id()` ignores `app_user.status`, so suspended, pending and inactive staff keep tenant-wide access

**Evidence**

- `supabase/migrations/00000000000000_baseline.sql:1335`: `SELECT woreda_id FROM public.app_user WHERE user_id = auth.uid();` has no `status` predicate, and the function is never redefined.
- `supabase/migrations/00000000000011_status_check_admin_helpers.sql:3-7` records that this same gap was fixed for `is_super_admin()` and `is_tenant_admin()`, but `get_user_woreda_id()` was left out.
- `raw/audit-database-status-ungated-policies.txt` lists 52 policy clauses on 43 tables whose tenant branch depends only on `get_user_woreda_id()`. They include SELECT on `resident`, `household`, `vital_event`, `payment`, `receipt`, `residence_credential`, `service_request` and `audit_log`, and writes on `audit_log`, `kebele`, six `*_sequence` tables and `service_request_status_history`. All 36 tenant `storage.objects` policies are in the same position.
- `decrypt_pii_text()` (`00000000000023_pii_encryption.sql:352`) uses it, so every `*_decrypted` view returns plaintext to suspended users.
- `src/components/settings/UsersRolesTab.tsx:254-260`: suspending a user only runs `.update({ status: "suspended" })`. Nothing bans the user in GoTrue or revokes their sessions.

**Impact.** Revoking access does not work at the data layer. A dismissed employee's refresh token keeps them able to export the whole tenant's PII and to tamper with counters and audit rows. This contradicts CLAUDE.md:331, which says a non-active account's queries "come back empty".

**Fix.** Add `AND status = 'active'` inside `get_user_woreda_id()`. That one change fixes every dependent policy. Also make suspension server-side, with a GoTrue ban or a global sign-out through an Edge Function.

### WP-DB-002 (High): storage policies check only the woreda path prefix

**Evidence**

- `00000000000001_storage.sql:121-130` (tenant-assets), `00000000000014_app_user_staff_fields.sql:28-37` (staff-assets), `00000000000004_resident_documents.sql:118-131`, and `00000000000048/49` (attachments). Every clause is `bucket_id = X AND (is_super_admin() OR storage_path_woreda_id(name) = get_user_woreda_id())`, with no permission helper.
- Official branding assets are written to a stable path with upsert: `src/routes/woreda.settings.woreda-configuration.tsx:687-691`, `${woredaId}/${field}.<ext>`, for the logo, stamp and supervisor signature.
- The `resident_document` table requires `resident.read`/`household.read` (`00000000000004_resident_documents.sql:71`), but the bucket holding the same PDFs does not.

**Impact.** Any tenant user (viewer, print_officer, or a custom role with no grants) can replace the supervisor signature or stamp printed on every future ID card, letter and receipt. The same user can list and download all scanned legal documents, and delete photos and evidence.

**Fix.** Add per-bucket, per-command permission predicates: branding writes require `tenant.manage`, staff-assets writes require `user.manage` or ownership, document reads require `resident.read`, and deletes require a dedicated permission. Record uploads in the audit trail.

### WP-DB-003 (High, Likely): the birth-approval DEFINER trigger reads a foreign tenant's resident

**Evidence**

- `00000000000059_task14a_civil_payment_and_preconditions.sql:136-141`: `v_mother_id := NULLIF(d->>'mother_resident_id','')::UUID; SELECT ethnicity, religion, current_household_id ... FROM public.resident WHERE resident_id = v_mother_id;` has no `woreda_id` filter. The function is SECURITY DEFINER, so RLS does not apply.
- `enforce_vital_event_preconditions()` (`00000000000066_payment_hardening_review_fixes.sql:406`) validates the household on a birth, the resident on a death, and both spouses on a marriage, but not `mother_resident_id`.

**Impact.** When the birth reaches `registered`, a new resident row in woreda A inherits woreda B's ethnicity and religion (special-category data), the mother's Amharic name, and a foreign `current_household_id`. Exploiting this needs a woreda-B resident UUID and a second approver in A. That precondition is the only reason this is rated High rather than Critical under R7.

**Fix.** Filter the lookup by `woreda_id = NEW.woreda_id`, and reject a foreign `mother_resident_id` in the preconditions trigger.

### WP-DB-004 (High): read permissions are not enforced by SELECT RLS

**Evidence**

- SELECT policies on `resident` (`baseline.sql:1626`), `household` (:1586), `vital_event` (:1655), `payment` (:1599), `receipt` (:1604), `credential_request` (:1568), `residence_credential` (:1621), `service_request` (:1644), `rental_occupancy(_request)` (:1612/:1608), `household_location`, `audit_log` (:1553) and the history tables are all `is_super_admin() OR woreda_id = get_user_woreda_id()`.
- `src/config/permissions.ts:455-464`: `print_officer` has no `resident.read`, `civil.read`, `payment.read` or `audit.view`. `custom: []`. `viewer` has no `audit.view`. The RLS gives all of them the full data set regardless.
- The newer tables do enforce read permissions (`resident_document`, all `rent_*`/`arrears_*` via `rental.view`, `service_request_checkpoint`), so the intended model is clear.

**Impact.** The RBAC matrix, custom roles and per-user denies have no effect on reads. Any account can bulk-export resident PII, including decrypted national IDs through `resident_decrypted`.

**Fix.** Add `user_has_any_perm('{<module>.read,...}')` to each SELECT policy, and require the same permission in `decrypt_pii_*()`.

### WP-DB-005 (Medium): Restricted PII is still stored and served in plaintext

**Evidence**

- The headers of `00000000000023_pii_encryption.sql:5-37` and `00000000000044_...:8` state that plaintext "stays authoritative".
- `baseline.sql:350-361`: `national_id_no`, `phone_number`, `ethnicity` and `religion` are all `text` columns.

**Impact.** A dump or backup still exposes national ID, names, DOB, GPS, ethnicity, religion and `vital_event.event_details`. The `*_enc` columns are copies only. A-08 fails.

**Fix.** Finish the documented stage 3/4 (cut reads over, then retire the plaintext). Extend the scope to special-category data and GPS, and add masked projections for roles that do not need full values.

### WP-DB-006 (Medium): counter tables are writable by every tenant user, and client-supplied numbers are accepted

**Evidence**

- FOR ALL, woreda-only policies on `credential_number_sequence` (`baseline.sql:1554`), `credential_request_sequence` (:1559), `receipt_sequence` (:1601), `rental_request_sequence` (:1618), `resident_number_sequence` (:1623) and `vital_event_sequence` (:1652).
- `00000000000084_...:173-187` made only the two newer counters SELECT-only, stating that they "are written only by their own SECURITY DEFINER trigger functions". The same reasoning applies to these six.
- Numbering triggers return early when the client supplies a value: `baseline.sql:972, 1015, 1042, 1076, 1127, 1155` (request, receipt, rental, resident, service and vital numbers). There is no format CHECK on any number column.

**Impact.** Any user can stop issuance by rewinding a counter, which triggers unique-key collisions, or can inject numbers outside the official series. BL-01 is PARTIAL: the increment is race-safe, but the counters themselves can be tampered with.

### WP-DB-007 (Medium): `kebele` reference data is writable by every tenant user

**Evidence.** `baseline.sql:1596` `kebele_tenant_isolation FOR ALL ... woreda_id = get_user_woreda_id()`, with no permission check.

**Impact.** A viewer can rename or renumber kebeles, and the kebele number is embedded in credential numbers.

**Fix.** SELECT for tenant users; writes for super_admin or `tenant.manage` only.

### WP-DB-008 (Medium): audit trail integrity

**Evidence**

- `audit_log_tenant_insert` (`baseline.sql:1552`) lets any tenant user insert rows. `force_actor_columns()` (`baseline.sql:1208-1210`) only replaces a **non-NULL** actor, so forged rows can carry a NULL actor.
- `service_request_status_history_insert` (:1636) requires no permission.
- `household_change_log` UPDATE/DELETE (:1583/:1580) and `credential_print_log` UPDATE (:1558) mean these logs can be edited.
- `apply_death_on_approval()` writes revocation audit rows with no `woreda_id` (`00000000000059_...:108`), so the tenant cannot see them.

**Positive.** There is no UPDATE or DELETE policy on `audit_log`.

**Fix.** Write audit rows only from triggers or DEFINER RPCs, always set the actor to `auth.uid()`, make the log and history tables append-only, and set `woreda_id` on trigger-written rows.

### WP-DB-009 (Medium, Needs-live-verification): `rental_eligibility()` is DEFINER with no tenant check and is probably anon-callable

**Evidence**

- `00000000000031_rental_eligibility.sql:55` (SECURITY DEFINER, no `get_user_woreda_id()`).
- `:196-198`: `REVOKE ALL ... FROM PUBLIC` and `GRANT ... TO authenticated`. `anon` is never named, and Supabase's default ACL grants `anon` EXECUTE explicitly. Migration 07 (`00000000000007_tighten_anon_grants.sql:73-80`) documents this exact trap.

**Impact.** Given a resident UUID from any woreda, the function returns their active-occupancy id and in-flight request numbers.

**Fix.** `REVOKE ... FROM anon`, and add a woreda check plus a `rental.*` permission check inside the function.

### WP-DB-010 (Medium): `get_credential_live_status()` exposes credential status across tenants

**Evidence.** `baseline.sql:1323` runs `SELECT status FROM residence_credential WHERE credential_number = $1` as SECURITY DEFINER with no woreda filter. Migration 07 (`:81-85`) removed `anon` but kept `authenticated`, and its own comment says the function has no callers.

**Impact.** Staff in one woreda can enumerate another woreda's sequential credential numbers and read their statuses.

**Fix.** Drop the function, or scope it to the caller's woreda.

### WP-DB-011 (Medium): hard-DELETE policies on registry and financial records

**Evidence**

- `payment_delete` (`baseline.sql:1597`), `receipt_delete` (:1602), `service_request_delete` (:1642, which cascades to status history via :711), `vital_event_delete` (:1653), `resident_delete` (:1624), `credential_request_delete` (:1566) and `rental_occupancy_request_delete` (:1606).
- No trigger records these deletions.

**Impact.** Records and their history can be destroyed without leaving a trace on the server. MC-03 is not met.

**Fix.** Use soft-void statuses governed by `workflow_transition`, and drop DELETE policies on financial, registry and history tables.

### WP-DB-012 (Medium, Likely): no composite tenant foreign keys

**Evidence**

- All 190 FKs are single-column (`raw/audit-database-fks.json`). Examples: `household.kebele_id` (`baseline.sql:661`) and `resident.current_household_id` (:703).
- Complaint-category service requests skip the woreda check on `resident_id` (`00000000000066_...:346`).
- `verify_service_letter()`, which anon can call, joins `resident` without a woreda match (`00000000000064_...:41`). `verify_receipt()` does match woredas (`00000000000013_...:168-177`).

**Impact.** Cross-tenant references can form in the data, and DEFINER readers can then disclose foreign data through them.

**Fix.** Add `UNIQUE (woreda_id, id)` on parent tables with composite FKs from the children, and add the woreda match in `verify_service_letter()`.

### WP-DB-013 (Low): weaknesses in public verification tokens

**Evidence**

- Tokens are generated with `random()`, which is not a CSPRNG (`baseline.sql:1236`, `00000000000013_...:16-33`).
- A token supplied by the client is kept (`baseline.sql:997`).
- `service_request.verification_token` is not pinned on UPDATE. Only the receipt token is (`00000000000013_...:79`).
- A real letter token is quoted in a migration comment: `00000000000064_...:12` (`SJ44…[REDACTED]`).

**Fix.** Generate tokens with `gen_random_bytes`, ignore client-supplied values, add a pin trigger, and remove the quoted token and regenerate it.

### WP-DB-014 (Low, Needs-live-verification): seven of ten buckets have no MIME or size limit

**Evidence.** `00000000000001_storage.sql:24-50` (`NULL, NULL` for six buckets), `00000000000014_...:23` and `00000000000048_...:345`. Only `resident-documents` (`00000000000004_...:113`) and `rental-request-documents` (`00000000000072_...:262`) are constrained.

**Fix.** Set `allowed_mime_types` and `file_size_limit` on every bucket.

### WP-DB-015 (Low): defence in depth

**Evidence**

- `anon` keeps SELECT/INSERT/UPDATE/DELETE on 63 of 66 tables (`00000000000007_...:32-35` revoked only TRUNCATE, TRIGGER and REFERENCES; `baseline.sql:1665-1671`).
- `FORCE ROW LEVEL SECURITY` is used on 0 tables.
- DEFINER `search_path = 'public'` does not put `pg_temp` last, and several DEFINER functions create temp tables.

**Impact.** Nothing is exploitable today, because every policy is `TO authenticated`. The margin is thin, though: a single future policy without a `TO` clause would open the table to `anon`.

### WP-DB-016 (Low): no DB-level format constraints for FAN/national ID or phone

**Evidence.** `baseline.sql:350-351` (plain `text`). The only format CHECK on `resident` is for email (:597).

**Fix.** Add `CHECK` constraints for 16-digit FAN and `+251` phone numbers (create them `NOT VALID`, then `VALIDATE`).

### WP-DB-017 (Info): documentation drift

**Evidence**

- `docs/erd.md:10` claims 52 tables. There are 66, and the 14 rental tables are missing.
- CLAUDE.md:582 says migrations are "additive-only, no DROP". That is contradicted by `00000000000010_id_card_template_draft.sql:28` (`DROP COLUMN status`) and by 28 `DROP CONSTRAINT` statements across 16 migrations.

**Positive.** `types.ts` and the migrations agree exactly (66 tables, 17 views, 64 callable functions, every column).

## 5. RLS matrix: all 66 tables (latest policy state)

Legend:

- `woreda` means `woreda_id = get_user_woreda_id()`.
- `perm:` lists the `user_has_any_perm` keys required.
- `(ALL)` marks a `FOR ALL` policy.
- Almost every clause also admits `is_super_admin()`. The exceptions are the write policies on `service_request` and `service_request_attachment`, and the INSERT policy on `service_request_status_history`, which have no super-admin branch.
- Every policy is `TO authenticated`.
- RLS is enabled on all 66 tables, and FORCE on none.

Source: `raw/audit-database-rls-inventory.txt`.

| Table | RLS | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `app_user` | on | super_admin only (ALL); woreda; woreda + tenant_admin (ALL) | super_admin only (ALL); woreda + tenant_admin (ALL) | super_admin only (ALL); woreda + tenant_admin (ALL) | super_admin only (ALL); woreda + tenant_admin (ALL) |
| `approval` | on | woreda + entity_approve_perm_ok + perm:approval.queue.view | woreda + entity_approve_perm_ok | — (denied) | — (denied) |
| `arrears_installment_charge` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `arrears_plan_sequence` | on | woreda | — (denied) | — (denied) | — (denied) |
| `arrears_repayment_installment` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `arrears_repayment_plan` | on | woreda + perm:rental.view | — (denied) | woreda + perm:rental.plan.approve/rental.plan.create/rental.plan.manage | — (denied) |
| `attachment` | on | woreda + entity_read_perm_ok | woreda + entity_attach_perm_ok | — (denied) | — (denied) |
| `audit_log` | on | woreda | woreda | — (denied) | — (denied) |
| `console_role` | on | super_admin only; user_has_console_perm (ALL) | user_has_console_perm (ALL) | user_has_console_perm (ALL) | user_has_console_perm (ALL) |
| `console_role_permission` | on | super_admin only; user_has_console_perm (ALL) | user_has_console_perm (ALL) | user_has_console_perm (ALL) | user_has_console_perm (ALL) |
| `credential_number_sequence` | on | woreda (ALL) | woreda (ALL) | woreda (ALL) | woreda (ALL) |
| `credential_policy` | on | woreda | woreda + perm:credential.configure_policy | woreda + perm:credential.configure_policy | — (denied) |
| `credential_print_log` | on | woreda | woreda + perm:credential.authorize_reprint | woreda + perm:credential.print | woreda + perm:tenant.manage |
| `credential_request` | on | woreda | woreda + perm:credential.issue | woreda + perm:credential.approve/credential.issue/credential.verify/paymen | woreda + perm:credential.approve |
| `credential_request_sequence` | on | woreda (ALL) | woreda (ALL) | woreda (ALL) | woreda (ALL) |
| `credential_request_status_history` | on | woreda | woreda + perm:credential.approve/credential.issue/credential.verify/paymen | — (denied) | — (denied) |
| `credential_status_history` | on | woreda | woreda + perm:credential.approve/credential.issue/credential.print/credent | — (denied) | — (denied) |
| `credential_verification_log` | on | woreda | — (denied) | — (denied) | — (denied) |
| `fee_schedule` | on | woreda | woreda + perm:tenant.manage | woreda + perm:tenant.manage | woreda + perm:tenant.manage |
| `household` | on | woreda | woreda + perm:household.create | woreda + perm:household.update | woreda + perm:household.update |
| `household_change_log` | on | woreda | woreda + perm:household.create/household.update | woreda + perm:household.update | woreda + perm:tenant.manage |
| `household_location` | on | woreda | woreda + perm:household.update | woreda + perm:household.update | woreda + perm:household.update |
| `id_card_template` | on | all authenticated; super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) |
| `id_card_template_field` | on | all authenticated; super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) |
| `id_card_template_field_draft` | on | all authenticated; super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) |
| `kebele` | on | woreda (ALL) | woreda (ALL) | woreda (ALL) | woreda (ALL) |
| `kebele_rental_house` | on | woreda | woreda + perm:rental.create | woreda + perm:rental.approve/rental.create/rental.vacate | woreda + perm:tenant.manage |
| `office` | on | super_admin only (ALL); woreda | super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) |
| `payment` | on | woreda | woreda + perm:payment.collect/revenue.collect | woreda + perm:payment.collect/revenue.collect | woreda + perm:tenant.manage |
| `payment_reconciliation_exception` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `rate_limit_bucket` | on | — (denied) | — (denied) | — (denied) | — (denied) |
| `receipt` | on | woreda | woreda + perm:payment.collect/receipt.print/revenue.collect | woreda + perm:payment.collect/receipt.print/revenue.receipt_reprint | woreda + perm:tenant.manage |
| `receipt_sequence` | on | woreda (ALL) | woreda (ALL) | woreda (ALL) | woreda (ALL) |
| `rent_account` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `rent_account_sequence` | on | woreda | — (denied) | — (denied) | — (denied) |
| `rent_charge` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `rent_payment_settlement` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `rent_rate_history` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `rent_reminder` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `rental_occupancy` | on | woreda | — (denied) | — (denied) | woreda + perm:tenant.manage |
| `rental_occupancy_request` | on | woreda | woreda + perm:rental.create/rental.vacate | woreda + perm:rental.approve/rental.create/rental.vacate | woreda + perm:tenant.manage |
| `rental_payment` | on | woreda + perm:rental.view | — (denied) | — (denied) | — (denied) |
| `rental_policy` | on | woreda | woreda + perm:rental.policy.configure | woreda + perm:rental.policy.configure | — (denied) |
| `rental_request_document` | on | woreda | woreda + perm:rental.create | woreda + perm:rental.create | woreda + perm:rental.create |
| `rental_request_sequence` | on | woreda (ALL) | woreda (ALL) | woreda (ALL) | woreda (ALL) |
| `residence_credential` | on | woreda | woreda + perm:credential.issue | woreda + perm:credential.approve/credential.issue/credential.print/credent | woreda + perm:credential.revoke |
| `resident` | on | woreda | woreda + perm:resident.create | woreda + perm:resident.update | woreda + perm:resident.delete |
| `resident_document` | on | woreda + perm:household.read/resident.read | woreda + perm:resident.update | woreda + perm:resident.update | woreda + perm:resident.update |
| `resident_number_sequence` | on | woreda (ALL) | woreda (ALL) | woreda (ALL) | woreda (ALL) |
| `role_permission` | on | woreda | woreda + tenant_admin + perm:civil.approve/credential.approve/credential.configure_policy | woreda + tenant_admin + perm:civil.approve/credential.approve/credential.configure_policy | — (denied) |
| `service_request` | on | woreda | woreda + perm:complaint.manage/service.create/service.submit/tenant.manage | woreda + perm:complaint.manage/service.approve/service.complete/service.cr | woreda + perm:tenant.manage |
| `service_request_attachment` | on | woreda | woreda + perm:complaint.manage/service.create/service.verify/tenant.manage | woreda + perm:complaint.manage/service.create/service.verify/tenant.manage | woreda + perm:complaint.manage/service.create/tenant.manage |
| `service_request_checkpoint` | on | woreda + perm:rental.report/service.read | — (denied) | — (denied) | — (denied) |
| `service_request_sequence` | on | woreda | — (denied) | — (denied) | — (denied) |
| `service_request_status_history` | on | woreda | woreda | — (denied) | — (denied) |
| `service_type` | on | woreda | woreda + perm:tenant.manage | woreda + perm:tenant.manage | woreda + perm:tenant.manage |
| `tenant_module_config` | on | super_admin only (ALL); woreda | super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) |
| `tenant_role` | on | woreda | woreda + tenant_admin | woreda + tenant_admin | — (denied) |
| `tenant_role_permission` | on | woreda | woreda + tenant_admin | woreda + tenant_admin | — (denied) |
| `user_permission_override` | on | woreda + tenant_admin | woreda + user_permission_override_target_role_ok + tenant_admin | woreda + user_permission_override_target_role_ok + tenant_admin | woreda + user_permission_override_target_role_ok + tenant_admin |
| `vital_event` | on | woreda | woreda + perm:civil.create_event/civil.register | woreda + perm:civil.approve/civil.create_event/civil.record_payment/civil. | woreda + perm:civil.approve |
| `vital_event_sequence` | on | woreda (ALL) | woreda (ALL) | woreda (ALL) | woreda (ALL) |
| `woreda` | on | all authenticated; super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) |
| `woreda_settings` | on | woreda | woreda + perm:tenant.manage | woreda + perm:tenant.manage | woreda + perm:tenant.manage |
| `workflow_status_history` | on | woreda | — (denied) | — (denied) | — (denied) |
| `workflow_transition` | on | all authenticated; super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) | super_admin only (ALL) |

## 6. Storage

There are **10** buckets in the migrations, all `public = false`. CLAUDE.md says nine, and the `tenant-isolation-review` agent says seven; both are out of date.

| Bucket | Limits (migrations) | Policies | Scoping |
|---|---|---|---|
| credential-request-documents | none | S/I/U/D | woreda prefix only |
| credential-templates | none | read: all authenticated; write: super_admin | platform-level by design (not a finding) |
| rental-request-documents | PDF/JPEG/PNG, 5 MB (`00000000000072_...:262`) | S/I/U/D | woreda prefix only |
| resident-clearance-letters | none | S/I/U/D | woreda prefix only |
| resident-photos | none | S/I/U/D | woreda prefix only |
| resident-documents | PDF, 10 MB (`00000000000004_...:113`) | S/I/U/D | woreda prefix only |
| service-request-documents | none | S/I/U/D (no super_admin on writes) | woreda prefix only |
| tenant-assets | none | S/I/U/D | woreda prefix only; **holds the official logo, stamp and signature** |
| staff-assets | none | S/I/U/D | woreda prefix only; **holds staff signatures** |
| attachments | none | S/I/U/D | woreda prefix only |

TEN-06 (per-woreda scoping) passes. Permission gating inside the tenant does not (WP-DB-002), and there is no status gating either (WP-DB-001). `storage_path_woreda_id()` casts the first path segment to `uuid`, so an object whose name does not start with a UUID raises an error instead of matching. That makes the check fail closed.

## 7. Callable SECURITY DEFINER functions (54)

"Tenant re-derived" and "Permission check" come from a grep of each function's latest body and were then reviewed by hand for the gaps flagged. "anon EXECUTE" is modelled from Supabase's stock default ACL plus every GRANT/REVOKE statement (`raw/audit-database-fn-acl.txt`). It needs Appendix C q3/q4 to confirm against the live database. The other 76 DEFINER functions are trigger functions, which PostgREST cannot call directly.

| Function (latest def) | anon EXECUTE (modelled) | Tenant re-derived | Permission check | Verdict |
|---|---|---|---|---|
| `create_arrears_repayment_plan` (00000000000087_rental_review_round4_fixes.sql:303) | no | yes | yes | OK |
| `current_console_permissions` (00000000000012_enforce_console_rbac.sql:65) | no | no | no | Self only |
| `current_permissions` (00000000000039_task13_custom_role_resolution.sql:119) | no | no | no | Self only |
| `decrypt_pii_numeric` (00000000000023_pii_encryption.sql:371) | no | no | no | Delegates to decrypt_pii_text |
| `decrypt_pii_text` (00000000000023_pii_encryption.sql:324) | no | yes | no | Tenant only, no permission (WP-DB-004) |
| `derive_woreda_key` (00000000000023_pii_encryption.sql:177) | no | no | no | Not granted to authenticated/anon |
| `encrypt_pii_numeric` (00000000000023_pii_encryption.sql:278) | no | no | no | Not granted to clients |
| `encrypt_pii_text` (00000000000023_pii_encryption.sql:252) | no | no | no | Not granted to clients |
| `entity_approve_perm_ok` (00000000000053_task11_review_round2.sql:152) | no | no | yes | Predicate helper |
| `entity_attach_perm_ok` (00000000000053_task11_review_round2.sql:132) | no | no | yes | Predicate helper |
| `entity_belongs_to_woreda` (00000000000053_task11_review_round2.sql:75) | no | yes | no | Predicate helper |
| `entity_read_perm_ok` (00000000000053_task11_review_round2.sql:112) | no | no | yes | Predicate helper |
| `generate_rent_charges` (00000000000076_rental_phase2_financial_core.sql:533) | no | yes | yes | OK |
| `generate_rent_reminders` (00000000000080_rental_phase4_arrears.sql:999) | no | yes | yes | OK |
| `get_civil_kpis` (00000000000067_task14c_civil_kpis.sql:13) | no | yes | yes | OK |
| `get_credential_kpis` (00000000000057_task12b_credential_kpis.sql:39) | no | yes | yes | OK |
| `get_credential_live_status` (00000000000000_baseline.sql:1323) | no | no | no | **Gap** WP-DB-010 |
| `get_rent_account_ledger_summary` (00000000000087_rental_review_round4_fixes.sql:457) | no | yes | yes | OK |
| `get_rental_arrears_aging_report` (00000000000083_rental_phase5_checkpoint.sql:581) | no | yes | yes | OK |
| `get_rental_billing_collection_report` (00000000000083_rental_phase5_checkpoint.sql:543) | no | yes | yes | OK |
| `get_rental_checkpoint_activity_report` (00000000000083_rental_phase5_checkpoint.sql:688) | no | yes | yes | OK |
| `get_rental_plan_compliance_report` (00000000000083_rental_phase5_checkpoint.sql:646) | no | yes | yes | OK |
| `get_rental_reconciliation_report` (00000000000083_rental_phase5_checkpoint.sql:724) | no | yes | yes | OK |
| `get_service_kpis` (00000000000062_task14b_payment_issuance_and_preconditions.sql:211) | no | yes | yes | OK |
| `get_user_woreda_id` (00000000000000_baseline.sql:1335) | no | yes | no | Self only; ignores status (WP-DB-001) |
| `is_active_app_user` (00000000000002_credential.sql:185) | no | no | no | Self only |
| `is_super_admin` (00000000000011_status_check_admin_helpers.sql:15) | no | no | no | Self only, status-checked |
| `is_tenant_admin` (00000000000011_status_check_admin_helpers.sql:25) | no | no | yes | Self only, status-checked |
| `my_national_id_blind_index` (00000000000044_task6_household_rent_national_id_pii.sql:103) | no | yes | no | Caller woreda only |
| `my_phone_blind_index` (00000000000023_pii_encryption.sql:394) | no | yes | no | Caller woreda only |
| `national_id_blind_index` (00000000000044_task6_household_rent_national_id_pii.sql:78) | no | no | no | Not granted to clients |
| `phone_blind_index` (00000000000023_pii_encryption.sql:294) | no | no | no | Not granted to clients |
| `pii_encryption_status` (00000000000044_task6_household_rent_national_id_pii.sql:192) | no | no | no | service_role only |
| `pii_root_key` (00000000000023_pii_encryption.sql:148) | no | no | no | Not granted to clients |
| `provision_rent_account` (00000000000087_rental_review_round4_fixes.sql:115) | no | yes | yes | OK |
| `rate_limit_hit` (00000000000022_rate_limit.sql:46) | no | no | no | service_role only |
| `refresh_rent_ledger_statuses` (00000000000081_rental_phase4_review_fixes.sql:527) | no | yes | yes | OK |
| `rental_eligibility` (00000000000031_rental_eligibility.sql:55) | **yes** | no | no | **Gap** WP-DB-009 |
| `resolve_civil_fee` (00000000000059_task14a_civil_payment_and_preconditions.sql:386) | no | yes | yes | OK |
| `resolve_credential_fee` (00000000000054_task12_fee_catalog_repair.sql:67) | no | yes | no | Own-woreda fee only; no permission needed |
| `resolve_reconciliation_exception` (00000000000086_rental_review_round3_fixes.sql:196) | no | yes | yes | OK |
| `resolve_rental_checkpoint` (00000000000083_rental_phase5_checkpoint.sql:342) | no | no | no | Delegates to _core (checks) |
| `resolve_rental_checkpoint_core` (00000000000083_rental_phase5_checkpoint.sql:218) | no | yes | yes | Internal; not granted |
| `resolve_service_fee` (00000000000062_task14b_payment_issuance_and_preconditions.sql:162) | no | yes | yes | OK |
| `reverse_rental_payment` (00000000000089_rental_review_round6_fixes.sql:434) | no | yes | yes | OK |
| `settle_arrears_installments` (00000000000089_rental_review_round6_fixes.sql:233) | no | yes | yes | OK |
| `settle_rent_payment` (00000000000087_rental_review_round4_fixes.sql:582) | no | yes | yes | OK |
| `user_has_any_perm` (00000000000000_baseline.sql:1381) | no | no | yes | Self only |
| `user_has_console_perm` (00000000000009_console_roles.sql:60) | no | no | yes | Self only |
| `user_has_perm` (00000000000039_task13_custom_role_resolution.sql:83) | no | no | yes | Self only, status-checked |
| `user_permission_override_target_role_ok` (00000000000019_override_hardening.sql:60) | no | no | no | Leaks only admin/non-admin bit for a UUID |
| `verify_credential_token` (00000000000034_task3_harden_credential_verification.sql:145) | **yes** | yes | no | Public by design; PII gated by is_active_app_user() |
| `verify_receipt` (00000000000013_receipt_verification.sql:134) | **yes** | no | no | Public by design; woreda-matched joins |
| `verify_service_letter` (00000000000064_task14b_verify_letter_completed_status.sql:22) | **yes** | no | no | Public by design; resident join not woreda-matched (WP-DB-012) |

## 8. Sensitive-column inventory (A-08)

The class labels are the auditor's. "Protection" describes what the migrations do to the column today.

| Table.column | Class | Protection at rest | Who can read it (RLS) |
|---|---|---|---|
| resident.national_id_no (FAN) | Restricted | Plaintext, authoritative. `national_id_no_enc` (pgp_sym, per-woreda key) plus a blind index added in migration 44 | Every tenant user (WP-DB-004) |
| resident.phone_number, email | Confidential | Plaintext, plus `_enc` copy and phone blind index (migration 23) | Every tenant user |
| resident.full_name / _am / first, father, grandfather, mother names | Confidential | Plaintext | Every tenant user |
| resident.date_of_birth, sex, marital_status | Confidential | Plaintext | Every tenant user |
| resident.ethnicity, religion | **Special category** | Plaintext; not in encryption scope | Every tenant user |
| resident.birth_place, work_info, former_residence, current_residence_extra (jsonb) | Confidential | Plaintext | Every tenant user |
| resident.photo_url | Restricted (biometric-adjacent) | Path to a private bucket object | Row: every tenant user. Object: every tenant user (WP-DB-002) |
| household.gps_lat/gps_lng; household_location.gps_* | Restricted | Plaintext | Every tenant user |
| household.phone_number, email, address_line | Confidential | Plaintext (+ `_enc` for phone and email) | Every tenant user |
| household.rent_amount; payment.amount; rental_occupancy(_request).rent_amount; rent_* amounts | Financial | Plaintext + `_enc` (rent_* tables: `_enc` plus sync triggers) | Tenant (rent_* require `rental.view`) |
| service_request.applicant_name, details, incident_place, respondent_name, issued_letter_html | Confidential | Plaintext (+ `applicant_phone_enc`) | Every tenant user |
| vital_event.event_details (jsonb: child, parents, spouses, death details) | Restricted | Plaintext | Every tenant user |
| residence_credential.qr_payload; receipt/service_request.verification_token | Bearer token | Plaintext (by design; public verification) | Every tenant user; anon via the verify RPCs by token |
| woreda_settings.supervisor_signature_url / stamp_url / logo_url; app_user.signature_path | Integrity-critical | Private bucket path | Row: tenant. Object: writable by any tenant user (WP-DB-002) |
| audit_log.source_ip, old/new_value_json; credential_verification_log.source_ip | Personal data (IP), may embed PII | Plaintext | Every tenant user (no `audit.view` check) |
| Passwords | Secret | Only in `auth.users` (GoTrue bcrypt); no password or secret column in `public` | n/a |

There are no column-level GRANTs and no masking views anywhere in the migrations. CLS-01 fails.

## 9. Grants

- **Tables.** The baseline grants the full privilege set to `anon` and `authenticated` on every table (`baseline.sql:1665` onward). Migration 07 revokes TRUNCATE, TRIGGER and REFERENCES on all tables and in default privileges for `postgres`. DML stays granted to both roles on 63 of 66 tables; the exceptions, which revoke all, are `credential_verification_log`, `rate_limit_bucket` and `service_request_checkpoint`. RLS is the only thing stopping `anon`. It holds today, because no policy targets `anon` or `PUBLIC`.
- **Views.** The `*_decrypted` views and `approval_queue_v` are `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT SELECT TO authenticated`. `household_member_roster` still carries the baseline `anon` grants, but it is `security_invoker`, so `anon` sees nothing.
- **Functions.** The modelled ACL (`raw/audit-database-fn-acl.txt`) leaves 99 of 153 functions executable by `anon`. 89 of those are trigger functions and cannot be called directly. Of the callable ones, the only DEFINER functions reachable by `anon` are `verify_credential_token`, `verify_receipt` and `verify_service_letter` (public by design) and `rental_eligibility` (WP-DB-009). The non-DEFINER helpers that `anon` can also reach (`luhn_check_digit`, `default_role_perms`, `storage_path_woreda_id`, `gen_*_token`, `check_credential_print_eligibility`) do not expose data.

## 10. Triggers, counters and side effects

- **Counters.** Counters are tables, not `CREATE SEQUENCE` objects. Each is incremented with an upsert that takes a row lock, which is race-safe. Every issued number is protected by a UNIQUE constraint.
- **Gaps.** Six counter tables can be written by clients, and client-supplied numbers are accepted (WP-DB-006).
- **Birth to resident.** `generate_resident_on_birth_approval` is a BEFORE UPDATE trigger that runs in the same transaction as the status change. It is guarded by `NEW.resident_id IS NULL` and the status transition, so it is atomic and idempotent. It has a cross-tenant lookup gap (WP-DB-003).
- **Death to revoke.** `apply_death_on_approval` sets the resident to deceased, revokes active credentials and writes history in the same transaction, scoped to `NEW.woreda_id`. Its audit rows carry no `woreda_id` (WP-DB-008).
- **Workflow engine.** `enforce_workflow_transition` is attached to 6 tables (credential_request, residence_credential, vital_event, rental_occupancy_request, service_request, arrears_repayment_plan). The transition semantics are left to `audit-workflows`.
- **Full list.** 139 latest trigger bindings are listed in `raw/audit-database-rls-inventory.txt` §Triggers.

## 11. Checklist

| ID | Status | Evidence / note |
|---|---|---|
| A-07 | PARTIAL | `docs/erd.md:10` claims 52 tables against 66 actual (14 rental tables missing). The regenerated `architecture/erd.md` covers 66 entities and 189 relationships. Two template tables have no FK to `id_card_template`. The live-database match is UNVERIFIED. |
| A-08 | FAIL | Sensitive columns are marked (§8, ERD). Passwords are only in `auth.users`. Restricted PII keeps an authoritative plaintext copy, and special-category data and GPS are unencrypted (WP-DB-005). |
| TEN-01 | PARTIAL | RLS enabled 66/66, FORCE 0/66, from migrations. Live `relrowsecurity` UNVERIFIED (Appendix C q1). |
| TEN-02 | PARTIAL | The tenant is always derived on the server, and `woreda_id` is NOT NULL on tenant tables (nullable by design on app_user, audit_log and credential_verification_log). But the helper ignores status (WP-DB-001), and there are no composite tenant FKs (WP-DB-012). |
| TEN-03 | PASS | Every INSERT has WITH CHECK. UPDATE/ALL policies reuse the woreda-scoped USING. |
| TEN-04 | PARTIAL | Views 17/17 invoker, and DEFINER search_path pinned 130/130. The tenant re-check is missing in `rental_eligibility`, `get_credential_live_status` and the birth trigger (WP-DB-003/009/010). |
| TEN-05 | PARTIAL | No policy admits `anon`, but `anon` keeps DML grants, and `rental_eligibility` is probably anon-callable. Needs Appendix C q4. |
| TEN-06 | PASS | 36/36 tenant storage policies use the woreda path prefix. `credential-templates` is platform-level by design. See WP-DB-002 for the in-tenant gap. |
| CLS-01 | FAIL | No column grants and no masked views. print_officer and zero-grant custom roles read national ID, ethnicity, religion and GPS (WP-DB-004/005). |

## 12. Documentation drift

| Claim | Source | Verdict | Evidence |
|---|---|---|---|
| A pending user's queries "come back empty" because `user_has_perm()` requires active | CLAUDE.md:331 | CONTRADICTED | 43 tables are gated only by `get_user_woreda_id()`, which ignores status |
| Migrations are additive-only, with no DROP except A5 | CLAUDE.md:582 | CONTRADICTED | `00000000000010_...:28` `DROP COLUMN status`; 28 `DROP CONSTRAINT` statements |
| 52 tables, zero drift | docs/erd.md:10, CLAUDE.md:152 | CONTRADICTED | 66 tables; 14 rental tables missing |
| Nine buckets / "All seven buckets are private" | CLAUDE.md; tenant-isolation-review.md | CONTRADICTED | 10 buckets, all private |
| 66 tables / 17 views / 64 functions in types.ts | shared-context.md | CONFIRMED | Exact match with migrations, including every column |
| No policy admits anon or PUBLIC | `00000000000007_...:8` | CONFIRMED | Every policy is `TO authenticated` |
| All views are security_invoker | migrations 06/27/45 | CONFIRMED | 17/17 |
| tenant_admin cannot mint a super_admin | CLAUDE.md (A7 / console) | CONFIRMED | `trg_guard_console_role_assignment` |
| Newer counter tables are SELECT-only | `00000000000084_...:173` | CONFIRMED | The same fix was not applied to the 6 baseline counters |

## 13. Live verification handed to the user

These queries cannot be run from this sandbox. Run them read-only (Appendix C), or in the SQL editor:

```sql
-- WP-DB-001: does get_user_woreda_id() check status live?
select pg_get_functiondef('public.get_user_woreda_id()'::regprocedure);
-- WP-DB-009 / TEN-05: anon EXECUTE on DEFINER functions
select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef order by 2 desc, 1;
-- TEN-01: RLS and FORCE per table
select relname, relrowsecurity, relforcerowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;
-- WP-DB-014: bucket limits
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;
-- Drift: count tables, views and functions against 66 / 17 / 153
select (select count(*) from pg_tables where schemaname = 'public') t,
       (select count(*) from pg_views where schemaname = 'public') v,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) f;
```
