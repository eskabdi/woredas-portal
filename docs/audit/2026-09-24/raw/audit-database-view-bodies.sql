-- ===== approval_queue_v @ supabase/migrations/00000000000027_workflow_abandon_paths.sql:79 =====
CREATE OR REPLACE VIEW public.approval_queue_v WITH (security_invoker = on) AS SELECT 'service'::text AS work_type, sr.service_request_id AS item_id, sr.request_number AS reference_number, sr.status AS stage, sr.woreda_id, sr.kebele_id, sr.resident_id, sr.priority, st.name_am AS subtype_am, st.name_en AS subtype_en, sr.requested_by_user_id, sr.created_at, sr.updated_at FROM service_request sr JOIN service_type st ON st.service_type_id = sr.service_type_id WHERE sr.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'pending_approval'::text, 'awaiting_payment'::text, 'returned'::text, 'approval_returned'::text, 'in_progress'::text]) UNION ALL SELECT 'credential'::text AS work_type, cr.credential_request_id AS item_id, cr.request_number AS reference_number, cr.status AS stage, cr.woreda_id, cr.issuing_kebele_id AS kebele_id, cr.resident_id, 'normal'::text AS priority, cr.credential_type AS subtype_am, cr.credential_type AS subtype_en, cr.requested_by_user_id, cr.created_at, cr.updated_at FROM credential_request cr WHERE cr.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'approved'::text, 'awaiting_payment'::text, 'paid'::text, 'printed'::text, 'returned'::text, 'approval_returned'::text]) UNION ALL SELECT 'civil'::text AS work_type, ve.vital_event_id AS item_id, ve.event_number AS reference_number, ve.status AS stage, ve.woreda_id, NULL::uuid AS kebele_id, ve.resident_id, 'normal'::text AS priority, ve.event_type AS subtype_am, ve.event_type AS subtype_en, ve.requested_by_user_id, ve.created_at, ve.updated_at FROM vital_event ve WHERE ve.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'pending_approval'::text, 'returned'::text, 'approval_returned'::text]) UNION ALL SELECT 'rental'::text AS work_type, ror.rental_request_id AS item_id, ror.request_number AS reference_number, ror.status AS stage, ror.woreda_id, krh.kebele_id, ror.resident_id, 'normal'::text AS priority, ror.request_type AS subtype_am, ror.request_type AS subtype_en, ror.requested_by_user_id, ror.created_at, ror.updated_at FROM rental_occupancy_request ror LEFT JOIN kebele_rental_house krh ON krh.rental_house_id = ror.rental_house_id WHERE ror.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'returned'::text, 'awaiting_payment'::text]);

-- ===== arrears_installment_charge_decrypted @ supabase/migrations/00000000000080_rental_phase4_arrears.sql:452 =====
CREATE VIEW public.arrears_installment_charge_decrypted WITH (security_invoker = on) AS SELECT m.*, public.decrypt_pii_numeric(m.charge_amount_snapshot_enc, m.woreda_id) AS charge_amount_snapshot_decrypted FROM public.arrears_installment_charge m;

-- ===== arrears_repayment_installment_decrypted @ supabase/migrations/00000000000080_rental_phase4_arrears.sql:394 =====
CREATE VIEW public.arrears_repayment_installment_decrypted WITH (security_invoker = on) AS SELECT i.*, public.decrypt_pii_numeric(i.amount_enc, i.woreda_id) AS amount_decrypted FROM public.arrears_repayment_installment i;

-- ===== arrears_repayment_plan_decrypted @ supabase/migrations/00000000000081_rental_phase4_review_fixes.sql:650 =====
CREATE VIEW public.arrears_repayment_plan_decrypted WITH (security_invoker = on) AS SELECT p.*, public.decrypt_pii_numeric(p.original_arrears_amount_enc, p.woreda_id) AS original_arrears_amount_decrypted, public.decrypt_pii_numeric(p.assigned_arrears_amount_enc, p.woreda_id) AS assigned_arrears_amount_decrypted FROM public.arrears_repayment_plan p;

-- ===== household_decrypted @ supabase/migrations/00000000000044_task6_household_rent_national_id_pii.sql:175 =====
CREATE VIEW public.household_decrypted WITH (security_invoker = on) AS SELECT h.*, public.decrypt_pii_text(h.phone_number_enc, h.woreda_id) AS phone_number_decrypted, public.decrypt_pii_text(h.email_enc, h.woreda_id) AS email_decrypted, public.decrypt_pii_numeric(h.rent_amount_enc, h.woreda_id) AS rent_amount_decrypted FROM public.household h;

-- ===== household_member_roster @ supabase/migrations/00000000000000_baseline.sql:814 =====
CREATE OR REPLACE VIEW public.household_member_roster AS SELECT resident_id, current_household_id AS household_id, full_name_am, full_name, date_of_birth, sex, relation_to_head, residency_status, active_flag, date_part('year'::text, age(date_of_birth::timestamp with time zone)) AS age FROM resident r WHERE current_household_id IS NOT NULL AND active_flag = true;

-- ===== payment_decrypted @ supabase/migrations/00000000000066_payment_hardening_review_fixes.sql:502 =====
CREATE VIEW public.payment_decrypted WITH (security_invoker = on) AS SELECT p.*, public.decrypt_pii_numeric(p.amount_enc, p.woreda_id) AS amount_decrypted FROM public.payment p;

-- ===== payment_reconciliation_exception_decrypted @ supabase/migrations/00000000000078_rental_phase3_settlement.sql:272 =====
CREATE VIEW public.payment_reconciliation_exception_decrypted WITH (security_invoker = on) AS SELECT e.*, public.decrypt_pii_numeric(e.received_amount_enc, e.woreda_id) AS received_amount_decrypted, public.decrypt_pii_numeric(e.expected_settlement_amount_enc, e.woreda_id) AS expected_settlement_amount_decrypted FROM public.payment_reconciliation_exception e;

-- ===== rent_charge_decrypted @ supabase/migrations/00000000000076_rental_phase2_financial_core.sql:344 =====
CREATE VIEW public.rent_charge_decrypted WITH (security_invoker = on) AS SELECT rc.*, public.decrypt_pii_numeric(rc.base_rent_amount_enc, rc.woreda_id) AS base_rent_amount_decrypted, public.decrypt_pii_numeric(rc.approved_adjustment_amount_enc, rc.woreda_id) AS approved_adjustment_amount_decrypted, public.decrypt_pii_numeric(rc.total_amount_enc, rc.woreda_id) AS total_amount_decrypted FROM public.rent_charge rc;

-- ===== rent_payment_settlement_decrypted @ supabase/migrations/00000000000078_rental_phase3_settlement.sql:206 =====
CREATE VIEW public.rent_payment_settlement_decrypted WITH (security_invoker = on) AS SELECT s.*, public.decrypt_pii_numeric(s.settlement_amount_enc, s.woreda_id) AS settlement_amount_decrypted FROM public.rent_payment_settlement s;

-- ===== rent_rate_history_decrypted @ supabase/migrations/00000000000076_rental_phase2_financial_core.sql:337 =====
CREATE VIEW public.rent_rate_history_decrypted WITH (security_invoker = on) AS SELECT rh.*, public.decrypt_pii_numeric(rh.monthly_amount_enc, rh.woreda_id) AS monthly_amount_decrypted FROM public.rent_rate_history rh;

-- ===== rent_reminder_decrypted @ supabase/migrations/00000000000080_rental_phase4_arrears.sql:984 =====
CREATE VIEW public.rent_reminder_decrypted WITH (security_invoker = on) AS SELECT rr.*, public.decrypt_pii_numeric(rr.snapshot_amount_enc, rr.woreda_id) AS snapshot_amount_decrypted FROM public.rent_reminder rr;

-- ===== rental_occupancy_decrypted @ supabase/migrations/00000000000023_pii_encryption.sql:666 =====
CREATE VIEW public.rental_occupancy_decrypted WITH (security_invoker = on) AS SELECT ro.*, public.decrypt_pii_numeric(ro.rent_amount_enc, ro.woreda_id) AS rent_amount_decrypted FROM public.rental_occupancy ro;

-- ===== rental_occupancy_request_decrypted @ supabase/migrations/00000000000024_rental_occupancy_request_decrypted_view.sql:21 =====
CREATE VIEW public.rental_occupancy_request_decrypted WITH (security_invoker = on) AS SELECT rr.*, public.decrypt_pii_numeric(rr.rent_amount_enc, rr.woreda_id) AS rent_amount_decrypted FROM public.rental_occupancy_request rr;

-- ===== resident_decrypted @ supabase/migrations/00000000000044_task6_household_rent_national_id_pii.sql:166 =====
CREATE VIEW public.resident_decrypted WITH (security_invoker = on) AS SELECT r.*, public.decrypt_pii_text(r.phone_number_enc, r.woreda_id) AS phone_number_decrypted, public.decrypt_pii_text(r.email_enc, r.woreda_id) AS email_decrypted, public.decrypt_pii_text(r.national_id_no_enc, r.woreda_id) AS national_id_no_decrypted FROM public.resident r;

-- ===== service_request_checkpoint_decrypted @ supabase/migrations/00000000000083_rental_phase5_checkpoint.sql:183 =====
CREATE VIEW public.service_request_checkpoint_decrypted WITH (security_invoker = on) AS SELECT c.*, public.decrypt_pii_numeric(c.overdue_total_enc, c.woreda_id) AS overdue_total_decrypted FROM public.service_request_checkpoint c;

-- ===== service_request_decrypted @ supabase/migrations/00000000000023_pii_encryption.sql:652 =====
CREATE VIEW public.service_request_decrypted WITH (security_invoker = on) AS SELECT s.*, public.decrypt_pii_text(s.applicant_phone_enc, s.woreda_id) AS applicant_phone_decrypted FROM public.service_request s;

