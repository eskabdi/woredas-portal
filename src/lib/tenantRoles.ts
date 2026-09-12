import { supabase } from "@/integrations/supabase/client";

export interface TenantRoleRow {
  tenant_role_id: string;
  woreda_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
}

export interface TenantRolePermissionRow {
  permission_key: string;
  is_granted: boolean;
}

// tenant_role / tenant_role_permission aren't in the generated types yet
// (00000000000038_task13_tenant_role_schema.sql) -- same temporary
// untyped-client cast pattern as user_permission_override
// (src/lib/userPermissionOverrides.ts). Regenerate types.ts post-deploy and
// these casts go away.
interface SelectBuilder<T> extends PromiseLike<{ data: T | null; error: unknown }> {
  eq: (col: string, val: string) => SelectBuilder<T>;
  order: (col: string) => SelectBuilder<T>;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
}
interface UpsertBuilder extends Promise<{ data: unknown; error: unknown }> {
  select: (cols: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
}
type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => SelectBuilder<unknown[]>;
    insert: (row: Record<string, unknown>) => UpsertBuilder;
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: string) => UpsertBuilder;
    };
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => UpsertBuilder;
  };
};
const db = supabase as unknown as UntypedClient;

export async function fetchTenantRoles(woredaId: string): Promise<TenantRoleRow[]> {
  const { data, error } = await db
    .from("tenant_role")
    .select("tenant_role_id, woreda_id, name, description, is_active")
    .eq("woreda_id", woredaId)
    .order("name");
  if (error) throw error as Error;
  return (data ?? []) as TenantRoleRow[];
}

export async function fetchTenantRolePermissions(
  tenantRoleId: string,
): Promise<TenantRolePermissionRow[]> {
  const { data, error } = await db
    .from("tenant_role_permission")
    .select("permission_key, is_granted")
    .eq("tenant_role_id", tenantRoleId);
  if (error) throw error as Error;
  return (data ?? []) as TenantRolePermissionRow[];
}

/** Per the house rule (F5/F6): every mutation chains `.select().maybeSingle()`
 * and treats an empty result as failure -- RLS silently excluding a
 * cross-tenant target (a stale tenant_role from a second tab, a role another
 * admin just deactivated) must not be reported as a successful save. */
export async function createTenantRole(
  woredaId: string,
  name: string,
  description: string | null,
  createdBy: string | null,
): Promise<{ data: unknown; error: unknown }> {
  return db
    .from("tenant_role")
    .insert({
      woreda_id: woredaId,
      name,
      description,
      created_by: createdBy,
      updated_by: createdBy,
    })
    .select("tenant_role_id")
    .maybeSingle();
}

export async function updateTenantRole(
  tenantRoleId: string,
  patch: { name?: string; description?: string | null; is_active?: boolean },
  updatedBy: string | null,
): Promise<{ data: unknown; error: unknown }> {
  return db
    .from("tenant_role")
    .update({ ...patch, updated_by: updatedBy })
    .eq("tenant_role_id", tenantRoleId)
    .select("tenant_role_id")
    .maybeSingle();
}

export async function upsertTenantRolePermission(
  tenantRoleId: string,
  permissionKey: string,
  isGranted: boolean,
  updatedBy: string | null,
): Promise<{ data: unknown; error: unknown }> {
  return db
    .from("tenant_role_permission")
    .upsert(
      {
        tenant_role_id: tenantRoleId,
        permission_key: permissionKey,
        is_granted: isGranted,
        updated_by: updatedBy,
      },
      { onConflict: "tenant_role_id,permission_key" },
    )
    .select("tenant_role_id, permission_key")
    .maybeSingle();
}
