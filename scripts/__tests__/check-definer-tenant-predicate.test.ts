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

  it("accepts the same lookup once it carries get_user_woreda_id(), is_super_admin() or auth.uid()", () => {
    for (const predicate of [
      "AND woreda_id = public.get_user_woreda_id()",
      "AND (public.is_super_admin() OR woreda_id = public.get_user_woreda_id())",
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

  describe("a bare woreda_id is not a tenant anchor (P0-2 review)", () => {
    const fn = (body: string) => `${TABLES}
      CREATE OR REPLACE FUNCTION public.f(_id uuid, _woreda_id uuid) RETURNS text
       LANGUAGE plpgsql SECURITY DEFINER AS $function$ ${body} $function$;`;

    it("flags a caller-supplied woreda parameter", () => {
      expect(
        unscoped(
          fn(
            "BEGIN RETURN (SELECT full_name FROM public.resident WHERE resident_id = _id AND woreda_id = _woreda_id); END;",
          ),
        ),
      ).toEqual(["f:resident"]);
    });

    it("flags a lookup whose only woreda_id is a display join", () => {
      expect(
        unscoped(
          fn(`BEGIN RETURN (SELECT w.name FROM public.resident r
                JOIN public.woreda w ON w.woreda_id = r.woreda_id WHERE r.resident_id = _id); END;`),
        ),
      ).toEqual(["f:resident"]);
    });

    it("does not let a RAISE after IF .. THEN scope the condition before it", () => {
      expect(
        unscoped(
          fn(`BEGIN
                IF NOT EXISTS (SELECT 1 FROM public.resident WHERE resident_id = _id) THEN
                  RAISE EXCEPTION 'x %', NEW.woreda_id;
                END IF;
              END;`),
        ),
      ).toEqual(["f:resident"]);
    });

    it("does not treat INTO NEW.woreda_id as scoping the lookup that fills it", () => {
      expect(
        unscoped(
          fn(
            "BEGIN SELECT woreda_id INTO NEW.woreda_id FROM public.resident WHERE resident_id = _id; END;",
          ),
        ),
      ).toEqual(["f:resident"]);
    });

    it("sees tables without the public. prefix, and UPDATE statements", () => {
      expect(unscoped(fn("BEGIN PERFORM 1 FROM resident WHERE resident_id = _id; END;"))).toEqual([
        "f:resident",
      ]);
      expect(
        unscoped(
          fn("BEGIN UPDATE public.resident SET full_name = 'x' WHERE resident_id = _id; END;"),
        ),
      ).toEqual(["f:resident"]);
    });

    it("sees comma joins, DELETE .. USING and quoted identifiers", () => {
      expect(
        unscoped(
          fn(
            "BEGIN PERFORM 1 FROM public.woreda w, public.resident r WHERE r.resident_id = _id; END;",
          ),
        ),
      ).toEqual(["f:resident"]);
      expect(
        unscoped(
          fn(
            "BEGIN DELETE FROM public.woreda w USING public.resident r WHERE r.resident_id = _id; END;",
          ),
        ),
      ).toEqual(["f:resident"]);
      expect(
        unscoped(fn('BEGIN PERFORM 1 FROM public."resident" WHERE resident_id = _id; END;')),
      ).toEqual(["f:resident"]);
    });

    it("ignores a woreda_id or `--` inside a string literal", () => {
      expect(
        unscoped(
          fn(`BEGIN
                RAISE EXCEPTION 'gone -- refresh / woreda_id get_user_woreda_id()';
                PERFORM 1 FROM public.resident WHERE resident_id = _id;
              END;`),
        ),
      ).toEqual(["f:resident"]);
    });
  });

  describe("anchors that do scope a statement", () => {
    it("accepts a variable assigned from get_user_woreda_id(), and one SELECTed INTO from an anchored row", () => {
      const sql = `${TABLES}
        CREATE OR REPLACE FUNCTION public.g(_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
        AS $function$
        DECLARE
          v_woreda uuid := public.get_user_woreda_id();
          v_household uuid;
        BEGIN
          SELECT current_household_id INTO v_household FROM public.resident
           WHERE resident_id = _id AND woreda_id = v_woreda;
          RETURN (SELECT full_name FROM public.resident WHERE current_household_id = v_household LIMIT 1);
        END;
        $function$;`;
      expect(unscoped(sql)).toEqual([]);
    });

    it("scopes a correlated subquery inside CASE .. THEN by its outer statement", () => {
      const sql = `${TABLES}
        CREATE OR REPLACE FUNCTION public.h() RETURNS boolean LANGUAGE sql SECURITY DEFINER
        AS $function$
          SELECT EXISTS (SELECT 1 FROM public.resident au WHERE au.resident_id = auth.uid()
            AND CASE WHEN au.woreda_id IS NULL THEN false
                     ELSE (SELECT true FROM public.resident x WHERE x.resident_id = au.resident_id) END)
        $function$;`;
      expect(unscoped(sql)).toEqual([]);
    });
  });

  it("keys functions by argument types and forgets a DROPped definition", () => {
    const sql = `${TABLES}
      CREATE OR REPLACE FUNCTION public.v(_old_name text) RETURNS text LANGUAGE sql SECURITY DEFINER
      AS $function$ SELECT full_name FROM public.resident WHERE full_name = _old_name; $function$;
      DROP FUNCTION IF EXISTS public.v(TEXT);
      CREATE FUNCTION public.v(_new_name text) RETURNS text LANGUAGE sql SECURITY DEFINER
      AS $function$ SELECT full_name FROM public.resident
        WHERE full_name = _new_name AND woreda_id = public.get_user_woreda_id(); $function$;`;
    const defs = parseLatestFunctions(sql);
    expect([...defs.keys()]).toEqual(["v(text)"]);
    expect(unscoped(sql)).toEqual([]);
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
