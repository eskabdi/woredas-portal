-- Task 14-B follow-up: verify_service_letter() must accept 'completed'.
--
-- Found live during the real two-actor end-to-end verification walkthrough:
-- migration 00000000000061 made 'completed' the sole terminal status for a
-- letter (issued -> completed, service.complete), replacing the pre-14-B
-- 'closed' terminus complaints still use. verify_service_letter() -- the
-- RPC backing the public verify.letter.$token route, unrelated to and
-- untouched by any of the 14-B migrations -- was never updated, and its
-- own status allow-list (`status IN ('issued', 'resolved', 'closed')`)
-- has no 'completed'. Confirmed live: a real letter driven through the
-- full FSM to 'completed' (request ABOKER-SRV-26-00003, token
-- SJ44WBNZW3ZD) returned zero rows from this RPC even with a correct
-- token and a populated issued_at -- every letter that ever reaches its
-- own new terminal status becomes publicly unverifiable.
--
-- Additive: only widens the allowed status set (a superset of the
-- as-built list), CREATE OR REPLACE, no signature change, no grant change
-- needed (EXECUTE is already granted to anon/authenticated/PUBLIC).

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_service_letter(_token text)
 RETURNS TABLE(request_number text, issued_at timestamp with time zone, subject text, resident_full_name text, letter_summary text, service_type_am text, service_type_en text, woreda_name_am text, woreda_name_en text, kebele_name_am text, kebele_name_en text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    sr.request_number,
    sr.issued_at,
    sr.subject,
    COALESCE(r.full_name_am, r.full_name, sr.applicant_name),
    COALESCE(sr.letter_summary, sr.purpose),
    st.name_am,
    st.name_en,
    w.woreda_name_am,
    w.woreda_name_en,
    k.kebele_name_am,
    k.kebele_name_en
  FROM public.service_request sr
  LEFT JOIN public.resident r ON r.resident_id = sr.resident_id
  LEFT JOIN public.service_type st ON st.service_type_id = sr.service_type_id
  LEFT JOIN public.woreda w ON w.woreda_id = sr.woreda_id
  LEFT JOIN public.kebele k ON k.kebele_id = sr.kebele_id
  WHERE sr.verification_token = _token
    AND sr.issued_at IS NOT NULL
    AND sr.status IN ('issued', 'resolved', 'closed', 'completed')
  LIMIT 1;
$function$;

COMMIT;
