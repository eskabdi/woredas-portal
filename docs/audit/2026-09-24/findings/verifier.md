# Verifier report: adversarial re-check of Critical/High findings

Audit run 2026-09-24 · HEAD `9950f16` · agent `verifier` · machine-readable twin: `verifier.json`

## 1. Scope and method

Wave 2 raised 157 findings: 0 Critical, 20 High, 56 Medium, 60 Low and 21 Info. This pass tried to disprove every High finding, re-graded the R7 (cross-tenant) candidates, merged duplicates, and spot-checked ten Medium findings.

For each finding, the verifier took these steps:

- Re-opened the cited `path:line`.
- Resolved the **latest** definition of every function, policy and trigger involved. This meant grepping all 90 migrations for `CREATE OR REPLACE`, `DROP POLICY`/`CREATE POLICY`, `CREATE TRIGGER`, `REVOKE` and `UPDATE public.workflow_transition`.
- Searched for compensating controls: `AS RESTRICTIVE` policies (none exist), column-level `REVOKE UPDATE` (none), BEFORE and pin triggers, and precondition re-checks.
- Confirmed that the path is reachable from the live UI or from PostgREST directly.

WP-CRY-001 was also reproduced independently with Node 22 WebCrypto.

Constraint: nothing was tested against a live database. Every verdict rests on the migration set, which may diverge from production (the baseline is a reconstruction).

## 2. Outcome at a glance

| | Critical | High | Medium | Low | Info | Total |
|---|---|---|---|---|---|---|
| Input (Wave 2) | 0 | 20 | 56 | 60 | 21 | 157 |
| After re-grade, before dedupe | 3 | 19 | 54 | 60 | 21 | 157 |
| After dedupe (canonical) | **1** | **15** | 47 | 56 | 21 | 140 |

Verdicts on the 20 High findings: **19 verified, 1 needs-live-test (WP-OPS-002), 0 downgraded, 0 rejected.** None of them could be disproved. For every High finding, the latest definition was the same object the reporting agent cited, or a later redefinition with the same gap. Severity changes, all under R7: **WP-DB-003** High→Critical, **WP-DB-009** Medium→Critical and **WP-DB-010** Medium→Critical. All three merge into the new canonical **WP-VER-001**.

Medium sample: 10 of 10 were accurate on their core claim. **Observed false-positive rate: 0%** (n=10, stratified across 9 agents).

## 3. The R7 question: cross-tenant exposure

R7 fixes cross-tenant exposure at Critical, so the bar is whether an authenticated principal of tenant A (or anon) can read or write tenant B's data through a server-side path. Four candidates were examined.

**WP-DB-003: birth-registration trigger (upgraded to Critical).**
- The latest `generate_resident_on_birth_approval()` is the one in migration 59 (lines 118-176). It is `SECURITY DEFINER` and reads `ethnicity, religion, current_household_id` (59:139-141) and `full_name_am` (59:163) from `public.resident` by the client-supplied `event_details.mother_resident_id`. It does not check the woreda.
- The two compensating checks do not cover this key:
  - `assert_vital_event_woreda_consistency()` (32:223) checks only `NEW.resident_id` and `NEW.household_id`.
  - `enforce_vital_event_preconditions()` (latest 66:406) checks the household, the deceased and the spouses, never the mother.
- `resident` has no trigger that validates `current_household_id`.
- Migration 32:68-71 explicitly deferred this gap to "Task 14". The Task 14 migrations (58, 59, 60, 65, 66) redefined the function without adding the check.
- One person can exploit it, by chaining WP-WF-001: a civil registrar inserts the birth at `awaiting_payment`, the routine fee is recorded, and the `paid -> registered` system transition writes tenant B's special-category data into a resident row that tenant A can read.
- The approval UI resolves the mother through RLS, so a foreign mother renders blank, and a reviewer would not notice.
- Confidence is **Likely**, because the attacker needs one tenant-B resident UUID.

**WP-DB-009: `rental_eligibility()` (upgraded to Critical).**
- The function takes the woreda from the *target* resident (31:74-78), not from the caller. It has no permission check and is `GRANT`ed to `authenticated` (31:197).
- Any tenant's staff can therefore read another tenant's occupancy id, household-head flag and in-flight request number for a known resident UUID.
- The revoke names only `PUBLIC` (31:196), so an anonymous path is likely under Supabase's default function ACL. That part still needs a live `has_function_privilege('anon', …)` check.

**WP-DB-010: `get_credential_live_status()` (upgraded to Critical).**
- This is a single baseline definition with no woreda predicate, granted to `authenticated` (07:84).
- Migration 34 (225-250) restricted bare-number lookups to same-woreda staff, and describes cross-tenant number enumeration as "the exact vulnerability this migration exists to close". This function reopens that path.
- Only status text is returned and the function has no callers, so the impact per record is small. It is still a server-side cross-tenant read over an enumerable 13-digit Luhn key space, and the fix is trivial.

**WP-API-003: self-registration (stays Medium, needs-live-test).**
- This is not itself a cross-tenant path. It is an amplifier: if GoTrue sign-up is enabled, an outsider gains the `authenticated` role and can reach all three functions above.
- WP-AUTH-008 is the same issue and is merged into it.

These three locations share one root cause: a `SECURITY DEFINER` function trusts a caller-supplied key without re-deriving the caller's woreda (TEN-04). They are consolidated as **WP-VER-001 (Critical)**, whose full finding text is in `verifier.json`. No other finding met the R7 bar:

- WP-AZ-001 concerns a platform-tier super_admin, not a tenant member.
- WP-CRY-001 is a revocation bypass on a public page, not access to tenant data.
- WP-DB-012 is a structural gap whose only demonstrated exploit is WP-DB-003.

## 4. Verdicts on each High finding

| ID | Verdict | Severity → | Confidence | Why it could not be disproved (short form) |
|---|---|---|---|---|
| WP-DB-001 | verified | High | Confirmed | `get_user_woreda_id()` has one definition (baseline:1335) with no status check. No RESTRICTIVE policy anywhere. No session revocation code (`signOut`, `ban_duration`, `updateUserById` all absent). Canonical for WP-AUTH-002. |
| WP-AUTH-002 | verified (dup) | High | Confirmed | `woreda.tsx:21-22` gates on role only; `admin.tsx:31` has the status gate. Merged into WP-DB-001. |
| WP-DB-002 | verified | High | Confirmed | None of the 78 `storage.objects` statements (migrations 01/04/14/48/49) references any permission helper. The attachments delete policy was re-widened in 49:112. |
| WP-DB-003 | verified, **upgraded** | **Critical** | Likely | See §3. Merged into WP-VER-001. |
| WP-DB-004 | verified | High | Confirmed | All cited SELECT policies are still baseline. `*_decrypted` views are security_invoker. `decrypt_pii_text()` checks woreda only (23:355). Canonical for WP-AZ-005. |
| WP-AZ-001 | verified | High | Confirmed | `user_has_console_perm` is used server-side only at 12:39-44, 12:150 and in `invite-platform-admin` for the super_admin mint. Impact is latent until a super_admin is actually given a console role. Canonical for WP-API-001. |
| WP-API-001 | verified (dup) | High | Confirmed | Same root cause as WP-AZ-001. |
| WP-AZ-002 | verified (split dup) | High | Confirmed | `credential_request_update` is still baseline:1569. The FSM returns early at 46:166. No pin trigger on `credential_request.resident_id`. The 66 precondition re-check only asserts same-woreda. Part 1 merges into WP-WF-004, part 2 into WP-WF-006. |
| WP-AUTH-001 | verified | High | Confirmed | No `mfa`/`aal2` usage in src or supabase. `input-otp.tsx` is unused. No policy requires aal2. |
| WP-APP-001 | verified | High | Confirmed | The `innerHTML` sink is live (`rich-text-editor.tsx:46`). No DB-side constraint exists. The attacker needs reserved `tenant.manage` (tenant_admin/super_admin), so the victim is a peer admin. It still defeats maker≠checker and non-repudiation between two admins, and the rubric fixes stored XSS at High. |
| WP-APP-002 | verified (dup) | High | Confirmed | No trigger or column grant pins `letter_summary`, `subject`, `issued_at` or `verification_token` after issuance. `verify_service_letter` (64:22) attests those columns. Merged into WP-WF-004. |
| WP-CRY-001 | verified | High | Confirmed | Both a registry miss and an RPC error reach the green banner (`v.$token.tsx:179`, `:134`, `:262`). The RPC matches on exact string (34:245). Reproduced: 15 alternative last-character encodings plus the high-S twin all verify and all miss the lookup. |
| WP-OPS-001 | verified | High | Confirmed | All evidence lines check out. This is an operational finding (INSA OPS-01) rather than a code exploit; kept High given real PII and committed test writes. |
| WP-OPS-002 | **needs-live-test** | High (provisional) | Needs-live | The negative evidence holds, but plan tier, PITR and Storage backup can only be confirmed in the dashboard. |
| WP-WF-001 | verified | High | Confirmed | The INSERT guard (29:203-211) covers credential tables only. The latest `vital_event_insert` (58:100) and `service_request_insert` (61:35) do not check status, and no BEFORE INSERT trigger reads `NEW.status`. |
| WP-WF-002 | verified | High | Confirmed | Complaint edges (61:113-130) are keyed by entity, not by category. No later migration reads category on a transition. The public verifier accepts `resolved`/`closed` (64:47). |
| WP-WF-003 | verified | High | Confirmed | `force_actor_columns` re-pins only a changed non-null value (baseline:1213). Trigger order runs it before the FSM. The FSM compares persisted columns (46:219). |
| WP-WF-004 | verified | High | Confirmed | Only these fields are pinned: `credential_number`/`serial_number`/`qr_payload` (46:31) and `vital_event.resident_id` once non-null (33:66). The mint reads `NEW.resident_id` (70:120). Canonical for AZ-002 part 1 and APP-002. |
| WP-WF-005 | verified | High | Likely | The baseline policy admits `credential.verify`, which `default_role_perms` (83:107-109) grants to viewer, auditor and finance_clerk. Likely only because live `role_permission` rows may differ. Canonical for WP-AZ-003. |
| WP-WF-006 | verified | High | Confirmed | The death side effect revokes only `active` credentials (59:99). The `suspended/printed -> active` transitions skip the residency check. `deceased -> active` is accepted by the DB and reachable from `ResidentActions.tsx:132`. |

## 5. Duplicate merges

| Canonical | Duplicates | Root cause |
|---|---|---|
| **WP-VER-001** | WP-DB-003, WP-DB-009, WP-DB-010 | SECURITY DEFINER lookup without caller-woreda re-check |
| WP-DB-001 | WP-AUTH-002 | Suspension does not cut data access or sessions |
| WP-AZ-001 | WP-API-001 | Console permissions enforced only in React |
| WP-DB-004 | WP-AZ-005 | Read permission keys absent from SELECT RLS |
| WP-WF-004 | WP-AZ-002 (part 1), WP-APP-002 | Content not frozen after approval or issuance |
| WP-WF-006 | WP-AZ-002 (part 2) | `residency_status` writable by any `resident.update` holder |
| WP-WF-005 | WP-AZ-003 | `credential.verify` doubles as a `credential_request` write key |
| WP-DB-005 | WP-CRY-006 | Plaintext PII twins remain authoritative |
| WP-DB-013 | WP-CRY-008 | Weak or mutable public verification tokens |
| WP-APP-005 | WP-LOC-005 | FAN/phone validation client-only |
| WP-APP-003 | WP-AUTH-003 | localStorage tokens with `'unsafe-inline'` CSP |
| WP-INV-004 | WP-SUP-002 | js-yaml advisory (build-time) |
| WP-AZ-004 | WP-INV-005 | Module toggles UI-only; `rental_houses` never gated |
| WP-OPS-005 | WP-API-005 | Production CORS allows `http://localhost:5173` |
| WP-API-003 | WP-AUTH-008 | GoTrue sign-up not evidenced as disabled |
| WP-AZ-006 | WP-WF-012 | `print_officer` cannot perform its duties |

Related but kept separate because each needs a different fix: WP-WF-001(b), WP-WF-002, WP-WF-004 and WP-DB-013 all lead to forged or altered publicly verifiable letters. Together they mean the letter verification surface should not be relied on until all four are fixed.

## 6. Medium spot-check (n = 10)

| ID | Result | Check performed |
|---|---|---|
| WP-DB-006 | accurate | `credential_seq_tenant`/`receipt_seq_tenant` are FOR ALL and tenant-only, never redefined. The client receipt number is kept (baseline:1015). |
| WP-DB-008 | accurate | `audit_log` insert is tenant-only. A NULL actor survives `force_actor`. The death side effect writes no `woreda_id` (59:108). |
| WP-CRY-007 | accurate | The only receipt UNIQUE constraints are `(woreda_id, receipt_number)` and `verification_token`; there is none on `payment_id`. |
| WP-AZ-004 | accurate | Server-side `module_key` reads exist only for `services` (62/65/66); none in the Edge Functions. |
| WP-AUTH-004 | accurate | `useIdleTimeout.ts:79-84` overwrites the stored activity timestamp on mount. |
| WP-LOC-001 | accurate | Reproduced under `TZ=Africa/Addis_Ababa`: 2026-10-20 serialises as 2026-10-19. |
| WP-WF-007 | accurate | `active->revoked` is non-system (25:533), and no later workflow_transition update exists. |
| WP-PRV-002 | accurate | The resident edit diff writes FAN, ethnicity and religion old/new values into `audit_log`. |
| WP-INV-001 | accurate | All 8 functions import `esm.sh/@supabase/supabase-js@2`; there is no deno.json, lock or import map. |
| WP-APP-004 | accurate | Most buckets are created with NULL size and MIME limits (01:24-48, 48:345). |

False-positive rate observed: **0/10**. Severity calibration in the sample was reasonable. The only calibration errors found anywhere in the audit were under-ratings of cross-tenant RPCs (WP-DB-009/010), corrected above.

## 7. Documentation drift confirmed during verification

- **CLAUDE.md:331-332** says "pending user sees empty results". **CONTRADICTED** (WP-DB-001).
- **CLAUDE.md:141-142** says "a query missing woreda_id can't cross tenants". **CONTRADICTED** for SECURITY DEFINER paths (WP-VER-001).
- **CLAUDE.md:262-263** says `user_has_perm()` gates RLS. **CONTRADICTED** for reads (WP-DB-004).
- **CLAUDE.md:313-315** says console roles scope super_admins. **CONTRADICTED** server-side (WP-AZ-001).
- **CLAUDE.md:515-516** says one person can never both verify and approve. **CONTRADICTED** (WP-WF-003).
- **CLAUDE.md:520-522** says a tenant can never remove a gate. **CONTRADICTED** (WP-WF-001).
- **CLAUDE.md:645-647** says the verifier checks live revocation. **CONTRADICTED** in effect, because it fails open (WP-CRY-001).
- **Migration 32:68-71** says the mother lookup is deferred to Task 14. No fix was found (**NOT FOUND**).

## 8. Blockers and required live tests

1. **WP-VER-001** (Critical) should block go-live. The fix is small (effort S): add a woreda predicate in three functions, add a mother check in the preconditions, and drop the dead RPC.
2. Live checks the verifier could not run:
   - `has_function_privilege('anon','public.rental_eligibility(uuid,uuid,text)','EXECUTE')`
   - GoTrue `enable_signup` / anonymous sign-in state (WP-API-003)
   - plan tier, PITR and Storage backup (WP-OPS-002)
   - live `role_permission` rows for `credential.verify` (WP-WF-005)
   - whether any super_admin has a non-NULL `console_role_id` (this sets how exposed WP-AZ-001 is in practice)
3. The High cluster around workflow integrity (WP-WF-001 to 006) and the fail-open public verifier (WP-CRY-001) together mean that neither public verification surface (ID card or letter) currently gives a trustworthy "genuine and in force" answer.
