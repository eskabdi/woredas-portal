-- Task 11 follow-up: one residual finding from the verification pass on
-- 00000000000049-051 (the other -- 051's zz_ trigger CREATE not being
-- re-runnable -- was fixed in place in 051 itself, since that file hadn't
-- been pushed anywhere yet).
--
-- LOW: household_location's mirror trigger only fired on UPDATE OF the GPS
-- columns, so a super-admin-only transfer of a household to a different
-- woreda (UPDATE OF woreda_id alone, no GPS change in the same statement)
-- left the mirrored household_location row pointing at the old tenant --
-- visible to the old woreda, invisible to the new one. Narrow
-- (super_admin/service_role only, since household_update pins woreda_id
-- for everyone else) but free to close: widen the trigger's column list to
-- also fire on woreda_id. (051 already applies the equivalent fix to the
-- two office consistency triggers.)

BEGIN;

DROP TRIGGER IF EXISTS mirror_household_gps_after_write ON public.household;
CREATE TRIGGER mirror_household_gps_after_write
  AFTER INSERT OR UPDATE OF gps_lat, gps_lng, woreda_id ON public.household
  FOR EACH ROW EXECUTE FUNCTION public.mirror_household_gps_to_location();

COMMIT;
