#!/usr/bin/env bun
/**
 * Kebele Rental Houses Management, Phase 2 -- section 6.5 legacy backfill.
 *
 * For every active rental_occupancy that has no active rent_account yet,
 * creates one rent_account (billing_start_period_key = the EC period of
 * rent_start_date, adjusted per plan section 3.3: a start during Pagume
 * backfills to the following Meskerem) and one initial rent_rate_history
 * row from the occupancy's own rent_amount -- exactly the section 6.5
 * "Net-zero-disciplined script; audited" backfill the migration's own
 * header comment defers to this file for.
 *
 * The EC conversion reuses src/utils/ethiopianCalendar.ts's own
 * gregorianToEthiopian() directly (imported, not re-implemented) --
 * per BR-28 / plan section 3.7, this module (including this script) adds
 * zero new calendar logic. This is also why the backfill is a script and
 * not a plain migration: 00000000000076's own header explains that Postgres
 * cannot call this TypeScript utility, so anything that needs the actual
 * conversion has to run where the utility runs.
 *
 * Runs over the Management API (Postgres ports are blocked from this
 * sandbox -- see CLAUDE.md's "Sandboxed agent environments" section), using
 * fetch + SUPABASE_ACCESS_TOKEN from the environment. Never urllib-style
 * anything: the requests below go through fetch(), not a hand-rolled
 * Python client, which is the one that trips Cloudflare's User-Agent block.
 *
 * Idempotent: only selects occupancies with no active rent_account, and the
 * migration's own UNIQUE(occupancy_id) WHERE status='active' partial index
 * is a second backstop against a duplicate row even under a race.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=... bun run scripts/rental-phase2-backfill.ts          # dry run (default)
 *   SUPABASE_ACCESS_TOKEN=... bun run scripts/rental-phase2-backfill.ts --apply  # writes
 */
import { gregorianToEthiopian, parseDateOnly } from "../src/utils/ethiopianCalendar";

const PROJECT_REF = "tugzuexfyzbdnghbmrjl";
const apply = process.argv.includes("--apply");

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("error: SUPABASE_ACCESS_TOKEN is not set");
  process.exit(2);
}

async function runQuery(query: string): Promise<unknown> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Management API query failed: ${JSON.stringify(body)}`);
  }
  return body;
}

interface OccupancyRow {
  occupancy_id: string;
  woreda_id: string;
  rental_house_id: string;
  resident_id: string;
  household_id: string | null;
  rent_start_date: string;
  rent_amount: string;
  kebele_id: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// Plan section 3.3: an occupancy starting during Pagume (EC month 13) bills
// from the following Meskerem, not from a nonexistent "Pagume charge".
function billingStartPeriodKey(rentStartDate: string): string {
  const d = parseDateOnly(rentStartDate);
  if (!d) throw new Error(`unparseable rent_start_date: ${rentStartDate}`);
  const e = gregorianToEthiopian(d);
  if (e.month === 13) {
    return `${e.year + 1}-01`;
  }
  return `${e.year}-${pad2(e.month)}`;
}

function sqlUuid(v: string): string {
  return `'${v}'::uuid`;
}
function sqlUuidOrNull(v: string | null): string {
  return v ? sqlUuid(v) : "NULL";
}
function sqlText(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}
function sqlNumeric(v: string): string {
  // rent_amount comes straight from the DB's own numeric column via the
  // Management API's JSON encoding -- it is a digit/decimal-point string,
  // never free text, so no escaping concern; still validated defensively.
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`unexpected numeric literal: ${v}`);
  return v;
}

async function main() {
  const rows = (await runQuery(`
    SELECT o.occupancy_id, o.woreda_id, o.rental_house_id, o.resident_id, o.household_id,
           o.rent_start_date, o.rent_amount, h.kebele_id
      FROM public.rental_occupancy o
      JOIN public.kebele_rental_house h ON h.rental_house_id = o.rental_house_id
     WHERE o.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.rent_account ra
          WHERE ra.occupancy_id = o.occupancy_id AND ra.status = 'active'
       )
  `)) as OccupancyRow[];

  if (rows.length === 0) {
    console.log("No active occupancies need backfilling. Nothing to do.");
    return;
  }

  console.log(`${rows.length} active occupancy(ies) need a rent_account:`);
  const plan = rows.map((r) => {
    const period = billingStartPeriodKey(r.rent_start_date);
    console.log(
      `  occupancy ${r.occupancy_id}: rent_start_date=${r.rent_start_date} -> billing_start_period_key=${period}, rate=${r.rent_amount}`,
    );
    return { ...r, period };
  });

  if (!apply) {
    console.log("\nDry run only (default). Re-run with --apply to write these rows.");
    return;
  }

  const statements = plan
    .map((r) => {
      return `
      WITH new_account AS (
        INSERT INTO public.rent_account (
          woreda_id, occupancy_id, rental_house_id, kebele_id, resident_id, household_id,
          status, billing_start_period_key
        ) VALUES (
          ${sqlUuid(r.woreda_id)}, ${sqlUuid(r.occupancy_id)}, ${sqlUuid(r.rental_house_id)},
          ${sqlUuid(r.kebele_id)}, ${sqlUuid(r.resident_id)}, ${sqlUuidOrNull(r.household_id)},
          'active', ${sqlText(r.period)}
        )
        RETURNING rent_account_id, woreda_id
      )
      INSERT INTO public.rent_rate_history (
        woreda_id, rent_account_id, effective_period_key, monthly_amount, change_reason, status, approved_at
      )
      SELECT woreda_id, rent_account_id, ${sqlText(r.period)}, ${sqlNumeric(r.rent_amount)}, 'phase2_backfill', 'active', now()
        FROM new_account;
      `;
    })
    .join("\n");

  const auditStatements = plan
    .map(
      (r) => `
      INSERT INTO public.audit_log (woreda_id, entity_name, entity_id, action_type, new_value_json)
      SELECT ${sqlUuid(r.woreda_id)}, 'rent_account', ra.rent_account_id::text, 'RENT_ACCOUNT_PHASE2_BACKFILL',
             jsonb_build_object('occupancy_id', ${sqlText(r.occupancy_id)}, 'billing_start_period_key', ${sqlText(r.period)})
        FROM public.rent_account ra
       WHERE ra.occupancy_id = ${sqlUuid(r.occupancy_id)} AND ra.status = 'active';
      `,
    )
    .join("\n");

  await runQuery(`BEGIN;\n${statements}\n${auditStatements}\nCOMMIT;`);
  console.log(
    `\nApplied: created ${plan.length} rent_account row(s) + initial rent_rate_history row(s).`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
