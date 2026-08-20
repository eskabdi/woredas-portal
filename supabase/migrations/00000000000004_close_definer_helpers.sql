-- ============================================================================
-- Close the remaining directly-callable SECURITY DEFINER helpers to anon.
--
-- Defense in depth, not a fix for live exposure: all five key off auth.uid(),
-- which is NULL for an anonymous caller, so they already return false or NULL.
-- The point is that a SECURITY DEFINER function runs as its owner, and `anon`
-- is reachable by anyone holding the publishable key -- so the surface should
-- be no wider than the set of functions that genuinely serve unauthenticated
-- callers.
--
-- As with get_credential_live_status in 00000000000003, the revoke has to name
-- PUBLIC. Postgres grants EXECUTE to PUBLIC on every function by default, and
-- revoking from anon alone leaves the function open through that grant.
--
-- The GRANTs are not optional. These helpers are called inside RLS policy
-- expressions, which evaluate as the querying role -- revoke from PUBLIC
-- without re-granting to authenticated and every policy using them fails with
-- "permission denied for function".
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.get_user_woreda_id()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin()             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_perm(text)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_any_perm(text[])     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_user_woreda_id()           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin()               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin()              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_perm(text)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_any_perm(text[])      TO authenticated, service_role;

-- ============================================================================
-- Deliberately NOT revoked: the 15 trigger functions
--
--   apply_death_on_approval, apply_rental_occupancy_on_approval,
--   assign_credential_number, assign_credential_request_number,
--   assign_letter_verification_token, assign_receipt_number,
--   assign_rental_request_number, assign_resident_number,
--   assign_service_request_number, assign_vital_event_number,
--   force_actor_columns, generate_residence_credential_on_payment,
--   generate_resident_on_birth_approval, validate_credential_fee_amount,
--   validate_receipt_amount
--
-- They are SECURITY DEFINER and executable by anon, but they return `trigger`
-- and Postgres refuses a direct call regardless of privilege:
--
--   set role anon; select public.force_actor_columns();
--   ERROR: 0A000: trigger functions can only be called as triggers
--
-- Verified against the deployed project. PostgREST does not expose functions
-- returning `trigger` either, so there is no reachable surface to close, and a
-- revoke here would trade zero security benefit against the risk of disturbing
-- trigger execution -- these are the functions that assign every reference
-- number and drive the approval cascades.
--
-- verify_service_letter() also stays open to anon: it backs the public
-- /verify/letter/$token page.
-- ============================================================================
