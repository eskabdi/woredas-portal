import { supabase } from "@/integrations/supabase/client";

/**
 * Grants or revokes one (woreda, role, permission) cell in the tenant
 * permission matrix.
 *
 * Deliberately an `upsert`, not an `update`: PostgREST returns `error: null`
 * whether an `UPDATE ... WHERE` matched one row or zero, so a bare `.update()`
 * silently no-ops for any permission key that doesn't have a `role_permission`
 * row yet (every tenant created before the seed covered a given module, or
 * after it and never backfilled). `upsert` creates the row on first toggle
 * instead of depending on one already existing.
 *
 * See docs/rbac-security-forensic-review.md, F5.
 */
export async function upsertRolePermission(
  woredaId: string,
  role: string,
  permissionKey: string,
  isGranted: boolean,
) {
  return supabase.from("role_permission").upsert(
    {
      woreda_id: woredaId,
      role_name: role,
      permission_key: permissionKey,
      is_granted: isGranted,
    },
    { onConflict: "woreda_id,role_name,permission_key" },
  );
}
