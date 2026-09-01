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
 *
 * `updatedBy` and the row-verification below are the access-review addendum
 * to F5 (report §3.1's audit-trail paragraph): `role_permission` carried
 * `created_at`/`updated_at` but no column-level record of *who* changed a
 * grant, and the caller's own `audit_log` insert was gated on `error ===
 * null` alone -- which a silently-filtered upsert (RLS excluding the target)
 * can also satisfy, logging a change that never actually happened. Chaining
 * `.select().maybeSingle()` here lets the caller tell the two apart.
 */
export async function upsertRolePermission(
  woredaId: string,
  role: string,
  permissionKey: string,
  isGranted: boolean,
  updatedBy: string | null,
) {
  // updated_by (00000000000018_role_permission_audit_trail.sql) isn't in the
  // generated types yet -- same temporary cast pattern as this codebase's
  // other pre-typegen columns. Regenerate types.ts post-deploy and this
  // cast goes away.
  return supabase
    .from("role_permission")
    .upsert(
      {
        woreda_id: woredaId,
        role_name: role,
        permission_key: permissionKey,
        is_granted: isGranted,
        updated_by: updatedBy,
      } as never,
      { onConflict: "woreda_id,role_name,permission_key" },
    )
    .select("woreda_id, role_name, permission_key")
    .maybeSingle();
}
