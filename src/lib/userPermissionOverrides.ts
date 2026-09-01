import { supabase } from "@/integrations/supabase/client";

export interface UserPermissionOverrideRow {
  permission_key: string;
  is_granted: boolean;
}

// user_permission_override isn't in the generated types yet
// (00000000000017_user_permission_overrides.sql) -- same temporary
// `as never`/untyped-client pattern already used elsewhere in this codebase
// for pre-typegen tables (console_role, id_card_template_field_draft).
// Regenerate types.ts post-deploy and these casts go away.
interface DeleteSelectBuilder extends PromiseLike<{ data: unknown[] | null; error: unknown }> {
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
}
interface DeleteBuilder extends Promise<{ error: unknown }> {
  eq: (col: string, val: string) => DeleteBuilder;
  select: (cols: string) => DeleteSelectBuilder;
}
interface UpsertBuilder extends Promise<{ data: unknown; error: unknown }> {
  select: (cols: string) => {
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  };
}
type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>;
    };
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => UpsertBuilder;
    delete: () => DeleteBuilder;
  };
};
const db = supabase as unknown as UntypedClient;

/** woreda_id is deliberately never sent -- the BEFORE INSERT/UPDATE trigger
 * (enforce_user_permission_override_woreda) always re-derives it from the
 * target user's own app_user row, so a client can't point an override at a
 * different tenant than the one the target user is actually in. */

export async function fetchUserOverrides(userId: string): Promise<UserPermissionOverrideRow[]> {
  const { data, error } = await db
    .from("user_permission_override")
    .select("permission_key, is_granted")
    .eq("user_id", userId);
  if (error) throw error as Error;
  return (data ?? []) as UserPermissionOverrideRow[];
}

/** Per the F6 house rule: verifies the write actually matched/created a row
 * (`.select().maybeSingle()`) rather than trusting `error === null` alone --
 * a stale target user, or a tenant boundary the RLS policy excludes, would
 * otherwise silently no-op while this still reported success. */
export async function upsertUserOverride(
  userId: string,
  permissionKey: string,
  isGranted: boolean,
): Promise<{ data: unknown; error: unknown }> {
  return db
    .from("user_permission_override")
    .upsert(
      { user_id: userId, permission_key: permissionKey, is_granted: isGranted },
      { onConflict: "user_id,permission_key" },
    )
    .select("user_id, permission_key")
    .maybeSingle();
}

/** Same F6 house rule as the upsert above, in the direction that matters
 * more here: an admin who believes a grant/deny was just cleared, when RLS
 * (e.g. the target-role exclusion added for tenant-isolation-review Finding
 * 3) silently filtered the delete, would otherwise go on believing the
 * override no longer applies while it still does. */
export async function clearUserOverride(
  userId: string,
  permissionKey: string,
): Promise<{ data: unknown; error: unknown }> {
  return db
    .from("user_permission_override")
    .delete()
    .eq("user_id", userId)
    .eq("permission_key", permissionKey)
    .select("user_id, permission_key")
    .maybeSingle();
}

/** Used by the role-change flow (D2(c)): an admin reviewing a role change
 * can explicitly clear every override for that user rather than have them
 * silently persist under the new role. Row-verified for the same reason as
 * clearUserOverride -- callers only invoke this when overrides are known to
 * exist, so an empty result means the delete didn't reach them. */
export async function clearAllUserOverrides(
  userId: string,
): Promise<{ data: unknown[] | null; error: unknown }> {
  return db.from("user_permission_override").delete().eq("user_id", userId).select("user_id");
}
