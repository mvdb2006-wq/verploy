// GEGENEREERD door scripts/gen-db-types.mjs — niet met de hand bewerken.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      agencies: {
        Row: {
          id: string
          name: string
          slug: string
          dashboard_locale: string
          brand_color: string
          brand_logo_path: string | null
          report_sender_name: string | null
          plan_id: string
          plan_status: string
          trial_ends_at: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          created_at: string
          updated_at: string
          subscription_period_end: string | null
          subscription_cancel_at_end: boolean
          stripe_synced_at: string | null
          security_autofix: boolean
          auto_updates: boolean
          auto_update_window: string
          auto_update_frequency: string
          timezone: string
          daily_digest: boolean
          digest_sent_at: string | null
        }
        Insert: {
          id?: string
          name: string
          slug: string
          dashboard_locale?: string
          brand_color?: string
          brand_logo_path?: string | null
          report_sender_name?: string | null
          plan_id?: string
          plan_status?: string
          trial_ends_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          created_at?: string
          updated_at?: string
          subscription_period_end?: string | null
          subscription_cancel_at_end?: boolean
          stripe_synced_at?: string | null
          security_autofix?: boolean
          auto_updates?: boolean
          auto_update_window?: string
          auto_update_frequency?: string
          timezone?: string
          daily_digest?: boolean
          digest_sent_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          dashboard_locale?: string
          brand_color?: string
          brand_logo_path?: string | null
          report_sender_name?: string | null
          plan_id?: string
          plan_status?: string
          trial_ends_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          created_at?: string
          updated_at?: string
          subscription_period_end?: string | null
          subscription_cancel_at_end?: boolean
          stripe_synced_at?: string | null
          security_autofix?: boolean
          auto_updates?: boolean
          auto_update_window?: string
          auto_update_frequency?: string
          timezone?: string
          daily_digest?: boolean
          digest_sent_at?: string | null
        }
        Relationships: []
      }
      agency_invitations: {
        Row: {
          id: string
          agency_id: string
          email: string
          role: string
          token_hash: string
          invited_by: string | null
          expires_at: string
          accepted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          agency_id: string
          email: string
          role: string
          token_hash: string
          invited_by?: string | null
          expires_at?: string
          accepted_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          agency_id?: string
          email?: string
          role?: string
          token_hash?: string
          invited_by?: string | null
          expires_at?: string
          accepted_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      agency_members: {
        Row: {
          agency_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          agency_id: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: {
          agency_id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          id: string
          agency_id: string
          site_id: string
          type: string
          severity: string
          status: string
          params: Json
          opened_at: string
          updated_at: string
          resolved_at: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          notified_at: string | null
          resolved_notified_at: string | null
          notify_attempts: number
          notify_claimed_at: string | null
        }
        Insert: {
          id?: string
          agency_id: string
          site_id: string
          type: string
          severity: string
          status?: string
          params?: Json
          opened_at?: string
          updated_at?: string
          resolved_at?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          notified_at?: string | null
          resolved_notified_at?: string | null
          notify_attempts?: number
          notify_claimed_at?: string | null
        }
        Update: {
          id?: string
          agency_id?: string
          site_id?: string
          type?: string
          severity?: string
          status?: string
          params?: Json
          opened_at?: string
          updated_at?: string
          resolved_at?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          notified_at?: string | null
          resolved_notified_at?: string | null
          notify_attempts?: number
          notify_claimed_at?: string | null
        }
        Relationships: []
      }
      diagnoses: {
        Row: {
          run_id: string
          agency_id: string
          source: string
          model: string | null
          locale: string
          summary: string
          cause: string
          fix: string
          culprit_slug: string | null
          culprit_name: string | null
          confidence: string
          evidence: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          run_id: string
          agency_id: string
          source: string
          model?: string | null
          locale: string
          summary: string
          cause: string
          fix: string
          culprit_slug?: string | null
          culprit_name?: string | null
          confidence: string
          evidence?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          run_id?: string
          agency_id?: string
          source?: string
          model?: string | null
          locale?: string
          summary?: string
          cause?: string
          fix?: string
          culprit_slug?: string | null
          culprit_name?: string | null
          confidence?: string
          evidence?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      health_snapshots: {
        Row: {
          id: number
          agency_id: string
          site_id: string
          captured_at: string
          received_at: string
          connector_version: string | null
          wp_version: string | null
          php_version: string | null
          memory_limit_mb: number | null
          memory_peak_mb: number | null
          disk_free_mb: number | null
          db_size_mb: number | null
          ssl_expires_at: string | null
          domain_expires_at: string | null
          raw: Json
        }
        Insert: {
          agency_id: string
          site_id: string
          captured_at?: string
          received_at?: string
          connector_version?: string | null
          wp_version?: string | null
          php_version?: string | null
          memory_limit_mb?: number | null
          memory_peak_mb?: number | null
          disk_free_mb?: number | null
          db_size_mb?: number | null
          ssl_expires_at?: string | null
          domain_expires_at?: string | null
          raw?: Json
        }
        Update: {
          agency_id?: string
          site_id?: string
          captured_at?: string
          received_at?: string
          connector_version?: string | null
          wp_version?: string | null
          php_version?: string | null
          memory_limit_mb?: number | null
          memory_peak_mb?: number | null
          disk_free_mb?: number | null
          db_size_mb?: number | null
          ssl_expires_at?: string | null
          domain_expires_at?: string | null
          raw?: Json
        }
        Relationships: []
      }
      plans: {
        Row: {
          id: string
          name: string
          price_cents: number
          currency: string
          sites_limit: number
          sort_order: number
          is_public: boolean
          stripe_price_id: string | null
        }
        Insert: {
          id: string
          name: string
          price_cents: number
          currency?: string
          sites_limit: number
          sort_order: number
          is_public?: boolean
          stripe_price_id?: string | null
        }
        Update: {
          id?: string
          name?: string
          price_cents?: number
          currency?: string
          sites_limit?: number
          sort_order?: number
          is_public?: boolean
          stripe_price_id?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          id: string
          agency_id: string
          site_id: string
          created_by: string | null
          trigger: string
          period_start: string
          period_end: string
          locale: string
          send_to: string | null
          status: string
          attempt: number
          worker_id: string | null
          lease_until: string | null
          pdf_path: string | null
          pdf_bytes: number | null
          error: string | null
          sent_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          agency_id: string
          site_id: string
          created_by?: string | null
          trigger: string
          period_start: string
          period_end: string
          locale: string
          send_to?: string | null
          status?: string
          attempt?: number
          worker_id?: string | null
          lease_until?: string | null
          pdf_path?: string | null
          pdf_bytes?: number | null
          error?: string | null
          sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          agency_id?: string
          site_id?: string
          created_by?: string | null
          trigger?: string
          period_start?: string
          period_end?: string
          locale?: string
          send_to?: string | null
          status?: string
          attempt?: number
          worker_id?: string | null
          lease_until?: string | null
          pdf_path?: string | null
          pdf_bytes?: number | null
          error?: string | null
          sent_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      signed_request_nonces: {
        Row: {
          site_id: string
          nonce: string
          created_at: string
        }
        Insert: {
          site_id: string
          nonce: string
          created_at?: string
        }
        Update: {
          site_id?: string
          nonce?: string
          created_at?: string
        }
        Relationships: []
      }
      site_components: {
        Row: {
          agency_id: string
          site_id: string
          type: string
          slug: string
          name: string
          version: string | null
          latest_version: string | null
          update_available: boolean
          active: boolean
          updated_at: string
        }
        Insert: {
          agency_id: string
          site_id: string
          type: string
          slug: string
          name: string
          version?: string | null
          latest_version?: string | null
          update_available?: boolean
          active?: boolean
          updated_at?: string
        }
        Update: {
          agency_id?: string
          site_id?: string
          type?: string
          slug?: string
          name?: string
          version?: string | null
          latest_version?: string | null
          update_available?: boolean
          active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      site_credentials: {
        Row: {
          site_id: string
          agency_id: string
          secret_ciphertext: string | null
          secret_version: number
          previous_secret_ciphertext: string | null
          previous_valid_until: string | null
          pairing_code_hash: string | null
          pairing_expires_at: string | null
          updated_at: string
        }
        Insert: {
          site_id: string
          agency_id: string
          secret_ciphertext?: string | null
          secret_version?: number
          previous_secret_ciphertext?: string | null
          previous_valid_until?: string | null
          pairing_code_hash?: string | null
          pairing_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          site_id?: string
          agency_id?: string
          secret_ciphertext?: string | null
          secret_version?: number
          previous_secret_ciphertext?: string | null
          previous_valid_until?: string | null
          pairing_code_hash?: string | null
          pairing_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      site_vulnerabilities: {
        Row: {
          site_id: string
          agency_id: string
          vulnerability_id: string
          component_type: string
          component_slug: string
          component_name: string
          installed_version: string
          fixed_version: string | null
          severity: string
          fixable: boolean
          status: string
          first_seen_at: string
          updated_at: string
          resolved_at: string | null
          autofix_run_id: string | null
          autofix_target: string | null
          autofix_at: string | null
        }
        Insert: {
          site_id: string
          agency_id: string
          vulnerability_id: string
          component_type: string
          component_slug: string
          component_name: string
          installed_version: string
          fixed_version?: string | null
          severity: string
          fixable?: boolean
          status?: string
          first_seen_at?: string
          updated_at?: string
          resolved_at?: string | null
          autofix_run_id?: string | null
          autofix_target?: string | null
          autofix_at?: string | null
        }
        Update: {
          site_id?: string
          agency_id?: string
          vulnerability_id?: string
          component_type?: string
          component_slug?: string
          component_name?: string
          installed_version?: string
          fixed_version?: string | null
          severity?: string
          fixable?: boolean
          status?: string
          first_seen_at?: string
          updated_at?: string
          resolved_at?: string | null
          autofix_run_id?: string | null
          autofix_target?: string | null
          autofix_at?: string | null
        }
        Relationships: []
      }
      sites: {
        Row: {
          id: string
          agency_id: string
          name: string
          url: string
          client_name: string | null
          client_email: string | null
          report_locale: string
          status: string
          connection_status: string
          connector_version: string | null
          wp_version: string | null
          php_version: string | null
          last_heartbeat_at: string | null
          paired_at: string | null
          created_at: string
          updated_at: string
          ssl_valid: boolean | null
          ssl_expires_at: string | null
          ssl_issuer: string | null
          ssl_error: string | null
          ssl_checked_at: string | null
          domain_expires_at: string | null
          domain_error: string | null
          domain_checked_at: string | null
          test_paths: string[]
          test_masks: string[]
          diff_threshold: number
          report_monthly: boolean
          vulns_checked_at: string | null
          heartbeat_seq: number
          vulns_checked_seq: number | null
          vulns_checked_feed_at: string | null
          auto_updates: boolean
          wp_login_user_id: number | null
        }
        Insert: {
          id?: string
          agency_id: string
          name: string
          url: string
          client_name?: string | null
          client_email?: string | null
          report_locale?: string
          status?: string
          connection_status?: string
          connector_version?: string | null
          wp_version?: string | null
          php_version?: string | null
          last_heartbeat_at?: string | null
          paired_at?: string | null
          created_at?: string
          updated_at?: string
          ssl_valid?: boolean | null
          ssl_expires_at?: string | null
          ssl_issuer?: string | null
          ssl_error?: string | null
          ssl_checked_at?: string | null
          domain_expires_at?: string | null
          domain_error?: string | null
          domain_checked_at?: string | null
          test_paths?: string[]
          test_masks?: string[]
          diff_threshold?: number
          report_monthly?: boolean
          vulns_checked_at?: string | null
          heartbeat_seq?: number
          vulns_checked_seq?: number | null
          vulns_checked_feed_at?: string | null
          auto_updates?: boolean
          wp_login_user_id?: number | null
        }
        Update: {
          id?: string
          agency_id?: string
          name?: string
          url?: string
          client_name?: string | null
          client_email?: string | null
          report_locale?: string
          status?: string
          connection_status?: string
          connector_version?: string | null
          wp_version?: string | null
          php_version?: string | null
          last_heartbeat_at?: string | null
          paired_at?: string | null
          created_at?: string
          updated_at?: string
          ssl_valid?: boolean | null
          ssl_expires_at?: string | null
          ssl_issuer?: string | null
          ssl_error?: string | null
          ssl_checked_at?: string | null
          domain_expires_at?: string | null
          domain_error?: string | null
          domain_checked_at?: string | null
          test_paths?: string[]
          test_masks?: string[]
          diff_threshold?: number
          report_monthly?: boolean
          vulns_checked_at?: string | null
          heartbeat_seq?: number
          vulns_checked_seq?: number | null
          vulns_checked_feed_at?: string | null
          auto_updates?: boolean
          wp_login_user_id?: number | null
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          id: string
          type: string
          agency_id: string | null
          received_at: string
        }
        Insert: {
          id: string
          type: string
          agency_id?: string | null
          received_at?: string
        }
        Update: {
          id?: string
          type?: string
          agency_id?: string | null
          received_at?: string
        }
        Relationships: []
      }
      test_results: {
        Row: {
          id: number
          agency_id: string
          run_id: string
          phase: string
          page_key: string
          page_label: string
          page_url: string
          viewport: string
          http_status: number | null
          load_ms: number | null
          passed: boolean
          checks: Json
          js_errors: Json
          facts: Json
          screenshot_path: string | null
          diff_path: string | null
          diff_ratio: number | null
          created_at: string
        }
        Insert: {
          agency_id: string
          run_id: string
          phase: string
          page_key: string
          page_label?: string
          page_url: string
          viewport: string
          http_status?: number | null
          load_ms?: number | null
          passed: boolean
          checks?: Json
          js_errors?: Json
          facts?: Json
          screenshot_path?: string | null
          diff_path?: string | null
          diff_ratio?: number | null
          created_at?: string
        }
        Update: {
          agency_id?: string
          run_id?: string
          phase?: string
          page_key?: string
          page_label?: string
          page_url?: string
          viewport?: string
          http_status?: number | null
          load_ms?: number | null
          passed?: boolean
          checks?: Json
          js_errors?: Json
          facts?: Json
          screenshot_path?: string | null
          diff_path?: string | null
          diff_ratio?: number | null
          created_at?: string
        }
        Relationships: []
      }
      update_intel: {
        Row: {
          type: string
          slug: string
          version: string
          ok_sites: number
          failed_sites: number
          refreshed_at: string
        }
        Insert: {
          type: string
          slug: string
          version: string
          ok_sites?: number
          failed_sites?: number
          refreshed_at?: string
        }
        Update: {
          type?: string
          slug?: string
          version?: string
          ok_sites?: number
          failed_sites?: number
          refreshed_at?: string
        }
        Relationships: []
      }
      update_run_events: {
        Row: {
          id: number
          agency_id: string
          run_id: string
          step: string
          level: string
          message_key: string
          params: Json
          created_at: string
        }
        Insert: {
          agency_id: string
          run_id: string
          step: string
          level?: string
          message_key: string
          params?: Json
          created_at?: string
        }
        Update: {
          agency_id?: string
          run_id?: string
          step?: string
          level?: string
          message_key?: string
          params?: Json
          created_at?: string
        }
        Relationships: []
      }
      update_runs: {
        Row: {
          id: string
          agency_id: string
          site_id: string
          created_by: string | null
          status: string
          items: Json
          verdict: string | null
          reason_key: string | null
          reason_params: Json
          attempt: number
          max_attempts: number
          worker_id: string | null
          lease_until: string | null
          not_before: string
          step_started_at: string | null
          step_state: Json
          cancel_requested: boolean
          created_at: string
          started_at: string | null
          finished_at: string | null
          updated_at: string
          trigger: string
        }
        Insert: {
          id?: string
          agency_id: string
          site_id: string
          created_by?: string | null
          status?: string
          items: Json
          verdict?: string | null
          reason_key?: string | null
          reason_params?: Json
          attempt?: number
          max_attempts?: number
          worker_id?: string | null
          lease_until?: string | null
          not_before?: string
          step_started_at?: string | null
          step_state?: Json
          cancel_requested?: boolean
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
          trigger?: string
        }
        Update: {
          id?: string
          agency_id?: string
          site_id?: string
          created_by?: string | null
          status?: string
          items?: Json
          verdict?: string | null
          reason_key?: string | null
          reason_params?: Json
          attempt?: number
          max_attempts?: number
          worker_id?: string | null
          lease_until?: string | null
          not_before?: string
          step_started_at?: string | null
          step_state?: Json
          cancel_requested?: boolean
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
          trigger?: string
        }
        Relationships: []
      }
      vulnerabilities: {
        Row: {
          id: string
          software_type: string
          slug: string
          name: string
          title: string
          affected: Json
          patched_versions: string[]
          severity: string
          cvss_score: number | null
          cve: string | null
          reference_url: string | null
          mitre: boolean
          published_at: string | null
          source_updated_at: string | null
          fetched_at: string
        }
        Insert: {
          id: string
          software_type: string
          slug: string
          name: string
          title: string
          affected: Json
          patched_versions?: string[]
          severity: string
          cvss_score?: number | null
          cve?: string | null
          reference_url?: string | null
          mitre?: boolean
          published_at?: string | null
          source_updated_at?: string | null
          fetched_at?: string
        }
        Update: {
          id?: string
          software_type?: string
          slug?: string
          name?: string
          title?: string
          affected?: Json
          patched_versions?: string[]
          severity?: string
          cvss_score?: number | null
          cve?: string | null
          reference_url?: string | null
          mitre?: boolean
          published_at?: string | null
          source_updated_at?: string | null
          fetched_at?: string
        }
        Relationships: []
      }
      vulnerability_feed_state: {
        Row: {
          id: number
          fetched_at: string | null
          source_updated_max: string | null
          record_count: number
          last_error: string | null
          last_error_at: string | null
          attribution: Json
        }
        Insert: {
          id?: number
          fetched_at?: string | null
          source_updated_max?: string | null
          record_count?: number
          last_error?: string | null
          last_error_at?: string | null
          attribution?: Json
        }
        Update: {
          id?: number
          fetched_at?: string | null
          source_updated_max?: string | null
          record_count?: number
          last_error?: string | null
          last_error_at?: string | null
          attribution?: Json
        }
        Relationships: []
      }
      wp_logins: {
        Row: {
          id: number
          agency_id: string
          site_id: string
          user_id: string | null
          user_email: string
          wp_user_id: number
          wp_user_login: string
          nonce: string
          created_at: string
        }
        Insert: {
          agency_id: string
          site_id: string
          user_id?: string | null
          user_email: string
          wp_user_id: number
          wp_user_login: string
          nonce: string
          created_at?: string
        }
        Update: {
          agency_id?: string
          site_id?: string
          user_id?: string | null
          user_email?: string
          wp_user_id?: number
          wp_user_login?: string
          nonce?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      accept_invitation: { Args: { p_token: string | null }; Returns: string }
      acknowledge_alert: { Args: { p_alert: string | null }; Returns: undefined }
      advance_update_run: { Args: { p_run: string | null; p_worker: string | null; p_status: string | null; p_step_state?: Json | null; p_verdict?: string | null; p_reason_key?: string | null; p_reason_params?: Json | null; p_items?: Json | null }; Returns: undefined }
      agency_owner_email: { Args: { p_agency: string | null }; Returns: string }
      apply_stripe_subscription: { Args: { p_event_id: string | null; p_event_type: string | null; p_event_created: string | null; p_agency: string | null; p_customer: string | null; p_subscription: string | null; p_price: string | null; p_status: string | null; p_period_end: string | null; p_cancel_at_end: boolean | null }; Returns: boolean }
      cancel_update_run: { Args: { p_run: string | null }; Returns: undefined }
      claim_alert_notifications: { Args: { p_limit?: number | null }; Returns: { alert_id: string; kind: string; type: string; severity: string; params: Json; opened_at: string; site_id: string; site_name: string; site_url: string; agency_name: string; locale: string; recipients: string[] }[] }
      claim_daily_digests: { Args: { p_hour?: number | null; p_limit?: number | null }; Returns: { agency_id: string; agency_name: string; locale: string; since: string; recipients: string[] }[] }
      claim_report: { Args: { p_worker: string | null; p_lease_seconds?: number | null }; Returns: Database['public']['Tables']['reports']['Row'][] }
      claim_update_run: { Args: { p_worker: string | null; p_lease_seconds?: number | null }; Returns: Database['public']['Tables']['update_runs']['Row'][] }
      clear_update_approvals_outside_schedule: { Args: Record<PropertyKey, never>; Returns: number }
      complete_alert_notification: { Args: { p_alert: string | null; p_kind: string | null; p_sent: boolean | null }; Returns: undefined }
      complete_report: { Args: { p_report: string | null; p_worker: string | null; p_status: string | null; p_pdf_path?: string | null; p_pdf_bytes?: number | null; p_error?: string | null }; Returns: undefined }
      consume_pairing_code: { Args: { p_code_hash: string | null; p_secret_box: string | null; p_connector_version: string | null }; Returns: { site_id: string; agency_id: string; secret_version: number }[] }
      create_agency: { Args: { p_name: string | null }; Returns: string }
      create_pairing_code: { Args: { p_site: string | null }; Returns: string }
      create_update_run: { Args: { p_site: string | null; p_items: Json | null }; Returns: string }
      ingest_heartbeat: { Args: { p_site: string | null; p_snapshot: Json | null; p_components: Json | null }; Returns: number }
      invite_member: { Args: { p_email: string | null; p_role: string | null }; Returns: string }
      list_members: { Args: Record<PropertyKey, never>; Returns: { user_id: string; email: string; role: string; created_at: string }[] }
      peek_invitation: { Args: { p_token: string | null }; Returns: { agency_name: string; email: string; role: string; valid: boolean }[] }
      pending_security_fixes: { Args: { p_limit?: number | null }; Returns: { site_id: string; items: Json }[] }
      record_run_outcome: { Args: { p_run: string | null }; Returns: undefined }
      record_site_checks: { Args: { p_site: string | null; p_ssl_valid: boolean | null; p_ssl_expires_at: string | null; p_ssl_issuer: string | null; p_ssl_error: string | null; p_domain_expires_at: string | null; p_domain_error: string | null; p_domain_checked: boolean | null }; Returns: undefined }
      refresh_update_intel: { Args: Record<PropertyKey, never>; Returns: number }
      release_update_run: { Args: { p_run: string | null; p_worker: string | null; p_delay_seconds?: number | null }; Returns: undefined }
      remove_member: { Args: { p_user: string | null }; Returns: undefined }
      renew_update_run: { Args: { p_run: string | null; p_worker: string | null; p_lease_seconds?: number | null }; Returns: boolean }
      request_report: { Args: { p_site: string | null; p_start: string | null; p_end: string | null; p_send?: boolean | null }; Returns: string }
      schedule_monthly_reports: { Args: Record<PropertyKey, never>; Returns: number }
      scheduled_update_candidates: { Args: { p_limit?: number | null }; Returns: { site_id: string; agency_id: string; timezone: string; update_window: string; frequency: string; last_scheduled_at: string; busy: boolean }[] }
      set_plan_price: { Args: { p_plan: string | null; p_price: string | null }; Returns: undefined }
      set_stripe_customer: { Args: { p_agency: string | null; p_customer: string | null }; Returns: undefined }
      sites_due_for_vulnerability_check: { Args: { p_limit?: number | null }; Returns: { site_id: string }[] }
      start_connector_updates: { Args: { p_version: string | null; p_limit?: number | null }; Returns: number }
      start_scheduled_update: { Args: { p_site: string | null; p_items: Json | null }; Returns: string }
      start_security_fix: { Args: { p_site: string | null; p_items: Json | null }; Returns: string }
      start_wp_login: { Args: { p_site: string | null }; Returns: { nonce: string; wp_user_id: number; wp_user_login: string; site_url: string; user_email: string }[] }
      sweep_alerts: { Args: Record<PropertyKey, never>; Returns: number }
      sync_site_vulnerabilities: { Args: { p_site: string | null; p_findings: Json | null; p_heartbeat_seq?: number | null; p_feed_at?: string | null }; Returns: number }
      sync_update_approvals: { Args: { p_site: string | null; p_items: Json | null }; Returns: undefined }
      update_member_role: { Args: { p_user: string | null; p_role: string | null }; Returns: undefined }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
