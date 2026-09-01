-- Access review (docs/rbac-security-forensic-review.md §3.1, "Audit trail"
-- paragraph): role_permission carries created_at/updated_at but no
-- column-level record of WHO changed a grant -- the application layer only
-- partially compensated for this via a separate audit_log insert in
-- RolesPermissionsTab.toggle(), which (before F5's fix) could log a change
-- that never actually happened. This column lets a row carry its own
-- provenance instead of depending entirely on a separate table staying in
-- sync with it.
ALTER TABLE public.role_permission
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.app_user(user_id);
