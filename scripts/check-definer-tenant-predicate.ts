#!/usr/bin/env bun
/**
 * Security audit 2026-09-24, P0-2 (WP-VER-001): a SECURITY DEFINER function
 * bypasses RLS, so "a query that forgets a woreda filter still cannot cross
 * tenants" (docs/architecture.md) stops being true inside one. Three such
 * functions looked up a row by a caller-controlled key with no woreda
 * predicate -- generate_resident_on_birth_approval(), rental_eligibility()
 * and get_credential_live_status() -- and were only found by a manual
 * audit. Migration 00000000000090 fixed them; this check is what stops a
 * fourth one landing unnoticed.
 *
 * Same static, no-database shape as check-role-perms-drift.ts: parse every
 * migration as text in order, keep the LATEST definition of each function
 * (CREATE OR REPLACE semantics), and for every SECURITY DEFINER body find
 * each `FROM public.<t>` / `JOIN public.<t>` where <t> is a tenant table
 * (one that carries a woreda_id column). The statement that contains it --
 * up to the next `;` -- must mention one of:
 *
 *   - woreda_id           (an explicit tenant predicate or comparison)
 *   - is_super_admin()    (an explicit platform-scope branch)
 *   - auth.uid()          (keyed on the caller's own row)
 *
 * It is a heuristic, not a proof: a statement can mention woreda_id and
 * still be wrong, and a statement that reaches its rows through a parent
 * row already locked and woreda-checked earlier in the body is safe without
 * mentioning it. So it runs as a ratchet. Every flagged (function, table)
 * pair that existed when the check was introduced is listed in
 * REVIEWED_BASELINE below with the reason it is tolerated; CI fails on any
 * pair NOT in that list (a new unscoped lookup) and on any listed pair that
 * no longer occurs (so the list only ever shrinks -- delete the entry).
 *
 * Run: bun run scripts/check-definer-tenant-predicate.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "supabase", "migrations");

// Pre-existing pairs flagged when this check was added (2026-09-25, HEAD of
// migration 00000000000090). "parent-scoped" means the body re-derives the
// caller's woreda (get_user_woreda_id() / NEW.woreda_id) on the parent row
// before this statement reads its children; "trigger-fk" means a trigger
// resolving NEW's own foreign key, whose same-woreda property is not
// independently re-checked here. Every entry is a candidate for follow-up
// review (audit 2026-09-24 register, P2-11); none is known to be exploitable.
export const REVIEWED_BASELINE: Record<string, string> = {
  "assign_credential_number:kebele": "trigger-fk: NEW.issuing_kebele_id",
  "audit_tenant_role_permission_change:tenant_role": "trigger-fk: NEW.tenant_role_id",
  "clear_overrides_on_role_promotion:user_permission_override":
    "trigger keyed on NEW.user_id; deletes the target user's own overrides",
  "clear_overrides_on_woreda_change:user_permission_override":
    "trigger keyed on NEW.user_id; deletes the target user's own overrides",
  "create_arrears_repayment_plan:arrears_installment_charge": "parent-scoped (rent_account)",
  "create_arrears_repayment_plan:arrears_repayment_installment": "parent-scoped (rent_account)",
  "create_arrears_repayment_plan:arrears_repayment_plan": "parent-scoped (rent_account)",
  "create_arrears_repayment_plan:rent_account":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "enforce_user_permission_override_woreda:app_user":
    "trigger that derives NEW.woreda_id from the target app_user row",
  "force_household_location_woreda_id:household":
    "trigger that derives NEW.woreda_id from the parent household",
  "get_rent_account_ledger_summary:arrears_repayment_installment": "parent-scoped (rent_account)",
  "get_rent_account_ledger_summary:arrears_repayment_plan": "parent-scoped (rent_account)",
  "get_rent_account_ledger_summary:payment": "parent-scoped (rent_account)",
  "get_rent_account_ledger_summary:rent_charge": "parent-scoped (rent_account)",
  "get_rent_account_ledger_summary:rental_payment": "parent-scoped (rent_account)",
  "guard_arrears_plan_maker_checker:arrears_repayment_plan": "trigger-fk: NEW.rent_account_id",
  "guard_settlement_amount_matches_charge:rent_charge": "trigger-fk: NEW.rent_charge_id",
  "pii_encryption_status:household": "platform-wide aggregate counts, service_role only",
  "pii_encryption_status:payment": "platform-wide aggregate counts, service_role only",
  "pii_encryption_status:rental_occupancy": "platform-wide aggregate counts, service_role only",
  "pii_encryption_status:rental_occupancy_request":
    "platform-wide aggregate counts, service_role only",
  "pii_encryption_status:resident": "platform-wide aggregate counts, service_role only",
  "pii_encryption_status:service_request": "platform-wide aggregate counts, service_role only",
  "provision_rent_account:rent_account": "parent-scoped (rental_occupancy)",
  "provision_rent_account:rental_occupancy":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "release_arrears_plan_charges:arrears_repayment_installment": "trigger-fk: NEW.plan_id",
  "resolve_reconciliation_exception:payment_reconciliation_exception":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "resolve_rental_checkpoint_core:arrears_repayment_plan": "parent-scoped (resident)",
  "resolve_rental_checkpoint_core:rent_account": "parent-scoped (resident)",
  "resolve_rental_checkpoint_core:rent_charge": "parent-scoped (resident)",
  "resolve_rental_checkpoint_core:resident":
    "resident's woreda checked against get_user_woreda_id() in the EXISTS just before",
  "reverse_rental_payment:arrears_installment_charge": "parent-scoped (rental_payment)",
  "reverse_rental_payment:arrears_repayment_installment": "parent-scoped (rental_payment)",
  "reverse_rental_payment:arrears_repayment_plan": "parent-scoped (rental_payment)",
  "reverse_rental_payment:rent_charge": "parent-scoped (rental_payment)",
  "reverse_rental_payment:rent_payment_settlement": "parent-scoped (rental_payment)",
  "reverse_rental_payment:rental_payment":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "settle_arrears_installments:arrears_installment_charge": "parent-scoped (arrears plan)",
  "settle_arrears_installments:arrears_repayment_installment": "parent-scoped (arrears plan)",
  "settle_arrears_installments:arrears_repayment_plan":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "settle_arrears_installments:rent_charge": "parent-scoped (arrears plan)",
  "settle_rent_payment:arrears_installment_charge": "parent-scoped (rent_account)",
  "settle_rent_payment:rent_account":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "settle_rent_payment:rent_charge": "parent-scoped (rent_account)",
  "user_permission_override_target_role_ok:app_user":
    "returns only whether the target is an admin role; no row data",
  "validate_credential_fee_amount:credential_request": "trigger-fk: NEW.credential_request_id",
  "validate_credential_fee_amount:vital_event": "trigger-fk: NEW.vital_event_id",
  "validate_receipt_amount:payment": "trigger-fk: NEW.payment_id",
  "verify_credential_token:kebele":
    "public verifier; kebele joined from the credential found by token",
  "verify_service_letter:kebele":
    "public verifier; kebele joined from the service_request found by token",
};

export interface FunctionDef {
  name: string;
  args: string;
  header: string;
  body: string;
}

function readAllMigrationsInOrder(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf-8")).join("\n");
}

/** Index of the `)` closing the paren group that starts just before `from`. */
function matchingParen(sql: string, from: number): number {
  let depth = 1;
  let i = from;
  for (; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) break;
  }
  return i;
}

/** Tables that carry a woreda_id column, from CREATE TABLE bodies and
 * ALTER TABLE ... ADD COLUMN woreda_id. `woreda` itself is the tenant root,
 * not a tenant table. */
export function parseTenantTables(sql: string): Set<string> {
  const tables = new Set<string>();
  const create = /CREATE TABLE(?: IF NOT EXISTS)? public\.(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = create.exec(sql))) {
    const body = sql.slice(m.index + m[0].length, matchingParen(sql, m.index + m[0].length));
    if (/^\s*woreda_id\s/m.test(body)) tables.add(m[1]);
  }
  const alter =
    /ALTER TABLE(?: ONLY)?(?: IF EXISTS)? public\.(\w+)\s+ADD COLUMN(?: IF NOT EXISTS)? woreda_id\b/gi;
  while ((m = alter.exec(sql))) tables.add(m[1]);
  tables.delete("woreda");
  return tables;
}

/** Every public function definition, keeping only the last one per
 * name + argument list (matching CREATE OR REPLACE in migration order).
 * Scans instead of using one big regex: dollar-quoted bodies make a single
 * backtracking pattern pathologically slow on 90 migrations. */
export function parseLatestFunctions(sql: string): Map<string, FunctionDef> {
  const defs = new Map<string, FunctionDef>();
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = head.exec(sql))) {
    const argsEnd = matchingParen(sql, m.index + m[0].length);
    const i = argsEnd + 1;
    const args = sql
      .slice(m.index + m[0].length, argsEnd)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const as = /\bAS\s+(\$\w*\$)/gi;
    as.lastIndex = i;
    const a = as.exec(sql);
    if (!a) break;
    const tag = a[1];
    const bodyStart = a.index + a[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd < 0) break;
    const name = m[1];
    defs.set(`${name}(${args})`, {
      name,
      args,
      header: sql.slice(i, a.index),
      body: sql.slice(bodyStart, bodyEnd),
    });
    head.lastIndex = bodyEnd + tag.length;
  }
  return defs;
}

const SCOPED = /woreda_id|is_super_admin\s*\(\s*\)|auth\.uid\s*\(\s*\)/i;

/** (function:table) pairs where a SECURITY DEFINER body reads a tenant table
 * in a statement that carries no tenant scoping. */
export function findUnscopedLookups(
  defs: Map<string, FunctionDef>,
  tenantTables: Set<string>,
): Set<string> {
  const found = new Set<string>();
  for (const def of defs.values()) {
    if (!/SECURITY\s+DEFINER/i.test(def.header)) continue;
    const body = def.body.replace(/--[^\n]*/g, "");
    const ref = /\b(?:FROM|JOIN)\s+public\.(\w+)/gi;
    let r: RegExpExecArray | null;
    while ((r = ref.exec(body))) {
      if (!tenantTables.has(r[1])) continue;
      const end = body.indexOf(";", r.index);
      const statement = body.slice(r.index, end < 0 ? undefined : end);
      if (!SCOPED.test(statement)) found.add(`${def.name}:${r[1]}`);
    }
  }
  return found;
}

function main() {
  const sql = readAllMigrationsInOrder();
  const found = findUnscopedLookups(parseLatestFunctions(sql), parseTenantTables(sql));

  const added = [...found].filter((k) => !(k in REVIEWED_BASELINE)).sort();
  const stale = Object.keys(REVIEWED_BASELINE)
    .filter((k) => !found.has(k))
    .sort();

  if (added.length) {
    console.error(
      "\nSECURITY DEFINER lookups on tenant tables with no woreda_id / is_super_admin() / auth.uid() in the statement:",
    );
    for (const k of added) console.error(`  ${k}`);
    console.error(
      "\nA DEFINER body bypasses RLS: pin the lookup to the caller's woreda " +
        "(AND x.woreda_id = public.get_user_woreda_id(), or = NEW.woreda_id in a trigger). " +
        "If the statement is provably scoped some other way, add it to REVIEWED_BASELINE " +
        "with the reason -- see docs/audit/2026-09-24 (WP-VER-001).",
    );
  }
  if (stale.length) {
    console.error("\nREVIEWED_BASELINE entries that no longer occur (delete them):");
    for (const k of stale) console.error(`  ${k}`);
  }
  if (added.length || stale.length) process.exit(1);

  console.log(
    `OK: ${found.size} tolerated DEFINER lookups, all in REVIEWED_BASELINE; no new unscoped lookup.`,
  );
}

// Only run as a CLI -- importing this module (e.g. from a unit test) must
// not call process.exit() as a side effect of module load.
if (import.meta.main) main();
