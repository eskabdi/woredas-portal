import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REVIEWED_BASELINE,
  findUnscopedLookups,
  parseLatestFunctions,
  parseTenantTables,
} from "../check-definer-tenant-predicate";

const TABLES = `
  CREATE TABLE IF NOT EXISTS public.resident (
    resident_id uuid NOT NULL,
    woreda_id uuid NOT NULL
  );
  CREATE TABLE IF NOT EXISTS public.workflow_transition (
    entity text NOT NULL
  );
`;

function unscoped(sql: string): string[] {
  return [...findUnscopedLookups(parseLatestFunctions(sql), parseTenantTables(sql))].sort();
}

describe("check-definer-tenant-predicate (WP-VER-001 regression lock)", () => {
  it("finds tenant tables by their woreda_id column, not the woreda root", () => {
    const tables = parseTenantTables(
      TABLES +
        `CREATE TABLE public.woreda (\n  woreda_id uuid NOT NULL\n);\n` +
        `ALTER TABLE public.payment ADD COLUMN woreda_id uuid;`,
    );
    expect([...tables].sort()).toEqual(["payment", "resident"]);
  });

  it("flags a DEFINER lookup by a caller-supplied key with no woreda predicate", () => {
    const sql = `${TABLES}
      CREATE OR REPLACE FUNCTION public.leak(_id uuid) RETURNS text
       LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
      AS $function$ SELECT full_name FROM public.resident WHERE resident_id = _id; $function$;`;
    expect(unscoped(sql)).toEqual(["leak:resident"]);
  });

  it("accepts the same lookup once it carries woreda_id, is_super_admin() or auth.uid()", () => {
    for (const predicate of [
      "AND woreda_id = public.get_user_woreda_id()",
      "AND (public.is_super_admin() OR true)",
      "AND resident_id = auth.uid()",
    ]) {
      const sql = `${TABLES}
        CREATE OR REPLACE FUNCTION public.ok(_id uuid) RETURNS text
         LANGUAGE sql STABLE SECURITY DEFINER
        AS $function$ SELECT full_name FROM public.resident WHERE resident_id = _id ${predicate}; $function$;`;
      expect(unscoped(sql)).toEqual([]);
    }
  });

  it("ignores SECURITY INVOKER functions and non-tenant tables", () => {
    const sql = `${TABLES}
      CREATE OR REPLACE FUNCTION public.invoker(_id uuid) RETURNS text LANGUAGE sql STABLE
      AS $$ SELECT full_name FROM public.resident WHERE resident_id = _id; $$;
      CREATE OR REPLACE FUNCTION public.platform() RETURNS bigint LANGUAGE sql SECURITY DEFINER
      AS $$ SELECT count(*) FROM public.workflow_transition; $$;`;
    expect(unscoped(sql)).toEqual([]);
  });

  it("judges only the latest CREATE OR REPLACE definition", () => {
    const sql = `${TABLES}
      CREATE OR REPLACE FUNCTION public.fixed(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER
      AS $function$ SELECT full_name FROM public.resident WHERE resident_id = _id; $function$;
      CREATE OR REPLACE FUNCTION public.fixed(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER
      AS $function$ SELECT full_name FROM public.resident r
        WHERE r.resident_id = _id AND r.woreda_id = public.get_user_woreda_id(); $function$;`;
    expect(unscoped(sql)).toEqual([]);
  });

  it("ignores a woreda_id that appears only in a comment", () => {
    const sql = `${TABLES}
      CREATE OR REPLACE FUNCTION public.commented(_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER
      AS $function$
        SELECT full_name FROM public.resident -- TODO: add woreda_id
         WHERE resident_id = _id;
      $function$;`;
    expect(unscoped(sql)).toEqual(["commented:resident"]);
  });

  describe("against this repo's migrations", () => {
    const dir = join(import.meta.dirname, "..", "..", "supabase", "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const read = (fs: string[]) => fs.map((f) => readFileSync(join(dir, f), "utf-8")).join("\n");

    it("would have caught all three WP-VER-001 functions before migration 90", () => {
      const before = read(files.filter((f) => f < "00000000000090"));
      const found = unscoped(before);
      expect(found).toContain("generate_resident_on_birth_approval:resident");
      expect(found).toContain("rental_eligibility:resident");
      expect(found).toContain("get_credential_live_status:residence_credential");
    });

    it("finds exactly the reviewed baseline at HEAD", () => {
      expect(unscoped(read(files))).toEqual(Object.keys(REVIEWED_BASELINE).sort());
    });
  });
});
