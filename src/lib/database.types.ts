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
      amazon_action_log: {
        Row: {
          action_type: string | null
          amount_aed: number | null
          approved_amount_aed: number | null
          confidence: string | null
          created_at: string
          created_by: string
          duplicate_warning: boolean
          expected_action_id: string
          follow_up_date: string | null
          id: string
          invoice_date: string | null
          invoice_value_aed: number | null
          notes: string | null
          outcome: string
          payment_number: string | null
          prt_number: string | null
          reason_note: string | null
          recovered_aed: number | null
          reference_type: string | null
          reference_value: string | null
          return_id: string | null
          sku: string | null
          srt_number: string | null
          tle_invoice_number: string | null
          workflow_status: string
        }
        Insert: {
          action_type?: string | null
          amount_aed?: number | null
          approved_amount_aed?: number | null
          confidence?: string | null
          created_at?: string
          created_by: string
          duplicate_warning?: boolean
          expected_action_id: string
          follow_up_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_value_aed?: number | null
          notes?: string | null
          outcome: string
          payment_number?: string | null
          prt_number?: string | null
          reason_note?: string | null
          recovered_aed?: number | null
          reference_type?: string | null
          reference_value?: string | null
          return_id?: string | null
          sku?: string | null
          srt_number?: string | null
          tle_invoice_number?: string | null
          workflow_status: string
        }
        Update: {
          action_type?: string | null
          amount_aed?: number | null
          approved_amount_aed?: number | null
          confidence?: string | null
          created_at?: string
          created_by?: string
          duplicate_warning?: boolean
          expected_action_id?: string
          follow_up_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_value_aed?: number | null
          notes?: string | null
          outcome?: string
          payment_number?: string | null
          prt_number?: string | null
          reason_note?: string | null
          recovered_aed?: number | null
          reference_type?: string | null
          reference_value?: string | null
          return_id?: string | null
          sku?: string | null
          srt_number?: string | null
          tle_invoice_number?: string | null
          workflow_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_action_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amazon_action_log_expected_action_id_fkey"
            columns: ["expected_action_id"]
            isOneToOne: false
            referencedRelation: "expected_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string | null
        }
        Relationships: []
      }
      blockers: {
        Row: {
          ageing_from: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          what: string
        }
        Insert: {
          ageing_from?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          what: string
        }
        Update: {
          ageing_from?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          what?: string
        }
        Relationships: [
          {
            foreignKeyName: "blockers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      remittance_deductions: {
        Row: {
          amazon_case_id: string | null
          amount_aed: number | null
          approved_amount_aed: number | null
          charge_type: string | null
          claim_amount_aed: number | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          dispute_id: string | null
          dispute_status: string | null
          id: string
          po_number: string | null
          prt_number: string | null
          recovery_date: string | null
          remark: string | null
          remittance_ref: string
          return_id: string | null
          return_missing: boolean
          source_line_key: string | null
          srt_number: string | null
          status: string
          tle_invoice_number: string | null
        }
        Insert: {
          amazon_case_id?: string | null
          amount_aed?: number | null
          approved_amount_aed?: number | null
          charge_type?: string | null
          claim_amount_aed?: number | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          dispute_id?: string | null
          dispute_status?: string | null
          id?: string
          po_number?: string | null
          prt_number?: string | null
          recovery_date?: string | null
          remark?: string | null
          remittance_ref: string
          return_id?: string | null
          return_missing?: boolean
          source_line_key?: string | null
          srt_number?: string | null
          status?: string
          tle_invoice_number?: string | null
        }
        Update: {
          amazon_case_id?: string | null
          amount_aed?: number | null
          approved_amount_aed?: number | null
          charge_type?: string | null
          claim_amount_aed?: number | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          dispute_id?: string | null
          dispute_status?: string | null
          id?: string
          po_number?: string | null
          prt_number?: string | null
          recovery_date?: string | null
          remark?: string | null
          remittance_ref?: string
          return_id?: string | null
          return_missing?: boolean
          source_line_key?: string | null
          srt_number?: string | null
          status?: string
          tle_invoice_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remittance_deductions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_sync: {
        Row: {
          key: string
          last_event_at: string
          last_topic: string | null
        }
        Insert: {
          key: string
          last_event_at?: string
          last_topic?: string | null
        }
        Update: {
          key?: string
          last_event_at?: string
          last_topic?: string | null
        }
        Relationships: []
      }
      breach_log: {
        Row: {
          aed_at_risk: number | null
          breach_date: string
          breach_type: string
          daily_task_id: string | null
          id: string
          logged_at: string
          task_title: string | null
          user_id: string
        }
        Insert: {
          aed_at_risk?: number | null
          breach_date: string
          breach_type: string
          daily_task_id?: string | null
          id?: string
          logged_at?: string
          task_title?: string | null
          user_id: string
        }
        Update: {
          aed_at_risk?: number | null
          breach_date?: string
          breach_type?: string
          daily_task_id?: string | null
          id?: string
          logged_at?: string
          task_title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "breach_log_daily_task_id_fkey"
            columns: ["daily_task_id"]
            isOneToOne: false
            referencedRelation: "daily_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breach_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cocoblu_ageing: {
        Row: {
          ageing_start_date: string
          created_at: string
          id: string
          invoice_date: string
          invoice_number: string
          line_number: number
          notes: string | null
          pdf_url: string | null
          qty_remaining: number
          qty_supplied: number
          sku: string
          source: string | null
          status: string
          supplied_date: string | null
          unit_cost: number | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          ageing_start_date?: string
          created_at?: string
          id?: string
          invoice_date: string
          invoice_number: string
          line_number?: number
          notes?: string | null
          pdf_url?: string | null
          qty_remaining?: number
          qty_supplied?: number
          sku: string
          source?: string | null
          status?: string
          supplied_date?: string | null
          unit_cost?: number | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          ageing_start_date?: string
          created_at?: string
          id?: string
          invoice_date?: string
          invoice_number?: string
          line_number?: number
          notes?: string | null
          pdf_url?: string | null
          qty_remaining?: number
          qty_supplied?: number
          sku?: string
          source?: string | null
          status?: string
          supplied_date?: string | null
          unit_cost?: number | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cocoblu_ageing_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cocoblu_supplies: {
        Row: {
          created_at: string | null
          id: string
          invoice_file_url: string | null
          invoice_number: string
          qty: number | null
          sku: string
          status: string | null
          supplied_date: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          invoice_file_url?: string | null
          invoice_number: string
          qty?: number | null
          sku: string
          status?: string | null
          supplied_date: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          invoice_file_url?: string | null
          invoice_number?: string
          qty?: number | null
          sku?: string
          status?: string | null
          supplied_date?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      daily_tasks: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          id: string
          source: string
          source_ref_id: string | null
          status: string
          task_date: string
          task_def_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          id?: string
          source?: string
          source_ref_id?: string | null
          status?: string
          task_date: string
          task_def_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          id?: string
          source?: string
          source_ref_id?: string | null
          status?: string
          task_date?: string
          task_def_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_tasks_source_ref_id_fkey"
            columns: ["source_ref_id"]
            isOneToOne: false
            referencedRelation: "expected_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_tasks_task_def_id_fkey"
            columns: ["task_def_id"]
            isOneToOne: false
            referencedRelation: "task_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      dispute_items: {
        Row: {
          comment: string | null
          created_at: string | null
          credit_amount_aed: number | null
          credit_date: string | null
          credit_ref: string | null
          dispute_number: string
          id: string
          line_amount_aed: number | null
          line_status: string | null
          resolved_at: string | null
          return_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          credit_amount_aed?: number | null
          credit_date?: string | null
          credit_ref?: string | null
          dispute_number: string
          id?: string
          line_amount_aed?: number | null
          line_status?: string | null
          resolved_at?: string | null
          return_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          credit_amount_aed?: number | null
          credit_date?: string | null
          credit_ref?: string | null
          dispute_number?: string
          id?: string
          line_amount_aed?: number | null
          line_status?: string | null
          resolved_at?: string | null
          return_id?: string
        }
        Relationships: []
      }
      disputes: {
        Row: {
          approval_status: string | null
          approved_amount_aed: number | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          credit_amount_aed: number | null
          credit_closed: boolean | null
          credit_date: string | null
          credit_transaction_ref: string | null
          dispute_number: string | null
          dispute_status: string | null
          dispute_type: string | null
          expected_action_id: string | null
          gap_accepted_by: string | null
          gap_aed: number | null
          id: string
          invoice_amount_aed: number
          invoice_date: string | null
          manager_instruction: string | null
          maricel_comment: string | null
          maricel_recommendation: string | null
          payment_number: string | null
          po_id: string | null
          po_number: string | null
          pre_dispute_checks: string | null
          prt_number: string | null
          raised_at: string | null
          resolution_comment: string | null
          resolved_at: string | null
          return_ids: string | null
          srt_number: string | null
          submitted_for_approval_at: string | null
          tle_invoice_number: string | null
        }
        Insert: {
          approval_status?: string | null
          approved_amount_aed?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          credit_amount_aed?: number | null
          credit_closed?: boolean | null
          credit_date?: string | null
          credit_transaction_ref?: string | null
          dispute_number?: string | null
          dispute_status?: string | null
          dispute_type?: string | null
          expected_action_id?: string | null
          gap_accepted_by?: string | null
          gap_aed?: number | null
          id?: string
          invoice_amount_aed: number
          invoice_date?: string | null
          manager_instruction?: string | null
          maricel_comment?: string | null
          maricel_recommendation?: string | null
          payment_number?: string | null
          po_id?: string | null
          po_number?: string | null
          pre_dispute_checks?: string | null
          prt_number?: string | null
          raised_at?: string | null
          resolution_comment?: string | null
          resolved_at?: string | null
          return_ids?: string | null
          srt_number?: string | null
          submitted_for_approval_at?: string | null
          tle_invoice_number?: string | null
        }
        Update: {
          approval_status?: string | null
          approved_amount_aed?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          credit_amount_aed?: number | null
          credit_closed?: boolean | null
          credit_date?: string | null
          credit_transaction_ref?: string | null
          dispute_number?: string | null
          dispute_status?: string | null
          dispute_type?: string | null
          expected_action_id?: string | null
          gap_accepted_by?: string | null
          gap_aed?: number | null
          id?: string
          invoice_amount_aed?: number
          invoice_date?: string | null
          manager_instruction?: string | null
          maricel_comment?: string | null
          maricel_recommendation?: string | null
          payment_number?: string | null
          po_id?: string | null
          po_number?: string | null
          pre_dispute_checks?: string | null
          prt_number?: string | null
          raised_at?: string | null
          resolution_comment?: string | null
          resolved_at?: string | null
          return_ids?: string | null
          srt_number?: string | null
          submitted_for_approval_at?: string | null
          tle_invoice_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disputes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_expected_action_id_fkey"
            columns: ["expected_action_id"]
            isOneToOne: false
            referencedRelation: "expected_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_gap_accepted_by_fkey"
            columns: ["gap_accepted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputes_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      expected_actions: {
        Row: {
          actioned_at: string | null
          aed_amount: number | null
          asin: string | null
          assigned_to: string | null
          created_at: string | null
          email_received_at: string
          email_sender: string | null
          email_subject: string | null
          id: string
          invoice_ref: string | null
          invoice_rows: Json | null
          needs_invoice: boolean | null
          payment_date: string | null
          po_number: string | null
          qty_cancelled: number | null
          qty_confirmed: number | null
          raw_body_snippet: string | null
          ref_number: string | null
          status: string
          type: string
        }
        Insert: {
          actioned_at?: string | null
          aed_amount?: number | null
          asin?: string | null
          assigned_to?: string | null
          created_at?: string | null
          email_received_at: string
          email_sender?: string | null
          email_subject?: string | null
          id?: string
          invoice_ref?: string | null
          invoice_rows?: Json | null
          needs_invoice?: boolean | null
          payment_date?: string | null
          po_number?: string | null
          qty_cancelled?: number | null
          qty_confirmed?: number | null
          raw_body_snippet?: string | null
          ref_number?: string | null
          status?: string
          type: string
        }
        Update: {
          actioned_at?: string | null
          aed_amount?: number | null
          asin?: string | null
          assigned_to?: string | null
          created_at?: string | null
          email_received_at?: string
          email_sender?: string | null
          email_subject?: string | null
          id?: string
          invoice_ref?: string | null
          invoice_rows?: Json | null
          needs_invoice?: boolean | null
          payment_date?: string | null
          po_number?: string | null
          qty_cancelled?: number | null
          qty_confirmed?: number | null
          raw_body_snippet?: string | null
          ref_number?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "expected_actions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_log: {
        Row: {
          email_type: string | null
          mailbox: string | null
          message_id: string
          processed_at: string
          received_at: string | null
        }
        Insert: {
          email_type?: string | null
          mailbox?: string | null
          message_id: string
          processed_at?: string
          received_at?: string | null
        }
        Update: {
          email_type?: string | null
          mailbox?: string | null
          message_id?: string
          processed_at?: string
          received_at?: string | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_aed: number | null
          balance_aed: number | null
          deduction_status: string | null
          due_date: string | null
          id: string
          invoice_date: string | null
          invoice_number: string
          match_status: string | null
          net_amount_aed: number | null
          paid_amount_aed: number | null
          payment_date: string | null
          payment_number: string | null
          payment_status: string | null
          po_number: string | null
          resolution_note: string | null
          sis_status: string | null
          source: string | null
          synced_at: string | null
        }
        Insert: {
          amount_aed?: number | null
          balance_aed?: number | null
          deduction_status?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number: string
          match_status?: string | null
          net_amount_aed?: number | null
          paid_amount_aed?: number | null
          payment_date?: string | null
          payment_number?: string | null
          payment_status?: string | null
          po_number?: string | null
          resolution_note?: string | null
          sis_status?: string | null
          source?: string | null
          synced_at?: string | null
        }
        Update: {
          amount_aed?: number | null
          balance_aed?: number | null
          deduction_status?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string
          match_status?: string | null
          net_amount_aed?: number | null
          paid_amount_aed?: number | null
          payment_date?: string | null
          payment_number?: string | null
          payment_status?: string | null
          po_number?: string | null
          resolution_note?: string | null
          sis_status?: string | null
          source?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      kpi_cache: {
        Row: {
          computed_at: string | null
          id: string
          metric_key: string
          status: string | null
          user_id: string
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          computed_at?: string | null
          id?: string
          metric_key: string
          status?: string | null
          user_id: string
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          computed_at?: string | null
          id?: string
          metric_key?: string
          status?: string | null
          user_id?: string
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_items: {
        Row: {
          amount: number | null
          brand: string | null
          created_at: string
          description: string | null
          disc_amount: number | null
          id: string
          line_number: number | null
          lp_id: string
          model_no: string | null
          qty_adjust_comment: string | null
          qty_original: number | null
          qty_purchased: number
          sku: string | null
          status: string
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          brand?: string | null
          created_at?: string
          description?: string | null
          disc_amount?: number | null
          id?: string
          line_number?: number | null
          lp_id: string
          model_no?: string | null
          qty_adjust_comment?: string | null
          qty_original?: number | null
          qty_purchased?: number
          sku?: string | null
          status?: string
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          brand?: string | null
          created_at?: string
          description?: string | null
          disc_amount?: number | null
          id?: string
          line_number?: number | null
          lp_id?: string
          model_no?: string | null
          qty_adjust_comment?: string | null
          qty_original?: number | null
          qty_purchased?: number
          sku?: string | null
          status?: string
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lp_items_lp_id_fkey"
            columns: ["lp_id"]
            isOneToOne: false
            referencedRelation: "lp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_orders: {
        Row: {
          amount_before_vat: number | null
          consignee_trn: string | null
          created_at: string
          created_by: string | null
          goods_received_date: string | null
          id: string
          lp_date: string
          lp_number: string
          net_amount: number | null
          notes: string | null
          pdf_url: string | null
          qtn_ref: string | null
          source: string
          terms: string | null
          updated_at: string
          vat_amount: number | null
          vendor_name: string
          vendor_trn: string | null
        }
        Insert: {
          amount_before_vat?: number | null
          consignee_trn?: string | null
          created_at?: string
          created_by?: string | null
          goods_received_date?: string | null
          id?: string
          lp_date: string
          lp_number: string
          net_amount?: number | null
          notes?: string | null
          pdf_url?: string | null
          qtn_ref?: string | null
          source?: string
          terms?: string | null
          updated_at?: string
          vat_amount?: number | null
          vendor_name: string
          vendor_trn?: string | null
        }
        Update: {
          amount_before_vat?: number | null
          consignee_trn?: string | null
          created_at?: string
          created_by?: string | null
          goods_received_date?: string | null
          id?: string
          lp_date?: string
          lp_number?: string
          net_amount?: number | null
          notes?: string | null
          pdf_url?: string | null
          qtn_ref?: string | null
          source?: string
          terms?: string | null
          updated_at?: string
          vat_amount?: number | null
          vendor_name?: string
          vendor_trn?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lp_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_sales: {
        Row: {
          created_at: string
          entity: string | null
          entity_other: string | null
          id: string
          invoice_number: string | null
          lp_item_id: string
          notes: string | null
          recorded_by: string | null
          sale_date: string | null
          salesman_name: string | null
          sold_qty: number
        }
        Insert: {
          created_at?: string
          entity?: string | null
          entity_other?: string | null
          id?: string
          invoice_number?: string | null
          lp_item_id: string
          notes?: string | null
          recorded_by?: string | null
          sale_date?: string | null
          salesman_name?: string | null
          sold_qty: number
        }
        Update: {
          created_at?: string
          entity?: string | null
          entity_other?: string | null
          id?: string
          invoice_number?: string | null
          lp_item_id?: string
          notes?: string | null
          recorded_by?: string | null
          sale_date?: string | null
          salesman_name?: string | null
          sold_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "lp_sales_lp_item_id_fkey"
            columns: ["lp_item_id"]
            isOneToOne: false
            referencedRelation: "lp_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lp_sales_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_abandoned_actions: {
        Row: {
          action_status: string
          actioned_at: string | null
          actioned_by: string | null
          checkout_created_at: string | null
          checkout_id: string
          created_at: string
          customer_email: string | null
          customer_name: string | null
          id: string
          note: string | null
          recovery_url: string | null
          total: number | null
          zoho_deal_id: string | null
        }
        Insert: {
          action_status?: string
          actioned_at?: string | null
          actioned_by?: string | null
          checkout_created_at?: string | null
          checkout_id: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          note?: string | null
          recovery_url?: string | null
          total?: number | null
          zoho_deal_id?: string | null
        }
        Update: {
          action_status?: string
          actioned_at?: string | null
          actioned_by?: string | null
          checkout_created_at?: string | null
          checkout_id?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          id?: string
          note?: string | null
          recovery_url?: string | null
          total?: number | null
          zoho_deal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mm_abandoned_actions_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_recovered_carts: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          note: string | null
          order_ref: string
          recovered_by: string | null
          recovered_date: string
          validation_message: string | null
          validation_status: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          note?: string | null
          order_ref: string
          recovered_by?: string | null
          recovered_date?: string
          validation_message?: string | null
          validation_status?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          note?: string | null
          order_ref?: string
          recovered_by?: string | null
          recovered_date?: string
          validation_message?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mm_recovered_carts_recovered_by_fkey"
            columns: ["recovered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mm_targets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          month: string
          target_amount: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          month: string
          target_amount: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          month?: string
          target_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "mm_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      priorities: {
        Row: {
          assigned_to: string | null
          assigned_to_both: boolean | null
          completed_at: string | null
          completion_note: string | null
          created_at: string | null
          created_by: string
          description: string | null
          due_date: string
          due_date_revised: string | null
          id: string
          notes: string | null
          priority_level: string | null
          progress_pct: number | null
          start_date: string
          status: string
          title: string
        }
        Insert: {
          assigned_to?: string | null
          assigned_to_both?: boolean | null
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          due_date: string
          due_date_revised?: string | null
          id?: string
          notes?: string | null
          priority_level?: string | null
          progress_pct?: number | null
          start_date: string
          status?: string
          title: string
        }
        Update: {
          assigned_to?: string | null
          assigned_to_both?: boolean | null
          completed_at?: string | null
          completion_note?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          due_date?: string
          due_date_revised?: string | null
          id?: string
          notes?: string | null
          priority_level?: string | null
          progress_pct?: number | null
          start_date?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "priorities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priorities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          accepted_qty: number | null
          actioned_at: string | null
          actioned_by: string | null
          created_at: string | null
          expected_action_id: string | null
          id: string
          is_cancellation: boolean | null
          mandatory_comment: string | null
          outcome: string | null
          po_number: string
          received_at: string | null
          total_qty: number | null
          vendor_central_ref: string | null
        }
        Insert: {
          accepted_qty?: number | null
          actioned_at?: string | null
          actioned_by?: string | null
          created_at?: string | null
          expected_action_id?: string | null
          id?: string
          is_cancellation?: boolean | null
          mandatory_comment?: string | null
          outcome?: string | null
          po_number: string
          received_at?: string | null
          total_qty?: number | null
          vendor_central_ref?: string | null
        }
        Update: {
          accepted_qty?: number | null
          actioned_at?: string | null
          actioned_by?: string | null
          created_at?: string | null
          expected_action_id?: string | null
          id?: string
          is_cancellation?: boolean | null
          mandatory_comment?: string | null
          outcome?: string | null
          po_number?: string
          received_at?: string | null
          total_qty?: number | null
          vendor_central_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_expected_action_id_fkey"
            columns: ["expected_action_id"]
            isOneToOne: false
            referencedRelation: "expected_actions"
            referencedColumns: ["id"]
          },
        ]
      }
      remittance_lines: {
        Row: {
          amount_paid_aed: number | null
          amount_remaining_aed: number | null
          created_at: string | null
          description: string | null
          dspt_number: string | null
          id: string
          invoice_amount_aed: number | null
          invoice_date: string | null
          invoice_number: string | null
          is_credit: boolean | null
          line_key: string | null
          matched_dispute: string | null
          matched_invoice: string | null
          matched_return_id: string | null
          partial: boolean | null
          remittance_ref: string
          transaction_type: string | null
        }
        Insert: {
          amount_paid_aed?: number | null
          amount_remaining_aed?: number | null
          created_at?: string | null
          description?: string | null
          dspt_number?: string | null
          id?: string
          invoice_amount_aed?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_credit?: boolean | null
          line_key?: string | null
          matched_dispute?: string | null
          matched_invoice?: string | null
          matched_return_id?: string | null
          partial?: boolean | null
          remittance_ref: string
          transaction_type?: string | null
        }
        Update: {
          amount_paid_aed?: number | null
          amount_remaining_aed?: number | null
          created_at?: string | null
          description?: string | null
          dspt_number?: string | null
          id?: string
          invoice_amount_aed?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_credit?: boolean | null
          line_key?: string | null
          matched_dispute?: string | null
          matched_invoice?: string | null
          matched_return_id?: string | null
          partial?: boolean | null
          remittance_ref?: string
          transaction_type?: string | null
        }
        Relationships: []
      }
      remittances: {
        Row: {
          coop_deductions_aed: number | null
          created_at: string | null
          damage_deductions_aed: number | null
          deductions_aed: number | null
          dispute_credits_aed: number | null
          expected_action_id: string | null
          explained_by: string | null
          gap_aed: number | null
          gap_explanation: string | null
          gross_amount_aed: number | null
          gross_invoices_aed: number | null
          id: string
          invoice_count: number | null
          invoice_refs: string[] | null
          match_status: string | null
          net_paid_aed: number | null
          payment_date: string | null
          reconciled: boolean | null
          remittance_ref: string
          shortage_deductions_aed: number | null
          vret_deductions_aed: number | null
        }
        Insert: {
          coop_deductions_aed?: number | null
          created_at?: string | null
          damage_deductions_aed?: number | null
          deductions_aed?: number | null
          dispute_credits_aed?: number | null
          expected_action_id?: string | null
          explained_by?: string | null
          gap_aed?: number | null
          gap_explanation?: string | null
          gross_amount_aed?: number | null
          gross_invoices_aed?: number | null
          id?: string
          invoice_count?: number | null
          invoice_refs?: string[] | null
          match_status?: string | null
          net_paid_aed?: number | null
          payment_date?: string | null
          reconciled?: boolean | null
          remittance_ref: string
          shortage_deductions_aed?: number | null
          vret_deductions_aed?: number | null
        }
        Update: {
          coop_deductions_aed?: number | null
          created_at?: string | null
          damage_deductions_aed?: number | null
          deductions_aed?: number | null
          dispute_credits_aed?: number | null
          expected_action_id?: string | null
          explained_by?: string | null
          gap_aed?: number | null
          gap_explanation?: string | null
          gross_amount_aed?: number | null
          gross_invoices_aed?: number | null
          id?: string
          invoice_count?: number | null
          invoice_refs?: string[] | null
          match_status?: string | null
          net_paid_aed?: number | null
          payment_date?: string | null
          reconciled?: boolean | null
          remittance_ref?: string
          shortage_deductions_aed?: number | null
          vret_deductions_aed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "remittances_expected_action_id_fkey"
            columns: ["expected_action_id"]
            isOneToOne: false
            referencedRelation: "expected_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remittances_explained_by_fkey"
            columns: ["explained_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reseller_deal_logs: {
        Row: {
          amount: number | null
          deal_created_time: string | null
          deal_id: string
          deal_name: string | null
          deal_url: string | null
          id: string
          inquiry_note: string | null
          logged_at: string
          logged_by: string | null
          owner_email: string | null
          owner_name: string | null
          stage: string | null
          validation_message: string | null
          validation_status: string
        }
        Insert: {
          amount?: number | null
          deal_created_time?: string | null
          deal_id: string
          deal_name?: string | null
          deal_url?: string | null
          id?: string
          inquiry_note?: string | null
          logged_at?: string
          logged_by?: string | null
          owner_email?: string | null
          owner_name?: string | null
          stage?: string | null
          validation_message?: string | null
          validation_status?: string
        }
        Update: {
          amount?: number | null
          deal_created_time?: string | null
          deal_id?: string
          deal_name?: string | null
          deal_url?: string | null
          id?: string
          inquiry_note?: string | null
          logged_at?: string
          logged_by?: string | null
          owner_email?: string | null
          owner_name?: string | null
          stage?: string | null
          validation_message?: string | null
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reseller_deal_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          amazon_invoice: string | null
          closed_at: string | null
          comments: string | null
          created_at: string | null
          date_received: string | null
          dispute_id: string | null
          dispute_id_ref: string | null
          dispute_reason: string | null
          dispute_status_text: string | null
          expected_action_id: string | null
          id: string
          invoice_date: string | null
          is_complete: boolean | null
          logged_by: string | null
          missing_fields: string[] | null
          model_sku: string | null
          owner: string | null
          payment_number: string | null
          po_id: string | null
          po_number: string | null
          pre_dispute_checks: string | null
          prt_number: string | null
          qty: number | null
          recovery_amt_aed: number | null
          refund_aed: number | null
          return_id: string
          return_id_ref: string | null
          return_type: string | null
          rma_number: string | null
          source: string | null
          srt_number: string | null
          stage: string | null
          status: string
          tle_invoice_number: string | null
          total_cost_aed: number | null
          vret_number: string | null
          warehouse: string | null
        }
        Insert: {
          amazon_invoice?: string | null
          closed_at?: string | null
          comments?: string | null
          created_at?: string | null
          date_received?: string | null
          dispute_id?: string | null
          dispute_id_ref?: string | null
          dispute_reason?: string | null
          dispute_status_text?: string | null
          expected_action_id?: string | null
          id?: string
          invoice_date?: string | null
          is_complete?: boolean | null
          logged_by?: string | null
          missing_fields?: string[] | null
          model_sku?: string | null
          owner?: string | null
          payment_number?: string | null
          po_id?: string | null
          po_number?: string | null
          pre_dispute_checks?: string | null
          prt_number?: string | null
          qty?: number | null
          recovery_amt_aed?: number | null
          refund_aed?: number | null
          return_id: string
          return_id_ref?: string | null
          return_type?: string | null
          rma_number?: string | null
          source?: string | null
          srt_number?: string | null
          stage?: string | null
          status?: string
          tle_invoice_number?: string | null
          total_cost_aed?: number | null
          vret_number?: string | null
          warehouse?: string | null
        }
        Update: {
          amazon_invoice?: string | null
          closed_at?: string | null
          comments?: string | null
          created_at?: string | null
          date_received?: string | null
          dispute_id?: string | null
          dispute_id_ref?: string | null
          dispute_reason?: string | null
          dispute_status_text?: string | null
          expected_action_id?: string | null
          id?: string
          invoice_date?: string | null
          is_complete?: boolean | null
          logged_by?: string | null
          missing_fields?: string[] | null
          model_sku?: string | null
          owner?: string | null
          payment_number?: string | null
          po_id?: string | null
          po_number?: string | null
          pre_dispute_checks?: string | null
          prt_number?: string | null
          qty?: number | null
          recovery_amt_aed?: number | null
          refund_aed?: number | null
          return_id?: string
          return_id_ref?: string | null
          return_type?: string | null
          rma_number?: string | null
          source?: string | null
          srt_number?: string | null
          stage?: string | null
          status?: string
          tle_invoice_number?: string | null
          total_cost_aed?: number | null
          vret_number?: string | null
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "returns_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_expected_action_id_fkey"
            columns: ["expected_action_id"]
            isOneToOne: false
            referencedRelation: "expected_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leave: {
        Row: {
          created_at: string
          created_by: string | null
          from_date: string
          id: string
          reason: string | null
          to_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_date: string
          id?: string
          reason?: string | null
          to_date: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_date?: string
          id?: string
          reason?: string | null
          to_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_leave_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          daily_task_id: string
          evidence_count: number | null
          evidence_file_path: string | null
          evidence_text: string | null
          id: string
          is_nothing_to_action: boolean | null
          nothing_to_action_note: string | null
          submitted_at: string
          submitted_by: string
        }
        Insert: {
          daily_task_id: string
          evidence_count?: number | null
          evidence_file_path?: string | null
          evidence_text?: string | null
          id?: string
          is_nothing_to_action?: boolean | null
          nothing_to_action_note?: string | null
          submitted_at?: string
          submitted_by: string
        }
        Update: {
          daily_task_id?: string
          evidence_count?: number | null
          evidence_file_path?: string | null
          evidence_text?: string | null
          id?: string
          is_nothing_to_action?: boolean | null
          nothing_to_action_note?: string | null
          submitted_at?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_daily_task_id_fkey"
            columns: ["daily_task_id"]
            isOneToOne: false
            referencedRelation: "daily_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_definitions: {
        Row: {
          assigned_to: string | null
          cadence: string
          category: string | null
          created_at: string | null
          eod_time: string | null
          evidence_hint: string | null
          evidence_type: string
          id: string
          is_active: boolean | null
          is_email_triggered: boolean | null
          sort_order: number | null
          title: string
          weekday: number | null
        }
        Insert: {
          assigned_to?: string | null
          cadence?: string
          category?: string | null
          created_at?: string | null
          eod_time?: string | null
          evidence_hint?: string | null
          evidence_type: string
          id?: string
          is_active?: boolean | null
          is_email_triggered?: boolean | null
          sort_order?: number | null
          title: string
          weekday?: number | null
        }
        Update: {
          assigned_to?: string | null
          cadence?: string
          category?: string | null
          created_at?: string | null
          eod_time?: string | null
          evidence_hint?: string | null
          evidence_type?: string
          id?: string
          is_active?: boolean | null
          is_email_triggered?: boolean | null
          sort_order?: number | null
          title?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "task_definitions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_initials: string | null
          created_at: string | null
          email: string
          full_name: string
          id: string
          role: string
        }
        Insert: {
          avatar_initials?: string | null
          created_at?: string | null
          email: string
          full_name: string
          id: string
          role: string
        }
        Update: {
          avatar_initials?: string | null
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
    }
    Views: {
      cocoblu_ageing_view: {
        Row: {
          ageing_days: number | null
          ageing_status: string | null
          created_at: string | null
          id: string | null
          invoice_date: string | null
          invoice_number: string | null
          line_number: number | null
          notes: string | null
          qty_remaining: number | null
          qty_supplied: number | null
          sku: string | null
          status: string | null
          supplied_date: string | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          ageing_days?: never
          ageing_status?: never
          created_at?: string | null
          id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          line_number?: number | null
          notes?: string | null
          qty_remaining?: number | null
          qty_supplied?: number | null
          sku?: string | null
          status?: string | null
          supplied_date?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          ageing_days?: never
          ageing_status?: never
          created_at?: string | null
          id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          line_number?: number | null
          notes?: string | null
          qty_remaining?: number | null
          qty_supplied?: number | null
          sku?: string | null
          status?: string | null
          supplied_date?: string | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      cocoblu_invoices_overview: {
        Row: {
          ageing_days: number | null
          ageing_status: string | null
          invoice_date: string | null
          invoice_number: string | null
          line_count: number | null
          open_line_count: number | null
          supplied_date: string | null
          total_remaining_qty: number | null
          total_remaining_value: number | null
        }
        Insert: {
          ageing_days?: never
          ageing_status?: never
          invoice_date?: never
          invoice_number?: string | null
          line_count?: never
          open_line_count?: never
          supplied_date?: never
          total_remaining_qty?: never
          total_remaining_value?: never
        }
        Update: {
          ageing_days?: never
          ageing_status?: never
          invoice_date?: never
          invoice_number?: string | null
          line_count?: never
          open_line_count?: never
          supplied_date?: never
          total_remaining_qty?: never
          total_remaining_value?: never
        }
        Relationships: []
      }
      lp_items_view: {
        Row: {
          ageing_days: number | null
          ageing_status: string | null
          amount: number | null
          brand: string | null
          created_at: string | null
          description: string | null
          disc_amount: number | null
          goods_received_date: string | null
          id: string | null
          line_number: number | null
          lp_date: string | null
          lp_id: string | null
          lp_number: string | null
          model_no: string | null
          pdf_url: string | null
          qty_adjust_comment: string | null
          qty_purchased: number | null
          qty_remaining: number | null
          qty_sold: number | null
          sku: string | null
          status: string | null
          unit_price: number | null
          vendor_name: string | null
          vendor_trn: string | null
        }
        Insert: {
          ageing_days?: never
          ageing_status?: never
          amount?: number | null
          brand?: string | null
          created_at?: string | null
          description?: string | null
          disc_amount?: number | null
          goods_received_date?: never
          id?: string | null
          line_number?: number | null
          lp_date?: never
          lp_id?: string | null
          lp_number?: never
          model_no?: string | null
          pdf_url?: never
          qty_adjust_comment?: string | null
          qty_purchased?: number | null
          qty_remaining?: never
          qty_sold?: never
          sku?: string | null
          status?: string | null
          unit_price?: number | null
          vendor_name?: never
          vendor_trn?: never
        }
        Update: {
          ageing_days?: never
          ageing_status?: never
          amount?: number | null
          brand?: string | null
          created_at?: string | null
          description?: string | null
          disc_amount?: number | null
          goods_received_date?: never
          id?: string | null
          line_number?: number | null
          lp_date?: never
          lp_id?: string | null
          lp_number?: never
          model_no?: string | null
          pdf_url?: never
          qty_adjust_comment?: string | null
          qty_purchased?: number | null
          qty_remaining?: never
          qty_sold?: never
          sku?: string | null
          status?: string | null
          unit_price?: number | null
          vendor_name?: never
          vendor_trn?: never
        }
        Relationships: [
          {
            foreignKeyName: "lp_items_lp_id_fkey"
            columns: ["lp_id"]
            isOneToOne: false
            referencedRelation: "lp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_orders_overview: {
        Row: {
          ageing_days: number | null
          ageing_status: string | null
          goods_received_date: string | null
          line_count: number | null
          lp_date: string | null
          lp_id: string | null
          lp_number: string | null
          open_line_count: number | null
          total_remaining_qty: number | null
          total_remaining_value: number | null
          vendor_name: string | null
        }
        Insert: {
          ageing_days?: never
          ageing_status?: never
          goods_received_date?: never
          line_count?: never
          lp_date?: never
          lp_id?: string | null
          lp_number?: never
          open_line_count?: never
          total_remaining_qty?: never
          total_remaining_value?: never
          vendor_name?: never
        }
        Update: {
          ageing_days?: never
          ageing_status?: never
          goods_received_date?: never
          line_count?: never
          lp_date?: never
          lp_id?: string | null
          lp_number?: never
          open_line_count?: never
          total_remaining_qty?: never
          total_remaining_value?: never
          vendor_name?: never
        }
        Relationships: [
          {
            foreignKeyName: "lp_items_lp_id_fkey"
            columns: ["lp_id"]
            isOneToOne: false
            referencedRelation: "lp_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_user_role: { Args: never; Returns: string }
      generate_daily_tasks: { Args: never; Returns: undefined }
      search_all: {
        Args: { q: string }
        Returns: {
          amount: number
          category: string
          id: string
          matched_field: string
          nav_key: string
          primary_label: string
          secondary_label: string
          source_table: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
