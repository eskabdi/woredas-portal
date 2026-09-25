# Authorization audit: RBAC model, route guards, server enforcement, module toggles, console roles

**Audit:** woredas-portal, 2026-09-24 · **Agent:** `audit-authz` (Wave 2) · **HEAD:** `9950f16e`
**Checklist IDs owned:** D-01, E-06, B-04 (enforcement part), TEN-02, RBAC-01, RBAC-02, RBAC-03
**Machine-readable:** `findings/authz.json` · **Artifacts:** `authz/permission-matrix.md`, `authz/route-guard-matrix.md`, `raw/authz-*`

## 1. Scope, method and limits

This review builds on the database agent's replay of all 90 migrations (`raw/audit-database-rls-inventory.txt`, `raw/audit-database-function-bodies.sql`). Every behaviour below is asserted against the **latest** definition of the policy or function in question. Findings that share a root cause with the database report cite its IDs and are not re-scored.

The review covered five areas:

1. **Permission lineage.** Each of the 80 `P` keys was traced from `ROLE_PERMISSIONS` (`src/config/permissions.ts`) through the latest `default_role_perms()` (`00000000000083:96-113`) and the `role_permission` seed (`supabase/seed.sql`) to every server evaluation point: RLS predicates, SECURITY DEFINER function bodies, `workflow_transition.required_permission` rows, and Edge Function checks. The work is scripted (`raw/authz-matrix.py`, `raw/authz-enforcement.py`) and its output is `authz/permission-matrix.md`.
2. **Route guards.** For all 63 portal route files, the page-level guard, `ModuleGate`, button-level gates and every client write call site (224 `.insert`/`.update`/`.upsert`/`.delete` and storage call sites across src/, plus RPC calls) were enumerated. Each write was paired with the RLS predicate that actually governs it (`raw/authz-routes.py` → `authz/route-guard-matrix.md`).
3. **Edge Functions.** All eight service-role Edge Functions were reviewed by hand for caller, status, tenant, permission and console-scope checks.
4. **Escalation paths.** Paths were reasoned through for tenant_admin → super_admin, self-edit, reserved keys, overrides, custom roles, and scoped super_admin → unrestricted.
5. **Least privilege.** Viewer and auditor were checked for read-only behaviour at the database.

The live database was not reachable. Live-state items are marked `Needs-live-verification`, with queries in §9.

## 2. Executive summary

The **escalation model is sound.** A tenant_admin cannot edit their own row. They cannot mint or promote a super_admin or a second tenant_admin, cannot touch reserved keys through any of the three grant surfaces, and cannot affect admin grants at all. Custom roles fail closed, and per-user overrides are pinned to the target's tenant. `ROLE_PERMISSIONS` and `default_role_perms()` match exactly. RBAC-02 passes.

The weaknesses sit **between the matrix and what the server enforces**:

1. **Console roles are cosmetic (WP-AZ-001, High).** Four of the five `CP` keys exist only in React. Every table, RPC and Edge Function they are meant to protect checks `is_super_admin()`, so a "Template Editor" super_admin can still read every woreda's PII, re-role users, toggle modules and mint tenant admins with a direct API call.
2. **Approved workflow records are editable by unrelated roles (WP-AZ-002, High).** The FSM only checks permissions on status changes. Coarse UPDATE policies admit `payment.collect` or `credential.verify` holders, and no trigger pins identity fields. A finance clerk can therefore swap `resident_id` on an approved credential request before recording payment, and the card is minted for an unverified person. Separately, `resident.residency_status` (deceased) is writable with `resident.update` alone.
3. **The `credential.verify` key means two things (WP-AZ-003).** It is the ID-lookup key given to viewer and auditor, and it also grants credential-request writes, so read-only roles are not read-only at the DB. Seed and default still disagree on it (F-05, open).
4. **Module toggles are UI-only (WP-AZ-004).** Only letter-category service requests are blocked server-side. RBAC-03 fails.
5. **The matrix promises more than the server enforces (WP-AZ-005).** 14 of 80 permission keys are never evaluated on the server (read/report/audit/revenue keys; root cause shared with WP-DB-004). `print_officer` cannot be assigned and cannot do its own job (WP-AZ-006).

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | none |
| High | 2 | WP-AZ-001, WP-AZ-002 |
| Medium | 4 | WP-AZ-003, 004, 005, 006 |
| Low | 2 | WP-AZ-007, 008 |
| Info | 1 | WP-AZ-009 |

**Checklist**

| ID | Status | One-line reason |
|---|---|---|
| D-01 | FAIL | The SFD has no route/RPC/Edge→guard→policy matrix, and its enforcement claim is contradicted. The matrix is produced here. |
| E-06 | FAIL | Edge Functions and DEFINER RPCs check caller, tenant and permission. Some PostgREST writes check no permission, or only a coarse, unrelated one. Console scope is ignored. |
| B-04 | FAIL | Documented role boundaries do not match DB enforcement. Viewer and auditor can write, and read boundaries are not enforced. |
| TEN-02 | PARTIAL | The tenant is always derived on the server. The helper ignores status (WP-DB-001), there are no composite FKs (WP-DB-012), and super_admin scope is not enforced (WP-AZ-007). |
| RBAC-01 | FAIL | P = ROLE_PERMISSIONS = default_role_perms() (0 differences). The seed differs from the default in 3 cells ×6 woredas. 14 keys have no server enforcement. |
| RBAC-02 | PASS | No self-escalation path for tenant_admin. Evidence in §4. |
| RBAC-03 | FAIL | 7 of the 8 module keys are enforced only in the browser. |

## 3. How authorization actually resolves (as built)

| Layer | Mechanism | Evidence |
|---|---|---|
| Identity → role | `app_user.role`/`status`/`woreda_id` row. No JWT custom claims. | `baseline.sql:1335-1362`, `00000000000011:15-33` |
| super_admin cross-tenant | `is_super_admin()` = `role='super_admin' AND status='active'`, OR-ed into almost every policy | `00000000000011:15-23` |
| tenant_admin | `is_tenant_admin()` (role + active). Defaults-only; never in `role_permission` | `00000000000011:25-33`, `00000000000035:65-70` |
| Built-in staff roles | `user_has_perm()`: override → `role_permission` → `default_role_perms()`, active users only | `00000000000039:83-117` |
| Custom role | `user_has_perm()` custom branch → `tenant_role_permission` of an **active** role in the **same** woreda, else false | `00000000000039:97-106` |
| Workflow verbs | `enforce_workflow_transition()` checks `workflow_transition.required_permission` on **status changes only** | `00000000000046:135-200` |
| Console axis | `user_has_console_perm()` (NULL console_role = unrestricted). Used server-side only for `console.console_users.manage` | `00000000000009:60-81`, `00000000000012:37-44,150` |
| Module axis | `tenant_module_config`. Server reader: `enforce_service_request_preconditions()` only | `00000000000066:391-400` |
| Client | `current_permissions()` → `authStore.permissions` → `PermissionGate`/`hasPermission`. Falls back to compiled defaults on error | `useAuthBootstrap.ts:85`, `authStore.ts:83` |

The database resolves **writes** through this chain almost everywhere. **Reads** on base tables use only the tenant predicate (WP-DB-004), so for SELECT the chain applies only to rental ledger tables, `resident_document`, `attachment`, `approval` and the KPI/report RPCs.

## 4. Controls verified as correct (do not re-flag)

- **Compiled/SQL lockstep.** An independent comparison of `ROLE_PERMISSIONS` against the latest `default_role_perms()` found 0 differences across all 10 role values (`raw/authz-permission-matrix.json`).
- **Reserved keys (A4).** The same 10 keys are excluded by the `role_permission` INSERT/UPDATE policies, the `user_permission_override_no_locked_keys` CHECK and the `tenant_role_permission_no_reserved_keys` CHECK (`00000000000078:79-128`), and they match `RESERVED_PERMISSION_KEYS` (`permissions.ts:186-197`). The matrix UI greys out the same set (`RolesPermissionsTab.tsx:34`).
- **A7.** `role_permission_role_name_check` allows only the 7 non-admin roles (`00000000000035:65-70`, never redefined later). tenant_admin and super_admin resolve from defaults only.
- **No self-edit.** `app_user_tenant_admin_write` USING and WITH CHECK both require `role <> 'tenant_admin'` (`baseline.sql:1551`). A tenant_admin can neither edit their own row nor produce a tenant_admin row. There is no self-write policy on `app_user`.
- **No super_admin minting.** `guard_console_role_assignment()` (`00000000000012:94-155`) raises on INSERT of an unrestricted super_admin, on promotion of an existing row (the NULL→NULL case is covered by `becomes_unrestricted`), and on any self-change to `console_role_id`, unless the caller holds `console.console_users.manage`. A tenant_admin never holds that key. `invite-tenant-user` refuses both admin roles (`:73-75`). `invite-platform-admin` requires an active super_admin, plus the console key when minting a super_admin (`:64-94`).
- **Overrides.** Admin targets are excluded by `user_permission_override_target_role_ok()` (`00000000000019:60-99`). `woreda_id` is re-derived from the target's `app_user` row by trigger (`00000000000017:52-66`), and overrides are cleared on a tenant move (`00000000000019:111-127`).
- **Custom roles.** They fail closed. An inactive role or one from another woreda grants nothing, and names cannot shadow built-in roles (`00000000000041:139+`). `tenant_role` has its woreda pinned (`00000000000042:57`).
- **Cross-tenant IDOR on PostgREST.** Every detail route fetches by id (`.eq("<pk>", params.id)`) under woreda-scoped SELECT policies, so a foreign id returns zero rows. Signed storage URLs are checked against the path prefix. The only cross-tenant readers are DEFINER functions already reported: WP-DB-003, WP-DB-009, WP-DB-010 and WP-DB-012.
- **Edge Functions.** All 8 resolve the caller from the JWT and require `status='active'`. The tenant-scoped ones compare the body's `woredaId` or the target's woreda with the caller's. `sign-credential` checks `user_has_perm('credential.print')` through the caller's JWT (`:120-127`). Nothing trusts a body `user_id`.
- **Rental ledger.** Every money path runs through DEFINER RPCs with woreda and permission checks. The tables themselves are SELECT-only.

## 5. Findings

### WP-AZ-001 (High): console permissions are enforced only in the browser

**Evidence**

- `user_has_console_perm()` appears in RLS only for `console_role`/`console_role_permission` (`00000000000012:37-44`) and in the `console_role_id` trigger (`:150`).
- `publish_id_card_template()` checks only `is_super_admin()` (`00000000000010:125`). So do `id_card_template*` writes (`baseline.sql:1589-1591`), `tenant_module_config` writes (`:1651`), `app_user` writes (`:1550`) and the `audit_log` read (`:1553`).
- The client gates `admin.credential-template.tsx:173`, `admin.tenants.$woredaId.index.tsx:25` and `admin.audit.tsx:52` have no server counterpart.
- In the Edge Functions, `invite-platform-admin` checks the console key only for the super_admin role (`:84`). `invite-tenant-user` (`:91`), `resend-platform-invite` and `sign-credential` do not check console scope at all.

**Impact.** A super_admin scoped to a single console permission keeps full platform power over PostgREST. That includes cross-woreda PII reads, user re-roling and suspension, module toggles and tenant-admin invites. The console-role UI suggests a separation of duties that does not exist. Whether any scoped admin exists today needs live verification.

**Fix.** Replace `is_super_admin()` with `user_has_console_perm('<key>')` in the policies and RPCs each CP key protects. Add the same check to the four Edge Functions. Add a CI check that every CP key has at least one server reference.

### WP-AZ-002 (High, Likely): unrelated roles can rewrite substantive fields of approved workflow records

**Evidence**

- `credential_request_update` admits `credential.issue`, `credential.approve`, `credential.verify`, `payment.collect` and `revenue.collect` (`baseline.sql:1569`).
- `enforce_workflow_transition()` returns early when status is unchanged (`00000000000046:166`).
- No trigger pins `resident_id`, `request_type` or related fields on `credential_request`. Its triggers are listed at `baseline.sql:1480-1482` and migrations 25/26/29/49-51.
- The mint trigger issues the card for `NEW.resident_id` (`00000000000070:77`).
- `resident_update` requires only `resident.update` (`baseline.sql:1627`). `residency_status` (`:600`) has no guard trigger, although its intended writer is the death-registration trigger (`00000000000059:95`).

**Attack.**

1. A finance clerk patches `resident_id` on an approved request in `awaiting_payment`, then records the fee. A card is minted for a person who was never verified or approved.
2. A registry clerk flips a registered-dead resident back to `active` (enabling a new credential), or marks a living resident deceased, without any civil event.

**Fix.** Add BEFORE UPDATE pin triggers on identity and substance columns once a record leaves `draft`/`returned`. Allow `residency_status` to change only in the system-transition context. Narrow `credential_request_update` to the workflow verbs, and write payment linkage through an RPC. This overlaps MC-01/MC-02, which belong to the workflows agent. It is reported here because the root cause is the permission set on the UPDATE policy.

### WP-AZ-003 (Medium): `credential.verify` has a double meaning, and viewer/auditor are not read-only at the database

**Evidence**

- `credential_request_update` and `cred_req_history_insert` accept `credential.verify` (`baseline.sql:1569,1560`).
- The compiled default gives it to viewer, auditor and finance_clerk (`permissions.ts:443,427,407`).
- The seed sets it false in all 6 woredas (`seed.sql:171,225,252`; 18 rows).
- The new-woreda trigger back-fills from the default, i.e. true (`00000000000035:104-124`).
- The client's workflow "Verify" quick action uses `P.CREDENTIAL_VERIFY` (`CredentialQueueTable.tsx:64`), but the FSM requires `credential.review`.

**Impact.**

- In any future woreda, or wherever a tenant_admin enables ID lookup, viewer and auditor can edit credential requests (see WP-AZ-002) and forge status-history rows.
- In today's woredas, the lookup screen the compiled matrix promises them is denied.

**Fix.** Remove `credential.verify` from both policies. Settle F-05 by aligning the seed with the default, and extend the drift check to cover `seed.sql`. Switch the quick action to `CREDENTIAL_REVIEW`.

Viewer and auditor also write through permissionless paths already reported by the database agent: `audit_log` (WP-DB-008), `kebele` (WP-DB-007), six counter tables (WP-DB-006) and nine storage buckets (WP-DB-002). Together these mean the "read-only role" guarantee does not hold at the DB level.

### WP-AZ-004 (Medium): module toggles are not enforced on the server (RBAC-03)

**Evidence**

- The only server reader of `tenant_module_config` is `enforce_service_request_preconditions()` (`00000000000066:391-400`), and it skips non-letter categories (`:346`).
- `ModuleGate` only redirects (`ModuleGate.tsx:23-29`).
- `useTenantModules` omits `rental_houses` (`useTenantModules.ts:6-14`; see WP-INV-005).
- `woreda.reports.tsx:3` has no gate, so `/woreda/reports/$reportType/print` bypasses the reports toggle.
- The dashboard reads `payment_decrypted` for every role (`woreda.dashboard.tsx:269-279`).
- `sign-credential` performs no module check.

**Impact.** A module the platform owner has switched off can still be operated through PostgREST, the RPCs and `sign-credential`.

**Fix.** Add a `module_enabled(woreda, key)` helper (missing row = enabled) and apply it to each module's INSERT/UPDATE policies, workflow triggers, RPCs and Edge Functions. Close the client gaps.

### WP-AZ-005 (Medium): 14 permission keys are never enforced on the server

**Evidence**

- `authz/permission-matrix.md` lists every key with its latest enforcement point.
- `payment.read`, `revenue.view`, `audit.view`, `report.view`, `report.export`, `credential.view`, `civil.view` and `credential.create_request` have no server reference at all.
- The six `*.read` keys gate only KPI RPCs (for example `00000000000057:64`) and `resident_document`, never the base tables. That is WP-DB-004 and is not re-scored here.
- Client gates `woreda.audit.tsx:394` and `woreda.revenue.index.tsx:300` sit over woreda-only SELECT policies.
- `docs/security-functionality.md:19` claims the opposite.

**Impact.** Per-tenant and per-user denies of these keys only change what the UI renders. A zero-grant custom role can read the audit log and all payments.

**Fix.** Fix together with WP-DB-004: put `user_has_any_perm()` on the SELECT policies and on the sources of the decrypted views. Delete or implement the unused keys. Add a CI rule that every `P` key has a server reference.

`user.manage`, `platform.manage` and `tenant.create` are marked decorative rather than mismatched, because the powers they name are gated by `is_tenant_admin()`/`is_super_admin()`.

### WP-AZ-006 (Medium): `print_officer` cannot be assigned or used, and FSM verbs alone are insufficient

**Evidence**

- `print_officer` holds only granular keys (`permissions.ts:455-463`).
- `residence_credential_update` requires `issue`, `approve`, `print`, `revoke` or `renew` (`baseline.sql:1622`).
- `sign-credential` and the print route require `credential.print` (`sign-credential/index.ts:122`, `woreda.credentials.$requestId.print.tsx:59`).
- The role is missing from both `EDITABLE_ROLES` lists (`UsersRolesTab.tsx:69-76`, `RolesPermissionsTab.tsx:15-22`) and from `invite-tenant-user`'s `ALLOWED_ROLES` (`:20-27`).

**Impact.** Least privilege cannot be applied at the print and handover stage. Tenants have to give print staff `registry_clerk` or `civil_registrar`, with their full resident, household and service write powers. A custom role built from the granular verbs fails in the same way.

**Fix.** Include the granular verbs in the coarse UPDATE policies (or move to per-transition RPCs). Accept `preview_print`/`confirm_print` in the signing path. Make the role assignable, or remove it.

### WP-AZ-007 (Low): the role-to-tenant scope invariant is not enforced in the database

**Evidence**

- There is no CHECK tying `role='super_admin'` to `woreda_id IS NULL`. Compare the `console_role_id` CHECK at `00000000000009:57`.
- `app_user_tenant_admin_write` excludes only `role='tenant_admin'` (`baseline.sql:1551`).
- The invariant is kept only by `PlatformUsersTab.tsx:856` and `invite-platform-admin:56`.

**Impact.** If a super_admin row ever carries a woreda_id, that woreda's tenant_admin can demote, suspend or delete it.

**Fix.** Add CHECK `(role='super_admin') = (woreda_id IS NULL)`, and exclude super_admin in the tenant_admin write policy.

### WP-AZ-008 (Low): client authorization fails open, and the woreda portal ignores status

**Evidence**

- `useAuthBootstrap.ts:85` and `authStore.ts:83` fall back to `ROLE_PERMISSIONS` when `current_permissions()` fails.
- `woreda.tsx:21` checks only that a role is present. Compare `admin.tsx:31`.

**Impact.**

- The UI re-shows controls a tenant has denied.
- Suspended staff keep a working shell whose unguarded queries still return data (the root cause is WP-DB-001).

**Fix.** Fail closed to `[]` on RPC error, and add the status redirect to `woreda.tsx`.

### WP-AZ-009 (Info): the SFD lacks an access-control matrix

**Evidence.** `docs/security-functionality.md:7-32`.

**Impact and fix.** D-01 requires a statement of which guard enforces each endpoint. Adopt `authz/route-guard-matrix.md` and `authz/permission-matrix.md` into the SFD, regenerate them in CI, and correct the claim at line 19.

## 6. Permission matrix summary (RBAC-01)

The full 80-row table is in `authz/permission-matrix.md`.

| Stage | Result |
|---|---|
| `P` keys | 80 (shared-context estimate was ~85) |
| `ROLE_PERMISSIONS` vs `default_role_perms()` | 0 differences across 10 role values |
| `role_permission` seed vs default | 1,560 rows over 44 keys, 6 roles, 6 woredas (the header says 1,512). 3 divergent cells ×6 woredas: `credential.verify`=false for AUD/FC/VW |
| Keys with no seed rows | 36 (resolved from migration back-fills or the default). `print_officer` has no seed rows at all |
| Server enforcement | 53 OK · 10 FSM-only verbs that also need a coarse key (WP-AZ-006) · 3 decorative · **14 mismatched** (WP-AZ-003/005, WP-DB-004) |

## 7. Route and endpoint enforcement summary (D-01, E-06)

The full table is in `authz/route-guard-matrix.md`.

- **Client guards are broadly present.** Portal routes with no page-level permission check are:
  - `woreda.residents.index.tsx` (its queries are enabled only with `RESIDENT_READ`, at :217)
  - `woreda.residents.new.tsx` (the server enforces `resident.create`)
  - `woreda.services.$requestId.print.tsx` (under the services `ModuleGate` only)
  - `woreda.dashboard.tsx`
  - `admin.dashboard.tsx`
  - the redirect/layout-only files
- **No write is client-only in the "no server check at all" sense**, with the exceptions already reported: `audit_log`, `kebele`, the counters, `service_request_status_history` and storage (WP-DB-002/006/007/008).
- **The real gaps are different in kind.** They are server checks that are *weaker than or different from* the client gate:
  - CP keys (WP-AZ-001)
  - coarse UPDATE key sets (WP-AZ-002/003)
  - read keys (WP-AZ-005/WP-DB-004)
  - module keys (WP-AZ-004)

## 8. Drift

| Claim | Source | Verdict | Evidence |
|---|---|---|---|
| `user_has_perm()` gates what a query returns and is the real enforcement point | docs/security-functionality.md:19-21 | CONTRADICTED | SELECT policies are woreda-only (baseline.sql:1553,1568,1586,1599,1626,1655) |
| CP console roles scope a super_admin inside /admin | CLAUDE.md; SFD:30-32 | CONTRADICTED | Only `console.console_users.manage` is enforced server-side (WP-AZ-001) |
| A7: admin roles are not editable through `role_permission` | CLAUDE.md | CONFIRMED | 00000000000035:65-70 |
| Reserved keys are enforced on all three grant surfaces | permissions.ts:173-185 | CONFIRMED | 00000000000078:79-128 |
| The drift check keeps `ROLE_PERMISSIONS` = `default_role_perms()` | CLAUDE.md | CONFIRMED | 0 differences |
| F-05 is left for a follow-up | 00000000000035:14-19 | CONFIRMED (still open) | seed.sql:171/225/252. The drift script does not read seed.sql |
| The seed has 1,512 `role_permission` rows | seed.sql:17,106 | CONTRADICTED | 1,560 rows parsed, 44 keys |
| Custom roles fail closed | CLAUDE.md | CONFIRMED (grants) | 00000000000039:97-106. Reads remain open (WP-DB-004) |
| Override `woreda_id` is re-derived by trigger | CLAUDE.md | CONFIRMED | 00000000000017:52-66 |
| A missing module row means enabled, and super admins see all modules | CLAUDE.md | CONFIRMED | useTenantModules.ts:31-33,47-48 |
| The module keys are the 7 listed | CLAUDE.md | CONTRADICTED | `rental_houses` is also allowed (baseline.sql:615) and is unused |
| Only services has a server-side module check | shared-context.md | CONFIRMED | 00000000000066:391-400, letters only |
| `credential.verify` is lookup-only and distinct from the workflow verify step | permissions.ts:42-45 | CONTRADICTED | baseline.sql:1560,1569; CredentialQueueTable.tsx:64 |
| `print_officer` is adjustable per tenant through the matrix | permissions.ts:450-454 | CONTRADICTED | Absent from every assignment surface (WP-AZ-006) |
| A scoped super_admin cannot mint an unrestricted super_admin | migration 12; invite-platform-admin | CONFIRMED | 00000000000012:121-152; invite-platform-admin:84-94 |

## 9. Live verification handed to the user (read-only)

```sql
-- WP-AZ-001: are console roles in use?
select count(*) filter (where console_role_id is not null) scoped, count(*) supers
from app_user where role = 'super_admin';
-- WP-AZ-003 / F-05: live credential.verify grants
select role_name, is_granted, count(*) from role_permission
where permission_key = 'credential.verify' group by 1,2 order by 1,2;
-- WP-AZ-006: any print_officer or custom users?
select role, count(*) from app_user group by role order by 1;
-- WP-AZ-004: which modules are actually disabled?
select woreda_id, module_key, is_enabled from tenant_module_config where not is_enabled;
-- WP-AZ-007: role/woreda scope invariant
select user_id, role, woreda_id from app_user
where (role = 'super_admin') <> (woreda_id is null);
-- WP-AZ-002: confirm there is no pin trigger live on credential_request/resident
select tgname, tgrelid::regclass from pg_trigger
where tgrelid in ('public.credential_request'::regclass, 'public.resident'::regclass) and not tgisinternal;
```
