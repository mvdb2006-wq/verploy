-- ============================================================================
-- Verploy — fase 4: veilige updates (kernflow)
--  • testinstellingen per site (extra pagina's, pixel-drempel, te maskeren zones)
--  • update_runs: state machine, één actieve run per site, lease voor de worker
--  • update_run_events: tijdlijn (alleen toevoegen)
--  • test_results: per fase/pagina/viewport de checks, screenshots en pixel-diff
--  • RPC's: create_update_run / cancel_update_run (leden), claim/lease/advance (worker)
--  • storage-bucket run-artifacts (privé; alleen de service role leest en schrijft)
-- ============================================================================

set check_function_bodies = off;

-- ── 1. Testinstellingen per site ──────────────────────────────────────────────
alter table public.sites
  add column test_paths     text[]       not null default '{}'
    check (cardinality(test_paths) <= 5),
  add column test_masks     text[]       not null default '{}'
    check (cardinality(test_masks) <= 10),
  add column diff_threshold numeric(5,4) not null default 0.02
    check (diff_threshold between 0.001 and 0.5);

grant update (test_paths, test_masks, diff_threshold) on public.sites to authenticated;

-- ── 2. Runs ──────────────────────────────────────────────────────────────────
create table public.update_runs (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  site_id          uuid not null references public.sites(id) on delete cascade,
  created_by       uuid references auth.users(id) on delete set null,
  status           text not null default 'queued' check (status in (
                     'queued','preparing','baseline','staging_create','staging_baseline','staging_update',
                     'staging_test','deploy_snapshot','deploy_apply','postcheck','rollback','cleanup','done')),
  -- [{type, slug, name, from_version, to_version, result?: {status, version}}]
  items            jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  verdict          text check (verdict in ('deployed','blocked','rolled_back','error','cancelled')),
  -- waarom (blocked/rolled_back/error): i18n-sleutel + parameters
  reason_key       text,
  reason_params    jsonb not null default '{}'::jsonb,
  attempt          int  not null default 0,
  max_attempts     int  not null default 3 check (max_attempts between 1 and 10),
  worker_id        text,
  lease_until      timestamptz,
  not_before       timestamptz not null default now(),
  step_started_at  timestamptz,
  step_state       jsonb not null default '{}'::jsonb,
  cancel_requested boolean not null default false,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now(),
  check ((status = 'done') = (verdict is not null and finished_at is not null))
);
create index update_runs_agency_idx on public.update_runs(agency_id, created_at desc);
create index update_runs_site_idx on public.update_runs(site_id, created_at desc);
create index update_runs_claim_idx on public.update_runs(not_before) where status <> 'done';
-- Eén actieve run per site
create unique index update_runs_one_active on public.update_runs(site_id) where status <> 'done';
create trigger update_runs_touch before update on public.update_runs
  for each row execute function app.touch_updated_at();
create trigger update_runs_agency before insert or update on public.update_runs
  for each row execute function app.check_site_agency();

create table public.update_run_events (
  id         bigint generated always as identity primary key,
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  run_id     uuid not null references public.update_runs(id) on delete cascade,
  step       text not null,
  level      text not null default 'info' check (level in ('info','warning','error')),
  message_key text not null check (message_key ~ '^[a-z0-9_.]+$'),
  params     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index update_run_events_run_idx on public.update_run_events(run_id, id);

create table public.test_results (
  id              bigint generated always as identity primary key,
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  run_id          uuid not null references public.update_runs(id) on delete cascade,
  phase           text not null check (phase in ('production_before','staging_before','staging_after','production_after')),
  page_key        text not null,
  page_label      text not null default '',
  page_url        text not null,
  viewport        text not null check (viewport in ('desktop','mobile')),
  http_status     int,
  load_ms         int,
  passed          boolean not null,
  -- [{check, ok, detail?}] — check ∈ http, php_error, js_errors, resources, landmarks, visual, login
  checks          jsonb not null default '[]'::jsonb,
  js_errors       jsonb not null default '[]'::jsonb,
  screenshot_path text,
  diff_path       text,
  diff_ratio      numeric(7,6),
  created_at      timestamptz not null default now(),
  unique (run_id, phase, page_key, viewport)
);
create index test_results_run_idx on public.test_results(run_id);

-- agency_id van events/resultaten moet gelijk zijn aan die van de run
create or replace function app.check_run_agency() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.update_runs r where r.id = new.run_id and r.agency_id = new.agency_id) then
    raise exception 'agency_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger update_run_events_agency before insert or update on public.update_run_events
  for each row execute function app.check_run_agency();
create trigger test_results_agency before insert or update on public.test_results
  for each row execute function app.check_run_agency();

-- Een site met een lopende run kan niet worden verwijderd (de staging moet eerst worden opgeruimd)
create or replace function app.protect_site_with_run() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.update_runs r where r.site_id = old.id and r.status <> 'done') then
    raise exception 'run_active' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger sites_protect_run before delete on public.sites
  for each row execute function app.protect_site_with_run();

-- ── 3. RLS: leden lezen, niemand schrijft direct (alleen RPC's en service role) ──
alter table public.update_runs       enable row level security;
alter table public.update_run_events enable row level security;
alter table public.test_results      enable row level security;

revoke all on public.update_runs, public.update_run_events, public.test_results from anon, authenticated, public;
grant all on public.update_runs, public.update_run_events, public.test_results to service_role;
grant select on public.update_runs, public.update_run_events, public.test_results to authenticated;

create policy update_runs_read on public.update_runs for select to authenticated
  using ((select app.is_member(agency_id)));
create policy update_run_events_read on public.update_run_events for select to authenticated
  using ((select app.is_member(agency_id)));
create policy test_results_read on public.test_results for select to authenticated
  using ((select app.is_member(agency_id)));

-- ── 4. RPC's voor het dashboard ──────────────────────────────────────────────

-- Start een run. De server bepaalt de doelversies (uit de laatste heartbeat), niet de browser.
-- p_items: [{type, slug}]
create or replace function public.create_update_run(p_site uuid, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site   public.sites%rowtype;
  v_items  jsonb := '[]'::jsonb;
  v_item   jsonb;
  v_comp   public.site_components%rowtype;
  v_id     uuid;
begin
  select * into v_site from public.sites where id = p_site;
  if v_site.id is null or not app.is_member(v_site.agency_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.agency_is_writable(v_site.agency_id) then
    raise exception 'read_only' using errcode = 'P0001';
  end if;
  if v_site.connection_status <> 'connected' then
    raise exception 'not_connected' using errcode = 'P0001';
  end if;
  if v_site.connector_version is null
     or string_to_array(regexp_replace(v_site.connector_version, '[^0-9.].*$', ''), '.')::int[] < array[2,1,0] then
    raise exception 'connector_outdated' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_comp from public.site_components c
     where c.site_id = p_site and c.type = v_item->>'type' and c.slug = v_item->>'slug';
    if v_comp.site_id is null or not v_comp.update_available or v_comp.latest_version is null then
      raise exception 'no_update_available' using errcode = 'P0001', detail = coalesce(v_item->>'slug', '');
    end if;
    if v_items @> jsonb_build_array(jsonb_build_object('type', v_comp.type, 'slug', v_comp.slug)) then
      continue;  -- dubbel opgegeven
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'type', v_comp.type, 'slug', v_comp.slug, 'name', v_comp.name,
      'from_version', v_comp.version, 'to_version', v_comp.latest_version));
  end loop;

  begin
    insert into public.update_runs (agency_id, site_id, created_by, items)
    values (v_site.agency_id, p_site, (select auth.uid()), v_items)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'run_active' using errcode = 'P0001';
  end;
  insert into public.update_run_events (agency_id, run_id, step, message_key, params)
  values (v_site.agency_id, v_id, 'queued', 'run.queued', jsonb_build_object('count', jsonb_array_length(v_items)));
  return v_id;
end $$;

-- Annuleren kan zolang er nog niets op productie is gebeurd.
create or replace function public.cancel_update_run(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.update_runs%rowtype;
begin
  select * into v_run from public.update_runs where id = p_run for update;
  if v_run.id is null or not app.is_member(v_run.agency_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_run.status not in ('queued','preparing','baseline','staging_create','staging_baseline','staging_update','staging_test') then
    raise exception 'not_cancellable' using errcode = 'P0001';
  end if;
  if v_run.status = 'queued' and v_run.worker_id is null then
    -- Nog door geen worker opgepakt: direct afsluiten, er is niets op te ruimen.
    update public.update_runs
       set status = 'done', verdict = 'cancelled', reason_key = 'run.reason.cancelled',
           finished_at = now(), cancel_requested = true
     where id = p_run;
  else
    update public.update_runs set cancel_requested = true where id = p_run;
  end if;
  insert into public.update_run_events (agency_id, run_id, step, message_key)
  values (v_run.agency_id, p_run, v_run.status, 'run.cancel_requested');
end $$;

-- ── 5. RPC's voor de worker (alleen service role) ────────────────────────────

-- Pakt de oudste wachtende run, of een run waarvan de lease verlopen is (worker gecrasht).
-- attempt telt de pogingen voor de huidige stap; advance zet hem terug op 0.
create or replace function public.claim_update_run(p_worker text, p_lease_seconds int default 120)
returns setof public.update_runs
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  select r.id into v_id from public.update_runs r
   where r.status <> 'done'
     and r.not_before <= now()
     and (r.lease_until is null or r.lease_until < now())
   order by r.not_before, r.created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
  update public.update_runs r
     set worker_id   = p_worker,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         attempt     = r.attempt + 1,
         started_at  = coalesce(r.started_at, now()),
         step_started_at = coalesce(r.step_started_at, now())
   where r.id = v_id
  returning r.*;
end $$;

-- Verlengt de lease; geeft cancel_requested terug (null = de worker is de run kwijt).
create or replace function public.renew_update_run(p_run uuid, p_worker text, p_lease_seconds int default 120)
returns boolean
language sql security definer set search_path = '' as $$
  update public.update_runs
     set lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_run and worker_id = p_worker and status <> 'done'
  returning cancel_requested;
$$;

-- Naar de volgende stap. step_state wordt samengevoegd; bij 'done' zijn verdict en finished_at verplicht.
create or replace function public.advance_update_run(
  p_run uuid, p_worker text, p_status text,
  p_step_state jsonb default '{}'::jsonb,
  p_verdict text default null, p_reason_key text default null, p_reason_params jsonb default '{}'::jsonb,
  p_items jsonb default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.update_runs
     set status          = p_status,
         step_state      = step_state || coalesce(p_step_state, '{}'::jsonb),
         attempt         = 0,
         step_started_at = now(),
         items           = coalesce(p_items, items),
         verdict         = coalesce(p_verdict, verdict),
         reason_key      = coalesce(p_reason_key, reason_key),
         reason_params   = case when p_reason_key is null then reason_params else coalesce(p_reason_params, '{}'::jsonb) end,
         finished_at     = case when p_status = 'done' then now() else null end,
         worker_id       = case when p_status = 'done' then null else worker_id end,
         lease_until     = case when p_status = 'done' then null else lease_until end
   where id = p_run and worker_id = p_worker and status <> 'done';
  if not found then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;
end $$;

-- Geeft een run terug aan de wachtrij (tijdelijke fout): opnieuw proberen na p_delay seconden.
create or replace function public.release_update_run(p_run uuid, p_worker text, p_delay_seconds int default 30)
returns void
language sql security definer set search_path = '' as $$
  update public.update_runs
     set worker_id = null, lease_until = null,
         not_before = now() + make_interval(secs => greatest(p_delay_seconds, 0))
   where id = p_run and worker_id = p_worker and status <> 'done';
$$;

revoke all on function public.create_update_run(uuid, jsonb), public.cancel_update_run(uuid),
  public.claim_update_run(text, int), public.renew_update_run(uuid, text, int),
  public.advance_update_run(uuid, text, text, jsonb, text, text, jsonb, jsonb),
  public.release_update_run(uuid, text, int),
  app.check_run_agency(), app.protect_site_with_run() from public, anon, authenticated;
grant execute on function public.create_update_run(uuid, jsonb), public.cancel_update_run(uuid) to authenticated;
grant execute on function public.create_update_run(uuid, jsonb), public.cancel_update_run(uuid),
  public.claim_update_run(text, int), public.renew_update_run(uuid, text, int),
  public.advance_update_run(uuid, text, text, jsonb, text, text, jsonb, jsonb),
  public.release_update_run(uuid, text, int) to service_role;

-- ── 6. Storage: screenshots en diffs (privé; het dashboard serveert ze na een RLS-controle) ──
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('run-artifacts', 'run-artifacts', false, 10485760, array['image/png'])
    on conflict (id) do nothing;
  end if;
end $$;
