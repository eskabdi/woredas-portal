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
  public: {
    Tables: {
      app_user: {
        Row: {
          console_role_id: string | null
          created_at: string
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
          created_at: string
          credential_id: string | null
          credential_request_id: string
          credential_type: string
          duplicate_flag: boolean
          duplicate_notes: string | null
          household_id: string | null
          issuing_kebele_id: string
          notes: string | null
          payment_id: string | null
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
          created_at?: string
          credential_id?: string | null
          credential_request_id?: string
          credential_type?: string
          duplicate_flag?: boolean
          duplicate_notes?: string | null
          household_id?: string | null
          issuing_kebele_id: string
          notes?: string | null
          payment_id?: string | null
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
          created_at?: string
          credential_id?: string | null
          credential_request_id?: string
          credential_type?: string
          duplicate_flag?: boolean
          duplicate_notes?: string | null
          household_id?: string | null
          issuing_kebele_id?: string
          notes?: string | null
          payment_id?: string | null
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
            foreignKeyName: "credential_request_issuing_kebele_id_fkey"
            columns: ["issuing_kebele_id"]
            isOneToOne: false
            referencedRelation: "kebele"
            referencedColumns: ["kebele_id"]
          },
          {
            foreignKeyName: "credential_request_payment_fk"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment"
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
      fee_schedule: {
        Row: {
          created_at: string
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
          po_box: string | null
          rent_amount: number | null
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
          po_box?: string | null
          rent_amount?: number | null
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
          po_box?: string | null
          rent_amount?: number | null
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
      payment: {
        Row: {
          amount: number
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
          woreda_id: string
        }
        Insert: {
          amount: number
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
          woreda_id: string
        }
        Update: {
          amount?: number
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
            foreignKeyName: "payment_service_request_id_fkey"
            columns: ["service_request_id"]
            isOneToOne: false
            referencedRelation: "service_request"
            referencedColumns: ["service_request_id"]
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
      rental_occupancy: {
        Row: {
          created_at: string
          household_id: string | null
          occupancy_id: string
          originating_request_id: string | null
          rent_amount: number
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
            foreignKeyName: "rental_occupancy_originating_request_id_fkey"
            columns: ["originating_request_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy_request"
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
            foreignKeyName: "rental_occupancy_request_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "household"
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
            foreignKeyName: "rental_occupancy_request_resulting_fk"
            columns: ["resulting_occupancy_id"]
            isOneToOne: false
            referencedRelation: "rental_occupancy"
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
          phone_number: string | null
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
          phone_number?: string | null
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
          phone_number?: string | null
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
          approval_decision_at: string | null
          approved_by_user_id: string | null
          category: string
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
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          category?: string
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
          approval_decision_at?: string | null
          approved_by_user_id?: string | null
          category?: string
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
            foreignKeyName: "vital_event_issued_by_user_id_fkey"
            columns: ["issued_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_user"
            referencedColumns: ["user_id"]
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
        ]
      }
    }
    Functions: {
      current_console_permissions: { Args: never; Returns: string[] }
      current_permissions: { Args: never; Returns: string[] }
      default_role_perms: { Args: { _role: string }; Returns: string[] }
      discard_id_card_template_draft: { Args: never; Returns: undefined }
      gen_letter_verification_token: { Args: never; Returns: string }
      gen_receipt_verification_token: { Args: never; Returns: string }
      get_credential_live_status: {
        Args: { _credential_number: string }
        Returns: string
      }
      get_user_woreda_id: { Args: never; Returns: string }
      is_active_app_user: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: never; Returns: boolean }
      luhn_check_digit: { Args: { _digits: string }; Returns: number }
      publish_id_card_template: { Args: never; Returns: undefined }
      storage_path_woreda_id: { Args: { object_name: string }; Returns: string }
      user_has_any_perm: { Args: { _perms: string[] }; Returns: boolean }
      user_has_console_perm: { Args: { _perm: string }; Returns: boolean }
      user_has_perm: { Args: { _perm: string }; Returns: boolean }
      user_permission_override_target_role_ok: {
        Args: { _user_id: string }
        Returns: boolean
      }
      verify_credential_token: {
        Args: { _credential_digits: string }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
