-- ============================================================================
-- Audit: dates entered through the (now-fixed) Ethiopian calendar widget
-- before the fix in this branch, which may have been stored wrong.
--
-- Run in the Supabase SQL Editor. Read-only -- every query here is a SELECT.
-- The SQL Editor shows one result set at a time, so run each numbered
-- section separately.
--
-- BACKGROUND
-- ----------
-- `src/utils/ethiopianCalendar.ts` used a single JDN epoch constant for both
-- conversion directions, but each direction's formula needed a different
-- one. This was fixed by giving each direction its own correctly-paired
-- constant. Before the fix, `EthiopianDateInput` (the Ethiopian-calendar date
-- picker used for date_of_birth, civil event dates, and rental dates) could
-- silently write a wrong Gregorian value to the database. There are two
-- distinct failure modes, with very different signatures:
--
--   (A) FRESH ENTRY. A user types a brand new Ethiopian date into an empty
--       widget. The old `ethiopianToGregorian` alone was off by exactly
--       ONE DAY (always one day earlier than correct) for every input.
--       This is a real, systematic 1-day error on every date entered this
--       way while the bug was live -- but it produces a value that still
--       looks completely plausible (nothing about "one day early" is
--       detectable by a sanity check). THIS AUDIT CANNOT FIND THESE.
--       There is no query that can recover a silent 1-day shift after the
--       fact; the only fix is re-confirming the date against its source
--       document (birth certificate, marriage certificate, etc).
--
--   (B) EDITING AN EXISTING DATE. A user opens a form for a record that
--       already has a stored Gregorian date. The widget displays it as an
--       Ethiopian date using the old (badly broken, not just 1-day-off)
--       `gregorianToEthiopian` -- which could show a wildly wrong year. If
--       the user then edits or re-saves any of the day/month/year fields,
--       ALL THREE current field values (including the two the user never
--       touched) are re-converted back to Gregorian via the old
--       `ethiopianToGregorian` and saved. Verified empirically (see the
--       session that produced this script): with no net change to the
--       displayed value, this round trip always shifts the stored Gregorian
--       date EXACTLY 365 DAYS EARLIER than the original. A real edit adds
--       whatever the user intentionally changed on top of that base -365
--       day shift. This IS detectable: shifting a suspect date forward by
--       365 days and checking whether that resolves an implausibility (a
--       negative or 100+ year age, a chronological impossibility) is a
--       strong, non-coincidental signal for this specific bug.
--
-- WHAT THIS SCRIPT DOES
-- ----------------------
-- Section 1: high-confidence candidates -- a stored date is implausible
--   as-is, but shifting it forward 365 days would make it plausible. This
--   is the (B) mechanism's signature; treat these as "should be corrected
--   by re-entering the true date" (do not blindly add 365 days -- always
--   verify with the resident/registrar first, since a real edit would have
--   added its own delta on top of the base 365).
-- Section 2: general implausibility scan, independent of the 365-day
--   theory -- catches anything else wrong (bad seed data, unrelated typos,
--   or an (A)-mechanism error that also happens to be implausible).
-- Section 3: exposure scope -- how many rows in the affected columns exist
--   at all, so you know the size of what can't be checked automatically
--   (every plausible-looking date in this count could still carry the
--   silent 1-day (A) error).
--
-- Affected columns (every date column ever written by EthiopianDateInput):
--   resident.date_of_birth, resident.residency_start_date
--   vital_event.event_date (all event types), and for divorce events only,
--     vital_event.event_details ->> 'marriage_date' (stored in JSON, not a
--     column)
--   rental_occupancy_request.rent_start_date, .termination_date
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1a. resident.date_of_birth: implausible age as stored (future birth, or
--     age > 110), but plausible if shifted forward 365 days.
-- ---------------------------------------------------------------------------
SELECT
  'resident.date_of_birth'                 AS column_ref,
  r.resident_id,
  r.full_name,
  r.date_of_birth                          AS stored_value,
  r.date_of_birth + 365                    AS shifted_candidate,
  date_part('year', age(r.date_of_birth))          AS age_as_stored,
  date_part('year', age(r.date_of_birth + 365))    AS age_if_shifted,
  r.updated_at
FROM public.resident r
WHERE (r.date_of_birth > CURRENT_DATE OR date_part('year', age(r.date_of_birth)) > 110)
  AND NOT (
    r.date_of_birth + 365 > CURRENT_DATE
    OR date_part('year', age(r.date_of_birth + 365)) > 110
  )
ORDER BY r.updated_at DESC;


-- ---------------------------------------------------------------------------
-- 1b. resident.residency_start_date: before date_of_birth or in the future
--     as stored, resolved by shifting 365 days forward.
-- ---------------------------------------------------------------------------
SELECT
  'resident.residency_start_date'          AS column_ref,
  r.resident_id,
  r.full_name,
  r.date_of_birth,
  r.residency_start_date                   AS stored_value,
  r.residency_start_date + 365             AS shifted_candidate,
  r.updated_at
FROM public.resident r
WHERE r.residency_start_date IS NOT NULL
  AND (r.residency_start_date < r.date_of_birth OR r.residency_start_date > CURRENT_DATE)
  AND NOT (
    r.residency_start_date + 365 < r.date_of_birth
    OR r.residency_start_date + 365 > CURRENT_DATE
  )
ORDER BY r.updated_at DESC;


-- ---------------------------------------------------------------------------
-- 1c. vital_event.event_date: implausible as stored (future, or -- for
--     birth/death events with a linked resident -- inconsistent with that
--     resident's date_of_birth by more than a few days), resolved by a
--     365-day forward shift.
-- ---------------------------------------------------------------------------
SELECT
  'vital_event.event_date'                 AS column_ref,
  v.vital_event_id,
  v.event_type,
  v.event_number,
  v.event_date                             AS stored_value,
  v.event_date + 365                       AS shifted_candidate,
  r.date_of_birth                          AS linked_resident_dob,
  v.updated_at
FROM public.vital_event v
LEFT JOIN public.resident r ON r.resident_id = v.resident_id
WHERE (
    v.event_date > CURRENT_DATE
    OR (v.event_type = 'birth' AND r.resident_id IS NOT NULL AND v.event_date <> r.date_of_birth)
  )
  AND NOT (
    v.event_date + 365 > CURRENT_DATE
    OR (
      v.event_type = 'birth' AND r.resident_id IS NOT NULL
      AND v.event_date + 365 <> r.date_of_birth
    )
  )
ORDER BY v.updated_at DESC;


-- ---------------------------------------------------------------------------
-- 1d. divorce events: event_details->>'marriage_date' stored after the
--     divorce's own event_date -- the app's own entry form refuses to save
--     this (see woreda.civil.divorce.new.tsx's zod .refine), so any row
--     violating it in the database was corrupted after entry, not at entry.
--     Resolved by shifting the marriage_date forward 365 days.
-- ---------------------------------------------------------------------------
SELECT
  'vital_event.event_details.marriage_date'      AS column_ref,
  v.vital_event_id,
  v.event_number,
  (v.event_details ->> 'marriage_date')::date    AS stored_marriage_date,
  (v.event_details ->> 'marriage_date')::date + 365 AS shifted_candidate,
  v.event_date                                   AS divorce_event_date,
  v.updated_at
FROM public.vital_event v
WHERE v.event_type = 'divorce'
  AND v.event_details ? 'marriage_date'
  AND (v.event_details ->> 'marriage_date') <> ''
  AND (v.event_details ->> 'marriage_date')::date > v.event_date
  AND (v.event_details ->> 'marriage_date')::date + 365 <= v.event_date
ORDER BY v.updated_at DESC;


-- ---------------------------------------------------------------------------
-- 1e. rental_occupancy_request: termination_date before rent_start_date as
--     stored, resolved by shifting one of them 365 days.
-- ---------------------------------------------------------------------------
SELECT
  'rental_occupancy_request'               AS column_ref,
  rr.rental_request_id,
  rr.request_number,
  rr.rent_start_date,
  rr.termination_date,
  rr.rent_start_date + 365                 AS rent_start_shifted_candidate,
  rr.termination_date + 365                AS termination_shifted_candidate,
  rr.updated_at
FROM public.rental_occupancy_request rr
WHERE rr.rent_start_date IS NOT NULL
  AND rr.termination_date IS NOT NULL
  AND rr.termination_date < rr.rent_start_date
ORDER BY rr.updated_at DESC;


-- ---------------------------------------------------------------------------
-- 2. General implausibility scan, independent of the 365-day theory --
--    anything left over is still worth a human's eyes even if it doesn't
--    match the mechanism-B signature exactly (a real edit adds its own
--    delta on top of -365 days, so the shift won't always land exactly).
-- ---------------------------------------------------------------------------
SELECT 'resident.date_of_birth (future or age>110)' AS issue, resident_id::text AS row_id, full_name AS label, date_of_birth::text AS value
FROM public.resident
WHERE date_of_birth > CURRENT_DATE OR date_part('year', age(date_of_birth)) > 110
UNION ALL
SELECT 'resident.residency_start_date (before DOB or future)', resident_id::text, full_name, residency_start_date::text
FROM public.resident
WHERE residency_start_date IS NOT NULL
  AND (residency_start_date < date_of_birth OR residency_start_date > CURRENT_DATE)
UNION ALL
SELECT 'vital_event.event_date (future)', vital_event_id::text, event_number, event_date::text
FROM public.vital_event
WHERE event_date > CURRENT_DATE
UNION ALL
SELECT 'vital_event birth event_date <> linked resident DOB', v.vital_event_id::text, v.event_number, v.event_date::text || ' vs dob ' || r.date_of_birth::text
FROM public.vital_event v JOIN public.resident r ON r.resident_id = v.resident_id
WHERE v.event_type = 'birth' AND v.event_date <> r.date_of_birth
UNION ALL
SELECT 'vital_event divorce marriage_date after event_date', vital_event_id::text, event_number,
  (event_details ->> 'marriage_date') || ' vs divorce ' || event_date::text
FROM public.vital_event
WHERE event_type = 'divorce'
  AND event_details ? 'marriage_date'
  AND (event_details ->> 'marriage_date') <> ''
  AND (event_details ->> 'marriage_date')::date > event_date
UNION ALL
SELECT 'rental_occupancy_request termination before rent_start', rental_request_id::text, request_number,
  rent_start_date::text || ' vs termination ' || termination_date::text
FROM public.rental_occupancy_request
WHERE rent_start_date IS NOT NULL AND termination_date IS NOT NULL AND termination_date < rent_start_date
ORDER BY issue;


-- ---------------------------------------------------------------------------
-- 3. Exposure scope: total rows in every column the buggy widget could have
--    written. Every plausible-looking value in these counts could still
--    carry the silent, undetectable 1-day (A)-mechanism error -- there is
--    no query that finds those; re-verify against source documents if a
--    date's exact day genuinely matters (legal/credential use).
-- ---------------------------------------------------------------------------
SELECT 'resident.date_of_birth' AS column_ref, count(*) AS total_rows FROM public.resident WHERE date_of_birth IS NOT NULL
UNION ALL
SELECT 'resident.residency_start_date', count(*) FROM public.resident WHERE residency_start_date IS NOT NULL
UNION ALL
SELECT 'vital_event.event_date', count(*) FROM public.vital_event WHERE event_date IS NOT NULL
UNION ALL
SELECT 'vital_event.event_details.marriage_date (divorce)', count(*) FROM public.vital_event
  WHERE event_type = 'divorce' AND event_details ? 'marriage_date' AND (event_details ->> 'marriage_date') <> ''
UNION ALL
SELECT 'rental_occupancy_request.rent_start_date', count(*) FROM public.rental_occupancy_request WHERE rent_start_date IS NOT NULL
UNION ALL
SELECT 'rental_occupancy_request.termination_date', count(*) FROM public.rental_occupancy_request WHERE termination_date IS NOT NULL;
