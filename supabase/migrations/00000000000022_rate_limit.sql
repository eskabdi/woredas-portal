-- ============================================================================
-- Postgres-backed fixed-window rate limiting for Edge Functions (INSA
-- remediation Phase B, finding 5.9).
--
-- Edge Function isolates are stateless (no cross-invocation memory, no Deno
-- KV provisioned), so the counter lives here. The three invite functions
-- (invite-tenant-user, invite-platform-admin, resend-platform-invite) call
-- rate_limit_hit() via the service-role client, keyed by the VERIFIED caller
-- user_id -- never by anything request-supplied.
--
-- Deliberately NOT covered: the two public verification RPCs
-- (verify_credential_token / verify_service_letter). They are plain SQL
-- functions invoked by the anon client with no request-IP plumbing;
-- retrofitting per-caller limits there means rewriting two security-
-- sensitive public functions in plpgsql for little gain -- they rely on
-- Supabase's project-wide API rate limits instead, documented as an accepted
-- gap in docs/testing-scope.md's operator checklist.
--
-- No pg_cron: this repo has none, and traffic is tiny (an internal-staff
-- app). rate_limit_hit() deletes expired rows opportunistically on each
-- call, which keeps the table at a handful of live rows without scheduled
-- infrastructure.
-- ============================================================================

CREATE TABLE public.rate_limit_bucket (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer DEFAULT 1 NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

-- Deny-all RLS: enabled with zero policies. Only the service-role client
-- (which bypasses RLS) and rate_limit_hit() below ever touch this table --
-- there is no legitimate anon/authenticated access at all.
ALTER TABLE public.rate_limit_bucket ENABLE ROW LEVEL SECURITY;

-- Belt over the RLS braces, matching 00000000000007_tighten_anon_grants:
-- default grants would otherwise leave anon/authenticated holding table
-- privileges that RLS alone is left to neutralize.
REVOKE ALL ON TABLE public.rate_limit_bucket FROM PUBLIC, anon, authenticated;

-- Atomic hit counter: one round trip, INSERT .. ON CONFLICT .. DO UPDATE so
-- two concurrent calls both count (a client-side read-then-write would lose
-- increments). Returns the count for the current window; the caller compares
-- it against its own limit.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(_bucket_key text, _window_seconds integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  IF _window_seconds IS NULL OR _window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid _window_seconds %', _window_seconds;
  END IF;

  v_window_start :=
    to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  -- Opportunistic cleanup (see header): anything older than an hour is
  -- outside every window this app uses.
  DELETE FROM public.rate_limit_bucket WHERE window_start < now() - interval '1 hour';

  INSERT INTO public.rate_limit_bucket (bucket_key, window_start, request_count)
  VALUES (_bucket_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET request_count = rate_limit_bucket.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count;
END;
$function$;

-- Same closure discipline as 00000000000008_close_definer_helpers.sql:
-- SECURITY DEFINER + postgres owner means anyone who can EXECUTE this
-- function writes past RLS through it, so EXECUTE is the real gate.
-- service_role only -- unlike the user_has_perm()-style helpers, no
-- RLS policy and no client code ever evaluates this as anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer) TO service_role;
