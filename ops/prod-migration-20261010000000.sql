-- Verploy — productiemigratie 20261010000000 (ops_and_account_deletion). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261010000000') then raise exception 'migratie 20261010000000 is al toegepast'; end if; end $$;
-- 1. Alarm voor de beheerder van Verploy: merkt het als de worker stilvalt, runs blijven hangen, er geen
--    heartbeats meer binnenkomen of de worker/Stripe-webhook fouten geeft. Supabase (pg_cron + pg_net)
--    roept elke 5 minuten /api/cron/ops aan, onafhankelijk van de worker: ook een dode worker wordt gemeld.
-- 2. Bureau en account verwijderen (eigenaar), met opruimen van alle bestanden in Storage. Ook bij het
--    verwijderen van een site of run worden de screenshots nu opgeruimd.
--
-- Achterwaarts compatibel: alleen nieuwe tabellen, functies en triggers.

-- ── 1. Alarm ─────────────────────────────────────────────────────────────────
create table public.ops_config (
  id          boolean primary key default true check (id),
  alert_email text check (alert_email is null or alert_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  app_url     text not null default 'https://app.verploy.com',
  cron_token  text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.ops_config (id) values (true) on conflict do nothing;

create table public.ops_heartbeats (
  worker_id text primary key,
  seen_at   timestamptz not null default now()
);

create table public.ops_events (
  id         bigint generated always as identity primary key,
  source     text not null check (source in ('worker', 'stripe', 'app')),
  kind       text not null check (char_length(kind) between 1 and 80),
  detail     text check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index ops_events_created_idx on public.ops_events(created_at desc);

create table public.ops_alert_state (
  key           text primary key,
  detail        text,
  first_seen    timestamptz not null default now(),
  last_notified timestamptz,
  active        boolean not null default true
);

alter table public.ops_config enable row level security;
alter table public.ops_heartbeats enable row level security;
alter table public.ops_events enable row level security;
alter table public.ops_alert_state enable row level security;
revoke all on public.ops_config, public.ops_heartbeats, public.ops_events, public.ops_alert_state from anon, authenticated, public;
grant all on public.ops_config, public.ops_heartbeats, public.ops_events, public.ops_alert_state to service_role;

-- Wat er nu mis is (sleutel + uitleg). Leeg = alles in orde.
create or replace function public.ops_problems()
returns table (key text, detail text)
language sql stable security definer set search_path = '' as $$
  -- Worker: geen levensteken in 10 minuten.
  select 'worker_down', 'Laatste levensteken van de worker: '
         || coalesce(to_char((select max(seen_at) from public.ops_heartbeats) at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI'), 'nooit')
   where coalesce((select max(seen_at) from public.ops_heartbeats), '-infinity') < now() - interval '10 minutes'
  union all
  -- Runs die niet opschieten: te lang in de wachtrij, of een stap die al een uur niet verder komt.
  select 'runs_stuck', count(*) || ' update(s) komen niet verder; oudste sinds '
         || to_char(min(coalesce(r.step_started_at, r.not_before)) at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI')
    from public.update_runs r
   where r.status <> 'done'
     and ((r.status = 'queued' and r.not_before < now() - interval '30 minutes')
       or (r.status <> 'queued' and r.updated_at < now() - interval '60 minutes'))
  having count(*) > 0
  union all
  -- Heartbeats: er zijn gekoppelde sites, maar van geen enkele kwam er iets binnen in 45 minuten.
  select 'heartbeats_silent', 'Geen heartbeat van enige site sinds '
         || to_char(max(s.last_heartbeat_at) at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI')
    from public.sites s
   where s.connection_status = 'connected'
  having count(*) > 0 and coalesce(max(s.last_heartbeat_at), '-infinity') < now() - interval '45 minutes'
  union all
  -- Fouten van de worker, de Stripe-webhook of de app in de laatste 15 minuten.
  select 'error:' || e.source || ':' || e.kind,
         count(*) || '× in 15 min. Laatste: ' || coalesce((array_agg(e.detail order by e.id desc))[1], '-')
    from public.ops_events e
   where e.created_at > now() - interval '15 minutes'
   group by e.source, e.kind;
$$;
revoke all on function public.ops_problems() from anon, authenticated, public;
grant execute on function public.ops_problems() to service_role;

-- Oude levenstekens en fouten opruimen (30 dagen).
create or replace function public.ops_prune() returns void
language sql security definer set search_path = '' as $$
  delete from public.ops_events where created_at < now() - interval '30 days';
  delete from public.ops_heartbeats where seen_at < now() - interval '30 days';
  delete from public.ops_alert_state where not active and first_seen < now() - interval '30 days';
$$;
revoke all on function public.ops_prune() from anon, authenticated, public;
grant execute on function public.ops_prune() to service_role;

-- Elke 5 minuten vanuit Supabase zelf (alleen waar pg_cron en pg_net bestaan, dus niet in de lokale testomgeving).
do $outer$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule('verploy-ops-check', '*/5 * * * *', $job$
      select net.http_post(
        url := c.app_url || '/api/cron/ops',
        headers := jsonb_build_object('Authorization', 'Bearer ' || c.cron_token, 'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000)
        from public.ops_config c
       where c.alert_email is not null
    $job$);
  end if;
end $outer$;

-- ── 2. Bestanden opruimen ────────────────────────────────────────────────────
-- Map (of bestand) in Storage dat weg moet; de worker ruimt de wachtrij op.
create table public.storage_purges (
  id         bigint generated always as identity primary key,
  bucket     text not null check (bucket in ('run-artifacts', 'reports', 'branding')),
  prefix     text not null check (prefix ~ '^[0-9a-f-]{36}(/[^/]+)*$'),
  created_at timestamptz not null default now(),
  attempts   int not null default 0
);
alter table public.storage_purges enable row level security;
revoke all on public.storage_purges from anon, authenticated, public;
grant all on public.storage_purges to service_role;

create or replace function app.purge_run_files() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.storage_purges (bucket, prefix) values ('run-artifacts', old.agency_id || '/' || old.id);
  return old;
end $$;
create trigger update_runs_purge after delete on public.update_runs
  for each row execute function app.purge_run_files();

create or replace function app.purge_report_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.pdf_path is not null and old.pdf_path ~ '^[0-9a-f-]{36}(/[^/]+)*$' then
    insert into public.storage_purges (bucket, prefix) values ('reports', old.pdf_path);
  end if;
  return old;
end $$;
create trigger reports_purge after delete on public.reports
  for each row execute function app.purge_report_file();

create or replace function app.purge_agency_files() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.storage_purges (bucket, prefix)
  values ('run-artifacts', old.id::text), ('reports', old.id::text), ('branding', old.id::text);
  return old;
end $$;
create trigger agencies_purge after delete on public.agencies
  for each row execute function app.purge_agency_files();

-- ── 3. Bureau verwijderen (alleen de eigenaar) ───────────────────────────────
-- Controleert eigenaar, bevestiging (de naam van het bureau) en dat er geen update loopt, en verwijdert het
-- bureau met alles erop en eraan. Geeft de gebruikers terug die lid waren (hun account wordt daarna door de
-- app verwijderd) en het Stripe-abonnement (wordt vooraf door de app stopgezet).
create or replace function public.delete_agency(p_confirm text)
returns table (user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_agency public.agencies%rowtype;
  v_users  uuid[];
begin
  select a.* into v_agency
    from public.agencies a join public.agency_members m on m.agency_id = a.id
   where m.user_id = auth.uid() and m.role = 'owner'
   for update of a;
  if v_agency.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if btrim(coalesce(p_confirm, '')) <> v_agency.name then
    raise exception 'confirm_mismatch' using errcode = '22023';
  end if;
  if exists (select 1 from public.update_runs r where r.agency_id = v_agency.id and r.status <> 'done') then
    raise exception 'run_active' using errcode = 'P0001';
  end if;
  select array_agg(m.user_id) into v_users from public.agency_members m where m.agency_id = v_agency.id;
  delete from public.agencies where id = v_agency.id;
  return query select unnest(v_users);
end $$;
revoke all on function public.delete_agency(text) from anon, public;
grant execute on function public.delete_agency(text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261010000000', 'ops_and_account_deletion');
notify pgrst, 'reload schema';
commit;
