#!/usr/bin/env bun
/**
 * Task 14-B: service_request's fee source is service_type.fee_amount, NOT
 * fee_schedule (see docs/task14b-mapping-memo.md §0.4 for why -- fee_schedule
 * was built for a small, code-fixed enum; service_type is an open,
 * per-woreda-editable catalog, and fee_amount is NOT NULL DEFAULT 0, so a
 * "missing fee" the way a missing fee_schedule row can happen structurally
 * cannot occur for an existing row). This check is therefore NOT the same
 * shape as check-fee-catalog.ts's "does every woreda have this row" check --
 * there is no fixed universal code list to check against a per-woreda
 * catalog.
 *
 * What CAN drift, and what this checks instead: every woreda is expected to
 * carry the same *core* set of service_type codes (confirmed live: all 6
 * woredas share an identical 12-code set; one woreda has one additional
 * code). A code present in some woredas but silently missing in others is
 * usually an operator forgetting to add a new letter/complaint type
 * everywhere, not a deliberate per-tenant customization -- this check flags
 * that drift the same way check-role-perms-drift.ts flags a permission
 * drift, over supabase/seed.sql, the same static, no-DB-connection shape
 * every other *-drift/*-catalog check here uses.
 *
 * Run: bun run scripts/check-service-type-catalog.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ServiceTypeRow {
  woredaId: string;
  code: string;
  category: string;
  isActive: boolean;
}

export function parseWoredaIds(sql: string): Set<string> {
  const ids = new Set<string>();
  const re = /INSERT INTO public\.woreda \([^)]*\) VALUES \('([0-9a-f-]{36})'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) ids.add(m[1]);
  return ids;
}

export function parseServiceTypeRows(sql: string): ServiceTypeRow[] {
  const rows: ServiceTypeRow[] = [];
  // Columns: (service_type_id, woreda_id, code, name_am, name_en, category,
  // fee_amount, requires_payment, requires_approval, ...)
  const re =
    /INSERT INTO public\.service_type \([^)]*\) VALUES \('[0-9a-f-]{36}', '([0-9a-f-]{36})', '([^']*)', '[^']*', '[^']*', '([a-z]+)', '[^']*', '[a-z]+', '[a-z]+', '\[[^\]]*\]', (?:NULL|'[^']*'), '\d+', '(true|false)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    rows.push({ woredaId: m[1], code: m[2], category: m[3], isActive: m[4] === "true" });
  }
  return rows;
}

/** A code counts as "core" if every woreda that has ANY service_type row also has this code active. */
export function findCoreCodeDrift(woredaIds: Set<string>, rows: ServiceTypeRow[]): string[] {
  const activeCodesByWoreda = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.isActive) continue;
    if (!activeCodesByWoreda.has(row.woredaId)) activeCodesByWoreda.set(row.woredaId, new Set());
    activeCodesByWoreda.get(row.woredaId)!.add(row.code);
  }

  const allCodes = new Set(rows.map((r) => r.code));
  const woredasWithRows = [...activeCodesByWoreda.keys()];

  const problems: string[] = [];
  for (const code of allCodes) {
    const presentIn = woredasWithRows.filter((w) => activeCodesByWoreda.get(w)!.has(code));
    // "Core" = present in a strict majority of woredas with any catalog at all.
    // A code present everywhere-but-one is exactly the "forgot to add it
    // there" shape this check exists to catch; a code genuinely unique to
    // one woreda (present in only one) is a deliberate one-off, not drift.
    if (
      presentIn.length >= woredasWithRows.length - 1 &&
      presentIn.length < woredasWithRows.length
    ) {
      const missingFrom = woredasWithRows.filter((w) => !presentIn.includes(w));
      for (const w of missingFrom) {
        problems.push(
          `${w} is missing active service_type code "${code}" (present in ${presentIn.length}/${woredasWithRows.length} other woredas)`,
        );
      }
    }
  }
  return problems;
}

function main() {
  const root = join(import.meta.dir, "..");
  const seedSql = readFileSync(join(root, "supabase/seed.sql"), "utf8");

  const woredaIds = parseWoredaIds(seedSql);
  const rows = parseServiceTypeRows(seedSql);

  if (woredaIds.size === 0) {
    console.error("FAIL: found zero woreda rows in seed.sql -- parser regression?");
    process.exit(1);
  }
  if (rows.length === 0) {
    console.error("FAIL: found zero service_type rows in seed.sql -- parser regression?");
    process.exit(1);
  }

  const problems = findCoreCodeDrift(woredaIds, rows);

  if (problems.length > 0) {
    console.error(
      `FAIL: service_type catalog has drifted for ${problems.length} (woreda x code) pair(s):`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nA service_type code that's active almost everywhere but missing in one woreda is usually " +
        "a forgotten rollout, not a deliberate per-tenant customization -- add the missing row or " +
        "confirm the omission is intentional.",
    );
    process.exit(1);
  }

  console.log(
    `OK: no service_type core-code drift found across ${woredaIds.size} woredas (${rows.length} rows parsed).`,
  );
}

if (import.meta.main) main();
