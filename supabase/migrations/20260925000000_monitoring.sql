-- ============================================================================
-- Verploy — fase 3: monitoring en waarschuwingen
--  • SSL- en domeingegevens op sites (door de backend gecontroleerd)
--  • alerts: één open melding per site+type, escalatie, herstel
--  • app.evaluate_site / app.sweep: alle drempelregels op één plek
--  • meldingenwachtrij voor e-mail (claim → versturen → bevestigen/opnieuw)
--  • pg_cron (indien beschikbaar): elke 5 minuten app.sweep()
-- ============================================================================

set check_function_bodies = off;

-- ── 1. SSL/domein op sites (alleen de server schrijft deze kolommen) ─────────
alter table public.sites
  add column ssl_valid         boolean,
  add column ssl_expires_at    timestamptz,
  add column ssl_issuer        text,
  add column ssl_error         text check (ssl_error is null or ssl_error in
                               ('expired','self_signed','hostname_mismatch','untrusted','unreachable')),
  add column ssl_checked_at    timestamptz,
  add column domain_expires_at timestamptz,
  add column domain_error      text check (domain_error is null or domain_error in ('not_published','lookup_failed')),
  add column domain_checked_at timestamptz;

-- ── 2. Alerts ─────────────────────────────────────────────────────────────────
create table public.alerts (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null references public.agencies(id) on delete cascade,
  site_id              uuid not null references public.sites(id) on delete cascade,
  type                 text not null check (type in ('site_offline','ssl_expiring','ssl_invalid','ssl_missing',
                        'domain_expiring','php_eol','memory_low','disk_low','core_update','plugin_updates')),
  severity             text not null check (severity in ('info','warning','critical')),
  status               text not null default 'open' check (status in ('open','resolved')),
  params               jsonb not null default '{}'::jsonb,
  opened_at            timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  acknowledged_at      timestamptz,
  acknowledged_by      uuid references auth.users(id) on delete set null,
  notified_at          timestamptz,           -- melding (e-mail) verstuurd of bewust overgeslagen
  resolved_notified_at timestamptz,           -- herstelmelding (alleen site_offline)
  notify_attempts      integer not null default 0,
  notify_claimed_at    timestamptz
);
create unique index alerts_one_open_per_type on public.alerts(site_id, type) where status = 'open';
create index alerts_agency_status_idx on public.alerts(agency_id, status, opened_at desc);
create index alerts_pending_notify_idx on public.alerts(opened_at) where notified_at is null;

create trigger alerts_agency before insert or update on public.alerts
  for each row execute function app.check_site_agency();

alter table public.alerts enable row level security;
revoke all on public.alerts from anon, authenticated, public;
grant all on public.alerts to service_role;
grant select on public.alerts to authenticated;
create policy alerts_read on public.alerts for select to authenticated
  using ((select app.is_member(agency_id)));

-- ── 3. Alert-helpers ─────────────────────────────────────────────────────────
-- Opent of werkt bij. Escalatie (warning → critical) zet de melding opnieuw klaar.
create or replace function app.raise_alert(p_site uuid, p_agency uuid, p_type text, p_severity text, p_params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_rank constant jsonb := '{"info":0,"warning":1,"critical":2}';
  v_existing public.alerts%rowtype;
begin
  select * into v_existing from public.alerts where site_id = p_site and type = p_type and status = 'open' for update;
  if not found then
    insert into public.alerts (agency_id, site_id, type, severity, params, notified_at)
    values (p_agency, p_site, p_type, p_severity, coalesce(p_params, '{}'::jsonb),
            case when p_severity = 'info' then now() end);          -- info: alleen in-app
  else
    update public.alerts
       set params = coalesce(p_params, '{}'::jsonb),
           severity = p_severity,
           updated_at = now(),
           -- escalatie: opnieuw melden en bevestiging vervalt
           notified_at = case when (v_rank ->> p_severity)::int > (v_rank ->> v_existing.severity)::int
                               and p_severity <> 'info' then null else notified_at end,
           notify_attempts = case when (v_rank ->> p_severity)::int > (v_rank ->> v_existing.severity)::int then 0 else notify_attempts end,
           acknowledged_at = case when (v_rank ->> p_severity)::int > (v_rank ->> v_existing.severity)::int then null else acknowledged_at end
     where id = v_existing.id
       and (severity <> p_severity or params <> coalesce(p_params, '{}'::jsonb));
  end if;
end $$;

create or replace function app.resolve_alert(p_site uuid, p_type text)
returns void language sql security definer set search_path = '' as $$
  update public.alerts
     set status = 'resolved', resolved_at = now(), updated_at = now(),
         -- alleen een herstelmelding als de openingsmelding ook echt verstuurd is
         resolved_notified_at = case when type = 'site_offline' and notified_at is not null then null else now() end
   where site_id = p_site and type = p_type and status = 'open';
$$;

-- PHP-beveiligingsondersteuning volgens php.net/supported-versions (opgehaald 24-09-2026).
-- Oudere branches dan 8.2 zijn end-of-life.
create or replace function app.php_security_eol(p_version text) returns date
language sql immutable set search_path = '' as $$
  select case
    when p_version is null or p_version !~ '^\d+\.\d+' then null
    when (split_part(p_version, '.', 1))::int < 8 then date '2022-11-28'
    when (split_part(p_version, '.', 1))::int > 8 then null
    else case (split_part(p_version, '.', 2))::int
      when 0 then date '2023-11-26'
      when 1 then date '2025-12-31'
      when 2 then date '2026-12-31'
      when 3 then date '2027-12-31'
      when 4 then date '2028-12-31'
      when 5 then date '2029-12-31'
      else null end
  end;
$$;

-- ── 4. Alle drempelregels (enige bron; zie PLAN.md §6) ───────────────────────
create or replace function app.evaluate_site(p_site uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s    public.sites%rowtype;
  snap public.health_snapshots%rowtype;
  v_eol date;
  v_days int;
  v_updates int;
  v_core public.site_components%rowtype;
begin
  select * into s from public.sites where id = p_site;
  if not found then return; end if;

  -- Niet (meer) gekoppeld: geen meldingen over deze site
  if s.connection_status <> 'connected' then
    update public.alerts set status = 'resolved', resolved_at = now(), updated_at = now(), resolved_notified_at = now()
     where site_id = p_site and status = 'open';
    return;
  end if;

  -- Offline: 45 min geen heartbeat (3 gemiste van 15 min)
  if coalesce(s.last_heartbeat_at, s.paired_at, s.created_at) < now() - interval '45 minutes' then
    perform app.raise_alert(s.id, s.agency_id, 'site_offline', 'critical',
      jsonb_build_object('since', s.last_heartbeat_at));
    update public.sites set status = 'offline' where id = s.id and status <> 'offline';
  else
    perform app.resolve_alert(s.id, 'site_offline');
  end if;

  -- SSL
  if s.url like 'http://%' then
    perform app.raise_alert(s.id, s.agency_id, 'ssl_missing', 'warning', '{}');
    perform app.resolve_alert(s.id, 'ssl_invalid');
    perform app.resolve_alert(s.id, 'ssl_expiring');
  else
    perform app.resolve_alert(s.id, 'ssl_missing');
    if s.ssl_checked_at is not null then
      if s.ssl_valid is false and s.ssl_error is distinct from 'expired' and s.ssl_error is distinct from 'unreachable' then
        perform app.raise_alert(s.id, s.agency_id, 'ssl_invalid', 'critical', jsonb_build_object('error', s.ssl_error));
      else
        perform app.resolve_alert(s.id, 'ssl_invalid');
      end if;
      if s.ssl_expires_at is not null and s.ssl_expires_at < now() + interval '14 days' then
        v_days := greatest(0, floor(extract(epoch from (s.ssl_expires_at - now())) / 86400)::int);
        perform app.raise_alert(s.id, s.agency_id, 'ssl_expiring',
          case when s.ssl_expires_at < now() + interval '3 days' then 'critical' else 'warning' end,
          jsonb_build_object('expires_at', s.ssl_expires_at, 'days', v_days));
      else
        perform app.resolve_alert(s.id, 'ssl_expiring');
      end if;
    end if;
  end if;

  -- Domein (alleen als de registry een verloopdatum publiceert)
  if s.domain_expires_at is not null and s.domain_expires_at < now() + interval '30 days' then
    v_days := greatest(0, floor(extract(epoch from (s.domain_expires_at - now())) / 86400)::int);
    perform app.raise_alert(s.id, s.agency_id, 'domain_expiring',
      case when s.domain_expires_at < now() + interval '7 days' then 'critical' else 'warning' end,
      jsonb_build_object('expires_at', s.domain_expires_at, 'days', v_days));
  else
    perform app.resolve_alert(s.id, 'domain_expiring');
  end if;

  -- PHP end-of-life
  v_eol := app.php_security_eol(s.php_version);
  if v_eol is not null and v_eol < current_date + 180 then
    perform app.raise_alert(s.id, s.agency_id, 'php_eol',
      case when v_eol < current_date then 'critical' else 'warning' end,
      jsonb_build_object('version', substring(s.php_version from '^\d+\.\d+'), 'eol', v_eol));
  else
    perform app.resolve_alert(s.id, 'php_eol');
  end if;

  -- Uit de laatste heartbeat: geheugen en schijf
  -- Laatst ontvangen (id), niet captured_at: de klok van de plugin is niet leidend.
  select * into snap from public.health_snapshots where site_id = s.id order by id desc limit 1;
  if found then
    if snap.memory_limit_mb is not null and snap.memory_limit_mb < 128 then
      perform app.raise_alert(s.id, s.agency_id, 'memory_low',
        case when snap.memory_limit_mb < 64 then 'critical' else 'warning' end,
        jsonb_build_object('mb', snap.memory_limit_mb));
    else
      perform app.resolve_alert(s.id, 'memory_low');
    end if;
    if snap.disk_free_mb is not null and snap.disk_free_mb < 1024 then
      perform app.raise_alert(s.id, s.agency_id, 'disk_low',
        case when snap.disk_free_mb < 256 then 'critical' else 'warning' end,
        jsonb_build_object('mb', snap.disk_free_mb));
    else
      perform app.resolve_alert(s.id, 'disk_low');
    end if;
  end if;

  -- Updates
  select * into v_core from public.site_components where site_id = s.id and type = 'core' and update_available limit 1;
  if found then
    perform app.raise_alert(s.id, s.agency_id, 'core_update', 'warning', jsonb_build_object('version', v_core.latest_version));
  else
    perform app.resolve_alert(s.id, 'core_update');
  end if;
  select count(*) into v_updates from public.site_components
   where site_id = s.id and type in ('plugin','theme') and update_available;
  if v_updates > 0 then
    perform app.raise_alert(s.id, s.agency_id, 'plugin_updates', 'info', jsonb_build_object('count', v_updates));
  else
    perform app.resolve_alert(s.id, 'plugin_updates');
  end if;
end $$;

-- Evalueert alle sites; aangeroepen door pg_cron (elke 5 min) en de onderhouds-cron.
create or replace function public.sweep_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.sites loop
    perform app.evaluate_site(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Heartbeat-ingest: identiek aan fase 2, plus evaluatie aan het EINDE (nadat site-status
-- en componenten zijn bijgewerkt), in dezelfde transactie.
create or replace function public.ingest_heartbeat(p_site uuid, p_snapshot jsonb, p_components jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid;
  v_id bigint;
begin
  select agency_id into v_agency from public.sites where id = p_site and connection_status = 'connected' for update;
  if v_agency is null then
    raise exception 'site_not_connected' using errcode = 'P0001';
  end if;

  insert into public.health_snapshots (agency_id, site_id, captured_at, connector_version, wp_version, php_version,
                                       memory_limit_mb, memory_peak_mb, disk_free_mb, db_size_mb, raw)
  values (v_agency, p_site,
          coalesce((p_snapshot ->> 'captured_at')::timestamptz, now()),
          p_snapshot ->> 'connector_version', p_snapshot ->> 'wp_version', p_snapshot ->> 'php_version',
          (p_snapshot ->> 'memory_limit_mb')::int, (p_snapshot ->> 'memory_peak_mb')::int,
          (p_snapshot ->> 'disk_free_mb')::int, (p_snapshot ->> 'db_size_mb')::numeric,
          coalesce(p_snapshot -> 'raw', '{}'::jsonb))
  returning id into v_id;

  insert into public.site_components (agency_id, site_id, type, slug, name, version, latest_version, update_available, active, updated_at)
  select v_agency, p_site, c ->> 'type', c ->> 'slug', c ->> 'name', c ->> 'version', c ->> 'latest_version',
         coalesce((c ->> 'update_available')::boolean, false), coalesce((c ->> 'active')::boolean, true), now()
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
  on conflict (site_id, type, slug) do update
     set name = excluded.name, version = excluded.version, latest_version = excluded.latest_version,
         update_available = excluded.update_available, active = excluded.active, updated_at = now();

  delete from public.site_components sc
   where sc.site_id = p_site
     and not exists (select 1 from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
                     where c ->> 'type' = sc.type and c ->> 'slug' = sc.slug);

  update public.sites
     set status = 'online',
         last_heartbeat_at = now(),
         connector_version = p_snapshot ->> 'connector_version',
         wp_version = p_snapshot ->> 'wp_version',
         php_version = p_snapshot ->> 'php_version'
   where id = p_site;

  delete from public.signed_request_nonces where site_id = p_site and created_at < now() - interval '15 minutes';
  perform app.evaluate_site(p_site);
  return v_id;
end $$;
revoke all on function public.ingest_heartbeat(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_heartbeat(uuid, jsonb, jsonb) to service_role;

-- ── 5. Meldingenwachtrij (e-mail) — alleen service_role ──────────────────────
-- Claimt openstaande meldingen (openen én herstel) met SKIP LOCKED; een claim
-- verloopt na 10 min, zodat een gecrasht proces niets laat liggen.
create or replace function public.claim_alert_notifications(p_limit int default 25)
returns table (
  alert_id uuid, kind text, type text, severity text, params jsonb, opened_at timestamptz,
  site_id uuid, site_name text, site_url text, agency_name text, locale text, recipients text[]
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id, case when a.status = 'open' then 'opened' else 'resolved' end as kind
      from public.alerts a
     where ((a.status = 'open' and a.notified_at is null)
         or (a.status = 'resolved' and a.type = 'site_offline' and a.notified_at is not null and a.resolved_notified_at is null))
       and a.notify_attempts < 5
       and (a.notify_claimed_at is null or a.notify_claimed_at < now() - interval '10 minutes')
     order by a.opened_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), claimed as (
    update public.alerts a set notify_claimed_at = now(), notify_attempts = a.notify_attempts + 1
      from due where a.id = due.id
    returning a.*, due.kind
  )
  select c.id, c.kind, c.type, c.severity, c.params, c.opened_at, s.id, s.name, s.url, ag.name, ag.dashboard_locale,
         array(select u.email::text from public.agency_members m join auth.users u on u.id = m.user_id
                where m.agency_id = c.agency_id and m.role in ('owner','admin') and u.email is not null order by u.email)
    from claimed c
    join public.sites s on s.id = c.site_id
    join public.agencies ag on ag.id = c.agency_id;
end $$;

-- Bevestigt (sent = true) of geeft vrij voor een nieuwe poging (sent = false).
create or replace function public.complete_alert_notification(p_alert uuid, p_kind text, p_sent boolean)
returns void language sql security definer set search_path = '' as $$
  update public.alerts
     set notify_claimed_at = null,
         notified_at = case when p_kind = 'opened' and p_sent then now() else notified_at end,
         resolved_notified_at = case when p_kind = 'resolved' and p_sent then now() else resolved_notified_at end
   where id = p_alert;
$$;

-- Bevestigen in de UI: melding blijft open (de oorzaak bestaat nog), maar verdwijnt uit "nieuw".
create or replace function public.acknowledge_alert(p_alert uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_agency uuid;
begin
  select agency_id into v_agency from public.alerts where id = p_alert;
  if v_agency is null or not app.is_member(v_agency) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.alerts set acknowledged_at = now(), acknowledged_by = (select auth.uid()) where id = p_alert and acknowledged_at is null;
end $$;

-- De server schrijft SSL/domein-resultaten weg en evalueert direct.
create or replace function public.record_site_checks(
  p_site uuid, p_ssl_valid boolean, p_ssl_expires_at timestamptz, p_ssl_issuer text, p_ssl_error text,
  p_domain_expires_at timestamptz, p_domain_error text, p_domain_checked boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.sites
     set ssl_valid = p_ssl_valid, ssl_expires_at = p_ssl_expires_at, ssl_issuer = p_ssl_issuer,
         ssl_error = p_ssl_error, ssl_checked_at = now(),
         domain_expires_at = case when p_domain_checked then p_domain_expires_at else domain_expires_at end,
         domain_error = case when p_domain_checked then p_domain_error else domain_error end,
         domain_checked_at = case when p_domain_checked then now() else domain_checked_at end
   where id = p_site;
  perform app.evaluate_site(p_site);
end $$;

revoke all on function public.sweep_alerts(), public.claim_alert_notifications(int),
  public.complete_alert_notification(uuid, text, boolean), public.acknowledge_alert(uuid),
  public.record_site_checks(uuid, boolean, timestamptz, text, text, timestamptz, text, boolean),
  app.raise_alert(uuid, uuid, text, text, jsonb), app.resolve_alert(uuid, text), app.evaluate_site(uuid),
  app.php_security_eol(text) from public, anon, authenticated;
grant execute on function public.acknowledge_alert(uuid) to authenticated;
grant execute on function public.sweep_alerts(), public.claim_alert_notifications(int),
  public.complete_alert_notification(uuid, text, boolean),
  public.record_site_checks(uuid, boolean, timestamptz, text, text, timestamptz, text, boolean) to service_role;
grant execute on all functions in schema app to service_role;

-- ── 6. Planning: pg_cron als die er is (Supabase), anders via de onderhouds-cron ──
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('verploy-sweep-alerts', '*/5 * * * *', 'select public.sweep_alerts()');
  end if;
end $$;
