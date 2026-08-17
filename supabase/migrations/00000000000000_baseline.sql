-- ============================================================================
-- Baseline schema for the woreda administration portal.
--
-- Generated from the previous Supabase project with scripts/dump-schema.sql.
-- This replaces the 26 incremental migrations that preceded it: those were
-- written against a database whose schema was partly created outside version
-- control, so 8 of the 26 failed on an empty database and 9 tables the
-- application queries were never created by any of them.
--
-- Applies cleanly to a new Supabase project. Requires the platform-managed
-- auth schema (auth.users, auth.uid()) and the anon / authenticated /
-- service_role roles, which Supabase provisions automatically.
-- ============================================================================

SET check_function_bodies = false;

-- ===== EXTENSIONS =====
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ===== TABLES =====
CREATE TABLE IF NOT EXISTS public.app_user (
  user_id uuid NOT NULL,
  woreda_id uuid,
  role text NOT NULL,
  full_name text NOT NULL,
  username text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  invited_by_user_id uuid,
  invited_at timestamp with time zone
);
CREATE TABLE IF NOT EXISTS public.audit_log (
  audit_log_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid,
  actor_user_id uuid,
  entity_name text NOT NULL,
  entity_id text,
  action_type text NOT NULL,
  old_value_json jsonb,
  new_value_json jsonb,
  action_at timestamp with time zone DEFAULT now() NOT NULL,
  source_ip text
);
CREATE TABLE IF NOT EXISTS public.credential_number_sequence (
  woreda_id uuid NOT NULL,
  seq_year smallint NOT NULL,
  last_value integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.credential_print_log (
  credential_print_log_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  printed_by_user_id uuid,
  print_type text NOT NULL,
  print_reason text NOT NULL,
  is_reprint boolean DEFAULT false NOT NULL,
  reprint_reason text,
  reprint_authorized_by_user_id uuid,
  printer_name text,
  copies_count integer DEFAULT 1 NOT NULL,
  printed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.credential_request (
  credential_request_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  request_number text NOT NULL,
  resident_id uuid NOT NULL,
  household_id uuid,
  issuing_kebele_id uuid NOT NULL,
  request_type text NOT NULL,
  credential_type text DEFAULT 'card'::text NOT NULL,
  status text DEFAULT 'draft'::text NOT NULL,
  prior_credential_id uuid,
  duplicate_flag boolean DEFAULT false NOT NULL,
  duplicate_notes text,
  verification_checklist jsonb,
  return_reason text,
  reject_reason text,
  requested_by_user_id uuid,
  verified_by_user_id uuid,
  approved_by_user_id uuid,
  approval_decision_at timestamp with time zone,
  payment_id uuid,
  credential_id uuid,
  submitted_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  supporting_document_path text,
  supporting_document_name text,
  verified_at timestamp with time zone,
  notes text
);
CREATE TABLE IF NOT EXISTS public.credential_request_sequence (
  woreda_id uuid NOT NULL,
  seq_year smallint NOT NULL,
  last_value integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.credential_request_status_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  credential_request_id uuid NOT NULL,
  old_status text,
  new_status text NOT NULL,
  changed_by_user_id uuid,
  change_reason text,
  changed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.credential_status_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  credential_id uuid NOT NULL,
  old_status text,
  new_status text NOT NULL,
  changed_by_user_id uuid,
  change_reason text,
  changed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.fee_schedule (
  fee_schedule_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  service_type text NOT NULL,
  standard_fee numeric(10,2) DEFAULT 0 NOT NULL,
  penalty_rate numeric(10,2) DEFAULT 0 NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.household (
  household_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  kebele_id uuid NOT NULL,
  house_number text NOT NULL,
  house_label text,
  occupancy_status text DEFAULT 'occupied'::text NOT NULL,
  address_line text,
  gps_lat numeric(10,8),
  gps_lng numeric(11,8),
  active_flag boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  household_head_resident_id uuid,
  phone_number text,
  po_box text,
  email text,
  house_type text,
  house_type_other text,
  rent_amount numeric(12,2),
  spouse_resident_id uuid,
  alternate_head_resident_id uuid,
  sub_woreda text
);
CREATE TABLE IF NOT EXISTS public.household_change_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  change_type text NOT NULL,
  change_date date DEFAULT CURRENT_DATE NOT NULL,
  registered_by_user_id uuid,
  clerk_comment text,
  household_head_signed boolean DEFAULT false NOT NULL,
  clerk_signed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  woreda_id uuid NOT NULL,
  old_value_json jsonb,
  new_value_json jsonb
);
CREATE TABLE IF NOT EXISTS public.id_card_template (
  template_type text NOT NULL,
  background_image_url text,
  status text DEFAULT 'draft'::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);
CREATE TABLE IF NOT EXISTS public.id_card_template_field (
  template_field_id uuid DEFAULT gen_random_uuid() NOT NULL,
  template_type text NOT NULL,
  field_key text NOT NULL,
  x numeric NOT NULL,
  y numeric NOT NULL,
  width numeric NOT NULL,
  height numeric NOT NULL,
  font_size numeric,
  font_weight text,
  text_align text DEFAULT 'left'::text NOT NULL,
  z_index integer DEFAULT 0 NOT NULL,
  canvas_width numeric DEFAULT 1688 NOT NULL,
  canvas_height numeric DEFAULT 1063 NOT NULL,
  field_type text DEFAULT 'text'::text NOT NULL,
  color text DEFAULT '#000000'::text NOT NULL,
  font_family text DEFAULT 'Inter'::text NOT NULL,
  font_style text DEFAULT 'normal'::text NOT NULL,
  text_decoration text DEFAULT 'none'::text NOT NULL,
  binding_mode text DEFAULT 'bound'::text NOT NULL,
  static_value text
);
CREATE TABLE IF NOT EXISTS public.kebele (
  kebele_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  kebele_number text NOT NULL,
  kebele_name_en text NOT NULL,
  kebele_name_am text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.kebele_rental_house (
  rental_house_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  kebele_id uuid NOT NULL,
  house_number text NOT NULL,
  address_line text,
  bedrooms integer,
  monthly_rent_standard numeric(10,2),
  occupancy_status text DEFAULT 'vacant'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.payment (
  payment_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  household_id uuid,
  resident_id uuid,
  payment_type text NOT NULL,
  amount numeric(12,2) NOT NULL,
  payment_date date NOT NULL,
  channel text DEFAULT 'cash'::text NOT NULL,
  reference_no text,
  status text DEFAULT 'pending'::text NOT NULL,
  posted_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  credential_request_id uuid,
  rental_request_id uuid,
  service_request_id uuid
);
CREATE TABLE IF NOT EXISTS public.receipt (
  receipt_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  receipt_number text NOT NULL,
  receipt_date date NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  cash_bank_channel text NOT NULL,
  printed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.receipt_sequence (
  woreda_id uuid NOT NULL,
  seq_year smallint NOT NULL,
  last_value integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.rental_occupancy (
  occupancy_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  rental_house_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  household_id uuid,
  rent_start_date date NOT NULL,
  rent_amount numeric(10,2) NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  termination_date date,
  termination_reason text,
  originating_request_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.rental_occupancy_request (
  rental_request_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  request_number text NOT NULL,
  rental_house_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  household_id uuid,
  request_type text NOT NULL,
  rent_start_date date,
  rent_amount numeric(10,2),
  termination_date date,
  termination_reason text,
  existing_occupancy_id uuid,
  status text DEFAULT 'draft'::text NOT NULL,
  verification_checklist jsonb,
  return_reason text,
  reject_reason text,
  requested_by_user_id uuid,
  verified_by_user_id uuid,
  verified_at timestamp with time zone,
  approved_by_user_id uuid,
  approval_decision_at timestamp with time zone,
  resulting_occupancy_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.rental_request_document (
  document_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  rental_request_id uuid NOT NULL,
  document_type text NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_size_bytes integer,
  content_type text,
  uploaded_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.rental_request_sequence (
  woreda_id uuid NOT NULL,
  seq_year smallint NOT NULL,
  last_value integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.residence_credential (
  credential_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  issuing_kebele_id uuid NOT NULL,
  credential_number text NOT NULL,
  serial_number text NOT NULL,
  credential_type text DEFAULT 'card'::text NOT NULL,
  status text DEFAULT 'ready_to_print'::text NOT NULL,
  issue_date date,
  expiry_date date,
  reason_for_issue text,
  reissue_count integer DEFAULT 0 NOT NULL,
  qr_payload text,
  printed_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  requested_by_user_id uuid,
  rejection_reason text,
  credential_request_id uuid,
  activated_at timestamp with time zone,
  replaced_at timestamp with time zone,
  issued_recipient_name text,
  revoked_reason text,
  revoked_by_user_id uuid
);
CREATE TABLE IF NOT EXISTS public.resident (
  resident_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  resident_number text NOT NULL,
  full_name text NOT NULL,
  full_name_am text,
  sex text NOT NULL,
  date_of_birth date NOT NULL,
  marital_status text NOT NULL,
  current_household_id uuid,
  relation_to_head text,
  phone_number text,
  national_id_no text,
  residency_status text DEFAULT 'active'::text NOT NULL,
  photo_url text,
  active_flag boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  father_name text,
  grandfather_name text,
  mother_full_name text,
  ethnicity text,
  religion text,
  residency_start_date date,
  current_residence_extra jsonb,
  birth_place jsonb,
  work_info jsonb,
  former_residence jsonb,
  first_name text,
  email text
);
CREATE TABLE IF NOT EXISTS public.resident_number_sequence (
  woreda_id uuid NOT NULL,
  last_value integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.role_permission (
  woreda_id uuid NOT NULL,
  role_name text NOT NULL,
  permission_key text NOT NULL,
  is_granted boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.service_request (
  service_request_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  request_number text NOT NULL,
  service_type_id uuid NOT NULL,
  category text DEFAULT 'letter'::text NOT NULL,
  resident_id uuid,
  household_id uuid,
  kebele_id uuid,
  applicant_name text,
  applicant_phone text,
  status text DEFAULT 'submitted'::text NOT NULL,
  priority text DEFAULT 'normal'::text NOT NULL,
  purpose text,
  addressed_to text,
  details text,
  subject text,
  respondent_name text,
  incident_date date,
  incident_place text,
  fee_amount numeric DEFAULT 0 NOT NULL,
  verification_checklist jsonb,
  return_reason text,
  reject_reason text,
  resolution_notes text,
  requested_by_user_id uuid,
  verified_by_user_id uuid,
  verified_at timestamp with time zone,
  approved_by_user_id uuid,
  approval_decision_at timestamp with time zone,
  issued_by_user_id uuid,
  issued_at timestamp with time zone,
  closed_at timestamp with time zone,
  payment_id uuid,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  verification_token text,
  issued_letter_html text,
  letter_summary text
);
CREATE TABLE IF NOT EXISTS public.service_request_attachment (
  attachment_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  service_request_id uuid NOT NULL,
  document_type text NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_size_bytes integer,
  content_type text,
  uploaded_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.service_request_sequence (
  woreda_id uuid NOT NULL,
  seq_year smallint NOT NULL,
  last_value integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.service_request_status_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  service_request_id uuid NOT NULL,
  old_status text,
  new_status text NOT NULL,
  changed_by_user_id uuid,
  change_reason text,
  changed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS public.service_type (
  service_type_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  code text NOT NULL,
  name_am text NOT NULL,
  name_en text NOT NULL,
  category text DEFAULT 'letter'::text NOT NULL,
  fee_amount numeric DEFAULT 0 NOT NULL,
  requires_payment boolean DEFAULT false NOT NULL,
  requires_approval boolean DEFAULT true NOT NULL,
  required_documents jsonb DEFAULT '[]'::jsonb NOT NULL,
  letter_body_template text,
  sort_order integer DEFAULT 0 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  letter_body_html text
);
CREATE TABLE IF NOT EXISTS public.tenant_module_config (
  woreda_id uuid NOT NULL,
  module_key text NOT NULL,
  is_enabled boolean DEFAULT true NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);
CREATE TABLE IF NOT EXISTS public.vital_event (
  vital_event_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_id uuid NOT NULL,
  resident_id uuid,
  household_id uuid,
  event_type text NOT NULL,
  event_number text NOT NULL,
  event_date date NOT NULL,
  registration_date date,
  status text DEFAULT 'pending'::text NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  event_details jsonb,
  requested_by_user_id uuid,
  verified_by_user_id uuid,
  verified_at timestamp with time zone,
  approved_by_user_id uuid,
  approval_decision_at timestamp with time zone,
  return_reason text,
  reject_reason text,
  verification_checklist jsonb,
  source_document_no text,
  issued_at timestamp with time zone,
  issued_by_user_id uuid
);
CREATE TABLE IF NOT EXISTS public.vital_event_sequence (
  woreda_id uuid NOT NULL,
  event_type text NOT NULL,
  seq_year smallint NOT NULL,
  last_value integer DEFAULT 0 NOT NULL
);
CREATE TABLE IF NOT EXISTS public.woreda (
  woreda_id uuid DEFAULT gen_random_uuid() NOT NULL,
  woreda_code text NOT NULL,
  woreda_name_en text NOT NULL,
  woreda_name_am text NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  woreda_numeric_code smallint NOT NULL
);
CREATE TABLE IF NOT EXISTS public.woreda_settings (
  woreda_id uuid NOT NULL,
  credential_issuance_fee numeric(10,2) DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid,
  logo_url text,
  stamp_url text,
  supervisor_signature_url text,
  woreda_name_display text,
  resident_number_format text DEFAULT '{WOREDA_CODE}-{SEQ:6}'::text NOT NULL,
  address_line text,
  contact_phone text,
  contact_email text
);

-- ===== CONSTRAINTS (PK / UNIQUE / CHECK) =====
ALTER TABLE public.app_user ADD CONSTRAINT app_user_pkey PRIMARY KEY (user_id);
ALTER TABLE public.app_user ADD CONSTRAINT app_user_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'tenant_admin'::text, 'civil_registrar'::text, 'registry_clerk'::text, 'finance_clerk'::text, 'supervisor'::text, 'auditor'::text, 'viewer'::text])));
ALTER TABLE public.app_user ADD CONSTRAINT app_user_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text, 'pending'::text])));
ALTER TABLE public.app_user ADD CONSTRAINT app_user_username_key UNIQUE (username);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (audit_log_id);
ALTER TABLE public.credential_number_sequence ADD CONSTRAINT credential_number_sequence_pkey PRIMARY KEY (woreda_id, seq_year);
ALTER TABLE public.credential_print_log ADD CONSTRAINT credential_print_log_pkey PRIMARY KEY (credential_print_log_id);
ALTER TABLE public.credential_print_log ADD CONSTRAINT credential_print_log_print_type_check CHECK ((print_type = ANY (ARRAY['card'::text, 'certificate'::text, 'both'::text])));
ALTER TABLE public.credential_request_sequence ADD CONSTRAINT credential_request_sequence_pkey PRIMARY KEY (woreda_id, seq_year);
ALTER TABLE public.credential_request_status_history ADD CONSTRAINT credential_request_status_history_pkey PRIMARY KEY (id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_credential_type_check CHECK ((credential_type = ANY (ARRAY['card'::text, 'certificate'::text, 'both'::text])));
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_pkey PRIMARY KEY (credential_request_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_request_type_check CHECK ((request_type = ANY (ARRAY['new_issue'::text, 'renewal'::text, 'reissue_lost'::text, 'reissue_damaged'::text, 'reissue_stolen'::text, 'reissue_correction'::text])));
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'returned'::text, 'approval_returned'::text, 'rejected'::text, 'approved'::text, 'awaiting_payment'::text, 'paid'::text, 'printed'::text, 'active'::text])));
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_woreda_id_request_number_key UNIQUE (woreda_id, request_number);
ALTER TABLE public.credential_status_history ADD CONSTRAINT credential_status_history_pkey PRIMARY KEY (id);
ALTER TABLE public.fee_schedule ADD CONSTRAINT fee_schedule_pkey PRIMARY KEY (fee_schedule_id);
ALTER TABLE public.fee_schedule ADD CONSTRAINT fee_schedule_status_check CHECK ((status = ANY (ARRAY['active'::text, 'review_required'::text, 'inactive'::text])));
ALTER TABLE public.fee_schedule ADD CONSTRAINT fee_schedule_woreda_id_service_type_key UNIQUE (woreda_id, service_type);
ALTER TABLE public.household_change_log ADD CONSTRAINT household_change_log_pkey PRIMARY KEY (id);
ALTER TABLE public.household ADD CONSTRAINT household_house_type_check CHECK ((house_type = ANY (ARRAY['private'::text, 'kebele'::text, 'rental'::text, 'government'::text, 'rented_by_private'::text, 'other'::text])));
ALTER TABLE public.household ADD CONSTRAINT household_kebele_id_house_number_key UNIQUE (kebele_id, house_number);
ALTER TABLE public.household ADD CONSTRAINT household_occupancy_status_check CHECK ((occupancy_status = ANY (ARRAY['occupied'::text, 'vacant'::text, 'demolished'::text, 'transferred'::text])));
ALTER TABLE public.household ADD CONSTRAINT household_pkey PRIMARY KEY (household_id);
ALTER TABLE public.id_card_template_field ADD CONSTRAINT id_card_template_field_binding_mode_check CHECK ((binding_mode = ANY (ARRAY['bound'::text, 'static'::text])));
ALTER TABLE public.id_card_template_field ADD CONSTRAINT id_card_template_field_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'image'::text])));
ALTER TABLE public.id_card_template_field ADD CONSTRAINT id_card_template_field_font_style_check CHECK ((font_style = ANY (ARRAY['normal'::text, 'italic'::text])));
ALTER TABLE public.id_card_template_field ADD CONSTRAINT id_card_template_field_pkey PRIMARY KEY (template_field_id);
ALTER TABLE public.id_card_template_field ADD CONSTRAINT id_card_template_field_template_type_check CHECK ((template_type = ANY (ARRAY['card_front'::text, 'card_back'::text, 'certificate'::text])));
ALTER TABLE public.id_card_template_field ADD CONSTRAINT id_card_template_field_template_type_field_key_key UNIQUE (template_type, field_key);
ALTER TABLE public.id_card_template_field ADD CONSTRAINT id_card_template_field_text_decoration_check CHECK ((text_decoration = ANY (ARRAY['none'::text, 'underline'::text])));
ALTER TABLE public.id_card_template ADD CONSTRAINT id_card_template_pkey PRIMARY KEY (template_type);
ALTER TABLE public.id_card_template ADD CONSTRAINT id_card_template_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text])));
ALTER TABLE public.id_card_template ADD CONSTRAINT id_card_template_template_type_check CHECK ((template_type = ANY (ARRAY['card_front'::text, 'card_back'::text])));
ALTER TABLE public.kebele_rental_house ADD CONSTRAINT kebele_rental_house_occupancy_status_check CHECK ((occupancy_status = ANY (ARRAY['vacant'::text, 'occupied'::text, 'under_maintenance'::text])));
ALTER TABLE public.kebele_rental_house ADD CONSTRAINT kebele_rental_house_pkey PRIMARY KEY (rental_house_id);
ALTER TABLE public.kebele_rental_house ADD CONSTRAINT kebele_rental_house_woreda_id_kebele_id_house_number_key UNIQUE (woreda_id, kebele_id, house_number);
ALTER TABLE public.kebele ADD CONSTRAINT kebele_pkey PRIMARY KEY (kebele_id);
ALTER TABLE public.kebele ADD CONSTRAINT kebele_woreda_id_kebele_number_key UNIQUE (woreda_id, kebele_number);
ALTER TABLE public.payment ADD CONSTRAINT payment_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE public.payment ADD CONSTRAINT payment_channel_check CHECK ((channel = ANY (ARRAY['cash'::text, 'bank'::text, 'mobile'::text])));
ALTER TABLE public.payment ADD CONSTRAINT payment_payment_type_check CHECK ((payment_type = ANY (ARRAY['service_fee'::text, 'house_rent'::text, 'penalty'::text, 'credential_fee'::text, 'rental_rent'::text])));
ALTER TABLE public.payment ADD CONSTRAINT payment_pkey PRIMARY KEY (payment_id);
ALTER TABLE public.payment ADD CONSTRAINT payment_source_exclusive_check CHECK ((NOT ((credential_request_id IS NOT NULL) AND (rental_request_id IS NOT NULL))));
ALTER TABLE public.payment ADD CONSTRAINT payment_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'reversed'::text])));
ALTER TABLE public.receipt_sequence ADD CONSTRAINT receipt_sequence_pkey PRIMARY KEY (woreda_id, seq_year);
ALTER TABLE public.receipt ADD CONSTRAINT receipt_pkey PRIMARY KEY (receipt_id);
ALTER TABLE public.receipt ADD CONSTRAINT receipt_woreda_id_receipt_number_key UNIQUE (woreda_id, receipt_number);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_pkey PRIMARY KEY (rental_request_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_request_type_check CHECK ((request_type = ANY (ARRAY['new_registration'::text, 'termination'::text])));
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'returned'::text, 'approval_returned'::text, 'rejected'::text, 'approved'::text])));
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_woreda_id_request_number_key UNIQUE (woreda_id, request_number);
ALTER TABLE public.rental_occupancy ADD CONSTRAINT rental_occupancy_pkey PRIMARY KEY (occupancy_id);
ALTER TABLE public.rental_occupancy ADD CONSTRAINT rental_occupancy_rent_amount_check CHECK ((rent_amount > (0)::numeric));
ALTER TABLE public.rental_occupancy ADD CONSTRAINT rental_occupancy_status_check CHECK ((status = ANY (ARRAY['active'::text, 'terminated'::text])));
ALTER TABLE public.rental_request_document ADD CONSTRAINT rental_request_document_document_type_check CHECK ((document_type = ANY (ARRAY['contract'::text, 'clearance'::text, 'id_copy'::text, 'photo'::text, 'other'::text])));
ALTER TABLE public.rental_request_document ADD CONSTRAINT rental_request_document_pkey PRIMARY KEY (document_id);
ALTER TABLE public.rental_request_sequence ADD CONSTRAINT rental_request_sequence_pkey PRIMARY KEY (woreda_id, seq_year);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_credential_type_check CHECK ((credential_type = ANY (ARRAY['card'::text, 'certificate'::text, 'both'::text])));
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_number_woreda_unique UNIQUE (woreda_id, credential_number);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_pkey PRIMARY KEY (credential_id);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_serial_number_woreda_unique UNIQUE (woreda_id, serial_number);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_status_check CHECK ((status = ANY (ARRAY['ready_to_print'::text, 'printed'::text, 'active'::text, 'expired'::text, 'suspended'::text, 'revoked'::text, 'replaced'::text])));
ALTER TABLE public.resident_number_sequence ADD CONSTRAINT resident_number_sequence_pkey PRIMARY KEY (woreda_id);
ALTER TABLE public.resident ADD CONSTRAINT resident_email_format CHECK (((email IS NULL) OR (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)));
ALTER TABLE public.resident ADD CONSTRAINT resident_marital_status_check CHECK ((marital_status = ANY (ARRAY['single'::text, 'married'::text, 'divorced'::text, 'widowed'::text])));
ALTER TABLE public.resident ADD CONSTRAINT resident_pkey PRIMARY KEY (resident_id);
ALTER TABLE public.resident ADD CONSTRAINT resident_residency_status_check CHECK ((residency_status = ANY (ARRAY['active'::text, 'suspended'::text, 'deceased'::text])));
ALTER TABLE public.resident ADD CONSTRAINT resident_resident_number_key UNIQUE (resident_number);
ALTER TABLE public.resident ADD CONSTRAINT resident_sex_check CHECK ((sex = ANY (ARRAY['male'::text, 'female'::text])));
ALTER TABLE public.role_permission ADD CONSTRAINT role_permission_pkey PRIMARY KEY (woreda_id, role_name, permission_key);
ALTER TABLE public.role_permission ADD CONSTRAINT role_permission_role_name_check CHECK ((role_name = ANY (ARRAY['registry_clerk'::text, 'civil_registrar'::text, 'finance_clerk'::text, 'supervisor'::text, 'auditor'::text, 'viewer'::text])));
ALTER TABLE public.service_request_attachment ADD CONSTRAINT service_request_attachment_pkey PRIMARY KEY (attachment_id);
ALTER TABLE public.service_request_sequence ADD CONSTRAINT service_request_sequence_pkey PRIMARY KEY (woreda_id, seq_year);
ALTER TABLE public.service_request_status_history ADD CONSTRAINT service_request_status_history_pkey PRIMARY KEY (id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_category_chk CHECK ((category = ANY (ARRAY['letter'::text, 'complaint'::text])));
ALTER TABLE public.service_request ADD CONSTRAINT service_request_pkey PRIMARY KEY (service_request_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_priority_chk CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));
ALTER TABLE public.service_request ADD CONSTRAINT service_request_status_chk CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under_review'::text, 'returned'::text, 'pending_approval'::text, 'approval_returned'::text, 'approved'::text, 'rejected'::text, 'awaiting_payment'::text, 'paid'::text, 'issued'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])));
ALTER TABLE public.service_type ADD CONSTRAINT service_type_category_chk CHECK ((category = ANY (ARRAY['letter'::text, 'complaint'::text])));
ALTER TABLE public.service_type ADD CONSTRAINT service_type_code_unique UNIQUE (woreda_id, code);
ALTER TABLE public.service_type ADD CONSTRAINT service_type_pkey PRIMARY KEY (service_type_id);
ALTER TABLE public.tenant_module_config ADD CONSTRAINT tenant_module_config_module_key_check CHECK ((module_key = ANY (ARRAY['credentials'::text, 'civil_registration'::text, 'revenue'::text, 'reports'::text, 'audit'::text, 'rental_houses'::text, 'services'::text, 'approvals'::text])));
ALTER TABLE public.tenant_module_config ADD CONSTRAINT tenant_module_config_pkey PRIMARY KEY (woreda_id, module_key);
ALTER TABLE public.vital_event_sequence ADD CONSTRAINT vital_event_sequence_pkey PRIMARY KEY (woreda_id, event_type, seq_year);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_event_type_check CHECK ((event_type = ANY (ARRAY['birth'::text, 'death'::text, 'marriage'::text, 'divorce'::text])));
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_pkey PRIMARY KEY (vital_event_id);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'returned'::text, 'approval_returned'::text, 'rejected'::text, 'approved'::text, 'issued'::text])));
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_woreda_id_event_type_event_number_key UNIQUE (woreda_id, event_type, event_number);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_woreda_number_unique UNIQUE (woreda_id, event_type, event_number);
ALTER TABLE public.woreda_settings ADD CONSTRAINT woreda_settings_pkey PRIMARY KEY (woreda_id);
ALTER TABLE public.woreda ADD CONSTRAINT woreda_pkey PRIMARY KEY (woreda_id);
ALTER TABLE public.woreda ADD CONSTRAINT woreda_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'suspended'::text])));
ALTER TABLE public.woreda ADD CONSTRAINT woreda_woreda_code_key UNIQUE (woreda_code);
ALTER TABLE public.woreda ADD CONSTRAINT woreda_woreda_numeric_code_key UNIQUE (woreda_numeric_code);

-- ===== FOREIGN KEYS =====
ALTER TABLE public.app_user ADD CONSTRAINT app_user_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.app_user ADD CONSTRAINT app_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.app_user ADD CONSTRAINT app_user_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.credential_number_sequence ADD CONSTRAINT credential_number_sequence_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.credential_print_log ADD CONSTRAINT credential_print_log_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES residence_credential(credential_id);
ALTER TABLE public.credential_print_log ADD CONSTRAINT credential_print_log_printed_by_user_id_fkey FOREIGN KEY (printed_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.credential_print_log ADD CONSTRAINT credential_print_log_reprint_authorized_by_user_id_fkey FOREIGN KEY (reprint_authorized_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.credential_print_log ADD CONSTRAINT credential_print_log_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.credential_request_sequence ADD CONSTRAINT credential_request_sequence_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.credential_request_status_history ADD CONSTRAINT credential_request_status_history_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.credential_request_status_history ADD CONSTRAINT credential_request_status_history_credential_request_id_fkey FOREIGN KEY (credential_request_id) REFERENCES credential_request(credential_request_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES residence_credential(credential_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_household_id_fkey FOREIGN KEY (household_id) REFERENCES household(household_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_issuing_kebele_id_fkey FOREIGN KEY (issuing_kebele_id) REFERENCES kebele(kebele_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_payment_fk FOREIGN KEY (payment_id) REFERENCES payment(payment_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_prior_credential_id_fkey FOREIGN KEY (prior_credential_id) REFERENCES residence_credential(credential_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES resident(resident_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.credential_request ADD CONSTRAINT credential_request_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.credential_status_history ADD CONSTRAINT credential_status_history_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.credential_status_history ADD CONSTRAINT credential_status_history_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES residence_credential(credential_id) ON DELETE CASCADE;
ALTER TABLE public.fee_schedule ADD CONSTRAINT fee_schedule_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.household_change_log ADD CONSTRAINT household_change_log_household_id_fkey FOREIGN KEY (household_id) REFERENCES household(household_id);
ALTER TABLE public.household_change_log ADD CONSTRAINT household_change_log_registered_by_user_id_fkey FOREIGN KEY (registered_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.household_change_log ADD CONSTRAINT household_change_log_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.household ADD CONSTRAINT household_alternate_head_resident_id_fkey FOREIGN KEY (alternate_head_resident_id) REFERENCES resident(resident_id) ON DELETE SET NULL;
ALTER TABLE public.household ADD CONSTRAINT household_household_head_resident_id_fkey FOREIGN KEY (household_head_resident_id) REFERENCES resident(resident_id);
ALTER TABLE public.household ADD CONSTRAINT household_kebele_id_fkey FOREIGN KEY (kebele_id) REFERENCES kebele(kebele_id);
ALTER TABLE public.household ADD CONSTRAINT household_spouse_resident_id_fkey FOREIGN KEY (spouse_resident_id) REFERENCES resident(resident_id) ON DELETE SET NULL;
ALTER TABLE public.household ADD CONSTRAINT household_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.id_card_template ADD CONSTRAINT id_card_template_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app_user(user_id);
ALTER TABLE public.kebele_rental_house ADD CONSTRAINT kebele_rental_house_kebele_id_fkey FOREIGN KEY (kebele_id) REFERENCES kebele(kebele_id);
ALTER TABLE public.kebele_rental_house ADD CONSTRAINT kebele_rental_house_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.kebele ADD CONSTRAINT kebele_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.payment ADD CONSTRAINT payment_credential_request_id_fkey FOREIGN KEY (credential_request_id) REFERENCES credential_request(credential_request_id);
ALTER TABLE public.payment ADD CONSTRAINT payment_household_id_fkey FOREIGN KEY (household_id) REFERENCES household(household_id);
ALTER TABLE public.payment ADD CONSTRAINT payment_posted_by_user_id_fkey FOREIGN KEY (posted_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.payment ADD CONSTRAINT payment_rental_request_id_fkey FOREIGN KEY (rental_request_id) REFERENCES rental_occupancy_request(rental_request_id);
ALTER TABLE public.payment ADD CONSTRAINT payment_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES resident(resident_id);
ALTER TABLE public.payment ADD CONSTRAINT payment_service_request_id_fkey FOREIGN KEY (service_request_id) REFERENCES service_request(service_request_id);
ALTER TABLE public.payment ADD CONSTRAINT payment_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.receipt_sequence ADD CONSTRAINT receipt_sequence_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.receipt ADD CONSTRAINT receipt_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payment(payment_id);
ALTER TABLE public.receipt ADD CONSTRAINT receipt_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_existing_fk FOREIGN KEY (existing_occupancy_id) REFERENCES rental_occupancy(occupancy_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_household_id_fkey FOREIGN KEY (household_id) REFERENCES household(household_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_rental_house_id_fkey FOREIGN KEY (rental_house_id) REFERENCES kebele_rental_house(rental_house_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES resident(resident_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_resulting_fk FOREIGN KEY (resulting_occupancy_id) REFERENCES rental_occupancy(occupancy_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.rental_occupancy_request ADD CONSTRAINT rental_occupancy_request_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.rental_occupancy ADD CONSTRAINT rental_occupancy_household_id_fkey FOREIGN KEY (household_id) REFERENCES household(household_id);
ALTER TABLE public.rental_occupancy ADD CONSTRAINT rental_occupancy_originating_request_id_fkey FOREIGN KEY (originating_request_id) REFERENCES rental_occupancy_request(rental_request_id);
ALTER TABLE public.rental_occupancy ADD CONSTRAINT rental_occupancy_rental_house_id_fkey FOREIGN KEY (rental_house_id) REFERENCES kebele_rental_house(rental_house_id);
ALTER TABLE public.rental_occupancy ADD CONSTRAINT rental_occupancy_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES resident(resident_id);
ALTER TABLE public.rental_occupancy ADD CONSTRAINT rental_occupancy_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.rental_request_document ADD CONSTRAINT rental_request_document_rental_request_id_fkey FOREIGN KEY (rental_request_id) REFERENCES rental_occupancy_request(rental_request_id) ON DELETE CASCADE;
ALTER TABLE public.rental_request_document ADD CONSTRAINT rental_request_document_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.rental_request_document ADD CONSTRAINT rental_request_document_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.rental_request_sequence ADD CONSTRAINT rental_request_sequence_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_credential_request_id_fkey FOREIGN KEY (credential_request_id) REFERENCES credential_request(credential_request_id);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_issuing_kebele_id_fkey FOREIGN KEY (issuing_kebele_id) REFERENCES kebele(kebele_id);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES resident(resident_id);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.residence_credential ADD CONSTRAINT residence_credential_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.resident_number_sequence ADD CONSTRAINT resident_number_sequence_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.resident ADD CONSTRAINT resident_current_household_id_fkey FOREIGN KEY (current_household_id) REFERENCES household(household_id);
ALTER TABLE public.resident ADD CONSTRAINT resident_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.role_permission ADD CONSTRAINT role_permission_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.service_request_attachment ADD CONSTRAINT service_request_attachment_service_request_id_fkey FOREIGN KEY (service_request_id) REFERENCES service_request(service_request_id) ON DELETE CASCADE;
ALTER TABLE public.service_request_attachment ADD CONSTRAINT service_request_attachment_uploaded_by_user_id_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.service_request_attachment ADD CONSTRAINT service_request_attachment_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.service_request_sequence ADD CONSTRAINT service_request_sequence_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.service_request_status_history ADD CONSTRAINT service_request_status_history_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.service_request_status_history ADD CONSTRAINT service_request_status_history_service_request_id_fkey FOREIGN KEY (service_request_id) REFERENCES service_request(service_request_id) ON DELETE CASCADE;
ALTER TABLE public.service_request ADD CONSTRAINT service_request_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_household_id_fkey FOREIGN KEY (household_id) REFERENCES household(household_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_issued_by_user_id_fkey FOREIGN KEY (issued_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_kebele_id_fkey FOREIGN KEY (kebele_id) REFERENCES kebele(kebele_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payment(payment_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES resident(resident_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_service_type_id_fkey FOREIGN KEY (service_type_id) REFERENCES service_type(service_type_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.service_request ADD CONSTRAINT service_request_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.service_type ADD CONSTRAINT service_type_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id) ON DELETE CASCADE;
ALTER TABLE public.tenant_module_config ADD CONSTRAINT tenant_module_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app_user(user_id);
ALTER TABLE public.tenant_module_config ADD CONSTRAINT tenant_module_config_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.vital_event_sequence ADD CONSTRAINT vital_event_sequence_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_household_id_fkey FOREIGN KEY (household_id) REFERENCES household(household_id);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_issued_by_user_id_fkey FOREIGN KEY (issued_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES resident(resident_id);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_verified_by_user_id_fkey FOREIGN KEY (verified_by_user_id) REFERENCES app_user(user_id);
ALTER TABLE public.vital_event ADD CONSTRAINT vital_event_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id);
ALTER TABLE public.woreda_settings ADD CONSTRAINT woreda_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES app_user(user_id);
ALTER TABLE public.woreda_settings ADD CONSTRAINT woreda_settings_woreda_id_fkey FOREIGN KEY (woreda_id) REFERENCES woreda(woreda_id) ON DELETE CASCADE;

-- ===== INDEXES =====
CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_name, entity_id, action_at DESC);
CREATE INDEX idx_payment_rental_request_id ON public.payment USING btree (rental_request_id) WHERE (rental_request_id IS NOT NULL);
CREATE INDEX idx_service_request_kebele ON public.service_request USING btree (kebele_id);
CREATE UNIQUE INDEX idx_service_request_number ON public.service_request USING btree (request_number);
CREATE INDEX idx_service_request_resident ON public.service_request USING btree (resident_id);
CREATE INDEX idx_service_request_woreda_status ON public.service_request USING btree (woreda_id, status);
CREATE UNIQUE INDEX rental_occupancy_one_active_per_house ON public.rental_occupancy USING btree (rental_house_id) WHERE (status = 'active'::text);
CREATE INDEX rental_request_document_request_idx ON public.rental_request_document USING btree (rental_request_id);
CREATE UNIQUE INDEX service_request_verification_token_key ON public.service_request USING btree (verification_token);

-- ===== VIEWS =====
CREATE OR REPLACE VIEW public.approval_queue_v AS
 SELECT 'service'::text AS work_type,
    sr.service_request_id AS item_id,
    sr.request_number AS reference_number,
    sr.status AS stage,
    sr.woreda_id,
    sr.kebele_id,
    sr.resident_id,
    sr.priority,
    st.name_am AS subtype_am,
    st.name_en AS subtype_en,
    sr.requested_by_user_id,
    sr.created_at,
    sr.updated_at
   FROM service_request sr
     JOIN service_type st ON st.service_type_id = sr.service_type_id
  WHERE sr.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'pending_approval'::text, 'awaiting_payment'::text, 'returned'::text, 'approval_returned'::text, 'in_progress'::text])
UNION ALL
 SELECT 'credential'::text AS work_type,
    cr.credential_request_id AS item_id,
    cr.request_number AS reference_number,
    cr.status AS stage,
    cr.woreda_id,
    cr.issuing_kebele_id AS kebele_id,
    cr.resident_id,
    'normal'::text AS priority,
    cr.credential_type AS subtype_am,
    cr.credential_type AS subtype_en,
    cr.requested_by_user_id,
    cr.created_at,
    cr.updated_at
   FROM credential_request cr
  WHERE cr.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'pending_approval'::text, 'awaiting_payment'::text, 'returned'::text, 'approval_returned'::text, 'ready_to_print'::text])
UNION ALL
 SELECT 'civil'::text AS work_type,
    ve.vital_event_id AS item_id,
    ve.event_number AS reference_number,
    ve.status AS stage,
    ve.woreda_id,
    NULL::uuid AS kebele_id,
    ve.resident_id,
    'normal'::text AS priority,
    ve.event_type AS subtype_am,
    ve.event_type AS subtype_en,
    ve.requested_by_user_id,
    ve.created_at,
    ve.updated_at
   FROM vital_event ve
  WHERE ve.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'pending_approval'::text, 'returned'::text, 'approval_returned'::text])
UNION ALL
 SELECT 'rental'::text AS work_type,
    ror.rental_request_id AS item_id,
    ror.request_number AS reference_number,
    ror.status AS stage,
    ror.woreda_id,
    krh.kebele_id,
    ror.resident_id,
    'normal'::text AS priority,
    ror.request_type AS subtype_am,
    ror.request_type AS subtype_en,
    ror.requested_by_user_id,
    ror.created_at,
    ror.updated_at
   FROM rental_occupancy_request ror
     LEFT JOIN kebele_rental_house krh ON krh.rental_house_id = ror.rental_house_id
  WHERE ror.status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'verified'::text, 'pending_approval'::text, 'returned'::text, 'awaiting_payment'::text]);
CREATE OR REPLACE VIEW public.household_member_roster AS
 SELECT resident_id,
    current_household_id AS household_id,
    full_name_am,
    full_name,
    date_of_birth,
    sex,
    relation_to_head,
    residency_status,
    active_flag,
    date_part('year'::text, age(date_of_birth::timestamp with time zone)) AS age
   FROM resident r
  WHERE current_household_id IS NOT NULL AND active_flag = true;

-- ===== FUNCTIONS =====
CREATE OR REPLACE FUNCTION public.apply_death_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason TEXT;
BEGIN
  IF NEW.event_type = 'death' AND NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    v_reason := 'Resident deceased (event ' || NEW.event_number || ')';

    UPDATE public.resident
    SET residency_status = 'deceased'
    WHERE resident_id = NEW.resident_id;

    UPDATE public.residence_credential
    SET status = 'revoked', revoked_at = NOW(), revoked_reason = v_reason
    WHERE resident_id = NEW.resident_id AND status = 'active';

    INSERT INTO public.credential_status_history (credential_id, old_status, new_status, change_reason)
    SELECT credential_id, 'active', 'revoked', v_reason
    FROM public.residence_credential
    WHERE resident_id = NEW.resident_id AND status = 'revoked' AND revoked_reason = v_reason;

    INSERT INTO public.audit_log (entity_name, entity_id, action_type, new_value_json)
    SELECT 'residence_credential', credential_id, 'CREDENTIAL_REVOKED', jsonb_build_object('reason', v_reason)
    FROM public.residence_credential
    WHERE resident_id = NEW.resident_id AND revoked_reason = v_reason;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_rental_occupancy_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_occupancy_id UUID;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF NEW.request_type = 'new_registration' THEN
      -- Close any existing active occupancy on this property
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(termination_date, CURRENT_DATE),
          termination_reason = COALESCE(termination_reason, 'Superseded by new occupancy ' || NEW.request_number)
      WHERE rental_house_id = NEW.rental_house_id AND status = 'active';

      INSERT INTO public.rental_occupancy (
        woreda_id, rental_house_id, resident_id, household_id,
        rent_start_date, rent_amount, status, originating_request_id
      ) VALUES (
        NEW.woreda_id, NEW.rental_house_id, NEW.resident_id, NEW.household_id,
        COALESCE(NEW.rent_start_date, CURRENT_DATE),
        COALESCE(NEW.rent_amount, 0),
        'active', NEW.rental_request_id
      )
      RETURNING occupancy_id INTO v_new_occupancy_id;

      NEW.resulting_occupancy_id := v_new_occupancy_id;

      UPDATE public.kebele_rental_house
      SET occupancy_status = 'occupied'
      WHERE rental_house_id = NEW.rental_house_id;

    ELSIF NEW.request_type = 'termination' THEN
      UPDATE public.rental_occupancy
      SET status = 'terminated',
          termination_date = COALESCE(NEW.termination_date, CURRENT_DATE),
          termination_reason = COALESCE(NEW.termination_reason, 'Vacated via ' || NEW.request_number)
      WHERE occupancy_id = NEW.existing_occupancy_id AND status = 'active';

      UPDATE public.kebele_rental_house
      SET occupancy_status = 'vacant'
      WHERE rental_house_id = NEW.rental_house_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_credential_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_num SMALLINT;
  v_kebele_num TEXT;
  v_year SMALLINT;
  v_next INT;
  v_digits TEXT;
  v_sum INT := 0;
  v_weights INT[] := ARRAY[2,3,4,5,6,7];
  v_digit INT;
  i INT;
  v_check INT;
BEGIN
  IF NEW.credential_number IS NOT NULL AND NEW.credential_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_numeric_code INTO v_woreda_num FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  SELECT LPAD(kebele_number::TEXT, 2, '0') INTO v_kebele_num FROM public.kebele WHERE kebele_id = NEW.issuing_kebele_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;

  INSERT INTO public.credential_number_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = credential_number_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  v_digits := LPAD(v_woreda_num::TEXT, 2, '0') || v_kebele_num || LPAD(v_year::TEXT, 2, '0') || LPAD(v_next::TEXT, 6, '0');

  FOR i IN 1..length(v_digits) LOOP
    v_digit := substring(v_digits FROM (length(v_digits) - i + 1) FOR 1)::INT;
    v_sum := v_sum + v_digit * v_weights[((i - 1) % 6) + 1];
  END LOOP;
  v_check := (11 - (v_sum % 11)) % 11;
  IF v_check = 10 THEN v_check := 0; END IF;

  NEW.credential_number := LPAD(v_woreda_num::TEXT,2,'0') || '-' || v_kebele_num || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0') || '-' || v_check;
  NEW.serial_number := v_digits;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_credential_request_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
BEGIN
  IF NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;

  INSERT INTO public.credential_request_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = credential_request_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  NEW.request_number := v_woreda_code || '-REQ-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,5,'0');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_letter_verification_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.verification_token IS NULL OR NEW.verification_token = '' THEN
    NEW.verification_token := public.gen_letter_verification_token();
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_receipt_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
BEGIN
  IF NEW.receipt_number IS NOT NULL AND NEW.receipt_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  INSERT INTO public.receipt_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = receipt_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.receipt_number := v_woreda_code || '-RCT-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_rental_request_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.request_type
    WHEN 'new_registration' THEN 'RNT'
    WHEN 'termination' THEN 'VAC'
    ELSE 'REQ'
  END;
  INSERT INTO public.rental_request_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = rental_request_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.request_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,5,'0');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_resident_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code TEXT;
  v_next INTEGER;
  v_format TEXT;
  v_result TEXT;
  v_seq_match TEXT;
  v_seq_width INT;
BEGIN
  IF NEW.resident_number IS NOT NULL AND NEW.resident_number <> '' AND NEW.resident_number <> 'AUTO' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Unknown woreda %', NEW.woreda_id;
  END IF;

  INSERT INTO public.resident_number_sequence(woreda_id, last_value)
  VALUES (NEW.woreda_id, 1)
  ON CONFLICT (woreda_id)
  DO UPDATE SET last_value = public.resident_number_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  SELECT resident_number_format INTO v_format
    FROM public.woreda_settings WHERE woreda_id = NEW.woreda_id;

  IF v_format IS NULL OR v_format = '' THEN
    NEW.resident_number := v_code || '-' || LPAD(v_next::TEXT, 6, '0');
    RETURN NEW;
  END IF;

  v_result := v_format;
  v_result := REPLACE(v_result, '{WOREDA_CODE}', v_code);

  v_seq_match := (regexp_match(v_result, '\{SEQ:(\d+)\}'))[1];
  IF v_seq_match IS NOT NULL THEN
    v_seq_width := v_seq_match::INT;
    v_result := regexp_replace(v_result, '\{SEQ:\d+\}', LPAD(v_next::TEXT, v_seq_width, '0'), 'g');
  ELSE
    v_result := REPLACE(v_result, '{SEQ}', v_next::TEXT);
  END IF;

  NEW.resident_number := v_result;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_service_request_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.category WHEN 'complaint' THEN 'CMP' ELSE 'SRV' END;
  INSERT INTO public.service_request_sequence(woreda_id, seq_year, last_value)
  VALUES (NEW.woreda_id, v_year, 1)
  ON CONFLICT (woreda_id, seq_year)
  DO UPDATE SET last_value = service_request_sequence.last_value + 1
  RETURNING last_value INTO v_next;
  NEW.request_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,5,'0');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_vital_event_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_woreda_code TEXT;
  v_year SMALLINT;
  v_next INT;
  v_type_code TEXT;
BEGIN
  IF NEW.event_number IS NOT NULL AND NEW.event_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT woreda_code INTO v_woreda_code FROM public.woreda WHERE woreda_id = NEW.woreda_id;
  v_year := EXTRACT(YEAR FROM NOW())::SMALLINT % 100;
  v_type_code := CASE NEW.event_type
    WHEN 'birth' THEN 'BR' WHEN 'death' THEN 'DT'
    WHEN 'marriage' THEN 'MR' WHEN 'divorce' THEN 'DV'
  END;

  INSERT INTO public.vital_event_sequence(woreda_id, event_type, seq_year, last_value)
  VALUES (NEW.woreda_id, NEW.event_type, v_year, 1)
  ON CONFLICT (woreda_id, event_type, seq_year)
  DO UPDATE SET last_value = vital_event_sequence.last_value + 1
  RETURNING last_value INTO v_next;

  NEW.event_number := v_woreda_code || '-' || v_type_code || '-' || LPAD(v_year::TEXT,2,'0') || '-' || LPAD(v_next::TEXT,6,'0');
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.default_role_perms(_role text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _role
    WHEN 'super_admin' THEN ARRAY['platform.manage','tenant.create','tenant.manage','user.manage','audit.view','report.view']
    WHEN 'tenant_admin' THEN ARRAY['resident.create','resident.read','resident.update','resident.delete','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','credential.revoke','credential.renew','credential.approve','civil.register','civil.approve','civil.read','payment.collect','payment.read','receipt.print','report.view','report.export','audit.view','tenant.manage','user.manage','rental.view','rental.create','rental.approve','rental.vacate','rental.report','revenue.view','revenue.collect','revenue.receipt_reprint','service.create','service.read','service.verify','service.approve','service.issue','complaint.manage','approval.queue.view']
    WHEN 'supervisor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','credential.revoke','credential.approve','civil.approve','civil.read','payment.read','receipt.print','report.view','report.export','audit.view','rental.view','rental.approve','revenue.view','revenue.receipt_reprint','service.read','service.verify','service.approve','complaint.manage','approval.queue.view']
    WHEN 'civil_registrar' THEN ARRAY['resident.create','resident.read','resident.update','household.read','credential.issue','credential.read','credential.print','credential.verify','civil.register','civil.read','service.create','service.read','service.issue','approval.queue.view']
    WHEN 'registry_clerk' THEN ARRAY['resident.create','resident.read','resident.update','household.create','household.read','household.update','credential.issue','credential.read','credential.print','credential.verify','civil.read','rental.view','rental.create','service.create','service.read','service.issue','complaint.manage','approval.queue.view']
    WHEN 'finance_clerk' THEN ARRAY['payment.collect','payment.read','receipt.print','resident.read','household.read','credential.read','credential.verify','revenue.view','revenue.collect','revenue.receipt_reprint','service.read','approval.queue.view']
    WHEN 'auditor' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','report.view','audit.view','rental.view','rental.report','revenue.view','service.read']
    WHEN 'viewer' THEN ARRAY['resident.read','household.read','credential.read','credential.verify','civil.read','payment.read','service.read']
    ELSE ARRAY[]::text[]
  END
$function$
;
CREATE OR REPLACE FUNCTION public.force_actor_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid UUID := auth.uid();
  col TEXT;
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF TG_OP = 'INSERT' THEN
      IF to_jsonb(NEW) ->> col IS NOT NULL THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(col, uid));
      END IF;
    ELSE
      IF (to_jsonb(NEW) ->> col) IS NOT NULL
         AND (to_jsonb(NEW) ->> col) IS DISTINCT FROM (to_jsonb(OLD) ->> col) THEN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(col, uid));
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$
;
CREATE OR REPLACE FUNCTION public.gen_letter_verification_token()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_token TEXT;
  i INT;
BEGIN
  LOOP
    v_token := '';
    FOR i IN 1..12 LOOP
      v_token := v_token || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.service_request WHERE verification_token = v_token);
  END LOOP;
  RETURN v_token;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.generate_residence_credential_on_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expiry DATE;
  v_new_credential_id UUID;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    v_expiry := (CURRENT_DATE + INTERVAL '1 year')::DATE;

    INSERT INTO public.residence_credential (
      woreda_id, resident_id, issuing_kebele_id,
      credential_type, status, issue_date, expiry_date,
      reason_for_issue, credential_request_id
    ) VALUES (
      NEW.woreda_id, NEW.resident_id, NEW.issuing_kebele_id,
      NEW.credential_type, 'ready_to_print', CURRENT_DATE, v_expiry,
      NEW.request_type, NEW.credential_request_id
    )
    RETURNING credential_id INTO v_new_credential_id;

    NEW.credential_id := v_new_credential_id;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.generate_resident_on_birth_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d JSONB;
  v_mother_id UUID;
  v_mother_ethnicity TEXT;
  v_mother_religion TEXT;
  v_mother_household_id UUID;
  v_full_name_am TEXT;
  v_new_resident_id UUID;
BEGIN
  IF NEW.event_type = 'birth' AND NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    d := NEW.event_details;
    v_mother_id := NULLIF(d->>'mother_resident_id', '')::UUID;

    IF v_mother_id IS NOT NULL THEN
      SELECT ethnicity, religion, current_household_id
      INTO v_mother_ethnicity, v_mother_religion, v_mother_household_id
      FROM public.resident WHERE resident_id = v_mother_id;
    END IF;

    v_full_name_am := trim(concat_ws(' ', d->>'child_first_name', d->>'child_father_name', d->>'child_grandfather_name'));

    INSERT INTO public.resident (
      woreda_id, first_name, father_name, grandfather_name,
      full_name_am, full_name, sex, date_of_birth, mother_full_name,
      ethnicity, religion, current_household_id, active_flag, residency_status
    ) VALUES (
      NEW.woreda_id, d->>'child_first_name', d->>'child_father_name', d->>'child_grandfather_name',
      v_full_name_am,
      COALESCE(NULLIF(d->>'child_full_name_en', ''), v_full_name_am),
      d->>'sex', NEW.event_date,
      COALESCE(d->>'mother_name', (SELECT full_name_am FROM public.resident WHERE resident_id = v_mother_id)),
      COALESCE(v_mother_ethnicity, d->>'ethnicity'),
      COALESCE(v_mother_religion, d->>'religion'),
      v_mother_household_id, true, 'active'
    )
    RETURNING resident_id INTO v_new_resident_id;

    NEW.resident_id := v_new_resident_id;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_credential_live_status(_credential_number text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT status::text
  FROM public.residence_credential
  WHERE credential_number = _credential_number
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.get_user_woreda_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT woreda_id FROM public.app_user WHERE user_id = auth.uid();
$function$
;
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.app_user WHERE user_id = auth.uid() AND role = 'super_admin');
$function$
;
CREATE OR REPLACE FUNCTION public.is_tenant_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user
    WHERE user_id = auth.uid() AND role = 'tenant_admin'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$
;
CREATE OR REPLACE FUNCTION public.storage_path_woreda_id(object_name text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(split_part(object_name, '/', 1), '')::UUID;
$function$
;
CREATE OR REPLACE FUNCTION public.user_has_any_perm(_perms text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM unnest(_perms) p WHERE public.user_has_perm(p))
$function$
;
CREATE OR REPLACE FUNCTION public.user_has_perm(_perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user au
    WHERE au.user_id = auth.uid()
      AND au.status = 'active'
      AND COALESCE(
            (SELECT rp.is_granted FROM public.role_permission rp
              WHERE rp.woreda_id = au.woreda_id AND rp.role_name = au.role
                AND rp.permission_key = _perm),
            _perm = ANY (public.default_role_perms(au.role))
          )
  )
$function$
;
CREATE OR REPLACE FUNCTION public.validate_credential_fee_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fee NUMERIC;
BEGIN
  IF NEW.payment_type <> 'credential_fee' THEN RETURN NEW; END IF;
  SELECT credential_issuance_fee INTO v_fee FROM public.woreda_settings WHERE woreda_id = NEW.woreda_id;
  IF v_fee IS NULL THEN RETURN NEW; END IF;
  IF NEW.amount <> v_fee THEN
    IF NOT (public.is_super_admin() OR public.user_has_any_perm(ARRAY['credential.approve','tenant.manage'])) THEN
      RAISE EXCEPTION 'Credential fee must be % ETB; waivers or adjustments require supervisor authorization', v_fee;
    END IF;
  END IF;
  RETURN NEW;
END
$function$
;
CREATE OR REPLACE FUNCTION public.validate_receipt_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_amount NUMERIC;
BEGIN
  SELECT amount INTO v_amount FROM public.payment WHERE payment_id = NEW.payment_id;
  IF v_amount IS NULL THEN RAISE EXCEPTION 'Receipt must reference an existing payment'; END IF;
  NEW.total_amount := v_amount;
  RETURN NEW;
END
$function$
;
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
    AND sr.status IN ('issued', 'resolved', 'closed')
  LIMIT 1;
$function$
;

-- ===== TRIGGERS =====
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION force_actor_columns('actor_user_id');
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.credential_print_log FOR EACH ROW EXECUTE FUNCTION force_actor_columns('printed_by_user_id');
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.credential_request_status_history FOR EACH ROW EXECUTE FUNCTION force_actor_columns('changed_by_user_id');
CREATE TRIGGER trg_assign_credential_request_number BEFORE INSERT ON public.credential_request FOR EACH ROW EXECUTE FUNCTION assign_credential_request_number();
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.credential_request FOR EACH ROW EXECUTE FUNCTION force_actor_columns('requested_by_user_id', 'verified_by_user_id', 'approved_by_user_id');
CREATE TRIGGER trg_generate_credential_on_payment BEFORE UPDATE ON public.credential_request FOR EACH ROW EXECUTE FUNCTION generate_residence_credential_on_payment();
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.credential_status_history FOR EACH ROW EXECUTE FUNCTION force_actor_columns('changed_by_user_id');
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.household_change_log FOR EACH ROW EXECUTE FUNCTION force_actor_columns('registered_by_user_id');
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.payment FOR EACH ROW EXECUTE FUNCTION force_actor_columns('posted_by_user_id');
CREATE TRIGGER trg_validate_credential_fee BEFORE INSERT OR UPDATE OF amount, payment_type ON public.payment FOR EACH ROW EXECUTE FUNCTION validate_credential_fee_amount();
CREATE TRIGGER trg_assign_receipt_number BEFORE INSERT ON public.receipt FOR EACH ROW EXECUTE FUNCTION assign_receipt_number();
CREATE TRIGGER trg_validate_receipt_amount BEFORE INSERT OR UPDATE OF total_amount, payment_id ON public.receipt FOR EACH ROW EXECUTE FUNCTION validate_receipt_amount();
CREATE TRIGGER trg_apply_rental_occupancy_on_approval BEFORE UPDATE ON public.rental_occupancy_request FOR EACH ROW EXECUTE FUNCTION apply_rental_occupancy_on_approval();
CREATE TRIGGER trg_assign_rental_request_number BEFORE INSERT ON public.rental_occupancy_request FOR EACH ROW EXECUTE FUNCTION assign_rental_request_number();
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.rental_occupancy_request FOR EACH ROW EXECUTE FUNCTION force_actor_columns('requested_by_user_id', 'verified_by_user_id', 'approved_by_user_id');
CREATE TRIGGER set_rental_request_document_updated_at BEFORE UPDATE ON public.rental_request_document FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.rental_request_document FOR EACH ROW EXECUTE FUNCTION force_actor_columns('uploaded_by_user_id');
CREATE TRIGGER trg_assign_credential_number BEFORE INSERT ON public.residence_credential FOR EACH ROW EXECUTE FUNCTION assign_credential_number();
CREATE TRIGGER trg_assign_resident_number BEFORE INSERT ON public.resident FOR EACH ROW EXECUTE FUNCTION assign_resident_number();
CREATE TRIGGER role_permission_set_updated_at BEFORE UPDATE ON public.role_permission FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER service_request_attachment_set_updated_at BEFORE UPDATE ON public.service_request_attachment FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.service_request_attachment FOR EACH ROW EXECUTE FUNCTION force_actor_columns('uploaded_by_user_id');
CREATE TRIGGER trg_force_actor BEFORE INSERT ON public.service_request_status_history FOR EACH ROW EXECUTE FUNCTION force_actor_columns('changed_by_user_id');
CREATE TRIGGER service_request_set_updated_at BEFORE UPDATE ON public.service_request FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_assign_letter_verification_token BEFORE INSERT ON public.service_request FOR EACH ROW EXECUTE FUNCTION assign_letter_verification_token();
CREATE TRIGGER trg_assign_service_request_number BEFORE INSERT ON public.service_request FOR EACH ROW EXECUTE FUNCTION assign_service_request_number();
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.service_request FOR EACH ROW EXECUTE FUNCTION force_actor_columns('requested_by_user_id', 'verified_by_user_id', 'approved_by_user_id', 'issued_by_user_id');
CREATE TRIGGER service_type_set_updated_at BEFORE UPDATE ON public.service_type FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_apply_death_on_approval BEFORE UPDATE ON public.vital_event FOR EACH ROW EXECUTE FUNCTION apply_death_on_approval();
CREATE TRIGGER trg_assign_vital_event_number BEFORE INSERT ON public.vital_event FOR EACH ROW EXECUTE FUNCTION assign_vital_event_number();
CREATE TRIGGER trg_force_actor BEFORE INSERT OR UPDATE ON public.vital_event FOR EACH ROW EXECUTE FUNCTION force_actor_columns('requested_by_user_id', 'verified_by_user_id', 'approved_by_user_id', 'issued_by_user_id');
CREATE TRIGGER trg_generate_resident_on_birth_approval BEFORE UPDATE ON public.vital_event FOR EACH ROW EXECUTE FUNCTION generate_resident_on_birth_approval();

-- ===== ROW LEVEL SECURITY =====
ALTER TABLE public.app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_number_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_print_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_request_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_request_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.id_card_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.id_card_template_field ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kebele ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kebele_rental_house ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_occupancy_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_request_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_request_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residence_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_number_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_module_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vital_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vital_event_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.woreda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.woreda_settings ENABLE ROW LEVEL SECURITY;

-- ===== POLICIES =====
CREATE POLICY app_user_self_read ON public.app_user AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY app_user_super_admin_write ON public.app_user AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY app_user_tenant_admin_write ON public.app_user AS PERMISSIVE FOR ALL TO authenticated USING ((is_tenant_admin() AND (woreda_id = get_user_woreda_id()) AND (role <> 'tenant_admin'::text))) WITH CHECK ((is_tenant_admin() AND (woreda_id = get_user_woreda_id()) AND (role <> 'tenant_admin'::text)));
CREATE POLICY audit_log_tenant_insert ON public.audit_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY audit_log_tenant_read ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY credential_seq_tenant ON public.credential_number_sequence AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id()))) WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY credential_print_log_delete ON public.credential_print_log AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY credential_print_log_insert ON public.credential_print_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.print}'::text[]))));
CREATE POLICY credential_print_log_select ON public.credential_print_log AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY credential_print_log_update ON public.credential_print_log AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.print}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.print}'::text[]))));
CREATE POLICY cred_req_seq_tenant ON public.credential_request_sequence AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id()))) WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY cred_req_history_insert ON public.credential_request_status_history AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR (user_has_any_perm(ARRAY['credential.issue'::text, 'credential.approve'::text, 'credential.verify'::text, 'payment.collect'::text, 'revenue.collect'::text]) AND (EXISTS ( SELECT 1
   FROM credential_request cr
  WHERE ((cr.credential_request_id = credential_request_status_history.credential_request_id) AND (cr.woreda_id = get_user_woreda_id())))))));
CREATE POLICY cred_req_history_select ON public.credential_request_status_history AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM credential_request cr
  WHERE ((cr.credential_request_id = credential_request_status_history.credential_request_id) AND (cr.woreda_id = get_user_woreda_id()))))));
CREATE POLICY credential_request_delete ON public.credential_request AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.approve}'::text[]))));
CREATE POLICY credential_request_insert ON public.credential_request AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.issue}'::text[]))));
CREATE POLICY credential_request_select ON public.credential_request AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY credential_request_update ON public.credential_request AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.issue,credential.approve,credential.verify,payment.collect,revenue.collect}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.issue,credential.approve,credential.verify,payment.collect,revenue.collect}'::text[]))));
CREATE POLICY credential_status_history_insert ON public.credential_status_history AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR (user_has_any_perm(ARRAY['credential.issue'::text, 'credential.approve'::text, 'credential.print'::text, 'credential.revoke'::text, 'credential.renew'::text]) AND (EXISTS ( SELECT 1
   FROM residence_credential rc
  WHERE ((rc.credential_id = credential_status_history.credential_id) AND (rc.woreda_id = get_user_woreda_id())))))));
CREATE POLICY credential_status_history_read ON public.credential_status_history AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM residence_credential rc
  WHERE ((rc.credential_id = credential_status_history.credential_id) AND (rc.woreda_id = get_user_woreda_id()))))));
CREATE POLICY fee_schedule_delete ON public.fee_schedule AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY fee_schedule_insert ON public.fee_schedule AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY fee_schedule_select ON public.fee_schedule AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY fee_schedule_update ON public.fee_schedule AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY household_change_log_delete ON public.household_change_log AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY household_change_log_insert ON public.household_change_log AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update,household.create}'::text[]))));
CREATE POLICY household_change_log_select ON public.household_change_log AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY household_change_log_update ON public.household_change_log AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[]))));
CREATE POLICY household_delete ON public.household AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[]))));
CREATE POLICY household_insert ON public.household AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.create}'::text[]))));
CREATE POLICY household_select ON public.household AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY household_update ON public.household AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{household.update}'::text[]))));
CREATE POLICY template_read_all ON public.id_card_template_field AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY template_write_super_admin ON public.id_card_template_field AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY id_card_template_read_all ON public.id_card_template AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY id_card_template_write_super_admin ON public.id_card_template AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY kebele_rental_house_delete ON public.kebele_rental_house AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY kebele_rental_house_insert ON public.kebele_rental_house AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create}'::text[]))));
CREATE POLICY kebele_rental_house_select ON public.kebele_rental_house AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY kebele_rental_house_update ON public.kebele_rental_house AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create,rental.approve,rental.vacate}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create,rental.approve,rental.vacate}'::text[]))));
CREATE POLICY kebele_tenant_isolation ON public.kebele AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id()))) WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY payment_delete ON public.payment AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY payment_insert ON public.payment AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{payment.collect,revenue.collect}'::text[]))));
CREATE POLICY payment_select ON public.payment AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY payment_update ON public.payment AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{payment.collect,revenue.collect}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{payment.collect,revenue.collect}'::text[]))));
CREATE POLICY receipt_seq_tenant ON public.receipt_sequence AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id()))) WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY receipt_delete ON public.receipt AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY receipt_insert ON public.receipt AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{payment.collect,revenue.collect,receipt.print}'::text[]))));
CREATE POLICY receipt_select ON public.receipt AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY receipt_update ON public.receipt AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{receipt.print,revenue.receipt_reprint,payment.collect}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{receipt.print,revenue.receipt_reprint,payment.collect}'::text[]))));
CREATE POLICY rental_occupancy_request_delete ON public.rental_occupancy_request AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY rental_occupancy_request_insert ON public.rental_occupancy_request AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create,rental.vacate}'::text[]))));
CREATE POLICY rental_occupancy_request_select ON public.rental_occupancy_request AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY rental_occupancy_request_update ON public.rental_occupancy_request AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create,rental.approve,rental.vacate}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create,rental.approve,rental.vacate}'::text[]))));
CREATE POLICY rental_occupancy_delete ON public.rental_occupancy AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY rental_occupancy_insert ON public.rental_occupancy AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create,rental.approve}'::text[]))));
CREATE POLICY rental_occupancy_select ON public.rental_occupancy AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY rental_occupancy_update ON public.rental_occupancy AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.approve,rental.vacate}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.approve,rental.vacate}'::text[]))));
CREATE POLICY rental_request_document_delete ON public.rental_request_document AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create}'::text[]))));
CREATE POLICY rental_request_document_insert ON public.rental_request_document AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create}'::text[]))));
CREATE POLICY rental_request_document_select ON public.rental_request_document AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY rental_request_document_update ON public.rental_request_document AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{rental.create}'::text[]))));
CREATE POLICY rental_request_sequence_tenant ON public.rental_request_sequence AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id()))) WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY residence_credential_delete ON public.residence_credential AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.revoke}'::text[]))));
CREATE POLICY residence_credential_insert ON public.residence_credential AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.issue}'::text[]))));
CREATE POLICY residence_credential_select ON public.residence_credential AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY residence_credential_update ON public.residence_credential AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.issue,credential.approve,credential.print,credential.revoke,credential.renew}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{credential.issue,credential.approve,credential.print,credential.revoke,credential.renew}'::text[]))));
CREATE POLICY resident_number_sequence_tenant ON public.resident_number_sequence AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id()))) WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY resident_delete ON public.resident AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{resident.delete}'::text[]))));
CREATE POLICY resident_insert ON public.resident AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{resident.create}'::text[]))));
CREATE POLICY resident_select ON public.resident AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY resident_update ON public.resident AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{resident.update}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{resident.update}'::text[]))));
CREATE POLICY role_permission_insert_tenant_admin ON public.role_permission AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR (is_tenant_admin() AND (woreda_id = get_user_woreda_id()))));
CREATE POLICY role_permission_select_same_woreda ON public.role_permission AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY role_permission_update_tenant_admin ON public.role_permission AS PERMISSIVE FOR UPDATE TO authenticated USING (((is_super_admin() OR (is_tenant_admin() AND (woreda_id = get_user_woreda_id()))) AND (permission_key <> ALL (ARRAY['credential.approve'::text, 'civil.approve'::text, 'tenant.manage'::text])))) WITH CHECK (((is_super_admin() OR (is_tenant_admin() AND (woreda_id = get_user_woreda_id()))) AND (permission_key <> ALL (ARRAY['credential.approve'::text, 'civil.approve'::text, 'tenant.manage'::text]))));
CREATE POLICY service_request_attachment_delete ON public.service_request_attachment AS PERMISSIVE FOR DELETE TO authenticated USING (((woreda_id = get_user_woreda_id()) AND user_has_any_perm(ARRAY['service.create'::text, 'complaint.manage'::text, 'tenant.manage'::text])));
CREATE POLICY service_request_attachment_insert ON public.service_request_attachment AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((woreda_id = get_user_woreda_id()) AND user_has_any_perm(ARRAY['service.create'::text, 'service.verify'::text, 'complaint.manage'::text, 'tenant.manage'::text])));
CREATE POLICY service_request_attachment_select ON public.service_request_attachment AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY service_request_attachment_update ON public.service_request_attachment AS PERMISSIVE FOR UPDATE TO authenticated USING (((woreda_id = get_user_woreda_id()) AND user_has_any_perm(ARRAY['service.create'::text, 'service.verify'::text, 'complaint.manage'::text, 'tenant.manage'::text])));
CREATE POLICY service_request_sequence_read ON public.service_request_sequence AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY service_request_status_history_insert ON public.service_request_status_history AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM service_request sr
  WHERE ((sr.service_request_id = service_request_status_history.service_request_id) AND (sr.woreda_id = get_user_woreda_id())))));
CREATE POLICY service_request_status_history_select ON public.service_request_status_history AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM service_request sr
  WHERE ((sr.service_request_id = service_request_status_history.service_request_id) AND (is_super_admin() OR (sr.woreda_id = get_user_woreda_id()))))));
CREATE POLICY service_request_delete ON public.service_request AS PERMISSIVE FOR DELETE TO authenticated USING (((woreda_id = get_user_woreda_id()) AND user_has_any_perm(ARRAY['tenant.manage'::text])));
CREATE POLICY service_request_insert ON public.service_request AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((woreda_id = get_user_woreda_id()) AND user_has_any_perm(ARRAY['service.create'::text, 'complaint.manage'::text, 'tenant.manage'::text])));
CREATE POLICY service_request_select ON public.service_request AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY service_request_update ON public.service_request AS PERMISSIVE FOR UPDATE TO authenticated USING (((woreda_id = get_user_woreda_id()) AND user_has_any_perm(ARRAY['service.create'::text, 'service.verify'::text, 'service.approve'::text, 'service.issue'::text, 'complaint.manage'::text, 'tenant.manage'::text])));
CREATE POLICY service_type_delete ON public.service_type AS PERMISSIVE FOR DELETE TO authenticated USING (((is_super_admin() OR (woreda_id = get_user_woreda_id())) AND (is_super_admin() OR user_has_any_perm(ARRAY['tenant.manage'::text]))));
CREATE POLICY service_type_insert ON public.service_type AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_super_admin() OR (woreda_id = get_user_woreda_id())) AND (is_super_admin() OR user_has_any_perm(ARRAY['tenant.manage'::text]))));
CREATE POLICY service_type_select ON public.service_type AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY service_type_update ON public.service_type AS PERMISSIVE FOR UPDATE TO authenticated USING (((is_super_admin() OR (woreda_id = get_user_woreda_id())) AND (is_super_admin() OR user_has_any_perm(ARRAY['tenant.manage'::text]))));
CREATE POLICY tenant_module_config_read ON public.tenant_module_config AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY tenant_module_config_write_super_admin ON public.tenant_module_config AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY vital_event_seq_tenant ON public.vital_event_sequence AS PERMISSIVE FOR ALL TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id()))) WITH CHECK ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY vital_event_delete ON public.vital_event AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{civil.approve}'::text[]))));
CREATE POLICY vital_event_insert ON public.vital_event AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{civil.register}'::text[]))));
CREATE POLICY vital_event_select ON public.vital_event AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY vital_event_update ON public.vital_event AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{civil.register,civil.approve}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{civil.register,civil.approve}'::text[]))));
CREATE POLICY woreda_settings_delete ON public.woreda_settings AS PERMISSIVE FOR DELETE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY woreda_settings_insert ON public.woreda_settings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY woreda_settings_select ON public.woreda_settings AS PERMISSIVE FOR SELECT TO authenticated USING ((is_super_admin() OR (woreda_id = get_user_woreda_id())));
CREATE POLICY woreda_settings_update ON public.woreda_settings AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[])))) WITH CHECK ((is_super_admin() OR ((woreda_id = get_user_woreda_id()) AND user_has_any_perm('{tenant.manage}'::text[]))));
CREATE POLICY woreda_read_all_authenticated ON public.woreda AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY woreda_super_admin_write ON public.woreda AS PERMISSIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ===== GRANTS =====
GRANT DELETE ON public.app_user TO anon;
GRANT INSERT ON public.app_user TO anon;
GRANT REFERENCES ON public.app_user TO anon;
GRANT SELECT ON public.app_user TO anon;
GRANT TRIGGER ON public.app_user TO anon;
GRANT TRUNCATE ON public.app_user TO anon;
GRANT UPDATE ON public.app_user TO anon;
GRANT DELETE ON public.app_user TO authenticated;
GRANT INSERT ON public.app_user TO authenticated;
GRANT REFERENCES ON public.app_user TO authenticated;
GRANT SELECT ON public.app_user TO authenticated;
GRANT TRIGGER ON public.app_user TO authenticated;
GRANT TRUNCATE ON public.app_user TO authenticated;
GRANT UPDATE ON public.app_user TO authenticated;
GRANT DELETE ON public.app_user TO service_role;
GRANT INSERT ON public.app_user TO service_role;
GRANT REFERENCES ON public.app_user TO service_role;
GRANT SELECT ON public.app_user TO service_role;
GRANT TRIGGER ON public.app_user TO service_role;
GRANT TRUNCATE ON public.app_user TO service_role;
GRANT UPDATE ON public.app_user TO service_role;
GRANT DELETE ON public.approval_queue_v TO anon;
GRANT INSERT ON public.approval_queue_v TO anon;
GRANT REFERENCES ON public.approval_queue_v TO anon;
GRANT SELECT ON public.approval_queue_v TO anon;
GRANT TRIGGER ON public.approval_queue_v TO anon;
GRANT TRUNCATE ON public.approval_queue_v TO anon;
GRANT UPDATE ON public.approval_queue_v TO anon;
GRANT DELETE ON public.approval_queue_v TO authenticated;
GRANT INSERT ON public.approval_queue_v TO authenticated;
GRANT REFERENCES ON public.approval_queue_v TO authenticated;
GRANT SELECT ON public.approval_queue_v TO authenticated;
GRANT TRIGGER ON public.approval_queue_v TO authenticated;
GRANT TRUNCATE ON public.approval_queue_v TO authenticated;
GRANT UPDATE ON public.approval_queue_v TO authenticated;
GRANT DELETE ON public.approval_queue_v TO service_role;
GRANT INSERT ON public.approval_queue_v TO service_role;
GRANT REFERENCES ON public.approval_queue_v TO service_role;
GRANT SELECT ON public.approval_queue_v TO service_role;
GRANT TRIGGER ON public.approval_queue_v TO service_role;
GRANT TRUNCATE ON public.approval_queue_v TO service_role;
GRANT UPDATE ON public.approval_queue_v TO service_role;
GRANT DELETE ON public.audit_log TO anon;
GRANT INSERT ON public.audit_log TO anon;
GRANT REFERENCES ON public.audit_log TO anon;
GRANT SELECT ON public.audit_log TO anon;
GRANT TRIGGER ON public.audit_log TO anon;
GRANT TRUNCATE ON public.audit_log TO anon;
GRANT UPDATE ON public.audit_log TO anon;
GRANT DELETE ON public.audit_log TO authenticated;
GRANT INSERT ON public.audit_log TO authenticated;
GRANT REFERENCES ON public.audit_log TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT TRIGGER ON public.audit_log TO authenticated;
GRANT TRUNCATE ON public.audit_log TO authenticated;
GRANT UPDATE ON public.audit_log TO authenticated;
GRANT DELETE ON public.audit_log TO service_role;
GRANT INSERT ON public.audit_log TO service_role;
GRANT REFERENCES ON public.audit_log TO service_role;
GRANT SELECT ON public.audit_log TO service_role;
GRANT TRIGGER ON public.audit_log TO service_role;
GRANT TRUNCATE ON public.audit_log TO service_role;
GRANT UPDATE ON public.audit_log TO service_role;
GRANT DELETE ON public.credential_number_sequence TO anon;
GRANT INSERT ON public.credential_number_sequence TO anon;
GRANT REFERENCES ON public.credential_number_sequence TO anon;
GRANT SELECT ON public.credential_number_sequence TO anon;
GRANT TRIGGER ON public.credential_number_sequence TO anon;
GRANT TRUNCATE ON public.credential_number_sequence TO anon;
GRANT UPDATE ON public.credential_number_sequence TO anon;
GRANT DELETE ON public.credential_number_sequence TO authenticated;
GRANT INSERT ON public.credential_number_sequence TO authenticated;
GRANT REFERENCES ON public.credential_number_sequence TO authenticated;
GRANT SELECT ON public.credential_number_sequence TO authenticated;
GRANT TRIGGER ON public.credential_number_sequence TO authenticated;
GRANT TRUNCATE ON public.credential_number_sequence TO authenticated;
GRANT UPDATE ON public.credential_number_sequence TO authenticated;
GRANT DELETE ON public.credential_number_sequence TO service_role;
GRANT INSERT ON public.credential_number_sequence TO service_role;
GRANT REFERENCES ON public.credential_number_sequence TO service_role;
GRANT SELECT ON public.credential_number_sequence TO service_role;
GRANT TRIGGER ON public.credential_number_sequence TO service_role;
GRANT TRUNCATE ON public.credential_number_sequence TO service_role;
GRANT UPDATE ON public.credential_number_sequence TO service_role;
GRANT DELETE ON public.credential_print_log TO anon;
GRANT INSERT ON public.credential_print_log TO anon;
GRANT REFERENCES ON public.credential_print_log TO anon;
GRANT SELECT ON public.credential_print_log TO anon;
GRANT TRIGGER ON public.credential_print_log TO anon;
GRANT TRUNCATE ON public.credential_print_log TO anon;
GRANT UPDATE ON public.credential_print_log TO anon;
GRANT DELETE ON public.credential_print_log TO authenticated;
GRANT INSERT ON public.credential_print_log TO authenticated;
GRANT REFERENCES ON public.credential_print_log TO authenticated;
GRANT SELECT ON public.credential_print_log TO authenticated;
GRANT TRIGGER ON public.credential_print_log TO authenticated;
GRANT TRUNCATE ON public.credential_print_log TO authenticated;
GRANT UPDATE ON public.credential_print_log TO authenticated;
GRANT DELETE ON public.credential_print_log TO service_role;
GRANT INSERT ON public.credential_print_log TO service_role;
GRANT REFERENCES ON public.credential_print_log TO service_role;
GRANT SELECT ON public.credential_print_log TO service_role;
GRANT TRIGGER ON public.credential_print_log TO service_role;
GRANT TRUNCATE ON public.credential_print_log TO service_role;
GRANT UPDATE ON public.credential_print_log TO service_role;
GRANT DELETE ON public.credential_request_sequence TO anon;
GRANT INSERT ON public.credential_request_sequence TO anon;
GRANT REFERENCES ON public.credential_request_sequence TO anon;
GRANT SELECT ON public.credential_request_sequence TO anon;
GRANT TRIGGER ON public.credential_request_sequence TO anon;
GRANT TRUNCATE ON public.credential_request_sequence TO anon;
GRANT UPDATE ON public.credential_request_sequence TO anon;
GRANT DELETE ON public.credential_request_sequence TO authenticated;
GRANT INSERT ON public.credential_request_sequence TO authenticated;
GRANT REFERENCES ON public.credential_request_sequence TO authenticated;
GRANT SELECT ON public.credential_request_sequence TO authenticated;
GRANT TRIGGER ON public.credential_request_sequence TO authenticated;
GRANT TRUNCATE ON public.credential_request_sequence TO authenticated;
GRANT UPDATE ON public.credential_request_sequence TO authenticated;
GRANT DELETE ON public.credential_request_sequence TO service_role;
GRANT INSERT ON public.credential_request_sequence TO service_role;
GRANT REFERENCES ON public.credential_request_sequence TO service_role;
GRANT SELECT ON public.credential_request_sequence TO service_role;
GRANT TRIGGER ON public.credential_request_sequence TO service_role;
GRANT TRUNCATE ON public.credential_request_sequence TO service_role;
GRANT UPDATE ON public.credential_request_sequence TO service_role;
GRANT DELETE ON public.credential_request_status_history TO anon;
GRANT INSERT ON public.credential_request_status_history TO anon;
GRANT REFERENCES ON public.credential_request_status_history TO anon;
GRANT SELECT ON public.credential_request_status_history TO anon;
GRANT TRIGGER ON public.credential_request_status_history TO anon;
GRANT TRUNCATE ON public.credential_request_status_history TO anon;
GRANT UPDATE ON public.credential_request_status_history TO anon;
GRANT DELETE ON public.credential_request_status_history TO authenticated;
GRANT INSERT ON public.credential_request_status_history TO authenticated;
GRANT REFERENCES ON public.credential_request_status_history TO authenticated;
GRANT SELECT ON public.credential_request_status_history TO authenticated;
GRANT TRIGGER ON public.credential_request_status_history TO authenticated;
GRANT TRUNCATE ON public.credential_request_status_history TO authenticated;
GRANT UPDATE ON public.credential_request_status_history TO authenticated;
GRANT DELETE ON public.credential_request_status_history TO service_role;
GRANT INSERT ON public.credential_request_status_history TO service_role;
GRANT REFERENCES ON public.credential_request_status_history TO service_role;
GRANT SELECT ON public.credential_request_status_history TO service_role;
GRANT TRIGGER ON public.credential_request_status_history TO service_role;
GRANT TRUNCATE ON public.credential_request_status_history TO service_role;
GRANT UPDATE ON public.credential_request_status_history TO service_role;
GRANT DELETE ON public.credential_request TO anon;
GRANT INSERT ON public.credential_request TO anon;
GRANT REFERENCES ON public.credential_request TO anon;
GRANT SELECT ON public.credential_request TO anon;
GRANT TRIGGER ON public.credential_request TO anon;
GRANT TRUNCATE ON public.credential_request TO anon;
GRANT UPDATE ON public.credential_request TO anon;
GRANT DELETE ON public.credential_request TO authenticated;
GRANT INSERT ON public.credential_request TO authenticated;
GRANT REFERENCES ON public.credential_request TO authenticated;
GRANT SELECT ON public.credential_request TO authenticated;
GRANT TRIGGER ON public.credential_request TO authenticated;
GRANT TRUNCATE ON public.credential_request TO authenticated;
GRANT UPDATE ON public.credential_request TO authenticated;
GRANT DELETE ON public.credential_request TO service_role;
GRANT INSERT ON public.credential_request TO service_role;
GRANT REFERENCES ON public.credential_request TO service_role;
GRANT SELECT ON public.credential_request TO service_role;
GRANT TRIGGER ON public.credential_request TO service_role;
GRANT TRUNCATE ON public.credential_request TO service_role;
GRANT UPDATE ON public.credential_request TO service_role;
GRANT DELETE ON public.credential_status_history TO anon;
GRANT INSERT ON public.credential_status_history TO anon;
GRANT REFERENCES ON public.credential_status_history TO anon;
GRANT SELECT ON public.credential_status_history TO anon;
GRANT TRIGGER ON public.credential_status_history TO anon;
GRANT TRUNCATE ON public.credential_status_history TO anon;
GRANT UPDATE ON public.credential_status_history TO anon;
GRANT DELETE ON public.credential_status_history TO authenticated;
GRANT INSERT ON public.credential_status_history TO authenticated;
GRANT REFERENCES ON public.credential_status_history TO authenticated;
GRANT SELECT ON public.credential_status_history TO authenticated;
GRANT TRIGGER ON public.credential_status_history TO authenticated;
GRANT TRUNCATE ON public.credential_status_history TO authenticated;
GRANT UPDATE ON public.credential_status_history TO authenticated;
GRANT DELETE ON public.credential_status_history TO service_role;
GRANT INSERT ON public.credential_status_history TO service_role;
GRANT REFERENCES ON public.credential_status_history TO service_role;
GRANT SELECT ON public.credential_status_history TO service_role;
GRANT TRIGGER ON public.credential_status_history TO service_role;
GRANT TRUNCATE ON public.credential_status_history TO service_role;
GRANT UPDATE ON public.credential_status_history TO service_role;
GRANT DELETE ON public.fee_schedule TO anon;
GRANT INSERT ON public.fee_schedule TO anon;
GRANT REFERENCES ON public.fee_schedule TO anon;
GRANT SELECT ON public.fee_schedule TO anon;
GRANT TRIGGER ON public.fee_schedule TO anon;
GRANT TRUNCATE ON public.fee_schedule TO anon;
GRANT UPDATE ON public.fee_schedule TO anon;
GRANT DELETE ON public.fee_schedule TO authenticated;
GRANT INSERT ON public.fee_schedule TO authenticated;
GRANT REFERENCES ON public.fee_schedule TO authenticated;
GRANT SELECT ON public.fee_schedule TO authenticated;
GRANT TRIGGER ON public.fee_schedule TO authenticated;
GRANT TRUNCATE ON public.fee_schedule TO authenticated;
GRANT UPDATE ON public.fee_schedule TO authenticated;
GRANT DELETE ON public.fee_schedule TO service_role;
GRANT INSERT ON public.fee_schedule TO service_role;
GRANT REFERENCES ON public.fee_schedule TO service_role;
GRANT SELECT ON public.fee_schedule TO service_role;
GRANT TRIGGER ON public.fee_schedule TO service_role;
GRANT TRUNCATE ON public.fee_schedule TO service_role;
GRANT UPDATE ON public.fee_schedule TO service_role;
GRANT DELETE ON public.household_change_log TO anon;
GRANT INSERT ON public.household_change_log TO anon;
GRANT REFERENCES ON public.household_change_log TO anon;
GRANT SELECT ON public.household_change_log TO anon;
GRANT TRIGGER ON public.household_change_log TO anon;
GRANT TRUNCATE ON public.household_change_log TO anon;
GRANT UPDATE ON public.household_change_log TO anon;
GRANT DELETE ON public.household_change_log TO authenticated;
GRANT INSERT ON public.household_change_log TO authenticated;
GRANT REFERENCES ON public.household_change_log TO authenticated;
GRANT SELECT ON public.household_change_log TO authenticated;
GRANT TRIGGER ON public.household_change_log TO authenticated;
GRANT TRUNCATE ON public.household_change_log TO authenticated;
GRANT UPDATE ON public.household_change_log TO authenticated;
GRANT DELETE ON public.household_change_log TO service_role;
GRANT INSERT ON public.household_change_log TO service_role;
GRANT REFERENCES ON public.household_change_log TO service_role;
GRANT SELECT ON public.household_change_log TO service_role;
GRANT TRIGGER ON public.household_change_log TO service_role;
GRANT TRUNCATE ON public.household_change_log TO service_role;
GRANT UPDATE ON public.household_change_log TO service_role;
GRANT DELETE ON public.household_member_roster TO anon;
GRANT INSERT ON public.household_member_roster TO anon;
GRANT REFERENCES ON public.household_member_roster TO anon;
GRANT SELECT ON public.household_member_roster TO anon;
GRANT TRIGGER ON public.household_member_roster TO anon;
GRANT TRUNCATE ON public.household_member_roster TO anon;
GRANT UPDATE ON public.household_member_roster TO anon;
GRANT DELETE ON public.household_member_roster TO authenticated;
GRANT INSERT ON public.household_member_roster TO authenticated;
GRANT REFERENCES ON public.household_member_roster TO authenticated;
GRANT SELECT ON public.household_member_roster TO authenticated;
GRANT TRIGGER ON public.household_member_roster TO authenticated;
GRANT TRUNCATE ON public.household_member_roster TO authenticated;
GRANT UPDATE ON public.household_member_roster TO authenticated;
GRANT DELETE ON public.household_member_roster TO service_role;
GRANT INSERT ON public.household_member_roster TO service_role;
GRANT REFERENCES ON public.household_member_roster TO service_role;
GRANT SELECT ON public.household_member_roster TO service_role;
GRANT TRIGGER ON public.household_member_roster TO service_role;
GRANT TRUNCATE ON public.household_member_roster TO service_role;
GRANT UPDATE ON public.household_member_roster TO service_role;
GRANT DELETE ON public.household TO anon;
GRANT INSERT ON public.household TO anon;
GRANT REFERENCES ON public.household TO anon;
GRANT SELECT ON public.household TO anon;
GRANT TRIGGER ON public.household TO anon;
GRANT TRUNCATE ON public.household TO anon;
GRANT UPDATE ON public.household TO anon;
GRANT DELETE ON public.household TO authenticated;
GRANT INSERT ON public.household TO authenticated;
GRANT REFERENCES ON public.household TO authenticated;
GRANT SELECT ON public.household TO authenticated;
GRANT TRIGGER ON public.household TO authenticated;
GRANT TRUNCATE ON public.household TO authenticated;
GRANT UPDATE ON public.household TO authenticated;
GRANT DELETE ON public.household TO service_role;
GRANT INSERT ON public.household TO service_role;
GRANT REFERENCES ON public.household TO service_role;
GRANT SELECT ON public.household TO service_role;
GRANT TRIGGER ON public.household TO service_role;
GRANT TRUNCATE ON public.household TO service_role;
GRANT UPDATE ON public.household TO service_role;
GRANT DELETE ON public.id_card_template_field TO anon;
GRANT INSERT ON public.id_card_template_field TO anon;
GRANT REFERENCES ON public.id_card_template_field TO anon;
GRANT SELECT ON public.id_card_template_field TO anon;
GRANT TRIGGER ON public.id_card_template_field TO anon;
GRANT TRUNCATE ON public.id_card_template_field TO anon;
GRANT UPDATE ON public.id_card_template_field TO anon;
GRANT DELETE ON public.id_card_template_field TO authenticated;
GRANT INSERT ON public.id_card_template_field TO authenticated;
GRANT REFERENCES ON public.id_card_template_field TO authenticated;
GRANT SELECT ON public.id_card_template_field TO authenticated;
GRANT TRIGGER ON public.id_card_template_field TO authenticated;
GRANT TRUNCATE ON public.id_card_template_field TO authenticated;
GRANT UPDATE ON public.id_card_template_field TO authenticated;
GRANT DELETE ON public.id_card_template_field TO service_role;
GRANT INSERT ON public.id_card_template_field TO service_role;
GRANT REFERENCES ON public.id_card_template_field TO service_role;
GRANT SELECT ON public.id_card_template_field TO service_role;
GRANT TRIGGER ON public.id_card_template_field TO service_role;
GRANT TRUNCATE ON public.id_card_template_field TO service_role;
GRANT UPDATE ON public.id_card_template_field TO service_role;
GRANT DELETE ON public.id_card_template TO anon;
GRANT INSERT ON public.id_card_template TO anon;
GRANT REFERENCES ON public.id_card_template TO anon;
GRANT SELECT ON public.id_card_template TO anon;
GRANT TRIGGER ON public.id_card_template TO anon;
GRANT TRUNCATE ON public.id_card_template TO anon;
GRANT UPDATE ON public.id_card_template TO anon;
GRANT DELETE ON public.id_card_template TO authenticated;
GRANT INSERT ON public.id_card_template TO authenticated;
GRANT REFERENCES ON public.id_card_template TO authenticated;
GRANT SELECT ON public.id_card_template TO authenticated;
GRANT TRIGGER ON public.id_card_template TO authenticated;
GRANT TRUNCATE ON public.id_card_template TO authenticated;
GRANT UPDATE ON public.id_card_template TO authenticated;
GRANT DELETE ON public.id_card_template TO service_role;
GRANT INSERT ON public.id_card_template TO service_role;
GRANT REFERENCES ON public.id_card_template TO service_role;
GRANT SELECT ON public.id_card_template TO service_role;
GRANT TRIGGER ON public.id_card_template TO service_role;
GRANT TRUNCATE ON public.id_card_template TO service_role;
GRANT UPDATE ON public.id_card_template TO service_role;
GRANT DELETE ON public.kebele_rental_house TO anon;
GRANT INSERT ON public.kebele_rental_house TO anon;
GRANT REFERENCES ON public.kebele_rental_house TO anon;
GRANT SELECT ON public.kebele_rental_house TO anon;
GRANT TRIGGER ON public.kebele_rental_house TO anon;
GRANT TRUNCATE ON public.kebele_rental_house TO anon;
GRANT UPDATE ON public.kebele_rental_house TO anon;
GRANT DELETE ON public.kebele_rental_house TO authenticated;
GRANT INSERT ON public.kebele_rental_house TO authenticated;
GRANT REFERENCES ON public.kebele_rental_house TO authenticated;
GRANT SELECT ON public.kebele_rental_house TO authenticated;
GRANT TRIGGER ON public.kebele_rental_house TO authenticated;
GRANT TRUNCATE ON public.kebele_rental_house TO authenticated;
GRANT UPDATE ON public.kebele_rental_house TO authenticated;
GRANT DELETE ON public.kebele_rental_house TO service_role;
GRANT INSERT ON public.kebele_rental_house TO service_role;
GRANT REFERENCES ON public.kebele_rental_house TO service_role;
GRANT SELECT ON public.kebele_rental_house TO service_role;
GRANT TRIGGER ON public.kebele_rental_house TO service_role;
GRANT TRUNCATE ON public.kebele_rental_house TO service_role;
GRANT UPDATE ON public.kebele_rental_house TO service_role;
GRANT DELETE ON public.kebele TO anon;
GRANT INSERT ON public.kebele TO anon;
GRANT REFERENCES ON public.kebele TO anon;
GRANT SELECT ON public.kebele TO anon;
GRANT TRIGGER ON public.kebele TO anon;
GRANT TRUNCATE ON public.kebele TO anon;
GRANT UPDATE ON public.kebele TO anon;
GRANT DELETE ON public.kebele TO authenticated;
GRANT INSERT ON public.kebele TO authenticated;
GRANT REFERENCES ON public.kebele TO authenticated;
GRANT SELECT ON public.kebele TO authenticated;
GRANT TRIGGER ON public.kebele TO authenticated;
GRANT TRUNCATE ON public.kebele TO authenticated;
GRANT UPDATE ON public.kebele TO authenticated;
GRANT DELETE ON public.kebele TO service_role;
GRANT INSERT ON public.kebele TO service_role;
GRANT REFERENCES ON public.kebele TO service_role;
GRANT SELECT ON public.kebele TO service_role;
GRANT TRIGGER ON public.kebele TO service_role;
GRANT TRUNCATE ON public.kebele TO service_role;
GRANT UPDATE ON public.kebele TO service_role;
GRANT DELETE ON public.payment TO anon;
GRANT INSERT ON public.payment TO anon;
GRANT REFERENCES ON public.payment TO anon;
GRANT SELECT ON public.payment TO anon;
GRANT TRIGGER ON public.payment TO anon;
GRANT TRUNCATE ON public.payment TO anon;
GRANT UPDATE ON public.payment TO anon;
GRANT DELETE ON public.payment TO authenticated;
GRANT INSERT ON public.payment TO authenticated;
GRANT REFERENCES ON public.payment TO authenticated;
GRANT SELECT ON public.payment TO authenticated;
GRANT TRIGGER ON public.payment TO authenticated;
GRANT TRUNCATE ON public.payment TO authenticated;
GRANT UPDATE ON public.payment TO authenticated;
GRANT DELETE ON public.payment TO service_role;
GRANT INSERT ON public.payment TO service_role;
GRANT REFERENCES ON public.payment TO service_role;
GRANT SELECT ON public.payment TO service_role;
GRANT TRIGGER ON public.payment TO service_role;
GRANT TRUNCATE ON public.payment TO service_role;
GRANT UPDATE ON public.payment TO service_role;
GRANT DELETE ON public.receipt_sequence TO anon;
GRANT INSERT ON public.receipt_sequence TO anon;
GRANT REFERENCES ON public.receipt_sequence TO anon;
GRANT SELECT ON public.receipt_sequence TO anon;
GRANT TRIGGER ON public.receipt_sequence TO anon;
GRANT TRUNCATE ON public.receipt_sequence TO anon;
GRANT UPDATE ON public.receipt_sequence TO anon;
GRANT DELETE ON public.receipt_sequence TO authenticated;
GRANT INSERT ON public.receipt_sequence TO authenticated;
GRANT REFERENCES ON public.receipt_sequence TO authenticated;
GRANT SELECT ON public.receipt_sequence TO authenticated;
GRANT TRIGGER ON public.receipt_sequence TO authenticated;
GRANT TRUNCATE ON public.receipt_sequence TO authenticated;
GRANT UPDATE ON public.receipt_sequence TO authenticated;
GRANT DELETE ON public.receipt_sequence TO service_role;
GRANT INSERT ON public.receipt_sequence TO service_role;
GRANT REFERENCES ON public.receipt_sequence TO service_role;
GRANT SELECT ON public.receipt_sequence TO service_role;
GRANT TRIGGER ON public.receipt_sequence TO service_role;
GRANT TRUNCATE ON public.receipt_sequence TO service_role;
GRANT UPDATE ON public.receipt_sequence TO service_role;
GRANT DELETE ON public.receipt TO anon;
GRANT INSERT ON public.receipt TO anon;
GRANT REFERENCES ON public.receipt TO anon;
GRANT SELECT ON public.receipt TO anon;
GRANT TRIGGER ON public.receipt TO anon;
GRANT TRUNCATE ON public.receipt TO anon;
GRANT UPDATE ON public.receipt TO anon;
GRANT DELETE ON public.receipt TO authenticated;
GRANT INSERT ON public.receipt TO authenticated;
GRANT REFERENCES ON public.receipt TO authenticated;
GRANT SELECT ON public.receipt TO authenticated;
GRANT TRIGGER ON public.receipt TO authenticated;
GRANT TRUNCATE ON public.receipt TO authenticated;
GRANT UPDATE ON public.receipt TO authenticated;
GRANT DELETE ON public.receipt TO service_role;
GRANT INSERT ON public.receipt TO service_role;
GRANT REFERENCES ON public.receipt TO service_role;
GRANT SELECT ON public.receipt TO service_role;
GRANT TRIGGER ON public.receipt TO service_role;
GRANT TRUNCATE ON public.receipt TO service_role;
GRANT UPDATE ON public.receipt TO service_role;
GRANT DELETE ON public.rental_occupancy_request TO anon;
GRANT INSERT ON public.rental_occupancy_request TO anon;
GRANT REFERENCES ON public.rental_occupancy_request TO anon;
GRANT SELECT ON public.rental_occupancy_request TO anon;
GRANT TRIGGER ON public.rental_occupancy_request TO anon;
GRANT TRUNCATE ON public.rental_occupancy_request TO anon;
GRANT UPDATE ON public.rental_occupancy_request TO anon;
GRANT DELETE ON public.rental_occupancy_request TO authenticated;
GRANT INSERT ON public.rental_occupancy_request TO authenticated;
GRANT REFERENCES ON public.rental_occupancy_request TO authenticated;
GRANT SELECT ON public.rental_occupancy_request TO authenticated;
GRANT TRIGGER ON public.rental_occupancy_request TO authenticated;
GRANT TRUNCATE ON public.rental_occupancy_request TO authenticated;
GRANT UPDATE ON public.rental_occupancy_request TO authenticated;
GRANT DELETE ON public.rental_occupancy_request TO service_role;
GRANT INSERT ON public.rental_occupancy_request TO service_role;
GRANT REFERENCES ON public.rental_occupancy_request TO service_role;
GRANT SELECT ON public.rental_occupancy_request TO service_role;
GRANT TRIGGER ON public.rental_occupancy_request TO service_role;
GRANT TRUNCATE ON public.rental_occupancy_request TO service_role;
GRANT UPDATE ON public.rental_occupancy_request TO service_role;
GRANT DELETE ON public.rental_occupancy TO anon;
GRANT INSERT ON public.rental_occupancy TO anon;
GRANT REFERENCES ON public.rental_occupancy TO anon;
GRANT SELECT ON public.rental_occupancy TO anon;
GRANT TRIGGER ON public.rental_occupancy TO anon;
GRANT TRUNCATE ON public.rental_occupancy TO anon;
GRANT UPDATE ON public.rental_occupancy TO anon;
GRANT DELETE ON public.rental_occupancy TO authenticated;
GRANT INSERT ON public.rental_occupancy TO authenticated;
GRANT REFERENCES ON public.rental_occupancy TO authenticated;
GRANT SELECT ON public.rental_occupancy TO authenticated;
GRANT TRIGGER ON public.rental_occupancy TO authenticated;
GRANT TRUNCATE ON public.rental_occupancy TO authenticated;
GRANT UPDATE ON public.rental_occupancy TO authenticated;
GRANT DELETE ON public.rental_occupancy TO service_role;
GRANT INSERT ON public.rental_occupancy TO service_role;
GRANT REFERENCES ON public.rental_occupancy TO service_role;
GRANT SELECT ON public.rental_occupancy TO service_role;
GRANT TRIGGER ON public.rental_occupancy TO service_role;
GRANT TRUNCATE ON public.rental_occupancy TO service_role;
GRANT UPDATE ON public.rental_occupancy TO service_role;
GRANT DELETE ON public.rental_request_document TO anon;
GRANT INSERT ON public.rental_request_document TO anon;
GRANT REFERENCES ON public.rental_request_document TO anon;
GRANT SELECT ON public.rental_request_document TO anon;
GRANT TRIGGER ON public.rental_request_document TO anon;
GRANT TRUNCATE ON public.rental_request_document TO anon;
GRANT UPDATE ON public.rental_request_document TO anon;
GRANT DELETE ON public.rental_request_document TO authenticated;
GRANT INSERT ON public.rental_request_document TO authenticated;
GRANT REFERENCES ON public.rental_request_document TO authenticated;
GRANT SELECT ON public.rental_request_document TO authenticated;
GRANT TRIGGER ON public.rental_request_document TO authenticated;
GRANT TRUNCATE ON public.rental_request_document TO authenticated;
GRANT UPDATE ON public.rental_request_document TO authenticated;
GRANT DELETE ON public.rental_request_document TO service_role;
GRANT INSERT ON public.rental_request_document TO service_role;
GRANT REFERENCES ON public.rental_request_document TO service_role;
GRANT SELECT ON public.rental_request_document TO service_role;
GRANT TRIGGER ON public.rental_request_document TO service_role;
GRANT TRUNCATE ON public.rental_request_document TO service_role;
GRANT UPDATE ON public.rental_request_document TO service_role;
GRANT DELETE ON public.rental_request_sequence TO anon;
GRANT INSERT ON public.rental_request_sequence TO anon;
GRANT REFERENCES ON public.rental_request_sequence TO anon;
GRANT SELECT ON public.rental_request_sequence TO anon;
GRANT TRIGGER ON public.rental_request_sequence TO anon;
GRANT TRUNCATE ON public.rental_request_sequence TO anon;
GRANT UPDATE ON public.rental_request_sequence TO anon;
GRANT DELETE ON public.rental_request_sequence TO authenticated;
GRANT INSERT ON public.rental_request_sequence TO authenticated;
GRANT REFERENCES ON public.rental_request_sequence TO authenticated;
GRANT SELECT ON public.rental_request_sequence TO authenticated;
GRANT TRIGGER ON public.rental_request_sequence TO authenticated;
GRANT TRUNCATE ON public.rental_request_sequence TO authenticated;
GRANT UPDATE ON public.rental_request_sequence TO authenticated;
GRANT DELETE ON public.rental_request_sequence TO service_role;
GRANT INSERT ON public.rental_request_sequence TO service_role;
GRANT REFERENCES ON public.rental_request_sequence TO service_role;
GRANT SELECT ON public.rental_request_sequence TO service_role;
GRANT TRIGGER ON public.rental_request_sequence TO service_role;
GRANT TRUNCATE ON public.rental_request_sequence TO service_role;
GRANT UPDATE ON public.rental_request_sequence TO service_role;
GRANT DELETE ON public.residence_credential TO anon;
GRANT INSERT ON public.residence_credential TO anon;
GRANT REFERENCES ON public.residence_credential TO anon;
GRANT SELECT ON public.residence_credential TO anon;
GRANT TRIGGER ON public.residence_credential TO anon;
GRANT TRUNCATE ON public.residence_credential TO anon;
GRANT UPDATE ON public.residence_credential TO anon;
GRANT DELETE ON public.residence_credential TO authenticated;
GRANT INSERT ON public.residence_credential TO authenticated;
GRANT REFERENCES ON public.residence_credential TO authenticated;
GRANT SELECT ON public.residence_credential TO authenticated;
GRANT TRIGGER ON public.residence_credential TO authenticated;
GRANT TRUNCATE ON public.residence_credential TO authenticated;
GRANT UPDATE ON public.residence_credential TO authenticated;
GRANT DELETE ON public.residence_credential TO service_role;
GRANT INSERT ON public.residence_credential TO service_role;
GRANT REFERENCES ON public.residence_credential TO service_role;
GRANT SELECT ON public.residence_credential TO service_role;
GRANT TRIGGER ON public.residence_credential TO service_role;
GRANT TRUNCATE ON public.residence_credential TO service_role;
GRANT UPDATE ON public.residence_credential TO service_role;
GRANT DELETE ON public.resident_number_sequence TO anon;
GRANT INSERT ON public.resident_number_sequence TO anon;
GRANT REFERENCES ON public.resident_number_sequence TO anon;
GRANT SELECT ON public.resident_number_sequence TO anon;
GRANT TRIGGER ON public.resident_number_sequence TO anon;
GRANT TRUNCATE ON public.resident_number_sequence TO anon;
GRANT UPDATE ON public.resident_number_sequence TO anon;
GRANT DELETE ON public.resident_number_sequence TO authenticated;
GRANT INSERT ON public.resident_number_sequence TO authenticated;
GRANT REFERENCES ON public.resident_number_sequence TO authenticated;
GRANT SELECT ON public.resident_number_sequence TO authenticated;
GRANT TRIGGER ON public.resident_number_sequence TO authenticated;
GRANT TRUNCATE ON public.resident_number_sequence TO authenticated;
GRANT UPDATE ON public.resident_number_sequence TO authenticated;
GRANT DELETE ON public.resident_number_sequence TO service_role;
GRANT INSERT ON public.resident_number_sequence TO service_role;
GRANT REFERENCES ON public.resident_number_sequence TO service_role;
GRANT SELECT ON public.resident_number_sequence TO service_role;
GRANT TRIGGER ON public.resident_number_sequence TO service_role;
GRANT TRUNCATE ON public.resident_number_sequence TO service_role;
GRANT UPDATE ON public.resident_number_sequence TO service_role;
GRANT DELETE ON public.resident TO anon;
GRANT INSERT ON public.resident TO anon;
GRANT REFERENCES ON public.resident TO anon;
GRANT SELECT ON public.resident TO anon;
GRANT TRIGGER ON public.resident TO anon;
GRANT TRUNCATE ON public.resident TO anon;
GRANT UPDATE ON public.resident TO anon;
GRANT DELETE ON public.resident TO authenticated;
GRANT INSERT ON public.resident TO authenticated;
GRANT REFERENCES ON public.resident TO authenticated;
GRANT SELECT ON public.resident TO authenticated;
GRANT TRIGGER ON public.resident TO authenticated;
GRANT TRUNCATE ON public.resident TO authenticated;
GRANT UPDATE ON public.resident TO authenticated;
GRANT DELETE ON public.resident TO service_role;
GRANT INSERT ON public.resident TO service_role;
GRANT REFERENCES ON public.resident TO service_role;
GRANT SELECT ON public.resident TO service_role;
GRANT TRIGGER ON public.resident TO service_role;
GRANT TRUNCATE ON public.resident TO service_role;
GRANT UPDATE ON public.resident TO service_role;
GRANT DELETE ON public.role_permission TO anon;
GRANT INSERT ON public.role_permission TO anon;
GRANT REFERENCES ON public.role_permission TO anon;
GRANT SELECT ON public.role_permission TO anon;
GRANT TRIGGER ON public.role_permission TO anon;
GRANT TRUNCATE ON public.role_permission TO anon;
GRANT UPDATE ON public.role_permission TO anon;
GRANT DELETE ON public.role_permission TO authenticated;
GRANT INSERT ON public.role_permission TO authenticated;
GRANT REFERENCES ON public.role_permission TO authenticated;
GRANT SELECT ON public.role_permission TO authenticated;
GRANT TRIGGER ON public.role_permission TO authenticated;
GRANT TRUNCATE ON public.role_permission TO authenticated;
GRANT UPDATE ON public.role_permission TO authenticated;
GRANT DELETE ON public.role_permission TO service_role;
GRANT INSERT ON public.role_permission TO service_role;
GRANT REFERENCES ON public.role_permission TO service_role;
GRANT SELECT ON public.role_permission TO service_role;
GRANT TRIGGER ON public.role_permission TO service_role;
GRANT TRUNCATE ON public.role_permission TO service_role;
GRANT UPDATE ON public.role_permission TO service_role;
GRANT DELETE ON public.service_request_attachment TO anon;
GRANT INSERT ON public.service_request_attachment TO anon;
GRANT REFERENCES ON public.service_request_attachment TO anon;
GRANT SELECT ON public.service_request_attachment TO anon;
GRANT TRIGGER ON public.service_request_attachment TO anon;
GRANT TRUNCATE ON public.service_request_attachment TO anon;
GRANT UPDATE ON public.service_request_attachment TO anon;
GRANT DELETE ON public.service_request_attachment TO authenticated;
GRANT INSERT ON public.service_request_attachment TO authenticated;
GRANT REFERENCES ON public.service_request_attachment TO authenticated;
GRANT SELECT ON public.service_request_attachment TO authenticated;
GRANT TRIGGER ON public.service_request_attachment TO authenticated;
GRANT TRUNCATE ON public.service_request_attachment TO authenticated;
GRANT UPDATE ON public.service_request_attachment TO authenticated;
GRANT DELETE ON public.service_request_attachment TO service_role;
GRANT INSERT ON public.service_request_attachment TO service_role;
GRANT REFERENCES ON public.service_request_attachment TO service_role;
GRANT SELECT ON public.service_request_attachment TO service_role;
GRANT TRIGGER ON public.service_request_attachment TO service_role;
GRANT TRUNCATE ON public.service_request_attachment TO service_role;
GRANT UPDATE ON public.service_request_attachment TO service_role;
GRANT DELETE ON public.service_request_sequence TO anon;
GRANT INSERT ON public.service_request_sequence TO anon;
GRANT REFERENCES ON public.service_request_sequence TO anon;
GRANT SELECT ON public.service_request_sequence TO anon;
GRANT TRIGGER ON public.service_request_sequence TO anon;
GRANT TRUNCATE ON public.service_request_sequence TO anon;
GRANT UPDATE ON public.service_request_sequence TO anon;
GRANT DELETE ON public.service_request_sequence TO authenticated;
GRANT INSERT ON public.service_request_sequence TO authenticated;
GRANT REFERENCES ON public.service_request_sequence TO authenticated;
GRANT SELECT ON public.service_request_sequence TO authenticated;
GRANT TRIGGER ON public.service_request_sequence TO authenticated;
GRANT TRUNCATE ON public.service_request_sequence TO authenticated;
GRANT UPDATE ON public.service_request_sequence TO authenticated;
GRANT DELETE ON public.service_request_sequence TO service_role;
GRANT INSERT ON public.service_request_sequence TO service_role;
GRANT REFERENCES ON public.service_request_sequence TO service_role;
GRANT SELECT ON public.service_request_sequence TO service_role;
GRANT TRIGGER ON public.service_request_sequence TO service_role;
GRANT TRUNCATE ON public.service_request_sequence TO service_role;
GRANT UPDATE ON public.service_request_sequence TO service_role;
GRANT DELETE ON public.service_request_status_history TO anon;
GRANT INSERT ON public.service_request_status_history TO anon;
GRANT REFERENCES ON public.service_request_status_history TO anon;
GRANT SELECT ON public.service_request_status_history TO anon;
GRANT TRIGGER ON public.service_request_status_history TO anon;
GRANT TRUNCATE ON public.service_request_status_history TO anon;
GRANT UPDATE ON public.service_request_status_history TO anon;
GRANT DELETE ON public.service_request_status_history TO authenticated;
GRANT INSERT ON public.service_request_status_history TO authenticated;
GRANT REFERENCES ON public.service_request_status_history TO authenticated;
GRANT SELECT ON public.service_request_status_history TO authenticated;
GRANT TRIGGER ON public.service_request_status_history TO authenticated;
GRANT TRUNCATE ON public.service_request_status_history TO authenticated;
GRANT UPDATE ON public.service_request_status_history TO authenticated;
GRANT DELETE ON public.service_request_status_history TO service_role;
GRANT INSERT ON public.service_request_status_history TO service_role;
GRANT REFERENCES ON public.service_request_status_history TO service_role;
GRANT SELECT ON public.service_request_status_history TO service_role;
GRANT TRIGGER ON public.service_request_status_history TO service_role;
GRANT TRUNCATE ON public.service_request_status_history TO service_role;
GRANT UPDATE ON public.service_request_status_history TO service_role;
GRANT DELETE ON public.service_request TO anon;
GRANT INSERT ON public.service_request TO anon;
GRANT REFERENCES ON public.service_request TO anon;
GRANT SELECT ON public.service_request TO anon;
GRANT TRIGGER ON public.service_request TO anon;
GRANT TRUNCATE ON public.service_request TO anon;
GRANT UPDATE ON public.service_request TO anon;
GRANT DELETE ON public.service_request TO authenticated;
GRANT INSERT ON public.service_request TO authenticated;
GRANT REFERENCES ON public.service_request TO authenticated;
GRANT SELECT ON public.service_request TO authenticated;
GRANT TRIGGER ON public.service_request TO authenticated;
GRANT TRUNCATE ON public.service_request TO authenticated;
GRANT UPDATE ON public.service_request TO authenticated;
GRANT DELETE ON public.service_request TO service_role;
GRANT INSERT ON public.service_request TO service_role;
GRANT REFERENCES ON public.service_request TO service_role;
GRANT SELECT ON public.service_request TO service_role;
GRANT TRIGGER ON public.service_request TO service_role;
GRANT TRUNCATE ON public.service_request TO service_role;
GRANT UPDATE ON public.service_request TO service_role;
GRANT DELETE ON public.service_type TO anon;
GRANT INSERT ON public.service_type TO anon;
GRANT REFERENCES ON public.service_type TO anon;
GRANT SELECT ON public.service_type TO anon;
GRANT TRIGGER ON public.service_type TO anon;
GRANT TRUNCATE ON public.service_type TO anon;
GRANT UPDATE ON public.service_type TO anon;
GRANT DELETE ON public.service_type TO authenticated;
GRANT INSERT ON public.service_type TO authenticated;
GRANT REFERENCES ON public.service_type TO authenticated;
GRANT SELECT ON public.service_type TO authenticated;
GRANT TRIGGER ON public.service_type TO authenticated;
GRANT TRUNCATE ON public.service_type TO authenticated;
GRANT UPDATE ON public.service_type TO authenticated;
GRANT DELETE ON public.service_type TO service_role;
GRANT INSERT ON public.service_type TO service_role;
GRANT REFERENCES ON public.service_type TO service_role;
GRANT SELECT ON public.service_type TO service_role;
GRANT TRIGGER ON public.service_type TO service_role;
GRANT TRUNCATE ON public.service_type TO service_role;
GRANT UPDATE ON public.service_type TO service_role;
GRANT DELETE ON public.tenant_module_config TO anon;
GRANT INSERT ON public.tenant_module_config TO anon;
GRANT REFERENCES ON public.tenant_module_config TO anon;
GRANT SELECT ON public.tenant_module_config TO anon;
GRANT TRIGGER ON public.tenant_module_config TO anon;
GRANT TRUNCATE ON public.tenant_module_config TO anon;
GRANT UPDATE ON public.tenant_module_config TO anon;
GRANT DELETE ON public.tenant_module_config TO authenticated;
GRANT INSERT ON public.tenant_module_config TO authenticated;
GRANT REFERENCES ON public.tenant_module_config TO authenticated;
GRANT SELECT ON public.tenant_module_config TO authenticated;
GRANT TRIGGER ON public.tenant_module_config TO authenticated;
GRANT TRUNCATE ON public.tenant_module_config TO authenticated;
GRANT UPDATE ON public.tenant_module_config TO authenticated;
GRANT DELETE ON public.tenant_module_config TO service_role;
GRANT INSERT ON public.tenant_module_config TO service_role;
GRANT REFERENCES ON public.tenant_module_config TO service_role;
GRANT SELECT ON public.tenant_module_config TO service_role;
GRANT TRIGGER ON public.tenant_module_config TO service_role;
GRANT TRUNCATE ON public.tenant_module_config TO service_role;
GRANT UPDATE ON public.tenant_module_config TO service_role;
GRANT DELETE ON public.vital_event_sequence TO anon;
GRANT INSERT ON public.vital_event_sequence TO anon;
GRANT REFERENCES ON public.vital_event_sequence TO anon;
GRANT SELECT ON public.vital_event_sequence TO anon;
GRANT TRIGGER ON public.vital_event_sequence TO anon;
GRANT TRUNCATE ON public.vital_event_sequence TO anon;
GRANT UPDATE ON public.vital_event_sequence TO anon;
GRANT DELETE ON public.vital_event_sequence TO authenticated;
GRANT INSERT ON public.vital_event_sequence TO authenticated;
GRANT REFERENCES ON public.vital_event_sequence TO authenticated;
GRANT SELECT ON public.vital_event_sequence TO authenticated;
GRANT TRIGGER ON public.vital_event_sequence TO authenticated;
GRANT TRUNCATE ON public.vital_event_sequence TO authenticated;
GRANT UPDATE ON public.vital_event_sequence TO authenticated;
GRANT DELETE ON public.vital_event_sequence TO service_role;
GRANT INSERT ON public.vital_event_sequence TO service_role;
GRANT REFERENCES ON public.vital_event_sequence TO service_role;
GRANT SELECT ON public.vital_event_sequence TO service_role;
GRANT TRIGGER ON public.vital_event_sequence TO service_role;
GRANT TRUNCATE ON public.vital_event_sequence TO service_role;
GRANT UPDATE ON public.vital_event_sequence TO service_role;
GRANT DELETE ON public.vital_event TO anon;
GRANT INSERT ON public.vital_event TO anon;
GRANT REFERENCES ON public.vital_event TO anon;
GRANT SELECT ON public.vital_event TO anon;
GRANT TRIGGER ON public.vital_event TO anon;
GRANT TRUNCATE ON public.vital_event TO anon;
GRANT UPDATE ON public.vital_event TO anon;
GRANT DELETE ON public.vital_event TO authenticated;
GRANT INSERT ON public.vital_event TO authenticated;
GRANT REFERENCES ON public.vital_event TO authenticated;
GRANT SELECT ON public.vital_event TO authenticated;
GRANT TRIGGER ON public.vital_event TO authenticated;
GRANT TRUNCATE ON public.vital_event TO authenticated;
GRANT UPDATE ON public.vital_event TO authenticated;
GRANT DELETE ON public.vital_event TO service_role;
GRANT INSERT ON public.vital_event TO service_role;
GRANT REFERENCES ON public.vital_event TO service_role;
GRANT SELECT ON public.vital_event TO service_role;
GRANT TRIGGER ON public.vital_event TO service_role;
GRANT TRUNCATE ON public.vital_event TO service_role;
GRANT UPDATE ON public.vital_event TO service_role;
GRANT DELETE ON public.woreda_settings TO anon;
GRANT INSERT ON public.woreda_settings TO anon;
GRANT REFERENCES ON public.woreda_settings TO anon;
GRANT SELECT ON public.woreda_settings TO anon;
GRANT TRIGGER ON public.woreda_settings TO anon;
GRANT TRUNCATE ON public.woreda_settings TO anon;
GRANT UPDATE ON public.woreda_settings TO anon;
GRANT DELETE ON public.woreda_settings TO authenticated;
GRANT INSERT ON public.woreda_settings TO authenticated;
GRANT REFERENCES ON public.woreda_settings TO authenticated;
GRANT SELECT ON public.woreda_settings TO authenticated;
GRANT TRIGGER ON public.woreda_settings TO authenticated;
GRANT TRUNCATE ON public.woreda_settings TO authenticated;
GRANT UPDATE ON public.woreda_settings TO authenticated;
GRANT DELETE ON public.woreda_settings TO service_role;
GRANT INSERT ON public.woreda_settings TO service_role;
GRANT REFERENCES ON public.woreda_settings TO service_role;
GRANT SELECT ON public.woreda_settings TO service_role;
GRANT TRIGGER ON public.woreda_settings TO service_role;
GRANT TRUNCATE ON public.woreda_settings TO service_role;
GRANT UPDATE ON public.woreda_settings TO service_role;
GRANT DELETE ON public.woreda TO anon;
GRANT INSERT ON public.woreda TO anon;
GRANT REFERENCES ON public.woreda TO anon;
GRANT SELECT ON public.woreda TO anon;
GRANT TRIGGER ON public.woreda TO anon;
GRANT TRUNCATE ON public.woreda TO anon;
GRANT UPDATE ON public.woreda TO anon;
GRANT DELETE ON public.woreda TO authenticated;
GRANT INSERT ON public.woreda TO authenticated;
GRANT REFERENCES ON public.woreda TO authenticated;
GRANT SELECT ON public.woreda TO authenticated;
GRANT TRIGGER ON public.woreda TO authenticated;
GRANT TRUNCATE ON public.woreda TO authenticated;
GRANT UPDATE ON public.woreda TO authenticated;
GRANT DELETE ON public.woreda TO service_role;
GRANT INSERT ON public.woreda TO service_role;
GRANT REFERENCES ON public.woreda TO service_role;
GRANT SELECT ON public.woreda TO service_role;
GRANT TRIGGER ON public.woreda TO service_role;
GRANT TRUNCATE ON public.woreda TO service_role;
GRANT UPDATE ON public.woreda TO service_role;
