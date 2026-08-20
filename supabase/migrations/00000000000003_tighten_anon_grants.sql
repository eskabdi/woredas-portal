-- ============================================================================
-- Drop table privileges that no PostgREST client can use, and close one
-- SECURITY DEFINER function to anon.
--
-- Every relation in public (38 of them) grants the full privilege set to both
-- anon and authenticated: SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER,
-- TRUNCATE. The DML half is intentional -- RLS is what constrains it, and an
-- audit confirmed that holds: no policy in public admits anon or PUBLIC, and as
-- role anon, app_user and audit_log return 0 rows and 0 rows affected for
-- select, update and delete alike.
--
-- The other three are not constrained by RLS and are not usable by the API:
--
--   TRUNCATE   -- RLS does NOT apply to TRUNCATE. The grant is a real
--                 capability; only unreachability keeps it harmless, since
--                 PostgREST emits DML exclusively and anon/authenticated are
--                 NOLOGIN roles reached by authenticator switching into them.
--                 That is a thin margin for a privilege nobody needs.
--   TRIGGER    -- lets the grantee attach triggers to the table.
--   REFERENCES -- lets the grantee create foreign keys against it.
--
-- Revoking all three costs nothing: no application path uses them.
-- ============================================================================

REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- ============================================================================
-- Keep it from coming back.
--
-- These grants are not an artifact of the schema dump -- they are Supabase's
-- stock default. pg_default_acl carries arwdDxtm for anon and authenticated on
-- tables in public, so the next CREATE TABLE re-grants all three and quietly
-- undoes the statement above.
--
-- This block deviates from Supabase's out-of-the-box defaults. It is safe (the
-- privileges are unused) but it is a deliberate divergence, so drop this block
-- if you would rather stay on stock behavior and re-run the REVOKE above after
-- adding tables.
--
-- Scope note: this covers objects created by `postgres`, which is what
-- migrations run as. Anything created by `supabase_admin` carries its own
-- default ACL that we cannot alter from here.
-- ============================================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

-- ============================================================================
-- get_credential_live_status(text) -- SECURITY DEFINER, currently executable
-- by anon.
--
-- Its only caller is HararildScanner.tsx, mounted on /woreda/credentials/verify,
-- which sits behind the authenticated /woreda layout. Left executable by anon
-- it is a credential-status oracle for anyone holding the publishable key:
-- credential numbers are structured WW-KK-YY-NNNNNN-C with an enumerable
-- sequence, so valid numbers can be discovered and their status read. It
-- returns status text only -- enumeration, not disclosure -- but the function
-- has no unauthenticated caller to serve.
--
-- verify_service_letter() is deliberately left alone: it backs the public
-- /verify/letter/$token page and must stay executable by anon.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.get_credential_live_status(text) FROM anon;
