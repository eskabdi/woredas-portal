export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_user: {
        Row: {
          console_role_id: string | null
          created_at: string
          custom_role_id: string | null
          department: string | null
          full_name: string
          invited_at: string | null
          invited_by_user_id: string | null
          job_title: string | null
          last_login_at: string | null
          photo_path: string | null
          reports_to_user_id: string | null
          role: string
          signature_path: string | null
          status: string
          updated_at: string
          user_id: string
          username: string
          woreda_id: string | null
        }
        Insert: {
          console_role_id?: string | null
          created_at?: string
          custom_role_id?: string | null
          department?: string | null
          full_name: string
          invited_at?: string | null
          invited_by_user_id?: string | null
          job_title?: string | null
          last_login_at?: string | null
          photo_path?: string | null
          reports_to_user_id?: string | null
          role: string
          signature_path?: string | null
          status?: string
          updated_at?: string
          user_id: string
          username: string
          woreda_id?: string | null
        }
        Update: {
          console_role_id?: string | null
          created_at?: string
          custom_role_id?: string | null
          department?: string | null
          full_name?: string
          invited_at?: string | null
          invited_by_user_id?: string | null
          job_title?: string | null
          last_login_at?: string | null
          photo_path?: string | null
          reports_to_user_id?: string | null
          role?: string
          signature_path?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          username?: string
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_user_console_role_id_fkey"
            columns: ["console_role_id"]
            isOneToOne: false
            referencedRelation: "console_role"
            referencedColumns: ["console_role_id"]
          },
          {
            foreignKeyName: "app_user_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "tenant_role"
            referencedColumns: ["tenant_role_id"]
          },
          {
            foreignKeyName: "app_user_invited_by_user_id_fkey"
            columns: ["invited_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "app_user_reports_to_user_id_fkey"
            columns: ["reports_to_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "app_user_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      approval: {
        Row: {
          approval_id: string
          approver_user_id: string | null
          decision: string
          decision_at: string
          entity: string
          entity_id: string
          reason: string | null
          stage_no: number
          woreda_id: string
        }
        Insert: {
          approval_id?: string
          approver_user_id?: string | null
          decision: string
          decision_at?: string
          entity: string
          entity_id: string
          reason?: string | null
          stage_no: number
          woreda_id: string
        }
        Update: {
          approval_id?: string
          approver_user_id?: string | null
          decision?: string
          decision_at?: string
          entity?: string
          entity_id?: string
          reason?: string | null
          stage_no?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_approver_user_id_fkey"
            columns: ["approver_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "approval_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      arrears_installment_charge: {
        Row: {
          charge_amount_snapshot: number
          charge_amount_snapshot_enc: string | null
          created_at: string
          installment_id: string
          mapping_id: string
          rent_charge_id: string
          status: string
          woreda_id: string
        }
        Insert: {
          charge_amount_snapshot: number
          charge_amount_snapshot_enc?: string | null
          created_at?: string
          installment_id: string
          mapping_id?: string
          rent_charge_id: string
          status?: string
          woreda_id: string
        }
        Update: {
          charge_amount_snapshot?: number
          charge_amount_snapshot_enc?: string | null
          created_at?: string
          installment_id?: string
          mapping_id?: string
          rent_charge_id?: string
          status?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arrears_installment_charge_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_installment"
            referencedColumns: ["installment_id"]
          },
          {
            foreignKeyName: "arrears_installment_charge_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_installment_decrypted"
            referencedColumns: ["installment_id"]
          },
          {
            foreignKeyName: "arrears_installment_charge_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charge"
            referencedColumns: ["rent_charge_id"]
          },
          {
            foreignKeyName: "arrears_installment_charge_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charge_decrypted"
            referencedColumns: ["rent_charge_id"]
          },
          {
            foreignKeyName: "arrears_installment_charge_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      arrears_plan_sequence: {
        Row: {
          last_value: number
          seq_year: number
          woreda_id: string
        }
        Insert: {
          last_value?: number
          seq_year: number
          woreda_id: string
        }
        Update: {
          last_value?: number
          seq_year?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arrears_plan_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      arrears_repayment_installment: {
        Row: {
          amount: number
          amount_enc: string | null
          due_date: string
          installment_id: string
          installment_number: number
          plan_id: string
          settled_at: string | null
          settled_by_payment_id: string | null
          status: string
          woreda_id: string
        }
        Insert: {
          amount: number
          amount_enc?: string | null
          due_date: string
          installment_id?: string
          installment_number: number
          plan_id: string
          settled_at?: string | null
          settled_by_payment_id?: string | null
          status?: string
          woreda_id: string
        }
        Update: {
          amount?: number
          amount_enc?: string | null
          due_date?: string
          installment_id?: string
          installment_number?: number
          plan_id?: string
          settled_at?: string | null
          settled_by_payment_id?: string | null
          status?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arrears_repayment_installment_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_plan"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "arrears_repayment_installment_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_plan_decrypted"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "arrears_repayment_installment_settled_by_payment_id_fkey"
            columns: ["settled_by_payment_id"]
            isOneToOne: false
            referencedRelation: "rental_payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "arrears_repayment_installment_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      arrears_repayment_plan: {
        Row: {
          approval_decision_at: string | null
          approved_by_user_id: string | null
          assigned_arrears_amount: number
          assigned_arrears_amount_enc: string | null
          created_at: string
          installment_count: number
          original_arrears_amount: number
          original_arrears_amount_enc: string | null
          plan_id: string
          plan_number: string
          reason: string | null
          rent_account_id: string
          requested_by_user_id: string | null
          resident_id: string
          return_reason: string | null
          status: string
          updated_at: string
          woreda_id: string
        }
        Insert: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          assigned_arrears_amount: number
          assigned_arrears_amount_enc?: string | null
          created_at?: string
          installment_count: number
          original_arrears_amount: number
          original_arrears_amount_enc?: string | null
          plan_id?: string
          plan_number: string
          reason?: string | null
          rent_account_id: string
          requested_by_user_id?: string | null
          resident_id: string
          return_reason?: string | null
          status?: string
          updated_at?: string
          woreda_id: string
        }
        Update: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          assigned_arrears_amount?: number
          assigned_arrears_amount_enc?: string | null
          created_at?: string
          installment_count?: number
          original_arrears_amount?: number
          original_arrears_amount_enc?: string | null
          plan_id?: string
          plan_number?: string
          reason?: string | null
          rent_account_id?: string
          requested_by_user_id?: string | null
          resident_id?: string
          return_reason?: string | null
          status?: string
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arrears_repayment_plan_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      attachment: {
        Row: {
          attachment_id: string
          attachment_type: string | null
          checksum: string
          entity: string
          entity_id: string
          file_name: string
          mime: string
          size_bytes: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
          woreda_id: string
        }
        Insert: {
          attachment_id?: string
          attachment_type?: string | null
          checksum: string
          entity: string
          entity_id: string
          file_name: string
          mime: string
          size_bytes: number
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
          woreda_id: string
        }
        Update: {
          attachment_id?: string
          attachment_type?: string | null
          checksum?: string
          entity?: string
          entity_id?: string
          file_name?: string
          mime?: string
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attachment_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action_at: string
          action_type: string
          actor_user_id: string | null
          audit_log_id: string
          entity_id: string | null
          entity_name: string
          new_value_json: Json | null
          old_value_json: Json | null
          source_ip: string | null
          woreda_id: string | null
        }
        Insert: {
          action_at?: string
          action_type: string
          actor_user_id?: string | null
          audit_log_id?: string
          entity_id?: string | null
          entity_name: string
          new_value_json?: Json | null
          old_value_json?: Json | null
          source_ip?: string | null
          woreda_id?: string | null
        }
        Update: {
          action_at?: string
          action_type?: string
          actor_user_id?: string | null
          audit_log_id?: string
          entity_id?: string | null
          entity_name?: string
          new_value_json?: Json | null
          old_value_json?: Json | null
          source_ip?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_log_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      console_role: {
        Row: {
          console_role_id: string
          created_at: string
          description: string | null
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          console_role_id?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          console_role_id?: string
          created_at?: string
          description?: string | null
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "console_role_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
        ]
      }
      console_role_permission: {
        Row: {
          console_role_id: string
          is_granted: boolean
          permission_key: string
          updated_at: string
        }
        Insert: {
          console_role_id: string
          is_granted?: boolean
          permission_key: string
          updated_at?: string
        }
        Update: {
          console_role_id?: string
          is_granted?: boolean
          permission_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "console_role_permission_console_role_id_fkey"
            columns: ["console_role_id"]
            isOneToOne: false
            referencedRelation: "console_role"
            referencedColumns: ["console_role_id"]
          },
        ]
      }
      credential_number_sequence: {
        Row: {
          last_value: number
          seq_year: number
          woreda_id: string
        }
        Insert: {
          last_value?: number
          seq_year: number
          woreda_id: string
        }
        Update: {
          last_value?: number
          seq_year?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_number_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      credential_policy: {
        Row: {
          created_at: string
          credential_policy_id: string
          enabled_request_types: string[]
          expiry_months: number | null
          max_reissue_count: number | null
          renewal_window_days: number | null
          updated_at: string
          updated_by: string | null
          woreda_id: string
        }
        Insert: {
          created_at?: string
          credential_policy_id?: string
          enabled_request_types?: string[]
          expiry_months?: number | null
          max_reissue_count?: number | null
          renewal_window_days?: number | null
          updated_at?: string
          updated_by?: string | null
          woreda_id: string
        }
        Update: {
          created_at?: string
          credential_policy_id?: string
          enabled_request_types?: string[]
          expiry_months?: number | null
          max_reissue_count?: number | null
          renewal_window_days?: number | null
          updated_at?: string
          updated_by?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_policy_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_policy_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: true
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      credential_print_log: {
        Row: {
          copies_count: number
          credential_id: string
          credential_print_log_id: string
          is_reprint: boolean
          print_reason: string
          print_type: string
          printed_at: string
          printed_by_user_id: string | null
          printer_name: string | null
          reprint_authorized_by_user_id: string | null
          reprint_reason: string | null
          woreda_id: string
        }
        Insert: {
          copies_count?: number
          credential_id: string
          credential_print_log_id?: string
          is_reprint?: boolean
          print_reason: string
          print_type: string
          printed_at?: string
          printed_by_user_id?: string | null
          printer_name?: string | null
          reprint_authorized_by_user_id?: string | null
          reprint_reason?: string | null
          woreda_id: string
        }
        Update: {
          copies_count?: number
          credential_id?: string
          credential_print_log_id?: string
          is_reprint?: boolean
          print_reason?: string
          print_type?: string
          printed_at?: string
          printed_by_user_id?: string | null
          printer_name?: string | null
          reprint_authorized_by_user_id?: string | null
          reprint_reason?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_print_log_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "residence_credential"
            referencedColumns: ["credential_id"]
          },
          {
            foreignKeyName: "credential_print_log_printed_by_user_id_fkey"
            columns: ["printed_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_print_log_reprint_authorized_by_user_id_fkey"
            columns: ["reprint_authorized_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_print_log_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      credential_request: {
        Row: {
          approval_decision_at: string | null
          approved_by_user_id: string | null
          closed_at: string | null
          correction_fields: string[] | null
          correction_reason: string | null
          created_at: string
          credential_id: string | null
          credential_request_id: string
          credential_type: string
          duplicate_flag: boolean
          duplicate_notes: string | null
          household_id: string | null
          issuing_kebele_id: string
          notes: string | null
          office_id: string | null
          payment_id: string | null
          police_report_number: string | null
          prior_credential_id: string | null
          reject_reason: string | null
          request_number: string
          request_type: string
          requested_by_user_id: string | null
          resident_id: string
          return_reason: string | null
          status: string
          submitted_at: string | null
          supporting_document_content_type: string | null
          supporting_document_name: string | null
          supporting_document_path: string | null
          updated_at: string
          verification_checklist: Json | null
          verified_at: string | null
          verified_by_user_id: string | null
          woreda_id: string
        }
        Insert: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          closed_at?: string | null
          correction_fields?: string[] | null
          correction_reason?: string | null
          created_at?: string
          credential_id?: string | null
          credential_request_id?: string
          credential_type?: string
          duplicate_flag?: boolean
          duplicate_notes?: string | null
          household_id?: string | null
          issuing_kebele_id: string
          notes?: string | null
          office_id?: string | null
          payment_id?: string | null
          police_report_number?: string | null
          prior_credential_id?: string | null
          reject_reason?: string | null
          request_number: string
          request_type: string
          requested_by_user_id?: string | null
          resident_id: string
          return_reason?: string | null
          status?: string
          submitted_at?: string | null
          supporting_document_content_type?: string | null
          supporting_document_name?: string | null
          supporting_document_path?: string | null
          updated_at?: string
          verification_checklist?: Json | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id: string
        }
        Update: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          closed_at?: string | null
          correction_fields?: string[] | null
          correction_reason?: string | null
          created_at?: string
          credential_id?: string | null
          credential_request_id?: string
          credential_type?: string
          duplicate_flag?: boolean
          duplicate_notes?: string | null
          household_id?: string | null
          issuing_kebele_id?: string
          notes?: string | null
          office_id?: string | null
          payment_id?: string | null
          police_report_number?: string | null
          prior_credential_id?: string | null
          reject_reason?: string | null
          request_number?: string
          request_type?: string
          requested_by_user_id?: string | null
          resident_id?: string
          return_reason?: string | null
          status?: string
          submitted_at?: string | null
          supporting_document_content_type?: string | null
          supporting_document_name?: string | null
          supporting_document_path?: string | null
          updated_at?: string
          verification_checklist?: Json | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_request_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_request_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "residence_credential"
            referencedColumns: ["credential_id"]
          },
          {
            foreignKeyName: "credential_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "credential_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "credential_request_issuing_kebele_id_fkey"
            columns: ["issuing_kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "credential_request_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "office"
            referencedColumns: ["office_id"]
          },
          {
            foreignKeyName: "credential_request_payment_fk"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "credential_request_payment_fk"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_decrypted"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "credential_request_prior_credential_id_fkey"
            columns: ["prior_credential_id"]
            isOneToOne: false
            referencedRelation: "residence_credential"
            referencedColumns: ["credential_id"]
          },
          {
            foreignKeyName: "credential_request_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "credential_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "credential_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "credential_request_verified_by_user_id_fkey"
            columns: ["verified_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_request_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      credential_request_sequence: {
        Row: {
          last_value: number
          seq_year: number
          woreda_id: string
        }
        Insert: {
          last_value?: number
          seq_year: number
          woreda_id: string
        }
        Update: {
          last_value?: number
          seq_year?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_request_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      credential_request_status_history: {
        Row: {
          change_reason: string | null
          changed_at: string
          changed_by_user_id: string | null
          credential_request_id: string
          id: string
          new_status: string
          old_status: string | null
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          changed_by_user_id?: string | null
          credential_request_id: string
          id?: string
          new_status: string
          old_status?: string | null
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          changed_by_user_id?: string | null
          credential_request_id?: string
          id?: string
          new_status?: string
          old_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_request_status_history_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_request_status_history_credential_request_id_fkey"
            columns: ["credential_request_id"]
            isOneToOne: false
            referencedRelation: "credential_request"
            referencedColumns: ["credential_request_id"]
          },
        ]
      }
      credential_status_history: {
        Row: {
          change_reason: string | null
          changed_at: string
          changed_by_user_id: string | null
          credential_id: string
          id: string
          new_status: string
          old_status: string | null
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          changed_by_user_id?: string | null
          credential_id: string
          id?: string
          new_status: string
          old_status?: string | null
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          changed_by_user_id?: string | null
          credential_id?: string
          id?: string
          new_status?: string
          old_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_status_history_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "credential_status_history_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "residence_credential"
            referencedColumns: ["credential_id"]
          },
        ]
      }
      credential_verification_log: {
        Row: {
          attempted_value: string
          attempted_value_kind: string
          created_at: string
          id: string
          is_staff_caller: boolean
          matched_credential_id: string | null
          result: string
          source_ip: string | null
          woreda_id: string | null
        }
        Insert: {
          attempted_value: string
          attempted_value_kind: string
          created_at?: string
          id?: string
          is_staff_caller?: boolean
          matched_credential_id?: string | null
          result: string
          source_ip?: string | null
          woreda_id?: string | null
        }
        Update: {
          attempted_value?: string
          attempted_value_kind?: string
          created_at?: string
          id?: string
          is_staff_caller?: boolean
          matched_credential_id?: string | null
          result?: string
          source_ip?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_verification_log_matched_credential_id_fkey"
            columns: ["matched_credential_id"]
            isOneToOne: false
            referencedRelation: "residence_credential"
            referencedColumns: ["credential_id"]
          },
          {
            foreignKeyName: "credential_verification_log_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      fee_schedule: {
        Row: {
          created_at: string
          effective_from: string | null
          fee_schedule_id: string
          penalty_rate: number
          service_type: string
          standard_fee: number
          status: string
          updated_at: string
          woreda_id: string
        }
        Insert: {
          created_at?: string
          effective_from?: string | null
          fee_schedule_id?: string
          penalty_rate?: number
          service_type: string
          standard_fee?: number
          status?: string
          updated_at?: string
          woreda_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string | null
          fee_schedule_id?: string
          penalty_rate?: number
          service_type?: string
          standard_fee?: number
          status?: string
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_schedule_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      household: {
        Row: {
          active_flag: boolean
          address_line: string | null
          alternate_head_resident_id: string | null
          created_at: string
          email: string | null
          email_enc: string | null
          gps_lat: number | null
          gps_lng: number | null
          house_label: string | null
          house_number: string
          house_type: string | null
          house_type_other: string | null
          household_head_resident_id: string | null
          household_id: string
          kebele_id: string
          occupancy_status: string
          phone_number: string | null
          phone_number_enc: string | null
          po_box: string | null
          rent_amount: number | null
          rent_amount_enc: string | null
          spouse_resident_id: string | null
          sub_woreda: string | null
          updated_at: string
          woreda_id: string
        }
        Insert: {
          active_flag?: boolean
          address_line?: string | null
          alternate_head_resident_id?: string | null
          created_at?: string
          email?: string | null
          email_enc?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          house_label?: string | null
          house_number: string
          house_type?: string | null
          house_type_other?: string | null
          household_head_resident_id?: string | null
          household_id?: string
          kebele_id: string
          occupancy_status?: string
          phone_number?: string | null
          phone_number_enc?: string | null
          po_box?: string | null
          rent_amount?: number | null
          rent_amount_enc?: string | null
          spouse_resident_id?: string | null
          sub_woreda?: string | null
          updated_at?: string
          woreda_id: string
        }
        Update: {
          active_flag?: boolean
          address_line?: string | null
          alternate_head_resident_id?: string | null
          created_at?: string
          email?: string | null
          email_enc?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          house_label?: string | null
          house_number?: string
          house_type?: string | null
          house_type_other?: string | null
          household_head_resident_id?: string | null
          household_id?: string
          kebele_id?: string
          occupancy_status?: string
          phone_number?: string | null
          phone_number_enc?: string | null
          po_box?: string | null
          rent_amount?: number | null
          rent_amount_enc?: string | null
          spouse_resident_id?: string | null
          sub_woreda?: string | null
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_alternate_head_resident_id_fkey"
            columns: ["alternate_head_resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_alternate_head_resident_id_fkey"
            columns: ["alternate_head_resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_alternate_head_resident_id_fkey"
            columns: ["alternate_head_resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_household_head_resident_id_fkey"
            columns: ["household_head_resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_household_head_resident_id_fkey"
            columns: ["household_head_resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_household_head_resident_id_fkey"
            columns: ["household_head_resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_kebele_id_fkey"
            columns: ["kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "household_spouse_resident_id_fkey"
            columns: ["spouse_resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_spouse_resident_id_fkey"
            columns: ["spouse_resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_spouse_resident_id_fkey"
            columns: ["spouse_resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      household_change_log: {
        Row: {
          change_date: string
          change_type: string
          clerk_comment: string | null
          clerk_signed: boolean
          created_at: string
          household_head_signed: boolean
          household_id: string
          id: string
          new_value_json: Json | null
          old_value_json: Json | null
          registered_by_user_id: string | null
          woreda_id: string
        }
        Insert: {
          change_date?: string
          change_type: string
          clerk_comment?: string | null
          clerk_signed?: boolean
          created_at?: string
          household_head_signed?: boolean
          household_id: string
          id?: string
          new_value_json?: Json | null
          old_value_json?: Json | null
          registered_by_user_id?: string | null
          woreda_id: string
        }
        Update: {
          change_date?: string
          change_type?: string
          clerk_comment?: string | null
          clerk_signed?: boolean
          created_at?: string
          household_head_signed?: boolean
          household_id?: string
          id?: string
          new_value_json?: Json | null
          old_value_json?: Json | null
          registered_by_user_id?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_change_log_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "household_change_log_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "household_change_log_registered_by_user_id_fkey"
            columns: ["registered_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "household_change_log_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      household_location: {
        Row: {
          captured_at: string
          captured_by: string | null
          gps_lat: number | null
          gps_lng: number | null
          household_id: string
          household_location_id: string
          map_reference: string | null
          woreda_id: string
        }
        Insert: {
          captured_at?: string
          captured_by?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          household_id: string
          household_location_id?: string
          map_reference?: string | null
          woreda_id: string
        }
        Update: {
          captured_at?: string
          captured_by?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          household_id?: string
          household_location_id?: string
          map_reference?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_location_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "household_location_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "household_location_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "household_location_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      id_card_template: {
        Row: {
          background_image_url: string | null
          is_published: boolean
          template_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          background_image_url?: string | null
          is_published?: boolean
          template_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          background_image_url?: string | null
          is_published?: boolean
          template_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "id_card_template_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
        ]
      }
      id_card_template_field: {
        Row: {
          binding_mode: string
          canvas_height: number
          canvas_width: number
          color: string
          field_key: string
          field_type: string
          font_family: string
          font_size: number | null
          font_style: string
          font_weight: string | null
          height: number
          static_value: string | null
          template_field_id: string
          template_type: string
          text_align: string
          text_decoration: string
          width: number
          x: number
          y: number
          z_index: number
        }
        Insert: {
          binding_mode?: string
          canvas_height?: number
          canvas_width?: number
          color?: string
          field_key: string
          field_type?: string
          font_family?: string
          font_size?: number | null
          font_style?: string
          font_weight?: string | null
          height: number
          static_value?: string | null
          template_field_id?: string
          template_type: string
          text_align?: string
          text_decoration?: string
          width: number
          x: number
          y: number
          z_index?: number
        }
        Update: {
          binding_mode?: string
          canvas_height?: number
          canvas_width?: number
          color?: string
          field_key?: string
          field_type?: string
          font_family?: string
          font_size?: number | null
          font_style?: string
          font_weight?: string | null
          height?: number
          static_value?: string | null
          template_field_id?: string
          template_type?: string
          text_align?: string
          text_decoration?: string
          width?: number
          x?: number
          y?: number
          z_index?: number
        }
        Relationships: []
      }
      id_card_template_field_draft: {
        Row: {
          binding_mode: string
          canvas_height: number
          canvas_width: number
          color: string
          field_key: string
          field_type: string
          font_family: string
          font_size: number | null
          font_style: string
          font_weight: string | null
          height: number
          static_value: string | null
          template_field_id: string
          template_type: string
          text_align: string
          text_decoration: string
          width: number
          x: number
          y: number
          z_index: number
        }
        Insert: {
          binding_mode?: string
          canvas_height?: number
          canvas_width?: number
          color?: string
          field_key: string
          field_type?: string
          font_family?: string
          font_size?: number | null
          font_style?: string
          font_weight?: string | null
          height: number
          static_value?: string | null
          template_field_id?: string
          template_type: string
          text_align?: string
          text_decoration?: string
          width: number
          x: number
          y: number
          z_index?: number
        }
        Update: {
          binding_mode?: string
          canvas_height?: number
          canvas_width?: number
          color?: string
          field_key?: string
          field_type?: string
          font_family?: string
          font_size?: number | null
          font_style?: string
          font_weight?: string | null
          height?: number
          static_value?: string | null
          template_field_id?: string
          template_type?: string
          text_align?: string
          text_decoration?: string
          width?: number
          x?: number
          y?: number
          z_index?: number
        }
        Relationships: []
      }
      kebele: {
        Row: {
          created_at: string
          kebele_id: string
          kebele_name_am: string
          kebele_name_en: string
          kebele_number: string
          status: string
          woreda_id: string
        }
        Insert: {
          created_at?: string
          kebele_id?: string
          kebele_name_am: string
          kebele_name_en: string
          kebele_number: string
          status?: string
          woreda_id: string
        }
        Update: {
          created_at?: string
          kebele_id?: string
          kebele_name_am?: string
          kebele_name_en?: string
          kebele_number?: string
          status?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kebele_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      kebele_rental_house: {
        Row: {
          address_line: string | null
          bedrooms: number | null
          created_at: string
          house_number: string
          kebele_id: string
          monthly_rent_standard: number | null
          occupancy_status: string
          rental_house_id: string
          updated_at: string
          woreda_id: string
        }
        Insert: {
          address_line?: string | null
          bedrooms?: number | null
          created_at?: string
          house_number: string
          kebele_id: string
          monthly_rent_standard?: number | null
          occupancy_status?: string
          rental_house_id?: string
          updated_at?: string
          woreda_id: string
        }
        Update: {
          address_line?: string | null
          bedrooms?: number | null
          created_at?: string
          house_number?: string
          kebele_id?: string
          monthly_rent_standard?: number | null
          occupancy_status?: string
          rental_house_id?: string
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kebele_rental_house_kebele_id_fkey"
            columns: ["kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "kebele_rental_house_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      office: {
        Row: {
          created_at: string
          is_active: boolean
          is_main: boolean
          office_code: string
          office_id: string
          office_name: string
          updated_at: string
          woreda_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          is_main?: boolean
          office_code: string
          office_id?: string
          office_name: string
          updated_at?: string
          woreda_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          is_main?: boolean
          office_code?: string
          office_id?: string
          office_name?: string
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "office_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: true
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      payment: {
        Row: {
          amount: number
          amount_enc: string | null
          channel: string
          created_at: string
          credential_request_id: string | null
          household_id: string | null
          payment_date: string
          payment_id: string
          payment_type: string
          posted_by_user_id: string | null
          reference_no: string | null
          rental_request_id: string | null
          resident_id: string | null
          service_request_id: string | null
          status: string
          vital_event_id: string | null
          waived: boolean
          waiver_reason: string | null
          woreda_id: string
        }
        Insert: {
          amount: number
          amount_enc?: string | null
          channel?: string
          created_at?: string
          credential_request_id?: string | null
          household_id?: string | null
          payment_date: string
          payment_id?: string
          payment_type: string
          posted_by_user_id?: string | null
          reference_no?: string | null
          rental_request_id?: string | null
          resident_id?: string | null
          service_request_id?: string | null
          status?: string
          vital_event_id?: string | null
          waived?: boolean
          waiver_reason?: string | null
          woreda_id: string
        }
        Update: {
          amount?: number
          amount_enc?: string | null
          channel?: string
          created_at?: string
          credential_request_id?: string | null
          household_id?: string | null
          payment_date?: string
          payment_id?: string
          payment_type?: string
          posted_by_user_id?: string | null
          reference_no?: string | null
          rental_request_id?: string | null
          resident_id?: string | null
          service_request_id?: string | null
          status?: string
          vital_event_id?: string | null
          waived?: boolean
          waiver_reason?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_credential_request_id_fkey"
            columns: ["credential_request_id"]
            isOneToOne: false
            referencedRelation: "credential_request"
            referencedColumns: ["credential_request_id"]
          },
          {
            foreignKeyName: "payment_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "payment_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "payment_posted_by_user_id_fkey"
            columns: ["posted_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_rental_request_id_fkey"
            columns: ["rental_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "payment_rental_request_id_fkey"
            columns: ["rental_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request_decrypted"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "payment_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "payment_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "payment_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "payment_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "payment_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request_decrypted"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "payment_vital_event_id_fkey"
            columns: ["vital_event_id"]
            isOneToOne: false
            referencedRelation: "vital_event"
            referencedColumns: ["vital_event_id"]
          },
          {
            foreignKeyName: "payment_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      payment_reconciliation_exception: {
        Row: {
          created_at: string
          created_by: string | null
          exception_id: string
          exception_type: string
          expected_settlement_amount: number | null
          expected_settlement_amount_enc: string | null
          external_reference: string | null
          idempotency_key: string | null
          received_amount: number
          received_amount_enc: string | null
          rent_account_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          woreda_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          exception_id?: string
          exception_type: string
          expected_settlement_amount?: number | null
          expected_settlement_amount_enc?: string | null
          external_reference?: string | null
          idempotency_key?: string | null
          received_amount: number
          received_amount_enc?: string | null
          rent_account_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          woreda_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          exception_id?: string
          exception_type?: string
          expected_settlement_amount?: number | null
          expected_settlement_amount_enc?: string | null
          external_reference?: string | null
          idempotency_key?: string | null
          received_amount?: number
          received_amount_enc?: string | null
          rent_account_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_exception_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_reconciliation_exception_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "payment_reconciliation_exception_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_reconciliation_exception_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rate_limit_bucket: {
        Row: {
          bucket_key: string
          request_count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          request_count?: number
          window_start: string
        }
        Update: {
          bucket_key?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      receipt: {
        Row: {
          cash_bank_channel: string
          created_at: string
          payment_id: string
          printed_at: string | null
          receipt_date: string
          receipt_id: string
          receipt_number: string
          total_amount: number
          verification_token: string | null
          woreda_id: string
        }
        Insert: {
          cash_bank_channel: string
          created_at?: string
          payment_id: string
          printed_at?: string | null
          receipt_date: string
          receipt_id?: string
          receipt_number: string
          total_amount: number
          verification_token?: string | null
          woreda_id: string
        }
        Update: {
          cash_bank_channel?: string
          created_at?: string
          payment_id?: string
          printed_at?: string | null
          receipt_date?: string
          receipt_id?: string
          receipt_number?: string
          total_amount?: number
          verification_token?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "receipt_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_decrypted"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "receipt_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      receipt_sequence: {
        Row: {
          last_value: number
          seq_year: number
          woreda_id: string
        }
        Insert: {
          last_value?: number
          seq_year: number
          woreda_id: string
        }
        Update: {
          last_value?: number
          seq_year?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_account: {
        Row: {
          account_number: string
          billing_end_period_key: string | null
          billing_start_period_key: string
          created_at: string
          created_by: string | null
          household_id: string | null
          kebele_id: string
          occupancy_id: string
          rent_account_id: string
          rental_house_id: string
          resident_id: string
          status: string
          updated_at: string
          woreda_id: string
        }
        Insert: {
          account_number: string
          billing_end_period_key?: string | null
          billing_start_period_key: string
          created_at?: string
          created_by?: string | null
          household_id?: string | null
          kebele_id: string
          occupancy_id: string
          rent_account_id?: string
          rental_house_id: string
          resident_id: string
          status?: string
          updated_at?: string
          woreda_id: string
        }
        Update: {
          account_number?: string
          billing_end_period_key?: string | null
          billing_start_period_key?: string
          created_at?: string
          created_by?: string | null
          household_id?: string | null
          kebele_id?: string
          occupancy_id?: string
          rent_account_id?: string
          rental_house_id?: string
          resident_id?: string
          status?: string
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_account_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rent_account_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rent_account_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rent_account_kebele_id_fkey"
            columns: ["kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "rent_account_occupancy_id_fkey"
            columns: ["occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rent_account_occupancy_id_fkey"
            columns: ["occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_decrypted"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rent_account_rental_house_id_fkey"
            columns: ["rental_house_id"]
            isOneToOne: false
            referencedRelation: "kebele_rental_house"
            referencedColumns: ["rental_house_id"]
          },
          {
            foreignKeyName: "rent_account_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rent_account_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rent_account_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rent_account_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_account_sequence: {
        Row: {
          last_value: number
          seq_year: number
          woreda_id: string
        }
        Insert: {
          last_value?: number
          seq_year: number
          woreda_id: string
        }
        Update: {
          last_value?: number
          seq_year?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_account_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_charge: {
        Row: {
          approved_adjustment_amount: number
          approved_adjustment_amount_enc: string | null
          base_rent_amount: number
          base_rent_amount_enc: string | null
          charge_date: string
          created_at: string
          due_date: string
          ethiopian_month: number
          ethiopian_period_key: string
          ethiopian_year: number
          occupancy_id: string
          rent_account_id: string
          rent_charge_id: string
          settled_at: string | null
          settled_by_payment_id: string | null
          status: string
          total_amount: number
          total_amount_enc: string | null
          updated_at: string
          woreda_id: string
        }
        Insert: {
          approved_adjustment_amount?: number
          approved_adjustment_amount_enc?: string | null
          base_rent_amount: number
          base_rent_amount_enc?: string | null
          charge_date?: string
          created_at?: string
          due_date: string
          ethiopian_month: number
          ethiopian_period_key: string
          ethiopian_year: number
          occupancy_id: string
          rent_account_id: string
          rent_charge_id?: string
          settled_at?: string | null
          settled_by_payment_id?: string | null
          status?: string
          total_amount: number
          total_amount_enc?: string | null
          updated_at?: string
          woreda_id: string
        }
        Update: {
          approved_adjustment_amount?: number
          approved_adjustment_amount_enc?: string | null
          base_rent_amount?: number
          base_rent_amount_enc?: string | null
          charge_date?: string
          created_at?: string
          due_date?: string
          ethiopian_month?: number
          ethiopian_period_key?: string
          ethiopian_year?: number
          occupancy_id?: string
          rent_account_id?: string
          rent_charge_id?: string
          settled_at?: string | null
          settled_by_payment_id?: string | null
          status?: string
          total_amount?: number
          total_amount_enc?: string | null
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_charge_occupancy_id_fkey"
            columns: ["occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rent_charge_occupancy_id_fkey"
            columns: ["occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_decrypted"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rent_charge_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "rent_charge_settled_by_payment_id_fkey"
            columns: ["settled_by_payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rent_charge_settled_by_payment_id_fkey"
            columns: ["settled_by_payment_id"]
            isOneToOne: false
            referencedRelation: "payment_decrypted"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rent_charge_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_payment_settlement: {
        Row: {
          created_by: string | null
          payment_id: string
          rent_charge_id: string
          settled_at: string
          settlement_amount: number
          settlement_amount_enc: string | null
          settlement_id: string
          status: string
          woreda_id: string
        }
        Insert: {
          created_by?: string | null
          payment_id: string
          rent_charge_id: string
          settled_at?: string
          settlement_amount: number
          settlement_amount_enc?: string | null
          settlement_id?: string
          status?: string
          woreda_id: string
        }
        Update: {
          created_by?: string | null
          payment_id?: string
          rent_charge_id?: string
          settled_at?: string
          settlement_amount?: number
          settlement_amount_enc?: string | null
          settlement_id?: string
          status?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_payment_settlement_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rent_payment_settlement_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "rental_payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rent_payment_settlement_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charge"
            referencedColumns: ["rent_charge_id"]
          },
          {
            foreignKeyName: "rent_payment_settlement_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charge_decrypted"
            referencedColumns: ["rent_charge_id"]
          },
          {
            foreignKeyName: "rent_payment_settlement_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_rate_history: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          change_reason: string | null
          created_at: string
          effective_period_key: string
          monthly_amount: number
          monthly_amount_enc: string | null
          rent_account_id: string
          rent_rate_id: string
          status: string
          woreda_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          change_reason?: string | null
          created_at?: string
          effective_period_key: string
          monthly_amount: number
          monthly_amount_enc?: string | null
          rent_account_id: string
          rent_rate_id?: string
          status?: string
          woreda_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          change_reason?: string | null
          created_at?: string
          effective_period_key?: string
          monthly_amount?: number
          monthly_amount_enc?: string | null
          rent_account_id?: string
          rent_rate_id?: string
          status?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_rate_history_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rent_rate_history_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "rent_rate_history_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_reminder: {
        Row: {
          created_at: string
          delivery_channel: string
          delivery_status: string
          reminder_id: string
          reminder_type: string
          rent_account_id: string
          snapshot_amount: number | null
          snapshot_amount_enc: string | null
          snapshot_month_count: number | null
          snapshot_oldest_overdue_period: string | null
          woreda_id: string
        }
        Insert: {
          created_at?: string
          delivery_channel?: string
          delivery_status?: string
          reminder_id?: string
          reminder_type: string
          rent_account_id: string
          snapshot_amount?: number | null
          snapshot_amount_enc?: string | null
          snapshot_month_count?: number | null
          snapshot_oldest_overdue_period?: string | null
          woreda_id: string
        }
        Update: {
          created_at?: string
          delivery_channel?: string
          delivery_status?: string
          reminder_id?: string
          reminder_type?: string
          rent_account_id?: string
          snapshot_amount?: number | null
          snapshot_amount_enc?: string | null
          snapshot_month_count?: number | null
          snapshot_oldest_overdue_period?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_reminder_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "rent_reminder_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rental_occupancy: {
        Row: {
          created_at: string
          household_id: string | null
          occupancy_id: string
          originating_request_id: string | null
          rent_amount: number
          rent_amount_enc: string | null
          rent_start_date: string
          rental_house_id: string
          resident_id: string
          status: string
          termination_date: string | null
          termination_reason: string | null
          updated_at: string
          woreda_id: string
        }
        Insert: {
          created_at?: string
          household_id?: string | null
          occupancy_id?: string
          originating_request_id?: string | null
          rent_amount: number
          rent_amount_enc?: string | null
          rent_start_date: string
          rental_house_id: string
          resident_id: string
          status?: string
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string
          woreda_id: string
        }
        Update: {
          created_at?: string
          household_id?: string | null
          occupancy_id?: string
          originating_request_id?: string | null
          rent_amount?: number
          rent_amount_enc?: string | null
          rent_start_date?: string
          rental_house_id?: string
          resident_id?: string
          status?: string
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_occupancy_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rental_occupancy_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rental_occupancy_originating_request_id_fkey"
            columns: ["originating_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "rental_occupancy_originating_request_id_fkey"
            columns: ["originating_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request_decrypted"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "rental_occupancy_rental_house_id_fkey"
            columns: ["rental_house_id"]
            isOneToOne: false
            referencedRelation: "kebele_rental_house"
            referencedColumns: ["rental_house_id"]
          },
          {
            foreignKeyName: "rental_occupancy_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rental_occupancy_request: {
        Row: {
          approval_decision_at: string | null
          approved_by_user_id: string | null
          created_at: string
          existing_occupancy_id: string | null
          household_id: string | null
          reject_reason: string | null
          rent_amount: number | null
          rent_amount_enc: string | null
          rent_start_date: string | null
          rental_house_id: string
          rental_request_id: string
          request_number: string
          request_type: string
          requested_by_user_id: string | null
          resident_id: string
          resulting_occupancy_id: string | null
          return_reason: string | null
          status: string
          termination_date: string | null
          termination_reason: string | null
          updated_at: string
          verification_checklist: Json | null
          verified_at: string | null
          verified_by_user_id: string | null
          woreda_id: string
        }
        Insert: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string
          existing_occupancy_id?: string | null
          household_id?: string | null
          reject_reason?: string | null
          rent_amount?: number | null
          rent_amount_enc?: string | null
          rent_start_date?: string | null
          rental_house_id: string
          rental_request_id?: string
          request_number: string
          request_type: string
          requested_by_user_id?: string | null
          resident_id: string
          resulting_occupancy_id?: string | null
          return_reason?: string | null
          status?: string
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string
          verification_checklist?: Json | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id: string
        }
        Update: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string
          existing_occupancy_id?: string | null
          household_id?: string | null
          reject_reason?: string | null
          rent_amount?: number | null
          rent_amount_enc?: string | null
          rent_start_date?: string | null
          rental_house_id?: string
          rental_request_id?: string
          request_number?: string
          request_type?: string
          requested_by_user_id?: string | null
          resident_id?: string
          resulting_occupancy_id?: string | null
          return_reason?: string | null
          status?: string
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string
          verification_checklist?: Json | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_occupancy_request_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_existing_fk"
            columns: ["existing_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_existing_fk"
            columns: ["existing_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_decrypted"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_rental_house_id_fkey"
            columns: ["rental_house_id"]
            isOneToOne: false
            referencedRelation: "kebele_rental_house"
            referencedColumns: ["rental_house_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resulting_fk"
            columns: ["resulting_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resulting_fk"
            columns: ["resulting_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_decrypted"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_verified_by_user_id_fkey"
            columns: ["verified_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rental_payment: {
        Row: {
          created_at: string
          idempotency_key: string | null
          payer_resident_id: string | null
          payment_id: string
          reference_number: string | null
          rent_account_id: string
          woreda_id: string
        }
        Insert: {
          created_at?: string
          idempotency_key?: string | null
          payer_resident_id?: string | null
          payment_id: string
          reference_number?: string | null
          rent_account_id: string
          woreda_id: string
        }
        Update: {
          created_at?: string
          idempotency_key?: string | null
          payer_resident_id?: string | null
          payment_id?: string
          reference_number?: string | null
          rent_account_id?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_payment_payer_resident_id_fkey"
            columns: ["payer_resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_payment_payer_resident_id_fkey"
            columns: ["payer_resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_payment_payer_resident_id_fkey"
            columns: ["payer_resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_payment_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rental_payment_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payment_decrypted"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rental_payment_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "rental_payment_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rental_policy: {
        Row: {
          billing_invocation_mode: string
          block_on_rental_arrears: boolean
          created_at: string
          due_day: number
          due_rule: string
          emergency_exemption: boolean
          escalation_after_overdue_months: number
          plan_compliance_effect: string
          plan_max_installments: number
          rate_change_requires_approval: boolean
          reminder_channels: string[]
          reminder_days_after_overdue: number
          reminder_days_before_due: number
          rental_policy_id: string
          termination_final_period_rule: string
          updated_at: string
          updated_by: string | null
          waiver_max_amount: number | null
          waiver_requires_role: string
          woreda_id: string
        }
        Insert: {
          billing_invocation_mode?: string
          block_on_rental_arrears?: boolean
          created_at?: string
          due_day?: number
          due_rule?: string
          emergency_exemption?: boolean
          escalation_after_overdue_months?: number
          plan_compliance_effect?: string
          plan_max_installments?: number
          rate_change_requires_approval?: boolean
          reminder_channels?: string[]
          reminder_days_after_overdue?: number
          reminder_days_before_due?: number
          rental_policy_id?: string
          termination_final_period_rule?: string
          updated_at?: string
          updated_by?: string | null
          waiver_max_amount?: number | null
          waiver_requires_role?: string
          woreda_id: string
        }
        Update: {
          billing_invocation_mode?: string
          block_on_rental_arrears?: boolean
          created_at?: string
          due_day?: number
          due_rule?: string
          emergency_exemption?: boolean
          escalation_after_overdue_months?: number
          plan_compliance_effect?: string
          plan_max_installments?: number
          rate_change_requires_approval?: boolean
          reminder_channels?: string[]
          reminder_days_after_overdue?: number
          reminder_days_before_due?: number
          rental_policy_id?: string
          termination_final_period_rule?: string
          updated_at?: string
          updated_by?: string | null
          waiver_max_amount?: number | null
          waiver_requires_role?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_policy_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_policy_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: true
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rental_request_document: {
        Row: {
          content_type: string | null
          created_at: string
          document_id: string
          document_type: string
          file_name: string
          file_size_bytes: number | null
          rental_request_id: string
          storage_path: string
          updated_at: string
          uploaded_by_user_id: string | null
          woreda_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          document_id?: string
          document_type: string
          file_name: string
          file_size_bytes?: number | null
          rental_request_id: string
          storage_path: string
          updated_at?: string
          uploaded_by_user_id?: string | null
          woreda_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          document_id?: string
          document_type?: string
          file_name?: string
          file_size_bytes?: number | null
          rental_request_id?: string
          storage_path?: string
          updated_at?: string
          uploaded_by_user_id?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_request_document_rental_request_id_fkey"
            columns: ["rental_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "rental_request_document_rental_request_id_fkey"
            columns: ["rental_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request_decrypted"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "rental_request_document_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_request_document_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rental_request_sequence: {
        Row: {
          last_value: number
          seq_year: number
          woreda_id: string
        }
        Insert: {
          last_value?: number
          seq_year: number
          woreda_id: string
        }
        Update: {
          last_value?: number
          seq_year?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_request_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      residence_credential: {
        Row: {
          activated_at: string | null
          created_at: string
          credential_id: string
          credential_number: string
          credential_request_id: string | null
          credential_type: string
          expiry_date: string | null
          issue_date: string | null
          issued_recipient_name: string | null
          issuing_kebele_id: string
          issuing_office_id: string | null
          printed_at: string | null
          qr_payload: string | null
          reason_for_issue: string | null
          reissue_count: number
          rejection_reason: string | null
          replaced_at: string | null
          requested_by_user_id: string | null
          resident_id: string
          revoked_at: string | null
          revoked_by_user_id: string | null
          revoked_reason: string | null
          serial_number: string
          status: string
          suspended_reason: string | null
          updated_at: string
          woreda_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          credential_id?: string
          credential_number: string
          credential_request_id?: string | null
          credential_type?: string
          expiry_date?: string | null
          issue_date?: string | null
          issued_recipient_name?: string | null
          issuing_kebele_id: string
          issuing_office_id?: string | null
          printed_at?: string | null
          qr_payload?: string | null
          reason_for_issue?: string | null
          reissue_count?: number
          rejection_reason?: string | null
          replaced_at?: string | null
          requested_by_user_id?: string | null
          resident_id: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          revoked_reason?: string | null
          serial_number: string
          status?: string
          suspended_reason?: string | null
          updated_at?: string
          woreda_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          credential_id?: string
          credential_number?: string
          credential_request_id?: string | null
          credential_type?: string
          expiry_date?: string | null
          issue_date?: string | null
          issued_recipient_name?: string | null
          issuing_kebele_id?: string
          issuing_office_id?: string | null
          printed_at?: string | null
          qr_payload?: string | null
          reason_for_issue?: string | null
          reissue_count?: number
          rejection_reason?: string | null
          replaced_at?: string | null
          requested_by_user_id?: string | null
          resident_id?: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          revoked_reason?: string | null
          serial_number?: string
          status?: string
          suspended_reason?: string | null
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "residence_credential_credential_request_id_fkey"
            columns: ["credential_request_id"]
            isOneToOne: false
            referencedRelation: "credential_request"
            referencedColumns: ["credential_request_id"]
          },
          {
            foreignKeyName: "residence_credential_issuing_kebele_id_fkey"
            columns: ["issuing_kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "residence_credential_issuing_office_id_fkey"
            columns: ["issuing_office_id"]
            isOneToOne: false
            referencedRelation: "office"
            referencedColumns: ["office_id"]
          },
          {
            foreignKeyName: "residence_credential_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "residence_credential_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "residence_credential_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "residence_credential_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "residence_credential_revoked_by_user_id_fkey"
            columns: ["revoked_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "residence_credential_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      resident: {
        Row: {
          active_flag: boolean
          birth_place: Json | null
          created_at: string
          current_household_id: string | null
          current_residence_extra: Json | null
          date_of_birth: string
          email: string | null
          email_enc: string | null
          ethnicity: string | null
          father_name: string | null
          first_name: string | null
          former_residence: Json | null
          full_name: string
          full_name_am: string | null
          grandfather_name: string | null
          marital_status: string
          mother_full_name: string | null
          national_id_no: string | null
          national_id_no_blind_index: string | null
          national_id_no_enc: string | null
          phone_number: string | null
          phone_number_blind_index: string | null
          phone_number_enc: string | null
          photo_url: string | null
          relation_to_head: string | null
          religion: string | null
          residency_start_date: string | null
          residency_status: string
          resident_id: string
          resident_number: string
          sex: string
          updated_at: string
          woreda_id: string
          work_info: Json | null
        }
        Insert: {
          active_flag?: boolean
          birth_place?: Json | null
          created_at?: string
          current_household_id?: string | null
          current_residence_extra?: Json | null
          date_of_birth: string
          email?: string | null
          email_enc?: string | null
          ethnicity?: string | null
          father_name?: string | null
          first_name?: string | null
          former_residence?: Json | null
          full_name: string
          full_name_am?: string | null
          grandfather_name?: string | null
          marital_status: string
          mother_full_name?: string | null
          national_id_no?: string | null
          national_id_no_blind_index?: string | null
          national_id_no_enc?: string | null
          phone_number?: string | null
          phone_number_blind_index?: string | null
          phone_number_enc?: string | null
          photo_url?: string | null
          relation_to_head?: string | null
          religion?: string | null
          residency_start_date?: string | null
          residency_status?: string
          resident_id?: string
          resident_number: string
          sex: string
          updated_at?: string
          woreda_id: string
          work_info?: Json | null
        }
        Update: {
          active_flag?: boolean
          birth_place?: Json | null
          created_at?: string
          current_household_id?: string | null
          current_residence_extra?: Json | null
          date_of_birth?: string
          email?: string | null
          email_enc?: string | null
          ethnicity?: string | null
          father_name?: string | null
          first_name?: string | null
          former_residence?: Json | null
          full_name?: string
          full_name_am?: string | null
          grandfather_name?: string | null
          marital_status?: string
          mother_full_name?: string | null
          national_id_no?: string | null
          national_id_no_blind_index?: string | null
          national_id_no_enc?: string | null
          phone_number?: string | null
          phone_number_blind_index?: string | null
          phone_number_enc?: string | null
          photo_url?: string | null
          relation_to_head?: string | null
          religion?: string | null
          residency_start_date?: string | null
          residency_status?: string
          resident_id?: string
          resident_number?: string
          sex?: string
          updated_at?: string
          woreda_id?: string
          work_info?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_current_household_id_fkey"
            columns: ["current_household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "resident_current_household_id_fkey"
            columns: ["current_household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "resident_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      resident_document: {
        Row: {
          content_type: string
          created_at: string
          document_id: string
          document_label: string
          file_name: string
          file_size_bytes: number | null
          household_id: string | null
          resident_id: string
          storage_path: string
          updated_at: string
          uploaded_by_user_id: string | null
          woreda_id: string
        }
        Insert: {
          content_type?: string
          created_at?: string
          document_id?: string
          document_label: string
          file_name: string
          file_size_bytes?: number | null
          household_id?: string | null
          resident_id: string
          storage_path: string
          updated_at?: string
          uploaded_by_user_id?: string | null
          woreda_id: string
        }
        Update: {
          content_type?: string
          created_at?: string
          document_id?: string
          document_label?: string
          file_name?: string
          file_size_bytes?: number | null
          household_id?: string | null
          resident_id?: string
          storage_path?: string
          updated_at?: string
          uploaded_by_user_id?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_document_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "resident_document_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "resident_document_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "resident_document_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "resident_document_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "resident_document_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "resident_document_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      resident_number_sequence: {
        Row: {
          last_value: number
          woreda_id: string
        }
        Insert: {
          last_value?: number
          woreda_id: string
        }
        Update: {
          last_value?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_number_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: true
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      role_permission: {
        Row: {
          created_at: string
          is_granted: boolean
          permission_key: string
          role_name: string
          updated_at: string
          updated_by: string | null
          woreda_id: string
        }
        Insert: {
          created_at?: string
          is_granted?: boolean
          permission_key: string
          role_name: string
          updated_at?: string
          updated_by?: string | null
          woreda_id: string
        }
        Update: {
          created_at?: string
          is_granted?: boolean
          permission_key?: string
          role_name?: string
          updated_at?: string
          updated_by?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permission_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "role_permission_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      service_request: {
        Row: {
          addressed_to: string | null
          applicant_name: string | null
          applicant_phone: string | null
          applicant_phone_enc: string | null
          approval_decision_at: string | null
          approved_by_user_id: string | null
          category: string
          checkpoint_override: boolean
          checkpoint_override_reason: string | null
          closed_at: string | null
          created_at: string
          details: string | null
          fee_amount: number
          household_id: string | null
          incident_date: string | null
          incident_place: string | null
          issued_at: string | null
          issued_by_user_id: string | null
          issued_letter_html: string | null
          kebele_id: string | null
          letter_summary: string | null
          payment_id: string | null
          priority: string
          purpose: string | null
          reject_reason: string | null
          request_number: string
          requested_by_user_id: string | null
          resident_id: string | null
          resolution_notes: string | null
          respondent_name: string | null
          return_reason: string | null
          service_request_id: string
          service_type_id: string
          status: string
          subject: string | null
          submitted_at: string
          updated_at: string
          verification_checklist: Json | null
          verification_token: string | null
          verified_at: string | null
          verified_by_user_id: string | null
          woreda_id: string
        }
        Insert: {
          addressed_to?: string | null
          applicant_name?: string | null
          applicant_phone?: string | null
          applicant_phone_enc?: string | null
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          category?: string
          checkpoint_override?: boolean
          checkpoint_override_reason?: string | null
          closed_at?: string | null
          created_at?: string
          details?: string | null
          fee_amount?: number
          household_id?: string | null
          incident_date?: string | null
          incident_place?: string | null
          issued_at?: string | null
          issued_by_user_id?: string | null
          issued_letter_html?: string | null
          kebele_id?: string | null
          letter_summary?: string | null
          payment_id?: string | null
          priority?: string
          purpose?: string | null
          reject_reason?: string | null
          request_number: string
          requested_by_user_id?: string | null
          resident_id?: string | null
          resolution_notes?: string | null
          respondent_name?: string | null
          return_reason?: string | null
          service_request_id?: string
          service_type_id: string
          status?: string
          subject?: string | null
          submitted_at?: string
          updated_at?: string
          verification_checklist?: Json | null
          verification_token?: string | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id: string
        }
        Update: {
          addressed_to?: string | null
          applicant_name?: string | null
          applicant_phone?: string | null
          applicant_phone_enc?: string | null
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          category?: string
          checkpoint_override?: boolean
          checkpoint_override_reason?: string | null
          closed_at?: string | null
          created_at?: string
          details?: string | null
          fee_amount?: number
          household_id?: string | null
          incident_date?: string | null
          incident_place?: string | null
          issued_at?: string | null
          issued_by_user_id?: string | null
          issued_letter_html?: string | null
          kebele_id?: string | null
          letter_summary?: string | null
          payment_id?: string | null
          priority?: string
          purpose?: string | null
          reject_reason?: string | null
          request_number?: string
          requested_by_user_id?: string | null
          resident_id?: string | null
          resolution_notes?: string | null
          respondent_name?: string | null
          return_reason?: string | null
          service_request_id?: string
          service_type_id?: string
          status?: string
          subject?: string | null
          submitted_at?: string
          updated_at?: string
          verification_checklist?: Json | null
          verification_token?: string | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_request_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "service_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "service_request_issued_by_user_id_fkey"
            columns: ["issued_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_kebele_id_fkey"
            columns: ["kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "service_request_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "service_request_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_decrypted"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "service_request_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_type"
            referencedColumns: ["service_type_id"]
          },
          {
            foreignKeyName: "service_request_verified_by_user_id_fkey"
            columns: ["verified_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      service_request_attachment: {
        Row: {
          attachment_id: string
          content_type: string | null
          created_at: string
          document_type: string
          file_name: string
          file_size_bytes: number | null
          service_request_id: string
          storage_path: string
          updated_at: string
          uploaded_by_user_id: string | null
          woreda_id: string
        }
        Insert: {
          attachment_id?: string
          content_type?: string | null
          created_at?: string
          document_type: string
          file_name: string
          file_size_bytes?: number | null
          service_request_id: string
          storage_path: string
          updated_at?: string
          uploaded_by_user_id?: string | null
          woreda_id: string
        }
        Update: {
          attachment_id?: string
          content_type?: string | null
          created_at?: string
          document_type?: string
          file_name?: string
          file_size_bytes?: number | null
          service_request_id?: string
          storage_path?: string
          updated_at?: string
          uploaded_by_user_id?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_request_attachment_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "service_request_attachment_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request_decrypted"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "service_request_attachment_uploaded_by_user_id_fkey"
            columns: ["uploaded_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_attachment_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      service_request_checkpoint: {
        Row: {
          active_plan_id: string | null
          checkpoint_id: string
          has_active_occupancy: boolean
          has_active_plan: boolean
          oldest_overdue_period: string | null
          overdue_month_count: number
          overdue_total: number
          overdue_total_enc: string | null
          override_reason: string | null
          override_used: boolean
          rent_account_id: string | null
          rental_house_id: string | null
          resident_id: string | null
          resolved_at: string
          service_request_id: string
          woreda_id: string
          would_block: boolean
        }
        Insert: {
          active_plan_id?: string | null
          checkpoint_id?: string
          has_active_occupancy?: boolean
          has_active_plan?: boolean
          oldest_overdue_period?: string | null
          overdue_month_count?: number
          overdue_total?: number
          overdue_total_enc?: string | null
          override_reason?: string | null
          override_used?: boolean
          rent_account_id?: string | null
          rental_house_id?: string | null
          resident_id?: string | null
          resolved_at?: string
          service_request_id: string
          woreda_id: string
          would_block?: boolean
        }
        Update: {
          active_plan_id?: string | null
          checkpoint_id?: string
          has_active_occupancy?: boolean
          has_active_plan?: boolean
          oldest_overdue_period?: string | null
          overdue_month_count?: number
          overdue_total?: number
          overdue_total_enc?: string | null
          override_reason?: string | null
          override_used?: boolean
          rent_account_id?: string | null
          rental_house_id?: string | null
          resident_id?: string | null
          resolved_at?: string
          service_request_id?: string
          woreda_id?: string
          would_block?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "service_request_checkpoint_active_plan_id_fkey"
            columns: ["active_plan_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_plan"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_active_plan_id_fkey"
            columns: ["active_plan_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_plan_decrypted"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_rental_house_id_fkey"
            columns: ["rental_house_id"]
            isOneToOne: false
            referencedRelation: "kebele_rental_house"
            referencedColumns: ["rental_house_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: true
            referencedRelation: "service_request"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: true
            referencedRelation: "service_request_decrypted"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      service_request_sequence: {
        Row: {
          last_value: number
          seq_year: number
          woreda_id: string
        }
        Insert: {
          last_value?: number
          seq_year: number
          woreda_id: string
        }
        Update: {
          last_value?: number
          seq_year?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_request_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      service_request_status_history: {
        Row: {
          change_reason: string | null
          changed_at: string
          changed_by_user_id: string | null
          id: string
          new_status: string
          old_status: string | null
          service_request_id: string
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          changed_by_user_id?: string | null
          id?: string
          new_status: string
          old_status?: string | null
          service_request_id: string
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          changed_by_user_id?: string | null
          id?: string
          new_status?: string
          old_status?: string | null
          service_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_request_status_history_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_status_history_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "service_request_status_history_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request_decrypted"
            referencedColumns: ["service_request_id"]
          },
        ]
      }
      service_type: {
        Row: {
          category: string
          code: string
          created_at: string
          fee_amount: number
          is_active: boolean
          letter_body_html: string | null
          letter_body_template: string | null
          name_am: string
          name_en: string
          rental_checkpoint_gated: boolean
          required_documents: Json
          requires_approval: boolean
          requires_payment: boolean
          service_type_id: string
          sort_order: number
          updated_at: string
          woreda_id: string
        }
        Insert: {
          category?: string
          code: string
          created_at?: string
          fee_amount?: number
          is_active?: boolean
          letter_body_html?: string | null
          letter_body_template?: string | null
          name_am: string
          name_en: string
          rental_checkpoint_gated?: boolean
          required_documents?: Json
          requires_approval?: boolean
          requires_payment?: boolean
          service_type_id?: string
          sort_order?: number
          updated_at?: string
          woreda_id: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          fee_amount?: number
          is_active?: boolean
          letter_body_html?: string | null
          letter_body_template?: string | null
          name_am?: string
          name_en?: string
          rental_checkpoint_gated?: boolean
          required_documents?: Json
          requires_approval?: boolean
          requires_payment?: boolean
          service_type_id?: string
          sort_order?: number
          updated_at?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_type_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      tenant_module_config: {
        Row: {
          is_enabled: boolean
          module_key: string
          updated_at: string
          updated_by: string | null
          woreda_id: string
        }
        Insert: {
          is_enabled?: boolean
          module_key: string
          updated_at?: string
          updated_by?: string | null
          woreda_id: string
        }
        Update: {
          is_enabled?: boolean
          module_key?: string
          updated_at?: string
          updated_by?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_module_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tenant_module_config_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      tenant_role: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          is_active: boolean
          name: string
          tenant_role_id: string
          updated_at: string
          updated_by: string | null
          woreda_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          is_active?: boolean
          name: string
          tenant_role_id?: string
          updated_at?: string
          updated_by?: string | null
          woreda_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          is_active?: boolean
          name?: string
          tenant_role_id?: string
          updated_at?: string
          updated_by?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_role_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tenant_role_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tenant_role_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      tenant_role_permission: {
        Row: {
          is_granted: boolean
          permission_key: string
          tenant_role_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          is_granted?: boolean
          permission_key: string
          tenant_role_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          is_granted?: boolean
          permission_key?: string
          tenant_role_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_role_permission_tenant_role_id_fkey"
            columns: ["tenant_role_id"]
            isOneToOne: false
            referencedRelation: "tenant_role"
            referencedColumns: ["tenant_role_id"]
          },
          {
            foreignKeyName: "tenant_role_permission_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_permission_override: {
        Row: {
          created_at: string
          is_granted: boolean
          permission_key: string
          updated_at: string
          updated_by: string | null
          user_id: string
          woreda_id: string
        }
        Insert: {
          created_at?: string
          is_granted: boolean
          permission_key: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
          woreda_id: string
        }
        Update: {
          created_at?: string
          is_granted?: boolean
          permission_key?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_override_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_permission_override_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_permission_override_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      vital_event: {
        Row: {
          approval_decision_at: string | null
          approved_by_user_id: string | null
          created_at: string
          event_date: string
          event_details: Json | null
          event_number: string
          event_type: string
          household_id: string | null
          issued_at: string | null
          issued_by_user_id: string | null
          notes: string | null
          payment_id: string | null
          registration_date: string | null
          reject_reason: string | null
          requested_by_user_id: string | null
          resident_id: string | null
          return_reason: string | null
          source_document_no: string | null
          status: string
          updated_at: string
          verification_checklist: Json | null
          verified_at: string | null
          verified_by_user_id: string | null
          vital_event_id: string
          woreda_id: string
        }
        Insert: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string
          event_date: string
          event_details?: Json | null
          event_number: string
          event_type: string
          household_id?: string | null
          issued_at?: string | null
          issued_by_user_id?: string | null
          notes?: string | null
          payment_id?: string | null
          registration_date?: string | null
          reject_reason?: string | null
          requested_by_user_id?: string | null
          resident_id?: string | null
          return_reason?: string | null
          source_document_no?: string | null
          status?: string
          updated_at?: string
          verification_checklist?: Json | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          vital_event_id?: string
          woreda_id: string
        }
        Update: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string
          event_date?: string
          event_details?: Json | null
          event_number?: string
          event_type?: string
          household_id?: string | null
          issued_at?: string | null
          issued_by_user_id?: string | null
          notes?: string | null
          payment_id?: string | null
          registration_date?: string | null
          reject_reason?: string | null
          requested_by_user_id?: string | null
          resident_id?: string | null
          return_reason?: string | null
          source_document_no?: string | null
          status?: string
          updated_at?: string
          verification_checklist?: Json | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          vital_event_id?: string
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vital_event_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vital_event_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "vital_event_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "vital_event_issued_by_user_id_fkey"
            columns: ["issued_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vital_event_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "vital_event_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_decrypted"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "vital_event_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vital_event_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "vital_event_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "vital_event_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "vital_event_verified_by_user_id_fkey"
            columns: ["verified_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "vital_event_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      vital_event_sequence: {
        Row: {
          event_type: string
          last_value: number
          seq_year: number
          woreda_id: string
        }
        Insert: {
          event_type: string
          last_value?: number
          seq_year: number
          woreda_id: string
        }
        Update: {
          event_type?: string
          last_value?: number
          seq_year?: number
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vital_event_sequence_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      woreda: {
        Row: {
          created_at: string
          status: string
          updated_at: string
          woreda_code: string
          woreda_id: string
          woreda_name_am: string
          woreda_name_en: string
          woreda_numeric_code: number
        }
        Insert: {
          created_at?: string
          status?: string
          updated_at?: string
          woreda_code: string
          woreda_id?: string
          woreda_name_am: string
          woreda_name_en: string
          woreda_numeric_code: number
        }
        Update: {
          created_at?: string
          status?: string
          updated_at?: string
          woreda_code?: string
          woreda_id?: string
          woreda_name_am?: string
          woreda_name_en?: string
          woreda_numeric_code?: number
        }
        Relationships: []
      }
      woreda_settings: {
        Row: {
          address_line: string | null
          contact_email: string | null
          contact_phone: string | null
          credential_issuance_fee: number
          logo_url: string | null
          resident_number_format: string
          stamp_url: string | null
          supervisor_signature_url: string | null
          updated_at: string
          updated_by: string | null
          woreda_id: string
          woreda_name_display: string | null
          woreda_name_display_en: string | null
          woreda_name_display_har: string | null
          woreda_name_display_om: string | null
          woreda_name_short: string | null
          woreda_name_short_en: string | null
        }
        Insert: {
          address_line?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          credential_issuance_fee?: number
          logo_url?: string | null
          resident_number_format?: string
          stamp_url?: string | null
          supervisor_signature_url?: string | null
          updated_at?: string
          updated_by?: string | null
          woreda_id: string
          woreda_name_display?: string | null
          woreda_name_display_en?: string | null
          woreda_name_display_har?: string | null
          woreda_name_display_om?: string | null
          woreda_name_short?: string | null
          woreda_name_short_en?: string | null
        }
        Update: {
          address_line?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          credential_issuance_fee?: number
          logo_url?: string | null
          resident_number_format?: string
          stamp_url?: string | null
          supervisor_signature_url?: string | null
          updated_at?: string
          updated_by?: string | null
          woreda_id?: string
          woreda_name_display?: string | null
          woreda_name_display_en?: string | null
          woreda_name_display_har?: string | null
          woreda_name_display_om?: string | null
          woreda_name_short?: string | null
          woreda_name_short_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "woreda_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "woreda_settings_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: true
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      workflow_status_history: {
        Row: {
          change_reason: string | null
          changed_at: string
          changed_by_user_id: string | null
          entity: string
          entity_id: string
          id: string
          new_status: string
          old_status: string | null
          woreda_id: string
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          changed_by_user_id?: string | null
          entity: string
          entity_id: string
          id?: string
          new_status: string
          old_status?: string | null
          woreda_id: string
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          changed_by_user_id?: string | null
          entity?: string
          entity_id?: string
          id?: string
          new_status?: string
          old_status?: string | null
          woreda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_status_history_changed_by_user_id_fkey"
            columns: ["changed_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "workflow_status_history_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      workflow_transition: {
        Row: {
          created_at: string
          entity: string
          from_status: string
          is_system: boolean
          note: string | null
          required_permission: string | null
          to_status: string
          workflow_transition_id: string
        }
        Insert: {
          created_at?: string
          entity: string
          from_status: string
          is_system?: boolean
          note?: string | null
          required_permission?: string | null
          to_status: string
          workflow_transition_id?: string
        }
        Update: {
          created_at?: string
          entity?: string
          from_status?: string
          is_system?: boolean
          note?: string | null
          required_permission?: string | null
          to_status?: string
          workflow_transition_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      approval_queue_v: {
        Row: {
          created_at: string | null
          item_id: string | null
          kebele_id: string | null
          priority: string | null
          reference_number: string | null
          requested_by_user_id: string | null
          resident_id: string | null
          stage: string | null
          subtype_am: string | null
          subtype_en: string | null
          updated_at: string | null
          woreda_id: string | null
          work_type: string | null
        }
        Relationships: []
      }
      arrears_installment_charge_decrypted: {
        Row: {
          charge_amount_snapshot: number | null
          charge_amount_snapshot_decrypted: number | null
          charge_amount_snapshot_enc: string | null
          created_at: string | null
          installment_id: string | null
          mapping_id: string | null
          rent_charge_id: string | null
          status: string | null
          woreda_id: string | null
        }
        Insert: {
          charge_amount_snapshot?: number | null
          charge_amount_snapshot_decrypted?: never
          charge_amount_snapshot_enc?: string | null
          created_at?: string | null
          installment_id?: string | null
          mapping_id?: string | null
          rent_charge_id?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Update: {
          charge_amount_snapshot?: number | null
          charge_amount_snapshot_decrypted?: never
          charge_amount_snapshot_enc?: string | null
          created_at?: string | null
          installment_id?: string | null
          mapping_id?: string | null
          rent_charge_id?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arrears_installment_charge_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_installment"
            referencedColumns: ["installment_id"]
          },
          {
            foreignKeyName: "arrears_installment_charge_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_installment_decrypted"
            referencedColumns: ["installment_id"]
          },
          {
            foreignKeyName: "arrears_installment_charge_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charge"
            referencedColumns: ["rent_charge_id"]
          },
          {
            foreignKeyName: "arrears_installment_charge_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charge_decrypted"
            referencedColumns: ["rent_charge_id"]
          },
          {
            foreignKeyName: "arrears_installment_charge_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      arrears_repayment_installment_decrypted: {
        Row: {
          amount: number | null
          amount_decrypted: number | null
          amount_enc: string | null
          due_date: string | null
          installment_id: string | null
          installment_number: number | null
          plan_id: string | null
          settled_at: string | null
          settled_by_payment_id: string | null
          status: string | null
          woreda_id: string | null
        }
        Insert: {
          amount?: number | null
          amount_decrypted?: never
          amount_enc?: string | null
          due_date?: string | null
          installment_id?: string | null
          installment_number?: number | null
          plan_id?: string | null
          settled_at?: string | null
          settled_by_payment_id?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Update: {
          amount?: number | null
          amount_decrypted?: never
          amount_enc?: string | null
          due_date?: string | null
          installment_id?: string | null
          installment_number?: number | null
          plan_id?: string | null
          settled_at?: string | null
          settled_by_payment_id?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arrears_repayment_installment_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_plan"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "arrears_repayment_installment_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_plan_decrypted"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "arrears_repayment_installment_settled_by_payment_id_fkey"
            columns: ["settled_by_payment_id"]
            isOneToOne: false
            referencedRelation: "rental_payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "arrears_repayment_installment_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      arrears_repayment_plan_decrypted: {
        Row: {
          approval_decision_at: string | null
          approved_by_user_id: string | null
          assigned_arrears_amount: number | null
          assigned_arrears_amount_decrypted: number | null
          assigned_arrears_amount_enc: string | null
          created_at: string | null
          installment_count: number | null
          original_arrears_amount: number | null
          original_arrears_amount_decrypted: number | null
          original_arrears_amount_enc: string | null
          plan_id: string | null
          plan_number: string | null
          reason: string | null
          rent_account_id: string | null
          requested_by_user_id: string | null
          resident_id: string | null
          return_reason: string | null
          status: string | null
          updated_at: string | null
          woreda_id: string | null
        }
        Insert: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          assigned_arrears_amount?: number | null
          assigned_arrears_amount_decrypted?: never
          assigned_arrears_amount_enc?: string | null
          created_at?: string | null
          installment_count?: number | null
          original_arrears_amount?: number | null
          original_arrears_amount_decrypted?: never
          original_arrears_amount_enc?: string | null
          plan_id?: string | null
          plan_number?: string | null
          reason?: string | null
          rent_account_id?: string | null
          requested_by_user_id?: string | null
          resident_id?: string | null
          return_reason?: string | null
          status?: string | null
          updated_at?: string | null
          woreda_id?: string | null
        }
        Update: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          assigned_arrears_amount?: number | null
          assigned_arrears_amount_decrypted?: never
          assigned_arrears_amount_enc?: string | null
          created_at?: string | null
          installment_count?: number | null
          original_arrears_amount?: number | null
          original_arrears_amount_decrypted?: never
          original_arrears_amount_enc?: string | null
          plan_id?: string | null
          plan_number?: string | null
          reason?: string | null
          rent_account_id?: string | null
          requested_by_user_id?: string | null
          resident_id?: string | null
          return_reason?: string | null
          status?: string | null
          updated_at?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arrears_repayment_plan_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "arrears_repayment_plan_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      household_decrypted: {
        Row: {
          active_flag: boolean | null
          address_line: string | null
          alternate_head_resident_id: string | null
          created_at: string | null
          email: string | null
          email_decrypted: string | null
          email_enc: string | null
          gps_lat: number | null
          gps_lng: number | null
          house_label: string | null
          house_number: string | null
          house_type: string | null
          house_type_other: string | null
          household_head_resident_id: string | null
          household_id: string | null
          kebele_id: string | null
          occupancy_status: string | null
          phone_number: string | null
          phone_number_decrypted: string | null
          phone_number_enc: string | null
          po_box: string | null
          rent_amount: number | null
          rent_amount_decrypted: number | null
          rent_amount_enc: string | null
          spouse_resident_id: string | null
          sub_woreda: string | null
          updated_at: string | null
          woreda_id: string | null
        }
        Insert: {
          active_flag?: boolean | null
          address_line?: string | null
          alternate_head_resident_id?: string | null
          created_at?: string | null
          email?: string | null
          email_decrypted?: never
          email_enc?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          house_label?: string | null
          house_number?: string | null
          house_type?: string | null
          house_type_other?: string | null
          household_head_resident_id?: string | null
          household_id?: string | null
          kebele_id?: string | null
          occupancy_status?: string | null
          phone_number?: string | null
          phone_number_decrypted?: never
          phone_number_enc?: string | null
          po_box?: string | null
          rent_amount?: number | null
          rent_amount_decrypted?: never
          rent_amount_enc?: string | null
          spouse_resident_id?: string | null
          sub_woreda?: string | null
          updated_at?: string | null
          woreda_id?: string | null
        }
        Update: {
          active_flag?: boolean | null
          address_line?: string | null
          alternate_head_resident_id?: string | null
          created_at?: string | null
          email?: string | null
          email_decrypted?: never
          email_enc?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          house_label?: string | null
          house_number?: string | null
          house_type?: string | null
          house_type_other?: string | null
          household_head_resident_id?: string | null
          household_id?: string | null
          kebele_id?: string | null
          occupancy_status?: string | null
          phone_number?: string | null
          phone_number_decrypted?: never
          phone_number_enc?: string | null
          po_box?: string | null
          rent_amount?: number | null
          rent_amount_decrypted?: never
          rent_amount_enc?: string | null
          spouse_resident_id?: string | null
          sub_woreda?: string | null
          updated_at?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "household_alternate_head_resident_id_fkey"
            columns: ["alternate_head_resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_alternate_head_resident_id_fkey"
            columns: ["alternate_head_resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_alternate_head_resident_id_fkey"
            columns: ["alternate_head_resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_household_head_resident_id_fkey"
            columns: ["household_head_resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_household_head_resident_id_fkey"
            columns: ["household_head_resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_household_head_resident_id_fkey"
            columns: ["household_head_resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_kebele_id_fkey"
            columns: ["kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "household_spouse_resident_id_fkey"
            columns: ["spouse_resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_spouse_resident_id_fkey"
            columns: ["spouse_resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_spouse_resident_id_fkey"
            columns: ["spouse_resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "household_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      household_member_roster: {
        Row: {
          active_flag: boolean | null
          age: number | null
          date_of_birth: string | null
          full_name: string | null
          full_name_am: string | null
          household_id: string | null
          relation_to_head: string | null
          residency_status: string | null
          resident_id: string | null
          sex: string | null
        }
        Insert: {
          active_flag?: boolean | null
          age?: never
          date_of_birth?: string | null
          full_name?: string | null
          full_name_am?: string | null
          household_id?: string | null
          relation_to_head?: string | null
          residency_status?: string | null
          resident_id?: string | null
          sex?: string | null
        }
        Update: {
          active_flag?: boolean | null
          age?: never
          date_of_birth?: string | null
          full_name?: string | null
          full_name_am?: string | null
          household_id?: string | null
          relation_to_head?: string | null
          residency_status?: string | null
          resident_id?: string | null
          sex?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_current_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "resident_current_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
        ]
      }
      payment_decrypted: {
        Row: {
          amount: number | null
          amount_decrypted: number | null
          amount_enc: string | null
          channel: string | null
          created_at: string | null
          credential_request_id: string | null
          household_id: string | null
          payment_date: string | null
          payment_id: string | null
          payment_type: string | null
          posted_by_user_id: string | null
          reference_no: string | null
          rental_request_id: string | null
          resident_id: string | null
          service_request_id: string | null
          status: string | null
          vital_event_id: string | null
          waived: boolean | null
          waiver_reason: string | null
          woreda_id: string | null
        }
        Insert: {
          amount?: number | null
          amount_decrypted?: never
          amount_enc?: string | null
          channel?: string | null
          created_at?: string | null
          credential_request_id?: string | null
          household_id?: string | null
          payment_date?: string | null
          payment_id?: string | null
          payment_type?: string | null
          posted_by_user_id?: string | null
          reference_no?: string | null
          rental_request_id?: string | null
          resident_id?: string | null
          service_request_id?: string | null
          status?: string | null
          vital_event_id?: string | null
          waived?: boolean | null
          waiver_reason?: string | null
          woreda_id?: string | null
        }
        Update: {
          amount?: number | null
          amount_decrypted?: never
          amount_enc?: string | null
          channel?: string | null
          created_at?: string | null
          credential_request_id?: string | null
          household_id?: string | null
          payment_date?: string | null
          payment_id?: string | null
          payment_type?: string | null
          posted_by_user_id?: string | null
          reference_no?: string | null
          rental_request_id?: string | null
          resident_id?: string | null
          service_request_id?: string | null
          status?: string | null
          vital_event_id?: string | null
          waived?: boolean | null
          waiver_reason?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_credential_request_id_fkey"
            columns: ["credential_request_id"]
            isOneToOne: false
            referencedRelation: "credential_request"
            referencedColumns: ["credential_request_id"]
          },
          {
            foreignKeyName: "payment_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "payment_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "payment_posted_by_user_id_fkey"
            columns: ["posted_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_rental_request_id_fkey"
            columns: ["rental_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "payment_rental_request_id_fkey"
            columns: ["rental_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request_decrypted"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "payment_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "payment_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "payment_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "payment_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "payment_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request_decrypted"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "payment_vital_event_id_fkey"
            columns: ["vital_event_id"]
            isOneToOne: false
            referencedRelation: "vital_event"
            referencedColumns: ["vital_event_id"]
          },
          {
            foreignKeyName: "payment_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      payment_reconciliation_exception_decrypted: {
        Row: {
          created_at: string | null
          created_by: string | null
          exception_id: string | null
          exception_type: string | null
          expected_settlement_amount: number | null
          expected_settlement_amount_decrypted: number | null
          expected_settlement_amount_enc: string | null
          external_reference: string | null
          received_amount: number | null
          received_amount_decrypted: number | null
          received_amount_enc: string | null
          rent_account_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          woreda_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          exception_id?: string | null
          exception_type?: string | null
          expected_settlement_amount?: number | null
          expected_settlement_amount_decrypted?: never
          expected_settlement_amount_enc?: string | null
          external_reference?: string | null
          received_amount?: number | null
          received_amount_decrypted?: never
          received_amount_enc?: string | null
          rent_account_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          exception_id?: string | null
          exception_type?: string | null
          expected_settlement_amount?: number | null
          expected_settlement_amount_decrypted?: never
          expected_settlement_amount_enc?: string | null
          external_reference?: string | null
          received_amount?: number | null
          received_amount_decrypted?: never
          received_amount_enc?: string | null
          rent_account_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_exception_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_reconciliation_exception_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "payment_reconciliation_exception_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_reconciliation_exception_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_charge_decrypted: {
        Row: {
          approved_adjustment_amount: number | null
          approved_adjustment_amount_decrypted: number | null
          approved_adjustment_amount_enc: string | null
          base_rent_amount: number | null
          base_rent_amount_decrypted: number | null
          base_rent_amount_enc: string | null
          charge_date: string | null
          created_at: string | null
          due_date: string | null
          ethiopian_month: number | null
          ethiopian_period_key: string | null
          ethiopian_year: number | null
          occupancy_id: string | null
          rent_account_id: string | null
          rent_charge_id: string | null
          settled_at: string | null
          settled_by_payment_id: string | null
          status: string | null
          total_amount: number | null
          total_amount_decrypted: number | null
          total_amount_enc: string | null
          updated_at: string | null
          woreda_id: string | null
        }
        Insert: {
          approved_adjustment_amount?: number | null
          approved_adjustment_amount_decrypted?: never
          approved_adjustment_amount_enc?: string | null
          base_rent_amount?: number | null
          base_rent_amount_decrypted?: never
          base_rent_amount_enc?: string | null
          charge_date?: string | null
          created_at?: string | null
          due_date?: string | null
          ethiopian_month?: number | null
          ethiopian_period_key?: string | null
          ethiopian_year?: number | null
          occupancy_id?: string | null
          rent_account_id?: string | null
          rent_charge_id?: string | null
          settled_at?: string | null
          settled_by_payment_id?: string | null
          status?: string | null
          total_amount?: number | null
          total_amount_decrypted?: never
          total_amount_enc?: string | null
          updated_at?: string | null
          woreda_id?: string | null
        }
        Update: {
          approved_adjustment_amount?: number | null
          approved_adjustment_amount_decrypted?: never
          approved_adjustment_amount_enc?: string | null
          base_rent_amount?: number | null
          base_rent_amount_decrypted?: never
          base_rent_amount_enc?: string | null
          charge_date?: string | null
          created_at?: string | null
          due_date?: string | null
          ethiopian_month?: number | null
          ethiopian_period_key?: string | null
          ethiopian_year?: number | null
          occupancy_id?: string | null
          rent_account_id?: string | null
          rent_charge_id?: string | null
          settled_at?: string | null
          settled_by_payment_id?: string | null
          status?: string | null
          total_amount?: number | null
          total_amount_decrypted?: never
          total_amount_enc?: string | null
          updated_at?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rent_charge_occupancy_id_fkey"
            columns: ["occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rent_charge_occupancy_id_fkey"
            columns: ["occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_decrypted"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rent_charge_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "rent_charge_settled_by_payment_id_fkey"
            columns: ["settled_by_payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rent_charge_settled_by_payment_id_fkey"
            columns: ["settled_by_payment_id"]
            isOneToOne: false
            referencedRelation: "payment_decrypted"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rent_charge_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_payment_settlement_decrypted: {
        Row: {
          created_by: string | null
          payment_id: string | null
          rent_charge_id: string | null
          settled_at: string | null
          settlement_amount: number | null
          settlement_amount_decrypted: number | null
          settlement_amount_enc: string | null
          settlement_id: string | null
          status: string | null
          woreda_id: string | null
        }
        Insert: {
          created_by?: string | null
          payment_id?: string | null
          rent_charge_id?: string | null
          settled_at?: string | null
          settlement_amount?: number | null
          settlement_amount_decrypted?: never
          settlement_amount_enc?: string | null
          settlement_id?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Update: {
          created_by?: string | null
          payment_id?: string | null
          rent_charge_id?: string | null
          settled_at?: string | null
          settlement_amount?: number | null
          settlement_amount_decrypted?: never
          settlement_amount_enc?: string | null
          settlement_id?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rent_payment_settlement_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rent_payment_settlement_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "rental_payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "rent_payment_settlement_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charge"
            referencedColumns: ["rent_charge_id"]
          },
          {
            foreignKeyName: "rent_payment_settlement_rent_charge_id_fkey"
            columns: ["rent_charge_id"]
            isOneToOne: false
            referencedRelation: "rent_charge_decrypted"
            referencedColumns: ["rent_charge_id"]
          },
          {
            foreignKeyName: "rent_payment_settlement_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_rate_history_decrypted: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          change_reason: string | null
          created_at: string | null
          effective_period_key: string | null
          monthly_amount: number | null
          monthly_amount_decrypted: number | null
          monthly_amount_enc: string | null
          rent_account_id: string | null
          rent_rate_id: string | null
          status: string | null
          woreda_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          change_reason?: string | null
          created_at?: string | null
          effective_period_key?: string | null
          monthly_amount?: number | null
          monthly_amount_decrypted?: never
          monthly_amount_enc?: string | null
          rent_account_id?: string | null
          rent_rate_id?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          change_reason?: string | null
          created_at?: string | null
          effective_period_key?: string | null
          monthly_amount?: number | null
          monthly_amount_decrypted?: never
          monthly_amount_enc?: string | null
          rent_account_id?: string | null
          rent_rate_id?: string | null
          status?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rent_rate_history_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rent_rate_history_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "rent_rate_history_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rent_reminder_decrypted: {
        Row: {
          created_at: string | null
          delivery_channel: string | null
          delivery_status: string | null
          reminder_id: string | null
          reminder_type: string | null
          rent_account_id: string | null
          snapshot_amount: number | null
          snapshot_amount_decrypted: number | null
          snapshot_amount_enc: string | null
          snapshot_month_count: number | null
          snapshot_oldest_overdue_period: string | null
          woreda_id: string | null
        }
        Insert: {
          created_at?: string | null
          delivery_channel?: string | null
          delivery_status?: string | null
          reminder_id?: string | null
          reminder_type?: string | null
          rent_account_id?: string | null
          snapshot_amount?: number | null
          snapshot_amount_decrypted?: never
          snapshot_amount_enc?: string | null
          snapshot_month_count?: number | null
          snapshot_oldest_overdue_period?: string | null
          woreda_id?: string | null
        }
        Update: {
          created_at?: string | null
          delivery_channel?: string | null
          delivery_status?: string | null
          reminder_id?: string | null
          reminder_type?: string | null
          rent_account_id?: string | null
          snapshot_amount?: number | null
          snapshot_amount_decrypted?: never
          snapshot_amount_enc?: string | null
          snapshot_month_count?: number | null
          snapshot_oldest_overdue_period?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rent_reminder_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "rent_reminder_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rental_occupancy_decrypted: {
        Row: {
          created_at: string | null
          household_id: string | null
          occupancy_id: string | null
          originating_request_id: string | null
          rent_amount: number | null
          rent_amount_decrypted: number | null
          rent_amount_enc: string | null
          rent_start_date: string | null
          rental_house_id: string | null
          resident_id: string | null
          status: string | null
          termination_date: string | null
          termination_reason: string | null
          updated_at: string | null
          woreda_id: string | null
        }
        Insert: {
          created_at?: string | null
          household_id?: string | null
          occupancy_id?: string | null
          originating_request_id?: string | null
          rent_amount?: number | null
          rent_amount_decrypted?: never
          rent_amount_enc?: string | null
          rent_start_date?: string | null
          rental_house_id?: string | null
          resident_id?: string | null
          status?: string | null
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string | null
          woreda_id?: string | null
        }
        Update: {
          created_at?: string | null
          household_id?: string | null
          occupancy_id?: string | null
          originating_request_id?: string | null
          rent_amount?: number | null
          rent_amount_decrypted?: never
          rent_amount_enc?: string | null
          rent_start_date?: string | null
          rental_house_id?: string | null
          resident_id?: string | null
          status?: string | null
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_occupancy_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rental_occupancy_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rental_occupancy_originating_request_id_fkey"
            columns: ["originating_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "rental_occupancy_originating_request_id_fkey"
            columns: ["originating_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request_decrypted"
            referencedColumns: ["rental_request_id"]
          },
          {
            foreignKeyName: "rental_occupancy_rental_house_id_fkey"
            columns: ["rental_house_id"]
            isOneToOne: false
            referencedRelation: "kebele_rental_house"
            referencedColumns: ["rental_house_id"]
          },
          {
            foreignKeyName: "rental_occupancy_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      rental_occupancy_request_decrypted: {
        Row: {
          approval_decision_at: string | null
          approved_by_user_id: string | null
          created_at: string | null
          existing_occupancy_id: string | null
          household_id: string | null
          reject_reason: string | null
          rent_amount: number | null
          rent_amount_decrypted: number | null
          rent_amount_enc: string | null
          rent_start_date: string | null
          rental_house_id: string | null
          rental_request_id: string | null
          request_number: string | null
          request_type: string | null
          requested_by_user_id: string | null
          resident_id: string | null
          resulting_occupancy_id: string | null
          return_reason: string | null
          status: string | null
          termination_date: string | null
          termination_reason: string | null
          updated_at: string | null
          verification_checklist: Json | null
          verified_at: string | null
          verified_by_user_id: string | null
          woreda_id: string | null
        }
        Insert: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string | null
          existing_occupancy_id?: string | null
          household_id?: string | null
          reject_reason?: string | null
          rent_amount?: number | null
          rent_amount_decrypted?: never
          rent_amount_enc?: string | null
          rent_start_date?: string | null
          rental_house_id?: string | null
          rental_request_id?: string | null
          request_number?: string | null
          request_type?: string | null
          requested_by_user_id?: string | null
          resident_id?: string | null
          resulting_occupancy_id?: string | null
          return_reason?: string | null
          status?: string | null
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string | null
          verification_checklist?: Json | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id?: string | null
        }
        Update: {
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          created_at?: string | null
          existing_occupancy_id?: string | null
          household_id?: string | null
          reject_reason?: string | null
          rent_amount?: number | null
          rent_amount_decrypted?: never
          rent_amount_enc?: string | null
          rent_start_date?: string | null
          rental_house_id?: string | null
          rental_request_id?: string | null
          request_number?: string | null
          request_type?: string | null
          requested_by_user_id?: string | null
          resident_id?: string | null
          resulting_occupancy_id?: string | null
          return_reason?: string | null
          status?: string | null
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string | null
          verification_checklist?: Json | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_occupancy_request_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_existing_fk"
            columns: ["existing_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_existing_fk"
            columns: ["existing_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_decrypted"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_rental_house_id_fkey"
            columns: ["rental_house_id"]
            isOneToOne: false
            referencedRelation: "kebele_rental_house"
            referencedColumns: ["rental_house_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resulting_fk"
            columns: ["resulting_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_resulting_fk"
            columns: ["resulting_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_decrypted"
            referencedColumns: ["occupancy_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_verified_by_user_id_fkey"
            columns: ["verified_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rental_occupancy_request_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      resident_decrypted: {
        Row: {
          active_flag: boolean | null
          birth_place: Json | null
          created_at: string | null
          current_household_id: string | null
          current_residence_extra: Json | null
          date_of_birth: string | null
          email: string | null
          email_decrypted: string | null
          email_enc: string | null
          ethnicity: string | null
          father_name: string | null
          first_name: string | null
          former_residence: Json | null
          full_name: string | null
          full_name_am: string | null
          grandfather_name: string | null
          marital_status: string | null
          mother_full_name: string | null
          national_id_no: string | null
          national_id_no_blind_index: string | null
          national_id_no_decrypted: string | null
          national_id_no_enc: string | null
          phone_number: string | null
          phone_number_blind_index: string | null
          phone_number_decrypted: string | null
          phone_number_enc: string | null
          photo_url: string | null
          relation_to_head: string | null
          religion: string | null
          residency_start_date: string | null
          residency_status: string | null
          resident_id: string | null
          resident_number: string | null
          sex: string | null
          updated_at: string | null
          woreda_id: string | null
          work_info: Json | null
        }
        Insert: {
          active_flag?: boolean | null
          birth_place?: Json | null
          created_at?: string | null
          current_household_id?: string | null
          current_residence_extra?: Json | null
          date_of_birth?: string | null
          email?: string | null
          email_decrypted?: never
          email_enc?: string | null
          ethnicity?: string | null
          father_name?: string | null
          first_name?: string | null
          former_residence?: Json | null
          full_name?: string | null
          full_name_am?: string | null
          grandfather_name?: string | null
          marital_status?: string | null
          mother_full_name?: string | null
          national_id_no?: string | null
          national_id_no_blind_index?: string | null
          national_id_no_decrypted?: never
          national_id_no_enc?: string | null
          phone_number?: string | null
          phone_number_blind_index?: string | null
          phone_number_decrypted?: never
          phone_number_enc?: string | null
          photo_url?: string | null
          relation_to_head?: string | null
          religion?: string | null
          residency_start_date?: string | null
          residency_status?: string | null
          resident_id?: string | null
          resident_number?: string | null
          sex?: string | null
          updated_at?: string | null
          woreda_id?: string | null
          work_info?: Json | null
        }
        Update: {
          active_flag?: boolean | null
          birth_place?: Json | null
          created_at?: string | null
          current_household_id?: string | null
          current_residence_extra?: Json | null
          date_of_birth?: string | null
          email?: string | null
          email_decrypted?: never
          email_enc?: string | null
          ethnicity?: string | null
          father_name?: string | null
          first_name?: string | null
          former_residence?: Json | null
          full_name?: string | null
          full_name_am?: string | null
          grandfather_name?: string | null
          marital_status?: string | null
          mother_full_name?: string | null
          national_id_no?: string | null
          national_id_no_blind_index?: string | null
          national_id_no_decrypted?: never
          national_id_no_enc?: string | null
          phone_number?: string | null
          phone_number_blind_index?: string | null
          phone_number_decrypted?: never
          phone_number_enc?: string | null
          photo_url?: string | null
          relation_to_head?: string | null
          religion?: string | null
          residency_start_date?: string | null
          residency_status?: string | null
          resident_id?: string | null
          resident_number?: string | null
          sex?: string | null
          updated_at?: string | null
          woreda_id?: string | null
          work_info?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_current_household_id_fkey"
            columns: ["current_household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "resident_current_household_id_fkey"
            columns: ["current_household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "resident_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      service_request_checkpoint_decrypted: {
        Row: {
          active_plan_id: string | null
          checkpoint_id: string | null
          has_active_occupancy: boolean | null
          has_active_plan: boolean | null
          oldest_overdue_period: string | null
          overdue_month_count: number | null
          overdue_total: number | null
          overdue_total_decrypted: number | null
          overdue_total_enc: string | null
          override_reason: string | null
          override_used: boolean | null
          rent_account_id: string | null
          rental_house_id: string | null
          resident_id: string | null
          resolved_at: string | null
          service_request_id: string | null
          woreda_id: string | null
          would_block: boolean | null
        }
        Insert: {
          active_plan_id?: string | null
          checkpoint_id?: string | null
          has_active_occupancy?: boolean | null
          has_active_plan?: boolean | null
          oldest_overdue_period?: string | null
          overdue_month_count?: number | null
          overdue_total?: number | null
          overdue_total_decrypted?: never
          overdue_total_enc?: string | null
          override_reason?: string | null
          override_used?: boolean | null
          rent_account_id?: string | null
          rental_house_id?: string | null
          resident_id?: string | null
          resolved_at?: string | null
          service_request_id?: string | null
          woreda_id?: string | null
          would_block?: boolean | null
        }
        Update: {
          active_plan_id?: string | null
          checkpoint_id?: string | null
          has_active_occupancy?: boolean | null
          has_active_plan?: boolean | null
          oldest_overdue_period?: string | null
          overdue_month_count?: number | null
          overdue_total?: number | null
          overdue_total_decrypted?: never
          overdue_total_enc?: string | null
          override_reason?: string | null
          override_used?: boolean | null
          rent_account_id?: string | null
          rental_house_id?: string | null
          resident_id?: string | null
          resolved_at?: string | null
          service_request_id?: string | null
          woreda_id?: string | null
          would_block?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "service_request_checkpoint_active_plan_id_fkey"
            columns: ["active_plan_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_plan"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_active_plan_id_fkey"
            columns: ["active_plan_id"]
            isOneToOne: false
            referencedRelation: "arrears_repayment_plan_decrypted"
            referencedColumns: ["plan_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_rent_account_id_fkey"
            columns: ["rent_account_id"]
            isOneToOne: false
            referencedRelation: "rent_account"
            referencedColumns: ["rent_account_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_rental_house_id_fkey"
            columns: ["rental_house_id"]
            isOneToOne: false
            referencedRelation: "kebele_rental_house"
            referencedColumns: ["rental_house_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: true
            referencedRelation: "service_request"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: true
            referencedRelation: "service_request_decrypted"
            referencedColumns: ["service_request_id"]
          },
          {
            foreignKeyName: "service_request_checkpoint_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
      service_request_decrypted: {
        Row: {
          addressed_to: string | null
          applicant_name: string | null
          applicant_phone: string | null
          applicant_phone_decrypted: string | null
          applicant_phone_enc: string | null
          approval_decision_at: string | null
          approved_by_user_id: string | null
          category: string | null
          closed_at: string | null
          created_at: string | null
          details: string | null
          fee_amount: number | null
          household_id: string | null
          incident_date: string | null
          incident_place: string | null
          issued_at: string | null
          issued_by_user_id: string | null
          issued_letter_html: string | null
          kebele_id: string | null
          letter_summary: string | null
          payment_id: string | null
          priority: string | null
          purpose: string | null
          reject_reason: string | null
          request_number: string | null
          requested_by_user_id: string | null
          resident_id: string | null
          resolution_notes: string | null
          respondent_name: string | null
          return_reason: string | null
          service_request_id: string | null
          service_type_id: string | null
          status: string | null
          subject: string | null
          submitted_at: string | null
          updated_at: string | null
          verification_checklist: Json | null
          verification_token: string | null
          verified_at: string | null
          verified_by_user_id: string | null
          woreda_id: string | null
        }
        Insert: {
          addressed_to?: string | null
          applicant_name?: string | null
          applicant_phone?: string | null
          applicant_phone_decrypted?: never
          applicant_phone_enc?: string | null
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          category?: string | null
          closed_at?: string | null
          created_at?: string | null
          details?: string | null
          fee_amount?: number | null
          household_id?: string | null
          incident_date?: string | null
          incident_place?: string | null
          issued_at?: string | null
          issued_by_user_id?: string | null
          issued_letter_html?: string | null
          kebele_id?: string | null
          letter_summary?: string | null
          payment_id?: string | null
          priority?: string | null
          purpose?: string | null
          reject_reason?: string | null
          request_number?: string | null
          requested_by_user_id?: string | null
          resident_id?: string | null
          resolution_notes?: string | null
          respondent_name?: string | null
          return_reason?: string | null
          service_request_id?: string | null
          service_type_id?: string | null
          status?: string | null
          subject?: string | null
          submitted_at?: string | null
          updated_at?: string | null
          verification_checklist?: Json | null
          verification_token?: string | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id?: string | null
        }
        Update: {
          addressed_to?: string | null
          applicant_name?: string | null
          applicant_phone?: string | null
          applicant_phone_decrypted?: never
          applicant_phone_enc?: string | null
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          category?: string | null
          closed_at?: string | null
          created_at?: string | null
          details?: string | null
          fee_amount?: number | null
          household_id?: string | null
          incident_date?: string | null
          incident_place?: string | null
          issued_at?: string | null
          issued_by_user_id?: string | null
          issued_letter_html?: string | null
          kebele_id?: string | null
          letter_summary?: string | null
          payment_id?: string | null
          priority?: string | null
          purpose?: string | null
          reject_reason?: string | null
          request_number?: string | null
          requested_by_user_id?: string | null
          resident_id?: string | null
          resolution_notes?: string | null
          respondent_name?: string | null
          return_reason?: string | null
          service_request_id?: string | null
          service_type_id?: string | null
          status?: string | null
          subject?: string | null
          submitted_at?: string | null
          updated_at?: string | null
          verification_checklist?: Json | null
          verification_token?: string | null
          verified_at?: string | null
          verified_by_user_id?: string | null
          woreda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_request_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "service_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household_decrypted"
            referencedColumns: ["household_id"]
          },
          {
            foreignKeyName: "service_request_issued_by_user_id_fkey"
            columns: ["issued_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_kebele_id_fkey"
            columns: ["kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "service_request_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "service_request_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_decrypted"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "service_request_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "household_member_roster"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "resident_decrypted"
            referencedColumns: ["resident_id"]
          },
          {
            foreignKeyName: "service_request_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_type"
            referencedColumns: ["service_type_id"]
          },
          {
            foreignKeyName: "service_request_verified_by_user_id_fkey"
            columns: ["verified_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_request_woreda_id_fkey"
            columns: ["woreda_id"]
            isOneToOne: false
            referencedRelation: "woreda"
            referencedColumns: ["woreda_id"]
          },
        ]
      }
    }
    Functions: {
      check_credential_print_eligibility: {
        Args: { _credential_id: string }
        Returns: undefined
      }
      create_arrears_repayment_plan: {
        Args: {
          _installment_count: number
          _installment_due_dates: string[]
          _reason: string
          _rent_account_id: string
        }
        Returns: string
      }
      current_console_permissions: { Args: never; Returns: string[] }
      current_permissions: { Args: never; Returns: string[] }
      decrypt_pii_numeric: {
        Args: { _cipher: string; _woreda_id: string }
        Returns: number
      }
      decrypt_pii_text: {
        Args: { _cipher: string; _woreda_id: string }
        Returns: string
      }
      default_role_perms: { Args: { _role: string }; Returns: string[] }
      derive_woreda_key: { Args: { _woreda_id: string }; Returns: string }
      discard_id_card_template_draft: { Args: never; Returns: undefined }
      encrypt_pii_numeric: {
        Args: { _value: number; _woreda_id: string }
        Returns: string
      }
      encrypt_pii_text: {
        Args: { _plain: string; _woreda_id: string }
        Returns: string
      }
      entity_approve_perm_ok: { Args: { _entity: string }; Returns: boolean }
      entity_attach_perm_ok: { Args: { _entity: string }; Returns: boolean }
      entity_belongs_to_woreda: {
        Args: { _entity: string; _entity_id: string; _woreda_id: string }
        Returns: boolean
      }
      entity_read_perm_ok: { Args: { _entity: string }; Returns: boolean }
      gen_letter_verification_token: { Args: never; Returns: string }
      gen_receipt_verification_token: { Args: never; Returns: string }
      generate_rent_charges: {
        Args: { _due_date: string; _target_period: string }
        Returns: Json
      }
      generate_rent_reminders: { Args: never; Returns: Json }
      get_civil_kpis: { Args: never; Returns: Json }
      get_credential_kpis: { Args: never; Returns: Json }
      get_credential_live_status: {
        Args: { _credential_number: string }
        Returns: string
      }
      get_rent_account_ledger_summary: {
        Args: { _rent_account_id: string }
        Returns: Json
      }
      get_rental_arrears_aging_report: {
        Args: { _current_period_key: string }
        Returns: {
          bucket_label: string
          charge_count: number
          total_amount: number
        }[]
      }
      get_rental_billing_collection_report: {
        Args: never
        Returns: {
          billed_total: number
          collected_total: number
          outstanding_total: number
          period_key: string
        }[]
      }
      get_rental_checkpoint_activity_report: {
        Args: { _end_date: string; _start_date: string }
        Returns: {
          blocked_count: number
          overridden_count: number
          passed_count: number
          total_resolved: number
        }[]
      }
      get_rental_plan_compliance_report: {
        Args: never
        Returns: {
          installments_cancelled: number
          installments_due: number
          installments_overdue: number
          installments_paid: number
          installments_scheduled: number
          plan_count: number
          status: string
        }[]
      }
      get_rental_reconciliation_report: {
        Args: never
        Returns: {
          billed_total: number
          exception_count: number
          exception_total: number
          reversed_total: number
          settled_total: number
        }[]
      }
      get_service_kpis: { Args: never; Returns: Json }
      get_user_woreda_id: { Args: never; Returns: string }
      is_active_app_user: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: never; Returns: boolean }
      luhn_check_digit: { Args: { _digits: string }; Returns: number }
      my_national_id_blind_index: { Args: { _id: string }; Returns: string }
      my_phone_blind_index: { Args: { _phone: string }; Returns: string }
      national_id_blind_index: {
        Args: { _id: string; _woreda_id: string }
        Returns: string
      }
      normalize_phone: { Args: { _phone: string }; Returns: string }
      phone_blind_index: {
        Args: { _phone: string; _woreda_id: string }
        Returns: string
      }
      pii_encryption_status: {
        Args: never
        Returns: {
          column_label: string
          key_present: boolean
          rows_encrypted: number
          rows_with_plaintext: number
        }[]
      }
      pii_root_key: { Args: never; Returns: string }
      provision_rent_account: {
        Args: { _billing_start_period_key: string; _occupancy_id: string }
        Returns: string
      }
      publish_id_card_template: { Args: never; Returns: undefined }
      rate_limit_hit: {
        Args: { _bucket_key: string; _window_seconds: number }
        Returns: number
      }
      refresh_rent_ledger_statuses: { Args: never; Returns: Json }
      rental_eligibility: {
        Args: {
          _rental_house_id: string
          _request_type: string
          _resident_id: string
        }
        Returns: Json
      }
      rental_period_month_index: {
        Args: { _period_key: string }
        Returns: number
      }
      resolve_civil_fee: { Args: { _event_type: string }; Returns: number }
      resolve_credential_fee: {
        Args: { _request_type: string }
        Returns: number
      }
      resolve_reconciliation_exception: {
        Args: {
          _exception_id: string
          _resolution_note: string
          _status: string
        }
        Returns: undefined
      }
      resolve_rental_checkpoint: {
        Args: { _resident_id: string }
        Returns: Json
      }
      resolve_rental_checkpoint_core: {
        Args: { _resident_id: string }
        Returns: Json
      }
      resolve_service_fee: {
        Args: { _service_type_id: string }
        Returns: number
      }
      reverse_rental_payment: {
        Args: { _payment_id: string; _reason: string }
        Returns: Json
      }
      settle_arrears_installments: {
        Args: {
          _channel: string
          _idempotency_key: string
          _installment_ids: string[]
          _payer_resident_id: string
          _payment_amount: number
          _payment_date: string
          _plan_id: string
          _reference_number: string
        }
        Returns: Json
      }
      settle_rent_payment: {
        Args: {
          _channel: string
          _idempotency_key: string
          _payer_resident_id: string
          _payment_amount: number
          _payment_date: string
          _reference_number: string
          _rent_account_id: string
          _rent_charge_ids: string[]
        }
        Returns: Json
      }
      storage_path_woreda_id: { Args: { object_name: string }; Returns: string }
      user_has_any_perm: { Args: { _perms: string[] }; Returns: boolean }
      user_has_console_perm: { Args: { _perm: string }; Returns: boolean }
      user_has_perm: { Args: { _perm: string }; Returns: boolean }
      user_permission_override_target_role_ok: {
        Args: { _user_id: string }
        Returns: boolean
      }
      verify_credential_token: {
        Args: { _token: string }
        Returns: {
          credential_number: string
          date_of_birth: string
          expiry_date: string
          issue_date: string
          kebele_name_am: string
          kebele_name_en: string
          photo_path: string
          resident_full_name: string
          status: string
          woreda_name_am: string
          woreda_name_en: string
        }[]
      }
      verify_receipt: {
        Args: { _token: string }
        Returns: {
          channel: string
          kebele_name_am: string
          kebele_name_en: string
          paid_by_full_name: string
          paid_by_full_name_am: string
          payment_type: string
          printed_at: string
          receipt_date: string
          receipt_number: string
          total_amount: number
          woreda_name_am: string
          woreda_name_en: string
        }[]
      }
      verify_service_letter: {
        Args: { _token: string }
        Returns: {
          issued_at: string
          kebele_name_am: string
          kebele_name_en: string
          letter_summary: string
          request_number: string
          resident_full_name: string
          service_type_am: string
          service_type_en: string
          subject: string
          woreda_name_am: string
          woreda_name_en: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
