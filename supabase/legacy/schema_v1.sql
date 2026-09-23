-- ============================================================
-- Verploy — Complete Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE plan_tier AS ENUM ('starter', 'agency', 'pro');
CREATE TYPE site_status AS ENUM ('online', 'offline', 'degraded', 'unknown');
CREATE TYPE alert_severity AS ENUM ('critical', 'warning', 'info');
CREATE TYPE alert_status AS ENUM ('open', 'resolved', 'dismissed');
CREATE TYPE update_run_status AS ENUM ('queued', 'staging', 'testing', 'passed', 'failed', 'deployed', 'rolled_back');
CREATE TYPE report_status AS ENUM ('queued', 'generating', 'ready', 'failed');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

-- ============================================================
-- AGENCIES
-- ============================================================

CREATE TABLE agencies (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  plan            plan_tier NOT NULL DEFAULT 'starter',
  stripe_customer_id    text UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan_sites_limit      int NOT NULL DEFAULT 10,
  trial_ends_at         timestamptz,
  subscription_ends_at  timestamptz,
  logo_url        text,
  primary_color   text DEFAULT '#22D98A',
  report_language text DEFAULT 'nl',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Plan limits
CREATE OR REPLACE FUNCTION agency_sites_limit(plan plan_tier)
RETURNS int AS $$
  SELECT CASE plan
    WHEN 'starter' THEN 10
    WHEN 'agency'  THEN 50
    WHEN 'pro'     THEN 2147483647  -- unlimited
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ============================================================
-- AGENCY MEMBERS
-- ============================================================

CREATE TABLE agency_members (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id   uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        member_role NOT NULL DEFAULT 'member',
  invited_at  timestamptz,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, user_id)
);

CREATE INDEX idx_agency_members_user ON agency_members(user_id);
CREATE INDEX idx_agency_members_agency ON agency_members(agency_id);

-- ============================================================
-- SITES
-- ============================================================

CREATE TABLE sites (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id       uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  url             text NOT NULL,
  client_name     text,
  api_key         text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  wp_version      text,
  php_version     text,
  status          site_status NOT NULL DEFAULT 'unknown',
  last_seen_at    timestamptz,
  last_heartbeat_at timestamptz,
  staging_url     text,
  test_scripts    jsonb DEFAULT '[]',  -- custom Playwright scripts
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sites_agency ON sites(agency_id);
CREATE INDEX idx_sites_api_key ON sites(api_key);
CREATE INDEX idx_sites_status ON sites(status);

-- ============================================================
-- HEALTH SNAPSHOTS
-- ============================================================

CREATE TABLE health_snapshots (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id             uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  captured_at         timestamptz NOT NULL DEFAULT now(),

  -- WordPress
  wp_version          text,
  php_version         text,
  php_major           numeric(3,1) GENERATED ALWAYS AS (
    CASE WHEN php_version ~ '^\d+\.\d'
    THEN (regexp_match(php_version, '^\d+\.\d'))[1]::numeric
    ELSE NULL END
  ) STORED,

  -- SSL
  ssl_valid           boolean,
  ssl_expires_at      timestamptz,
  ssl_days_remaining  int GENERATED ALWAYS AS (
    CASE WHEN ssl_expires_at IS NOT NULL
    THEN GREATEST(0, EXTRACT(days FROM ssl_expires_at - now())::int)
    ELSE NULL END
  ) STORED,
  ssl_issuer          text,

  -- Uptime / Performance
  uptime_ms           int,
  status_code         int,

  -- Core Web Vitals (from CrUX or PageSpeed)
  lcp_ms              numeric(8,2),   -- Largest Contentful Paint
  cls_score           numeric(6,4),   -- Cumulative Layout Shift
  fid_ms              numeric(8,2),   -- First Input Delay
  ttfb_ms             numeric(8,2),   -- Time to First Byte
  performance_score   int,            -- 0-100 Lighthouse score

  -- MySQL
  mysql_version       text,
  db_size_mb          numeric(10,2),

  -- Server
  opscache_enabled    boolean,
  memory_limit_mb     int,

  raw_data            jsonb
);

CREATE INDEX idx_snapshots_site_time ON health_snapshots(site_id, captured_at DESC);

-- View: latest snapshot per site
CREATE VIEW latest_health_snapshots AS
SELECT DISTINCT ON (site_id) *
FROM health_snapshots
ORDER BY site_id, captured_at DESC;

-- ============================================================
-- PLUGINS
-- ============================================================

CREATE TABLE site_plugins (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug            text NOT NULL,
  name            text NOT NULL,
  version         text,
  latest_version  text,
  update_available boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  vulnerable      boolean NOT NULL DEFAULT false,
  vulnerability_details jsonb,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug)
);

CREATE INDEX idx_plugins_site ON site_plugins(site_id);
CREATE INDEX idx_plugins_update ON site_plugins(site_id, update_available) WHERE update_available = true;

-- ============================================================
-- UPDATE RUNS
-- ============================================================

CREATE TABLE update_runs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  agency_id       uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  status          update_run_status NOT NULL DEFAULT 'queued',

  -- What's being updated
  plugin_slugs    text[] NOT NULL DEFAULT '{}',
  plugin_count    int GENERATED ALWAYS AS (array_length(plugin_slugs, 1)) STORED,

  -- Timeline
  queued_at       timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  staged_at       timestamptz,
  tested_at       timestamptz,
  deployed_at     timestamptz,
  finished_at     timestamptz,

  -- Results
  test_passed     boolean,
  screenshot_before_url text,
  screenshot_after_url  text,
  diff_score      numeric(5,2),     -- 0-100, lower = more similar
  test_output     text,
  ai_diagnosis    text,
  ai_fix_suggestion text,
  error_message   text,

  -- Worker info
  worker_id       text,
  staging_url     text
);

CREATE INDEX idx_runs_site ON update_runs(site_id);
CREATE INDEX idx_runs_agency ON update_runs(agency_id);
CREATE INDEX idx_runs_status ON update_runs(status) WHERE status IN ('queued', 'staging', 'testing');

-- ============================================================
-- ALERTS
-- ============================================================

CREATE TABLE alerts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  agency_id       uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  severity        alert_severity NOT NULL,
  status          alert_status NOT NULL DEFAULT 'open',
  type            text NOT NULL,  -- 'ssl_expiry', 'php_version', 'plugin_vulnerable', 'site_down', 'update_failed', etc.
  title           text NOT NULL,
  message         text,
  triggered_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  dismissed_at    timestamptz,
  metadata        jsonb
);

CREATE INDEX idx_alerts_site ON alerts(site_id);
CREATE INDEX idx_alerts_agency ON alerts(agency_id);
CREATE INDEX idx_alerts_open ON alerts(agency_id, status) WHERE status = 'open';

-- ============================================================
-- REPORTS
-- ============================================================

CREATE TABLE reports (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  agency_id       uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  period_label    text,   -- e.g. "September 2026"
  period_start    date,
  period_end      date,
  status          report_status NOT NULL DEFAULT 'queued',
  language        text NOT NULL DEFAULT 'nl',
  pdf_url         text,
  pdf_storage_path text,
  generated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_agency ON reports(agency_id);
CREATE INDEX idx_reports_site ON reports(site_id);

-- ============================================================
-- SITE OVERVIEW VIEW (used by dashboard)
-- ============================================================

CREATE VIEW site_overview AS
SELECT
  s.id,
  s.agency_id,
  s.url,
  s.name,
  s.client_name,
  s.status,
  s.last_seen_at,
  s.last_heartbeat_at,
  s.api_key,
  -- Latest snapshot fields
  h.wp_version,
  h.php_version,
  h.ssl_days_remaining,
  h.ssl_valid,
  h.performance_score,
  h.lcp_ms,
  h.cls_score,
  h.captured_at AS last_snapshot_at,
  -- Aggregates
  COUNT(DISTINCT CASE WHEN p.update_available THEN p.id END)::int AS pending_updates,
  COUNT(DISTINCT CASE WHEN a.status = 'open' AND a.severity = 'critical' THEN a.id END)::int AS critical_alerts
FROM sites s
LEFT JOIN latest_health_snapshots h ON h.site_id = s.id
LEFT JOIN site_plugins p ON p.site_id = s.id AND p.active = true
LEFT JOIN alerts a ON a.site_id = s.id AND a.status = 'open'
WHERE s.active = true
GROUP BY s.id, s.agency_id, s.url, s.name, s.client_name, s.status,
         s.last_seen_at, s.last_heartbeat_at, s.api_key,
         h.wp_version, h.php_version, h.ssl_days_remaining, h.ssl_valid,
         h.performance_score, h.lcp_ms, h.cls_score, h.captured_at;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Process incoming heartbeat from the WordPress plugin
CREATE OR REPLACE FUNCTION process_heartbeat(
  p_api_key     text,
  p_payload     jsonb
) RETURNS jsonb AS $$
DECLARE
  v_site        sites%ROWTYPE;
  v_snapshot_id uuid;
  v_status      site_status;
BEGIN
  -- Find site by API key
  SELECT * INTO v_site FROM sites WHERE api_key = p_api_key AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unknown API key');
  END IF;

  -- Determine status from status_code
  v_status := CASE
    WHEN (p_payload->>'status_code')::int BETWEEN 200 AND 299 THEN 'online'::site_status
    WHEN (p_payload->>'status_code')::int >= 500 THEN 'degraded'::site_status
    ELSE 'offline'::site_status
  END;

  -- Update site
  UPDATE sites SET
    status           = v_status,
    last_seen_at     = now(),
    last_heartbeat_at = now(),
    wp_version       = p_payload->>'wp_version',
    php_version      = p_payload->>'php_version',
    updated_at       = now()
  WHERE id = v_site.id;

  -- Insert health snapshot
  INSERT INTO health_snapshots (
    site_id, wp_version, php_version,
    ssl_valid, ssl_expires_at, ssl_issuer,
    uptime_ms, status_code,
    lcp_ms, cls_score, fid_ms, ttfb_ms, performance_score,
    mysql_version, db_size_mb,
    opscache_enabled, memory_limit_mb,
    raw_data
  ) VALUES (
    v_site.id,
    p_payload->>'wp_version',
    p_payload->>'php_version',
    (p_payload->>'ssl_valid')::boolean,
    (p_payload->>'ssl_expires_at')::timestamptz,
    p_payload->>'ssl_issuer',
    (p_payload->>'uptime_ms')::int,
    (p_payload->>'status_code')::int,
    (p_payload->>'lcp_ms')::numeric,
    (p_payload->>'cls_score')::numeric,
    (p_payload->>'fid_ms')::numeric,
    (p_payload->>'ttfb_ms')::numeric,
    (p_payload->>'performance_score')::int,
    p_payload->>'mysql_version',
    (p_payload->>'db_size_mb')::numeric,
    (p_payload->>'opscache_enabled')::boolean,
    (p_payload->>'memory_limit_mb')::int,
    p_payload
  ) RETURNING id INTO v_snapshot_id;

  -- Upsert plugins
  IF p_payload ? 'plugins' THEN
    INSERT INTO site_plugins (site_id, slug, name, version, latest_version, update_available, active, vulnerable, vulnerability_details)
    SELECT
      v_site.id,
      (plugin->>'slug')::text,
      (plugin->>'name')::text,
      (plugin->>'version')::text,
      (plugin->>'latest_version')::text,
      COALESCE((plugin->>'update_available')::boolean, false),
      COALESCE((plugin->>'active')::boolean, true),
      COALESCE((plugin->>'vulnerable')::boolean, false),
      plugin->'vulnerability_details'
    FROM jsonb_array_elements(p_payload->'plugins') AS plugin
    ON CONFLICT (site_id, slug) DO UPDATE SET
      name              = EXCLUDED.name,
      version           = EXCLUDED.version,
      latest_version    = EXCLUDED.latest_version,
      update_available  = EXCLUDED.update_available,
      active            = EXCLUDED.active,
      vulnerable        = EXCLUDED.vulnerable,
      vulnerability_details = EXCLUDED.vulnerability_details,
      last_checked_at   = now();
  END IF;

  -- Auto-create alerts
  -- SSL expiry warning
  IF (p_payload->>'ssl_expires_at') IS NOT NULL THEN
    DECLARE v_days int;
    BEGIN
      v_days := EXTRACT(days FROM (p_payload->>'ssl_expires_at')::timestamptz - now())::int;
      IF v_days <= 14 THEN
        INSERT INTO alerts (site_id, agency_id, severity, type, title, message)
        SELECT v_site.id, v_site.agency_id,
          CASE WHEN v_days <= 3 THEN 'critical' ELSE 'warning' END::alert_severity,
          'ssl_expiry',
          'SSL certificate expiring in ' || v_days || ' days',
          'The SSL certificate for ' || v_site.url || ' expires on ' || (p_payload->>'ssl_expires_at')::date
        WHERE NOT EXISTS (
          SELECT 1 FROM alerts
          WHERE site_id = v_site.id AND type = 'ssl_expiry' AND status = 'open'
        );
      END IF;
    END;
  END IF;

  -- PHP version warning (< 8.1)
  IF (p_payload->>'php_version') IS NOT NULL THEN
    IF (split_part(p_payload->>'php_version', '.', 1)::int < 8 OR
       (split_part(p_payload->>'php_version', '.', 1)::int = 8 AND
        split_part(p_payload->>'php_version', '.', 2)::int < 1)) THEN
      INSERT INTO alerts (site_id, agency_id, severity, type, title, message)
      SELECT v_site.id, v_site.agency_id, 'warning', 'php_version',
        'PHP ' || (p_payload->>'php_version') || ' is outdated',
        'WordPress best practice requires PHP 8.1 or higher'
      WHERE NOT EXISTS (
        SELECT 1 FROM alerts
        WHERE site_id = v_site.id AND type = 'php_version' AND status = 'open'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'site_id', v_site.id,
    'snapshot_id', v_snapshot_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if agency is at site limit
CREATE OR REPLACE FUNCTION agency_at_site_limit(p_agency_id uuid)
RETURNS boolean AS $$
DECLARE
  v_agency agencies%ROWTYPE;
  v_count  int;
BEGIN
  SELECT * INTO v_agency FROM agencies WHERE id = p_agency_id;
  SELECT COUNT(*) INTO v_count FROM sites WHERE agency_id = p_agency_id AND active = true;
  RETURN v_count >= v_agency.plan_sites_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agencies_updated_at BEFORE UPDATE ON agencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sites_updated_at BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE agencies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_plugins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports        ENABLE ROW LEVEL SECURITY;

-- Helper: is current user a member of an agency?
-- SECURITY DEFINER + SET search_path ensures it runs as postgres (BYPASSRLS) to avoid RLS recursion
CREATE OR REPLACE FUNCTION is_agency_member(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agency_members
    WHERE agency_id = p_agency_id AND user_id = auth.uid()
  );
$$;

-- Helper: is current user an owner of an agency?
CREATE OR REPLACE FUNCTION is_agency_owner(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agency_members
    WHERE agency_id = p_agency_id AND user_id = auth.uid() AND role = 'owner'
  );
$$;

-- Helper: current user's agency_id (for members with one agency)
CREATE OR REPLACE FUNCTION my_agency_id()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT agency_id FROM agency_members
  WHERE user_id = auth.uid()
  ORDER BY joined_at LIMIT 1;
$$;

-- AGENCIES
CREATE POLICY "members can see their agency" ON agencies
  FOR SELECT USING (is_agency_member(id));

-- Note: agencies UPDATE policy uses is_agency_owner which is SECURITY DEFINER (no recursion)
CREATE POLICY "owners can update their agency" ON agencies
  FOR UPDATE USING (is_agency_owner(id));

-- AGENCY MEMBERS
-- SELECT: direct user_id check (avoids any recursion — no function call needed)
CREATE POLICY "members can see their agency members" ON agency_members
  FOR SELECT USING (user_id = auth.uid());

-- Write policies use is_agency_owner (SECURITY DEFINER, bypasses RLS — no recursion)
-- Split from ALL to avoid SELECT recursion
CREATE POLICY "owners can insert members" ON agency_members
  FOR INSERT WITH CHECK (is_agency_owner(agency_id));

CREATE POLICY "owners can update members" ON agency_members
  FOR UPDATE USING (is_agency_owner(agency_id));

CREATE POLICY "owners can delete members" ON agency_members
  FOR DELETE USING (is_agency_owner(agency_id));

-- SITES
CREATE POLICY "agency members can see their sites" ON sites
  FOR SELECT USING (is_agency_member(agency_id));

CREATE POLICY "agency members can insert sites" ON sites
  FOR INSERT WITH CHECK (is_agency_member(agency_id));

CREATE POLICY "agency admins can update sites" ON sites
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM agency_members
      WHERE agency_id = sites.agency_id AND user_id = auth.uid()
      AND role IN ('owner', 'admin'))
  );

-- HEALTH SNAPSHOTS
CREATE POLICY "agency members can view snapshots" ON health_snapshots
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites s
      WHERE s.id = site_id AND is_agency_member(s.agency_id))
  );

-- SITE PLUGINS
CREATE POLICY "agency members can view plugins" ON site_plugins
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM sites s
      WHERE s.id = site_id AND is_agency_member(s.agency_id))
  );

-- UPDATE RUNS
CREATE POLICY "agency members can view update runs" ON update_runs
  FOR SELECT USING (is_agency_member(agency_id));

CREATE POLICY "agency members can create update runs" ON update_runs
  FOR INSERT WITH CHECK (is_agency_member(agency_id));

-- ALERTS
CREATE POLICY "agency members can view alerts" ON alerts
  FOR SELECT USING (is_agency_member(agency_id));

CREATE POLICY "agency members can update alerts" ON alerts
  FOR UPDATE USING (is_agency_member(agency_id));

-- REPORTS
CREATE POLICY "agency members can view reports" ON reports
  FOR SELECT USING (is_agency_member(agency_id));

-- ============================================================
-- GRANT AUTHENTICATED ROLE (for logged-in users via Supabase client)
-- RLS policies handle row-level access; these grants enable table access
-- ============================================================

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.agencies TO authenticated;
GRANT SELECT ON public.agency_members TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.agency_members TO authenticated;
GRANT UPDATE ON public.agencies TO authenticated;
GRANT SELECT ON public.sites TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.sites TO authenticated;
GRANT SELECT ON public.health_snapshots TO authenticated;
GRANT SELECT ON public.site_plugins TO authenticated;
GRANT SELECT, INSERT ON public.update_runs TO authenticated;
GRANT SELECT, UPDATE ON public.alerts TO authenticated;
GRANT SELECT ON public.reports TO authenticated;

-- ============================================================
-- GRANT SERVICE ROLE (for API routes using service key)
-- ============================================================

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ============================================================
-- SEED: Create first agency for testing
-- (Replace with real values after signup)
-- ============================================================

-- INSERT INTO agencies (name, slug, plan, plan_sites_limit)
-- VALUES ('EM Hosting en Design', 'em-hosting', 'agency', 50);
