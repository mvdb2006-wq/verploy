-- =============================================================================
-- Verploy — Database Schema
-- Migration: 001_schema.sql
-- =============================================================================
-- Run order: extensions → enums → tables → indexes → RLS → functions → triggers

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pg_cron";       -- scheduled jobs
create extension if not exists "pg_net";         -- async HTTP (Playwright workers)

-- ─── Enums ───────────────────────────────────────────────────────────────────

create type site_status as enum (
  'pending',      -- just registered, first heartbeat not yet received
  'online',       -- last heartbeat successful
  'offline',      -- missed 3+ heartbeats
  'maintenance'   -- agency manually paused monitoring
);

create type update_type as enum ('plugin', 'theme', 'core');

create type update_run_status as enum (
  'queued',
  'staging',      -- cloning site to staging env
  'testing',      -- Playwright running
  'applying',     -- update being applied to live site
  'completed',
  'failed',
  'blocked'       -- test failed, update NOT applied
);

create type alert_severity as enum ('info', 'warning', 'critical');
create type alert_type as enum (
  'site_offline',
  'update_failed',
  'update_blocked',
  'ssl_expiring',
  'ssl_expired',
  'domain_expiring',
  'php_outdated',
  'vulnerability_found',
  'core_update_available'
);

create type report_status as enum ('pending', 'generating', 'sent', 'failed');

-- ─── Tables ───────────────────────────────────────────────────────────────────

-- Agencies (one per Verploy customer account)
create table agencies (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  slug          text not null unique,
  logo_url      text,
  primary_color text default '#22D98A',
  plan          text not null default 'starter',  -- starter | agency | pro | enterprise
  site_limit    int  not null default 5,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Team members
create table agency_members (
  id         uuid primary key default uuid_generate_v4(),
  agency_id  uuid not null references agencies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member',  -- owner | admin | member
  invited_at timestamptz not null default now(),
  unique (agency_id, user_id)
);

-- WordPress sites connected to Verploy
create table sites (
  id              uuid primary key default uuid_generate_v4(),
  agency_id       uuid not null references agencies(id) on delete cascade,
  url             text not null,
  name            text not null,
  api_key         text not null unique default 'vp_live_' || replace(gen_random_uuid()::text, '-', ''),
  status          site_status not null default 'pending',
  client_name     text,
  client_email    text,
  client_language text not null default 'nl',   -- nl | en | de | fr | es
  notes           text,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (agency_id, url)
);

-- Health snapshots (every 15 min from WP plugin heartbeat)
create table health_snapshots (
  id               uuid primary key default uuid_generate_v4(),
  site_id          uuid not null references sites(id) on delete cascade,
  collected_at     timestamptz not null,

  -- WordPress
  wp_version       text,
  core_update_to   text,     -- null = up to date

  -- Server
  php_version      text,
  php_major        text,     -- e.g. "8.3"
  mysql_version    text,
  memory_limit     text,
  max_execution    int,
  opcache_enabled  bool,
  opcache_hit_rate numeric(5,2),

  -- SSL
  ssl_enabled      bool,
  ssl_expires_days int,
  ssl_issuer       text,

  -- Performance
  db_response_ms   numeric(8,2),
  uploads_size_mb  numeric(10,1),
  active_plugins   int,

  -- Raw payload (full JSON from plugin)
  raw              jsonb,

  created_at       timestamptz not null default now()
);

-- Plugin inventory (denormalized per snapshot for history)
create table site_plugins (
  id               uuid primary key default uuid_generate_v4(),
  site_id          uuid not null references sites(id) on delete cascade,
  snapshot_id      uuid not null references health_snapshots(id) on delete cascade,
  plugin_file      text not null,
  name             text not null,
  version          text,
  author           text,
  active           bool not null default true,
  update_available bool not null default false,
  update_version   text,
  created_at       timestamptz not null default now()
);

-- Theme inventory
create table site_themes (
  id               uuid primary key default uuid_generate_v4(),
  site_id          uuid not null references sites(id) on delete cascade,
  snapshot_id      uuid not null references health_snapshots(id) on delete cascade,
  slug             text not null,
  name             text not null,
  version          text,
  active           bool not null default false,
  update_available bool not null default false,
  update_version   text,
  created_at       timestamptz not null default now()
);

-- Update runs: one row per plugin/theme/core update attempt
create table update_runs (
  id                uuid primary key default uuid_generate_v4(),
  site_id           uuid not null references sites(id) on delete cascade,
  update_type       update_type not null,
  slug              text,            -- null for core
  from_version      text,
  to_version        text,
  status            update_run_status not null default 'queued',
  triggered_by      text default 'auto',  -- auto | manual | user_id
  staging_url       text,           -- ephemeral Railway URL
  test_passed       bool,
  screenshot_before text,           -- Storage URL
  screenshot_after  text,           -- Storage URL
  diff_image_url    text,           -- Visual regression diff
  ai_diagnosis      text,           -- AI failure explanation
  error_message     text,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- Individual Playwright test results within an update run
create table test_results (
  id           uuid primary key default uuid_generate_v4(),
  run_id       uuid not null references update_runs(id) on delete cascade,
  test_name    text not null,   -- e.g. "homepage_load", "contact_form", "checkout"
  passed       bool not null,
  duration_ms  int,
  error        text,
  screenshot   text,
  created_at   timestamptz not null default now()
);

-- Alerts
create table alerts (
  id           uuid primary key default uuid_generate_v4(),
  site_id      uuid not null references sites(id) on delete cascade,
  agency_id    uuid not null references agencies(id) on delete cascade,
  type         alert_type not null,
  severity     alert_severity not null default 'warning',
  message      text not null,
  metadata     jsonb default '{}',
  resolved     bool not null default false,
  resolved_at  timestamptz,
  notified_at  timestamptz,     -- when Slack/email was sent
  created_at   timestamptz not null default now()
);

-- Monthly client reports
create table reports (
  id              uuid primary key default uuid_generate_v4(),
  site_id         uuid not null references sites(id) on delete cascade,
  agency_id       uuid not null references agencies(id) on delete cascade,
  period_year     int  not null,
  period_month    int  not null,  -- 1–12
  status          report_status not null default 'pending',
  language        text not null default 'nl',
  pdf_url         text,           -- Supabase Storage URL
  sent_to         text,           -- client email address
  sent_at         timestamptz,
  uptime_pct      numeric(5,2),
  updates_applied int default 0,
  avg_load_ms     int,
  created_at      timestamptz not null default now(),
  unique (site_id, period_year, period_month)
);

-- Vulnerability scan results (cross-referenced with WPScan DB)
create table vulnerabilities (
  id           uuid primary key default uuid_generate_v4(),
  site_id      uuid not null references sites(id) on delete cascade,
  plugin_slug  text,
  theme_slug   text,
  cve_id       text,
  title        text not null,
  severity     alert_severity not null,
  fixed_in     text,            -- version that fixes it
  patched      bool not null default false,
  patched_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Core Web Vitals history
create table web_vitals (
  id           uuid primary key default uuid_generate_v4(),
  site_id      uuid not null references sites(id) on delete cascade,
  measured_at  timestamptz not null default now(),
  lcp_ms       int,    -- Largest Contentful Paint
  cls          numeric(6,4),  -- Cumulative Layout Shift
  fid_ms       int,    -- First Input Delay
  ttfb_ms      int,   -- Time to First Byte
  score        int,   -- 0–100 composite
  url_tested   text   -- which page was tested
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index on health_snapshots  (site_id, collected_at desc);
create index on site_plugins      (site_id, snapshot_id);
create index on site_plugins      (site_id) where update_available = true;
create index on update_runs       (site_id, created_at desc);
create index on update_runs       (status) where status not in ('completed', 'failed', 'blocked');
create index on alerts            (agency_id, resolved, created_at desc);
create index on alerts            (site_id, resolved);
create index on reports           (agency_id, period_year, period_month);
create index on web_vitals        (site_id, measured_at desc);
create index on vulnerabilities   (site_id, patched);

-- ─── Row-Level Security ───────────────────────────────────────────────────────

alter table agencies         enable row level security;
alter table agency_members   enable row level security;
alter table sites            enable row level security;
alter table health_snapshots enable row level security;
alter table site_plugins     enable row level security;
alter table site_themes      enable row level security;
alter table update_runs      enable row level security;
alter table test_results     enable row level security;
alter table alerts           enable row level security;
alter table reports          enable row level security;
alter table vulnerabilities  enable row level security;
alter table web_vitals       enable row level security;

-- Helper: is this user a member of the given agency?
create or replace function is_agency_member(p_agency_id uuid)
returns bool language sql security definer as $$
  select exists (
    select 1 from agency_members
    where agency_id = p_agency_id
      and user_id = auth.uid()
  );
$$;

-- Agencies: owner + members can read; only owner can write
create policy "agency_select" on agencies
  for select using ( is_agency_member(id) or owner_id = auth.uid() );
create policy "agency_insert" on agencies
  for insert with check ( owner_id = auth.uid() );
create policy "agency_update" on agencies
  for update using ( owner_id = auth.uid() );

-- Sites: members of owning agency
create policy "site_select" on sites
  for select using ( is_agency_member(agency_id) );
create policy "site_insert" on sites
  for insert with check ( is_agency_member(agency_id) );
create policy "site_update" on sites
  for update using ( is_agency_member(agency_id) );
create policy "site_delete" on sites
  for delete using ( is_agency_member(agency_id) );

-- Health / plugins / themes: same agency
create policy "health_select" on health_snapshots
  for select using (
    exists (select 1 from sites s where s.id = site_id and is_agency_member(s.agency_id))
  );
create policy "plugin_select" on site_plugins
  for select using (
    exists (select 1 from sites s where s.id = site_id and is_agency_member(s.agency_id))
  );
create policy "theme_select" on site_themes
  for select using (
    exists (select 1 from sites s where s.id = site_id and is_agency_member(s.agency_id))
  );

-- Update runs + test results
create policy "run_select" on update_runs
  for select using (
    exists (select 1 from sites s where s.id = site_id and is_agency_member(s.agency_id))
  );
create policy "test_select" on test_results
  for select using (
    exists (
      select 1 from update_runs r
      join sites s on s.id = r.site_id
      where r.id = run_id and is_agency_member(s.agency_id)
    )
  );

-- Alerts
create policy "alert_select" on alerts
  for select using ( is_agency_member(agency_id) );
create policy "alert_update" on alerts
  for update using ( is_agency_member(agency_id) );

-- Reports + vulns + vitals
create policy "report_select" on reports
  for select using ( is_agency_member(agency_id) );
create policy "vuln_select"   on vulnerabilities
  for select using (
    exists (select 1 from sites s where s.id = site_id and is_agency_member(s.agency_id))
  );
create policy "vitals_select" on web_vitals
  for select using (
    exists (select 1 from sites s where s.id = site_id and is_agency_member(s.agency_id))
  );

-- Service role bypass (used by API workers):
-- No policy needed — service_role bypasses RLS by default in Supabase.

-- ─── Functions ────────────────────────────────────────────────────────────────

-- Called by the heartbeat endpoint to upsert site status + store snapshot
create or replace function process_heartbeat(
  p_api_key  text,
  p_payload  jsonb
)
returns jsonb language plpgsql security definer as $$
declare
  v_site      sites%rowtype;
  v_snap_id   uuid;
  v_ssl       jsonb;
  v_server    jsonb;
  v_wp        jsonb;
begin
  -- Lookup site by API key
  select * into v_site from sites where api_key = p_api_key;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unknown API key');
  end if;

  v_ssl    := p_payload -> 'wordpress' -> 'ssl';
  v_server := p_payload -> 'server';
  v_wp     := p_payload -> 'wordpress';

  -- Insert health snapshot
  insert into health_snapshots (
    site_id, collected_at,
    wp_version, core_update_to,
    php_version, php_major, mysql_version,
    memory_limit, max_execution,
    opcache_enabled, opcache_hit_rate,
    ssl_enabled, ssl_expires_days, ssl_issuer,
    db_response_ms, uploads_size_mb, active_plugins,
    raw
  ) values (
    v_site.id,
    (p_payload ->> 'collected_at')::timestamptz,
    v_wp ->> 'version',
    v_wp ->> 'core_update_available',
    v_server ->> 'php_version',
    v_server ->> 'php_major',
    v_server ->> 'mysql_version',
    v_server ->> 'memory_limit',
    (v_server ->> 'max_execution_time')::int,
    (v_server -> 'opcache' ->> 'enabled')::bool,
    (v_server -> 'opcache' ->> 'hit_rate')::numeric,
    (v_ssl ->> 'enabled')::bool,
    (v_ssl ->> 'expires_days')::int,
    v_ssl ->> 'issuer',
    (p_payload -> 'performance' ->> 'db_response_ms')::numeric,
    (p_payload -> 'performance' ->> 'uploads_size_mb')::numeric,
    (p_payload -> 'performance' ->> 'active_plugins_count')::int,
    p_payload
  )
  returning id into v_snap_id;

  -- Update site status + last_seen
  update sites
  set status       = 'online',
      last_seen_at = now(),
      updated_at   = now()
  where id = v_site.id;

  -- Auto-create SSL expiry alert if needed
  if (v_ssl ->> 'expires_days')::int <= 14 then
    insert into alerts (site_id, agency_id, type, severity, message, metadata)
    values (
      v_site.id, v_site.agency_id,
      case when (v_ssl ->> 'expires_days')::int <= 0 then 'ssl_expired' else 'ssl_expiring' end,
      case when (v_ssl ->> 'expires_days')::int <= 7  then 'critical' else 'warning' end,
      format('SSL certificate expires in %s days', v_ssl ->> 'expires_days'),
      jsonb_build_object('expires_days', v_ssl ->> 'expires_days')
    )
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'snapshot_id', v_snap_id);
end;
$$;

-- Dashboard summary view: latest status per site for the agency overview
create or replace view site_overview as
select
  s.id,
  s.agency_id,
  s.url,
  s.name,
  s.client_name,
  s.status,
  s.last_seen_at,
  h.wp_version,
  h.core_update_to,
  h.php_major,
  h.ssl_expires_days,
  h.ssl_enabled,
  h.opcache_enabled,
  h.db_response_ms,
  h.active_plugins,
  -- Count pending updates from latest snapshot
  (
    select count(*) from site_plugins p
    where p.site_id = s.id
      and p.snapshot_id = h.id
      and p.update_available = true
  ) as pending_plugin_updates,
  -- Latest vitals score
  (
    select score from web_vitals v
    where v.site_id = s.id
    order by measured_at desc
    limit 1
  ) as vitals_score,
  -- Unresolved critical alerts
  (
    select count(*) from alerts a
    where a.site_id = s.id
      and a.resolved = false
      and a.severity = 'critical'
  ) as critical_alerts,
  h.collected_at as last_snapshot_at
from sites s
left join lateral (
  select * from health_snapshots
  where site_id = s.id
  order by collected_at desc
  limit 1
) h on true;

-- ─── Triggers ─────────────────────────────────────────────────────────────────

-- Auto-update updated_at on agencies and sites
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger agencies_updated_at before update on agencies
  for each row execute function set_updated_at();
create trigger sites_updated_at before update on sites
  for each row execute function set_updated_at();

-- Auto-create agency_member row when agency is created
create or replace function add_owner_as_member()
returns trigger language plpgsql security definer as $$
begin
  insert into agency_members (agency_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger agency_owner_member after insert on agencies
  for each row execute function add_owner_as_member();
