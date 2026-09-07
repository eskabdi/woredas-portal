import { describe, expect, it } from "vitest";
import { parseDefaultRolePerms, setsEqual } from "../check-role-perms-drift";

describe("check-role-perms-drift (F8 regression lock)", () => {
  it("parses the last default_role_perms() definition when multiple CREATE OR REPLACE exist", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
       RETURNS text[]
       LANGUAGE sql
      AS $function$
        SELECT CASE _role
          WHEN 'viewer' THEN ARRAY['resident.read']
          ELSE ARRAY[]::text[]
        END
      $function$
      ;
      -- a later migration replaces it, matching how CREATE OR REPLACE
      -- actually supersedes an earlier definition in Postgres
      CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
       RETURNS text[]
       LANGUAGE sql
      AS $function$
        SELECT CASE _role
          WHEN 'viewer' THEN ARRAY['resident.read','household.read']
          ELSE ARRAY[]::text[]
        END
      $function$
      ;
    `;

    const result = parseDefaultRolePerms(sql);

    expect(result.viewer).toEqual(new Set(["resident.read", "household.read"]));
  });

  it("rejects a permission listed twice in one branch, which Set comparison cannot see", () => {
    // Migration 25 shipped 'credential.preview_print' twice for three roles and
    // CI stayed green: parseDefaultRolePerms collapsed each branch to a Set
    // before anything compared it, so the duplication was structurally
    // invisible. Runtime-harmless, but the compiled authorization matrix
    // disagreed with itself and the next person diffing it had to work out
    // whether it was deliberate.
    const sql = `
CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
AS $function$
  SELECT CASE _role
    WHEN 'registry_clerk' THEN ARRAY['resident.read','credential.preview_print','credential.preview_print']
    ELSE ARRAY[]::text[]
  END;
$function$;`;
    expect(() => parseDefaultRolePerms(sql)).toThrow(/registry_clerk/);
    expect(() => parseDefaultRolePerms(sql)).toThrow(/credential\.preview_print/);
  });

  it("accepts the same key appearing in different roles", () => {
    const sql = `
CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
AS $function$
  SELECT CASE _role
    WHEN 'registry_clerk' THEN ARRAY['resident.read','credential.preview_print']
    WHEN 'civil_registrar' THEN ARRAY['resident.read','credential.preview_print']
    ELSE ARRAY[]::text[]
  END;
$function$;`;
    const parsed = parseDefaultRolePerms(sql);
    expect(parsed.registry_clerk.has("credential.preview_print")).toBe(true);
    expect(parsed.civil_registrar.has("credential.preview_print")).toBe(true);
  });

  it("throws if no default_role_perms() definition is found at all", () => {
    expect(() => parseDefaultRolePerms("CREATE OR REPLACE FUNCTION public.other() ...")).toThrow();
  });

  it("setsEqual is order-independent and size-sensitive", () => {
    expect(setsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(setsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(setsEqual(new Set(), new Set())).toBe(true);
  });
});
