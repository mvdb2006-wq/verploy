// ─── Database types (generated from Supabase schema) ─────────────────────────

export type SiteStatus = 'online' | 'offline' | 'degraded' | 'unknown'
export type UpdateType = 'plugin' | 'theme' | 'core'
export type UpdateRunStatus = 'queued' | 'staging' | 'testing' | 'applying' | 'completed' | 'failed' | 'blocked'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertType =
  | 'site_offline' | 'update_failed' | 'update_blocked'
  | 'ssl_expiring'  | 'ssl_expired'
  | 'domain_expiring' | 'php_outdated'
  | 'vulnerability_found' | 'core_update_available'

export interface Agency {
  id: string
  owner_id: string
  name: string
  slug: string
  logo_url: string | null
  primary_color: string
  plan: 'starter' | 'agency' | 'pro' | 'enterprise'
  site_limit: number
  created_at: string
  updated_at: string
}

export interface Site {
  id: string
  agency_id: string
  url: string
  name: string
  api_key: string
  status: SiteStatus
  client_name: string | null
  client_email: string | null
  client_language: string
  notes: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export interface HealthSnapshot {
  id: string
  site_id: string
  collected_at: string
  wp_version: string | null
  core_update_to: string | null
  php_version: string | null
  php_major: string | null
  mysql_version: string | null
  memory_limit: string | null
  max_execution: number | null
  opcache_enabled: boolean | null
  opcache_hit_rate: number | null
  ssl_enabled: boolean | null
  ssl_expires_days: number | null
  ssl_issuer: string | null
  db_response_ms: number | null
  uploads_size_mb: number | null
  active_plugins: number | null
  raw: Record<string, unknown> | null
  created_at: string
}

export interface SitePlugin {
  id: string
  site_id: string
  snapshot_id: string
  plugin_file: string
  name: string
  version: string | null
  author: string | null
  active: boolean
  update_available: boolean
  update_version: string | null
  created_at: string
}

export interface UpdateRun {
  id: string
  site_id: string
  update_type: UpdateType
  slug: string | null
  from_version: string | null
  to_version: string | null
  status: UpdateRunStatus
  triggered_by: string
  staging_url: string | null
  test_passed: boolean | null
  screenshot_before: string | null
  screenshot_after: string | null
  diff_image_url: string | null
  ai_diagnosis: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export type AlertStatus = 'open' | 'resolved' | 'dismissed'

export interface Alert {
  id: string
  site_id: string
  agency_id: string
  type: string
  severity: AlertSeverity
  status: AlertStatus
  title: string
  message: string | null
  metadata: Record<string, unknown> | null
  triggered_at: string
  resolved_at: string | null
  dismissed_at: string | null
}

// ─── View types ───────────────────────────────────────────────────────────────

export interface SiteOverview {
  id: string
  agency_id: string
  url: string
  name: string
  client_name: string | null
  status: SiteStatus
  last_seen_at: string | null
  last_heartbeat_at: string | null
  wp_version: string | null
  php_version: string | null
  ssl_days_remaining: number | null
  ssl_valid: boolean | null
  performance_score: number | null
  pending_updates: number
  critical_alerts: number
  last_snapshot_at: string | null
}

export interface Report {
  id: string
  site_id: string
  agency_id: string
  period_label: string | null
  status: 'queued' | 'generating' | 'ready' | 'failed'
  pdf_url: string | null
  language: string
  generated_at: string | null
  created_at: string
}

// ─── API types ────────────────────────────────────────────────────────────────

export interface HeartbeatPayload {
  collected_at: string
  site: {
    url: string
    name: string
    admin_email: string
    language: string
    timezone: string
    multisite: boolean
  }
  server: {
    php_version: string
    php_major: string
    mysql_version: string
    memory_limit: string
    max_execution_time: number
    opcache: {
      enabled: boolean
      hit_rate: number | null
    }
  }
  wordpress: {
    version: string
    core_update_available: string | null
    ssl: {
      enabled: boolean
      expires_days: number | null
      issuer: string | null
    }
  }
  plugins: Array<{
    plugin_file: string
    name: string
    version: string
    active: boolean
    update_available: boolean
    update_version: string | null
  }>
  performance: {
    db_response_ms: number
    uploads_size_mb: number
    active_plugins_count: number
  }
}
