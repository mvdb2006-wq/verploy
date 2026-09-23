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
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      consume_pairing_code: { Args: { p_code_hash: string; p_secret_box: string; p_connector_version: string }; Returns: { site_id: string; agency_id: string; secret_version: number }[] }
      create_agency: { Args: { p_name: string }; Returns: string }
      create_pairing_code: { Args: { p_site: string }; Returns: string }
      ingest_heartbeat: { Args: { p_site: string; p_snapshot: Json; p_components: Json }; Returns: number }
      invite_member: { Args: { p_email: string; p_role: string }; Returns: string }
      list_members: { Args: Record<PropertyKey, never>; Returns: { user_id: string; email: string; role: string; created_at: string }[] }
      peek_invitation: { Args: { p_token: string }; Returns: { agency_name: string; email: string; role: string; valid: boolean }[] }
      remove_member: { Args: { p_user: string }; Returns: undefined }
      update_member_role: { Args: { p_user: string; p_role: string }; Returns: undefined }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
