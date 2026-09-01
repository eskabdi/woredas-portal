#!/usr/bin/env bun
/**
 * F8 (docs/rbac-security-forensic-review.md): permissions.ts's ROLE_PERMISSIONS
 * and the SQL default_role_perms() function are two independently
 * hand-maintained copies of the same role -> permission matrix, with nothing
 * enforcing they agree at build or deploy time. This script is that
 * enforcement -- it fails loudly the moment they diverge, instead of relying
 * on someone remembering to update both, which is exactly how the third copy
 * (role_permission's seed data) already drifted (F4).
 *
 * This is a DRIFT CHECK, not a generator that rewrites SQL: the migrations
 * this repo already applied are forward-only (see CLAUDE.md and
 * supabase/migrations/README-equivalent notes) and default_role_perms() lives
 * in the baseline migration, which is never edited after the fact. A future
 * permission change updates permissions.ts and adds a new migration with
 * `CREATE OR REPLACE FUNCTION default_role_perms(...)`; this script's job is
 * only to catch the case where someone did one but not the other.
 *
 * role_permission's own seed/backfill data isn't compared here: since
 * 00000000000015_permission_matrix_backfill.sql (F4), a trigger derives every
 * tenant's role_permission rows from default_role_perms() itself (both for
 * existing tenants, backfilled once, and for every future one, via the
 * woreda-insert trigger) -- so once this check confirms permissions.ts and
 * default_role_perms() agree, the seed data can no longer drift independently
 * of either.
 *
 * Run: bun run scripts/check-role-perms-drift.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROLE_PERMISSIONS, type Role } from "../src/config/permissions";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "supabase", "migrations");

/** Concatenates every migration in order, so a `CREATE OR REPLACE FUNCTION
 * default_role_perms` in a later migration naturally supersedes the
 * baseline's own definition, the same way Postgres applies them. */
function readAllMigrationsInOrder(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf-8")).join("\n");
}

/** Extracts the *last* default_role_perms() function body in the concatenated
 * migration stream (matching Postgres's own CREATE OR REPLACE semantics),
 * then parses each `WHEN '<role>' THEN ARRAY[...]` branch into a Set. */
export function parseDefaultRolePerms(sql: string): Record<string, Set<string>> {
  // Matches from the CREATE statement through the *pair* of `$function$`
  // dollar-quote delimiters (opening, then body, then closing) -- capturing
  // group 1 is the body between them, i.e. the actual CASE/WHEN statement.
  const functionBodies = [
    ...sql.matchAll(
      /CREATE OR REPLACE FUNCTION public\.default_role_perms[\s\S]*?AS \$function\$([\s\S]*?)\$function\$/g,
    ),
  ];
  if (functionBodies.length === 0) {
    throw new Error("Could not find default_role_perms() in any migration file");
  }
  const body = functionBodies[functionBodies.length - 1][1];

  const result: Record<string, Set<string>> = {};
  for (const match of body.matchAll(/WHEN\s+'(\w+)'\s+THEN\s+ARRAY\[([^\]]*)\]/g)) {
    const [, role, contents] = match;
    const keys = contents
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    result[role] = new Set(keys);
  }
  return result;
}

export function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function main() {
  const sql = readAllMigrationsInOrder();
  const sqlDefaults = parseDefaultRolePerms(sql);

  let drifted = false;
  for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
    const tsSet = new Set(ROLE_PERMISSIONS[role]);
    const sqlSet = sqlDefaults[role] ?? new Set<string>();
    if (!setsEqual(tsSet, sqlSet)) {
      drifted = true;
      const onlyInTs = [...tsSet].filter((k) => !sqlSet.has(k));
      const onlyInSql = [...sqlSet].filter((k) => !tsSet.has(k));
      console.error(`\nDrift detected for role "${role}":`);
      if (onlyInTs.length) console.error(`  only in permissions.ts:        ${onlyInTs.join(", ")}`);
      if (onlyInSql.length)
        console.error(`  only in default_role_perms():  ${onlyInSql.join(", ")}`);
    }
  }

  const sqlOnlyRoles = Object.keys(sqlDefaults).filter((r) => !(r in ROLE_PERMISSIONS));
  if (sqlOnlyRoles.length) {
    drifted = true;
    console.error(
      `\nRoles in default_role_perms() but not in ROLE_PERMISSIONS: ${sqlOnlyRoles.join(", ")}`,
    );
  }

  if (drifted) {
    console.error(
      "\npermissions.ts (ROLE_PERMISSIONS) and the SQL default_role_perms() function have diverged. " +
        "Update both together -- see docs/rbac-security-forensic-review.md, F8.",
    );
    process.exit(1);
  }

  console.log("OK: permissions.ts and default_role_perms() agree for every role.");
}

// Only run as a CLI -- importing this module (e.g. from a unit test) must
// not call process.exit() as a side effect of module load.
if (import.meta.main) main();
