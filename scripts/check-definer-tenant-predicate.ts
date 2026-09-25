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
 * (keyed by name + argument types, honouring DROP FUNCTION), and for every
 * SECURITY DEFINER body find each FROM / JOIN / UPDATE of a tenant table
 * (one that carries a woreda_id column), with or without the public.
 * prefix. The statement around it -- bounded by `;`, a THEN/LOOP ending an
 * IF/WHILE/FOR condition, or a block END; string literals and comments
 * blanked -- must contain a tenant ANCHOR:
 *
 *   - get_user_woreda_id()        the caller's own woreda
 *   - NEW.woreda_id / OLD.woreda_id  the row a trigger is guarding
 *   - is_super_admin()            an explicit platform-scope branch
 *   - auth.uid()                  keyed on the caller's own row
 *   - a local variable assigned from one of the above, or SELECTed INTO
 *     from a statement that is itself anchored
 *
 * A bare `woreda_id` is not an anchor: `woreda_id = _woreda_id` trusts a
 * parameter and `JOIN public.woreda w ON w.woreda_id = rc.woreda_id` scopes
 * nothing (security review of P0-2, 2026-09-25).
 *
 * It is a heuristic, not a proof: an anchored statement can still be wrong
 * (`OR true`), and a statement that reaches its rows through a parent row
 * already locked and woreda-checked earlier in the body is safe without an
 * anchor. So it runs as a ratchet. Every flagged (function, table) pair that
 * existed when the check was introduced is listed in REVIEWED_BASELINE below
 * with the reason it is tolerated; CI fails on any pair NOT in that list (a
 * new unscoped lookup) and on any listed pair that no longer occurs (so the
 * list only ever shrinks -- delete the entry).
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
// review (audit 2026-09-24 register, P2-11). None is known to expose tenant
// row data; user_permission_override_target_role_ok is the one known
// cross-woreda oracle (whether a user id is an admin), recorded in its reason.
export const REVIEWED_BASELINE: Record<string, string> = {
  "activate_arrears_repayment_plan:arrears_repayment_installment":
    "trigger on the plan row updating its own children by NEW.plan_id (the row's own key)",
  "advance_vital_event_to_registered:vital_event":
    "trigger updating its own row by NEW.vital_event_id",
  "assign_credential_number:kebele": "trigger-fk: NEW.issuing_kebele_id",
  "audit_tenant_role_permission_change:tenant_role": "trigger-fk: NEW.tenant_role_id",
  "clear_overrides_on_role_promotion:user_permission_override":
    "trigger keyed on NEW.user_id; deletes the target user's own overrides",
  "clear_overrides_on_woreda_change:user_permission_override":
    "trigger keyed on NEW.user_id; deletes the target user's own overrides",
  "create_arrears_repayment_plan:arrears_installment_charge": "parent-scoped (rent_account)",
  "create_arrears_repayment_plan:arrears_repayment_plan": "parent-scoped (rent_account)",
  "create_arrears_repayment_plan:rent_account":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "enforce_user_permission_override_woreda:app_user":
    "trigger that derives NEW.woreda_id from the target app_user row",
  "entity_belongs_to_woreda:credential_request":
    "_woreda_id parameter must equal get_user_woreda_id() at entry (unless super admin)",
  "entity_belongs_to_woreda:household":
    "_woreda_id parameter must equal get_user_woreda_id() at entry (unless super admin)",
  "entity_belongs_to_woreda:rental_occupancy_request":
    "_woreda_id parameter must equal get_user_woreda_id() at entry (unless super admin)",
  "entity_belongs_to_woreda:residence_credential":
    "_woreda_id parameter must equal get_user_woreda_id() at entry (unless super admin)",
  "entity_belongs_to_woreda:resident":
    "_woreda_id parameter must equal get_user_woreda_id() at entry (unless super admin)",
  "entity_belongs_to_woreda:service_request":
    "_woreda_id parameter must equal get_user_woreda_id() at entry (unless super admin)",
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
  "provision_rent_account:kebele_rental_house": "parent-scoped (rental_occupancy)",
  "provision_rent_account:rent_account": "parent-scoped (rental_occupancy)",
  "provision_rent_account:rental_occupancy":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "release_arrears_plan_charges:arrears_installment_charge":
    "trigger on the plan row updating its own children by NEW.plan_id (the row's own key)",
  "release_arrears_plan_charges:arrears_repayment_installment":
    "trigger on the plan row updating its own children by NEW.plan_id (the row's own key)",
  "resolve_reconciliation_exception:payment_reconciliation_exception":
    "row fetched by id, woreda compared with get_user_woreda_id() before use",
  "resolve_rental_checkpoint_core:resident":
    "resident's woreda checked against get_user_woreda_id() in the EXISTS just before",
  "reverse_rental_payment:arrears_installment_charge": "parent-scoped (rental_payment)",
  "reverse_rental_payment:arrears_repayment_installment": "parent-scoped (rental_payment)",
  "reverse_rental_payment:arrears_repayment_plan": "parent-scoped (rental_payment)",
  "reverse_rental_payment:payment":
    "parent-scoped (payment locked FOR UPDATE with the caller's woreda just before)",
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
    "returns only whether a user_id is an admin role, but for ANY woreda's user: an authenticated caller can learn if a UUID is an admin anywhere (pre-existing, follow-up)",
  "validate_credential_fee_amount:credential_request": "trigger-fk: NEW.credential_request_id",
  "validate_credential_fee_amount:fee_schedule":
    "trigger-fk; fee row joined on the entity's own woreda, then compared with NEW.woreda_id",
  "validate_credential_fee_amount:service_request":
    "trigger-fk: NEW.service_request_id; woreda then compared with NEW.woreda_id",
  "validate_credential_fee_amount:service_type":
    "trigger-fk; joined on the service_request's own woreda",
  "validate_credential_fee_amount:vital_event": "trigger-fk: NEW.vital_event_id",
  "validate_receipt_amount:payment": "trigger-fk: NEW.payment_id",
  "verify_receipt:household":
    "public verifier keyed by the receipt's verification_token; cross-tenant by design",
  "verify_receipt:kebele":
    "public verifier keyed by the receipt's verification_token; cross-tenant by design",
  "verify_receipt:kebele_rental_house":
    "public verifier keyed by the receipt's verification_token; cross-tenant by design",
  "verify_receipt:payment":
    "public verifier keyed by the receipt's verification_token; cross-tenant by design",
  "verify_receipt:receipt":
    "public verifier keyed by the receipt's verification_token; cross-tenant by design",
  "verify_receipt:rental_occupancy_request":
    "public verifier keyed by the receipt's verification_token; cross-tenant by design",
  "verify_receipt:resident":
    "public verifier keyed by the receipt's verification_token; cross-tenant by design",
  "verify_service_letter:kebele":
    "public verifier keyed by the letter's verification_token; cross-tenant by design",
  "verify_service_letter:resident":
    "public verifier keyed by the letter's verification_token; the resident join is not woreda-pinned, but enforce_service_request_preconditions refuses a cross-woreda resident_id at write time (migration 66)",
  "verify_service_letter:service_request":
    "public verifier keyed by the letter's verification_token; cross-tenant by design",
  "verify_service_letter:service_type":
    "public verifier keyed by the letter's verification_token; cross-tenant by design",
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

/** Postgres identifies a function by name + argument TYPES, not argument
 * names: `f(_a text)` and `f(_b text)` are the same function. Strip modes,
 * parameter names and defaults so a CREATE OR REPLACE under a renamed
 * parameter, or a DROP FUNCTION f(TEXT), keys to the same definition. */
const TYPE_LEADERS = new Set(["double", "character", "timestamp", "time", "bit", "interval"]);
export function normaliseArgTypes(args: string): string {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of args) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts
    .map((part) => {
      let t = part
        .replace(/\s+(?:DEFAULT\b|=).*$/is, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .replace(/^(?:inout|in|out|variadic) /, "");
      const words = t.split(" ");
      if (words.length > 1 && !TYPE_LEADERS.has(words[0])) t = words.slice(1).join(" ");
      return t.replace(/^public\./, "");
    })
    .join(",");
}

/** Every public function definition, keeping only the last one per
 * name + argument types (CREATE OR REPLACE semantics, in migration order),
 * and forgetting a definition once a later DROP FUNCTION removes it.
 * Scans instead of using one big regex: dollar-quoted bodies make a single
 * backtracking pattern pathologically slow on 90 migrations. */
export function parseLatestFunctions(sql: string): Map<string, FunctionDef> {
  const defs = new Map<string, FunctionDef>();
  const head =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(|DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = head.exec(sql))) {
    const argsEnd = matchingParen(sql, m.index + m[0].length);
    const args = normaliseArgTypes(sql.slice(m.index + m[0].length, argsEnd));
    if (m[2]) {
      defs.delete(`${m[2]}(${args})`);
      head.lastIndex = argsEnd + 1;
      continue;
    }
    const i = argsEnd + 1;
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

/** Expressions that carry the tenant from somewhere the caller cannot choose:
 * the caller's own woreda, the row a trigger is guarding, a platform-scope
 * branch, or the caller's own identity. A bare `woreda_id` is NOT enough --
 * `WHERE woreda_id = _woreda_id` trusts a parameter, and a join such as
 * `JOIN public.woreda w ON w.woreda_id = rc.woreda_id` scopes nothing. */
const ANCHORS = [
  /\bget_user_woreda_id\s*\(\s*\)/i,
  // Not `SELECT woreda_id INTO NEW.woreda_id FROM ...`: that assigns the
  // anchor from the lookup, it does not scope the lookup by it.
  /(?<!\bINTO\s+)\b(?:NEW|OLD)\.woreda_id\b/i,
  /\bis_super_admin\s*\(\s*\)/i,
  /\bauth\.uid\s*\(\s*\)/i,
];

/** Local variables that hold an anchored woreda: assigned straight from an
 * anchor (`v_woreda_id uuid := public.get_user_woreda_id();`), or filled by
 * `SELECT ... INTO v_x` from a statement that is itself anchored (so the
 * woreda it read back is the caller's). Iterated to a fixpoint. */
function anchoredVariables(body: string, anchors: RegExp[]): RegExp[] {
  const found = new Set<string>();
  const assign =
    /\b(\w+)(?:\s+uuid)?\s*:=\s*(?:public\.)?(?:get_user_woreda_id\s*\(\s*\)|(?:NEW|OLD)\.woreda_id\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = assign.exec(body))) found.add(m[1].toLowerCase());
  const statements = body.split(";");
  for (let grew = true; grew;) {
    grew = false;
    const all = [...anchors, ...[...found].map((v) => new RegExp(`\\b${v}\\b`, "i"))];
    for (const st of statements) {
      const into = /\bINTO\s+(?:STRICT\s+)?([\w\s,]+?)\s+FROM\b/i.exec(st);
      if (!into || !all.some((a) => a.test(st))) continue;
      for (const v of into[1].split(",").map((x) => x.trim().toLowerCase())) {
        if (v && !found.has(v)) {
          found.add(v);
          grew = true;
        }
      }
    }
  }
  return [...found].map((v) => new RegExp(`\\b${v}\\b`, "i"));
}

/** Offsets that end one PL/pgSQL statement or condition and start the next:
 * `;`, a THEN/LOOP that closes an IF/ELSIF/WHILE/FOR condition, and a block
 * END. A THEN inside a CASE expression is not a boundary -- a correlated
 * subquery in `CASE WHEN .. THEN (SELECT ..)` belongs to the statement
 * around it, and that outer statement's own predicate scopes it. */
function statementBoundaries(body: string): number[] {
  const cuts = [0];
  let caseDepth = 0;
  const tok = /;|\bCASE\b|\bEND\b(?:\s+(IF|LOOP|CASE)\b)?|\bTHEN\b|\bLOOP\b/gi;
  let t: RegExpExecArray | null;
  while ((t = tok.exec(body))) {
    const w = t[0].toUpperCase();
    if (w === "CASE") caseDepth++;
    else if (w.startsWith("END")) {
      const tail = (t[1] ?? "").toUpperCase();
      if (tail === "CASE" || (!tail && caseDepth > 0)) caseDepth = Math.max(0, caseDepth - 1);
      else cuts.push(t.index);
    } else if (w === "THEN") {
      if (caseDepth === 0) cuts.push(t.index);
    } else cuts.push(t.index);
  }
  cuts.push(body.length);
  return cuts;
}

/** (function:table) pairs where a SECURITY DEFINER body reads or updates a
 * tenant table in a statement with no tenant anchor. The statement is the
 * whole span between the boundaries around the reference, so the outer
 * WHERE of a correlated subquery counts, but a RAISE after `IF .. THEN`
 * cannot lend its NEW.woreda_id to the condition before it. String literals
 * and comments are blanked first so a message cannot supply an anchor. */
export function findUnscopedLookups(
  defs: Map<string, FunctionDef>,
  tenantTables: Set<string>,
): Set<string> {
  const found = new Set<string>();
  for (const def of defs.values()) {
    if (!/SECURITY\s+DEFINER/i.test(def.header)) continue;
    // One pass, strings first: a `--` inside a message literal is text, not
    // a comment, and stripping it would unbalance every quote after it.
    const body = def.body.replace(/'(?:[^']|'')*'|--[^\n]*/g, (t) => (t[0] === "'" ? "''" : ""));
    const anchors = [...ANCHORS, ...anchoredVariables(body, ANCHORS)];
    const cuts = statementBoundaries(body);
    // FROM / JOIN / UPDATE / DELETE .. USING, optionally unqualified or
    // quoted, plus a comma-joined `, public.<t>` in a FROM list.
    const ref =
      /(?:\b(?:FROM|JOIN|UPDATE|USING)\s+(?:ONLY\s+)?(?:public\.)?|,\s*public\.)"?(\w+)"?/gi;
    let r: RegExpExecArray | null;
    while ((r = ref.exec(body))) {
      if (!tenantTables.has(r[1])) continue;
      const at = r.index;
      const prev = Math.max(...cuts.filter((c) => c <= at));
      const next = Math.min(...cuts.filter((c) => c > at));
      const statement = body.slice(prev, next);
      if (!anchors.some((a) => a.test(statement))) found.add(`${def.name}:${r[1]}`);
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
      "\nSECURITY DEFINER lookups on tenant tables with no tenant anchor (get_user_woreda_id(), NEW/OLD.woreda_id, is_super_admin(), auth.uid()) in the statement:",
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
