#!/usr/bin/env bun
/**
 * Task 12 (fix-task-production-readiness-v3): resolve_credential_fee()
 * (00000000000054) is strictly fail-closed -- it raises unless the caller's
 * own woreda has exactly one ACTIVE fee_schedule row for the mapped
 * service_type. That data invariant drifted once already before this check
 * existed: 5 of 6 woredas had "Lost ID Replacement" stuck at
 * status = 'review_required' and missing "Internal Re-Print" entirely, which
 * would have broken payment recording for those tenants the moment Stage 4
 * switched over to reading fee_schedule instead of the old flat
 * woreda_settings.credential_issuance_fee.
 *
 * This is a STATIC check over supabase/seed.sql, the same shape as
 * check-role-perms-drift.ts and for the same reason: there is no staging
 * project and CI has no live database credentials (Postgres ports are
 * blocked from every sandboxed environment this repo runs in -- see
 * CLAUDE.md), so "does a fresh environment seeded from this file pass" is
 * the only thing this check can promise automatically. Live-verifying the
 * actually-deployed project is a manual pass against the Management API
 * (done for 00000000000054 itself; not repeated here).
 *
 * Run: bun run scripts/check-fee-catalog.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The request_type -> fee_schedule.service_type mapping resolve_credential_fee()
// implements (00000000000054_task12_fee_catalog_repair.sql). Kept as a literal
// list here, not imported from the SQL, for the same reason
// check-role-perms-drift.ts parses SQL as text rather than executing it --
// this script has no database connection at all.
export const MAPPED_SERVICE_TYPES = [
  "New ID Issuance",
  "ID Renewal",
  "Lost ID Replacement",
  "Internal Re-Print",
  // Task 14-A: resolve_civil_fee() (00000000000059) -- distinct from the
  // pre-existing "Birth Certificate"/"Death Certificate"/"Marriage
  // Registration" rows, which price the 14-B certificate/letter service,
  // not the registration event itself.
  "Civil Registration - Birth",
  "Civil Registration - Death",
  "Civil Registration - Marriage",
];

export interface FeeRow {
  woredaId: string;
  serviceType: string;
  status: string;
}

export function parseWoredaIds(sql: string): Set<string> {
  const ids = new Set<string>();
  const re = /INSERT INTO public\.woreda \([^)]*\) VALUES \('([0-9a-f-]{36})'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) ids.add(m[1]);
  return ids;
}

export function parseFeeScheduleRows(sql: string): FeeRow[] {
  const rows: FeeRow[] = [];
  // Columns: (fee_schedule_id, woreda_id, service_type, standard_fee, penalty_rate, status, created_at, updated_at)
  const re =
    /INSERT INTO public\.fee_schedule \([^)]*\) VALUES \('[0-9a-f-]{36}', '([0-9a-f-]{36})', '([^']*)', '[^']*', '[^']*', '([a-z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    rows.push({ woredaId: m[1], serviceType: m[2], status: m[3] });
  }
  return rows;
}

/** Returns a human-readable problem string per incomplete (woreda, service_type) pair; empty when the catalog is complete. */
export function findCatalogProblems(woredaIds: Set<string>, feeRows: FeeRow[]): string[] {
  const activeByKey = new Map<string, number>();
  for (const row of feeRows) {
    if (row.status !== "active") continue;
    const key = `${row.woredaId}::${row.serviceType}`;
    activeByKey.set(key, (activeByKey.get(key) ?? 0) + 1);
  }

  const problems: string[] = [];
  for (const woredaId of woredaIds) {
    for (const serviceType of MAPPED_SERVICE_TYPES) {
      const key = `${woredaId}::${serviceType}`;
      const count = activeByKey.get(key) ?? 0;
      if (count === 0) {
        problems.push(`${woredaId} has NO active "${serviceType}" fee_schedule row`);
      } else if (count > 1) {
        problems.push(`${woredaId} has ${count} active "${serviceType}" rows (expected exactly 1)`);
      }
    }
  }
  return problems;
}

function main() {
  const root = join(import.meta.dir, "..");
  const seedSql = readFileSync(join(root, "supabase/seed.sql"), "utf8");

  const woredaIds = parseWoredaIds(seedSql);
  const feeRows = parseFeeScheduleRows(seedSql);

  if (woredaIds.size === 0) {
    console.error("FAIL: found zero woreda rows in seed.sql -- parser regression?");
    process.exit(1);
  }
  if (feeRows.length === 0) {
    console.error("FAIL: found zero fee_schedule rows in seed.sql -- parser regression?");
    process.exit(1);
  }

  const problems = findCatalogProblems(woredaIds, feeRows);

  if (problems.length > 0) {
    console.error(
      `FAIL: fee catalog is incomplete for ${problems.length} (woreda x service_type) pair(s):`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nresolve_credential_fee() is fail-closed: every mapped service_type needs exactly one " +
        "active row per woreda, or Stage 4 payment recording breaks for that tenant/request type.",
    );
    process.exit(1);
  }

  console.log(
    `OK: all ${woredaIds.size} woredas have exactly one active row for each of ${MAPPED_SERVICE_TYPES.length} mapped service types.`,
  );
}

// Only run as a CLI -- importing this module (e.g. from a unit test) must
// not call process.exit() as a side effect of module load.
if (import.meta.main) main();
