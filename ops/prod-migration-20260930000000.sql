-- Verploy — productiemigratie 20260930000000 (vulnerabilities). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20260930000000') then raise exception 'migratie 20260930000000 is al toegepast'; end if; end $$;
-- ============================================================================
-- Verploy — bekende kwetsbaarheden (Wordfence Intelligence) en veilig oplossen
--  • vulnerabilities: de feed, compact (één rij per kwetsbaarheid × getroffen software)
--  • vulnerability_feed_state: wanneer opgehaald + de verplichte bronvermelding (Defiant/MITRE)
--  • site_vulnerabilities: welke site door welke kwetsbaarheid geraakt wordt (open/opgelost)
--  • agencies.security_autofix: ernstige/kritieke lekken automatisch veilig oplossen (standaard uit)
--  • update_runs.trigger: 'manual' of 'security' (automatisch gestart door Verploy)
--  • RPC's voor de worker: sites_due_for_vulnerability_check, sync_site_vulnerabilities, start_security_fix
--  • melding 'vulnerability' (één per site, bijgewerkt bij elke evaluatie)
-- ============================================================================

set check_function_bodies = off;

-- ── 1. Feed ──────────────────────────────────────────────────────────────────
create table public.vulnerabilities (
  id                text not null,                 -- Wordfence-UUID
  software_type     text not null check (software_type in ('core','plugin','theme')),
  slug              text not null check (char_length(slug) between 1 and 200),
  name              text not null,
  title             text not null,
  affected          jsonb not null check (jsonb_typeof(affected) = 'array'),   -- [{from, fromInclusive, to, toInclusive}]
  patched_versions  text[] not null default '{}',
  severity          text not null check (severity in ('low','medium','high','critical')),
  cvss_score        numeric(3,1),
  cve               text,
  reference_url     text,
  mitre             boolean not null default false,  -- record bevat MITRE-materiaal (bronvermelding verplicht)
  published_at      timestamptz,
  source_updated_at timestamptz,
  fetched_at        timestamptz not null default now(),
  primary key (id, software_type, slug)
);
create index vulnerabilities_software_idx on public.vulnerabilities(software_type, slug);

create table public.vulnerability_feed_state (
  id                  int primary key default 1 check (id = 1),
  fetched_at          timestamptz,
  source_updated_max  timestamptz,
  record_count        int not null default 0,
  last_error          text,
  last_error_at       timestamptz,
  -- de copyright-/licentieteksten zoals de feed ze meelevert (weergegeven bij elke kwetsbaarheid)
  attribution         jsonb not null default '{}'::jsonb
);
insert into public.vulnerability_feed_state (id) values (1);

alter table public.vulnerabilities enable row level security;
alter table public.vulnerability_feed_state enable row level security;
revoke all on public.vulnerabilities, public.vulnerability_feed_state from anon, authenticated, public;
grant all on public.vulnerabilities, public.vulnerability_feed_state to service_role;
-- Openbare gegevens: elke ingelogde gebruiker mag lezen.
grant select on public.vulnerabilities, public.vulnerability_feed_state to authenticated;
create policy vulnerabilities_read on public.vulnerabilities for select to authenticated using (true);
create policy vulnerability_feed_state_read on public.vulnerability_feed_state for select to authenticated using (true);

-- ── 2. Per site ──────────────────────────────────────────────────────────────
alter table public.sites add column vulns_checked_at timestamptz;

create table public.site_vulnerabilities (
  site_id               uuid not null references public.sites(id) on delete cascade,
  agency_id             uuid not null references public.agencies(id) on delete cascade,
  vulnerability_id      text not null,
  component_type        text not null check (component_type in ('core','plugin','theme')),
  component_slug        text not null,             -- zoals in site_components (bijv. akismet/akismet.php)
  component_name        text not null,
  installed_version     text not null,
  fixed_version         text,
  severity              text not null check (severity in ('low','medium','high','critical')),
  fixable               boolean not null default false,
  status                text not null default 'open' check (status in ('open','resolved')),
  first_seen_at         timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  resolved_at           timestamptz,
  autofix_run_id        uuid references public.update_runs(id) on delete set null,
  autofix_target        text,                      -- versie waarmee automatisch is geprobeerd
  autofix_at            timestamptz,
  primary key (site_id, vulnerability_id, component_type, component_slug)
);
create index site_vulnerabilities_open_idx on public.site_vulnerabilities(agency_id, status);
create trigger site_vulnerabilities_agency before insert or update on public.site_vulnerabilities
  for each row execute function app.check_site_agency();

alter table public.site_vulnerabilities enable row level security;
revoke all on public.site_vulnerabilities from anon, authenticated, public;
grant all on public.site_vulnerabilities to service_role;
grant select on public.site_vulnerabilities to authenticated;
create policy site_vulnerabilities_read on public.site_vulnerabilities for select to authenticated
  using ((select app.is_member(agency_id)));

-- ── 3. Instelling per bureau + herkomst van een run ──────────────────────────
alter table public.agencies add column security_autofix boolean not null default false;
grant update (security_autofix) on public.agencies to authenticated;   -- policy agencies_update: eigenaar/beheerder

alter table public.update_runs add column trigger text not null default 'manual' check (trigger in ('manual','security'));

-- ── 4. Melding ───────────────────────────────────────────────────────────────
alter table public.alerts drop constraint alerts_type_check;
alter table public.alerts add constraint alerts_type_check check (type in ('site_offline','ssl_expiring','ssl_invalid',
  'ssl_missing','domain_expiring','php_eol','memory_low','disk_low','core_update','plugin_updates',
  'update_blocked','update_rolled_back','update_failed','vulnerability'));

-- ── 5. Run aanmaken (gedeeld door create_update_run en start_security_fix) ──
-- Controleert de site en bepaalt de doelversies uit de laatste heartbeat; rechten controleert de aanroeper.
create or replace function app.insert_update_run(p_site uuid, p_items jsonb, p_created_by uuid, p_trigger text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_site   public.sites%rowtype;
  v_items  jsonb := '[]'::jsonb;
  v_item   jsonb;
  v_comp   public.site_components%rowtype;
  v_id     uuid;
begin
  select * into v_site from public.sites where id = p_site;
  if v_site.id is null then
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
    insert into public.update_runs (agency_id, site_id, created_by, items, trigger)
    values (v_site.agency_id, p_site, p_created_by, v_items, p_trigger)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'run_active' using errcode = 'P0001';
  end;
  insert into public.update_run_events (agency_id, run_id, step, message_key, params)
  values (v_site.agency_id, v_id, 'queued',
          case when p_trigger = 'security' then 'run.queued_security' else 'run.queued' end,
          jsonb_build_object('count', jsonb_array_length(v_items)));
  return v_id;
end $$;
revoke all on function app.insert_update_run(uuid, jsonb, uuid, text) from public, anon, authenticated;

create or replace function public.create_update_run(p_site uuid, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid;
begin
  select agency_id into v_agency from public.sites where id = p_site;
  if v_agency is null or not app.is_member(v_agency) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return app.insert_update_run(p_site, p_items, (select auth.uid()), 'manual');
end $$;

-- ── 6. Worker-RPC's (alleen service_role) ────────────────────────────────────

-- Gekoppelde sites die (opnieuw) beoordeeld moeten worden: nooit gedaan, nieuwe heartbeat of nieuwe feed.
create or replace function public.sites_due_for_vulnerability_check(p_limit int default 50)
returns table (site_id uuid) language sql stable security definer set search_path = '' as $$
  select s.id
    from public.sites s
    cross join public.vulnerability_feed_state f
   where s.connection_status = 'connected'
     and f.fetched_at is not null
     and (s.vulns_checked_at is null
          or s.vulns_checked_at < s.last_heartbeat_at
          or s.vulns_checked_at < f.fetched_at)
   order by s.vulns_checked_at nulls first
   limit greatest(1, least(p_limit, 500));
$$;

-- Legt de bevindingen van één site vast (volledige lijst): nieuw → open, weg → opgelost, en werkt de melding bij.
-- p_findings: [{vulnerability_id, type, slug, name, installed_version, fixed_version, severity, fixable}]
create or replace function public.sync_site_vulnerabilities(p_site uuid, p_findings jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_site     public.sites%rowtype;
  v_autofix  boolean;
  v_open     int;
  v_max      text;
  v_fixable  int;
  v_items    jsonb;
begin
  select * into v_site from public.sites where id = p_site for update;
  if v_site.id is null then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_findings) <> 'array' then
    raise exception 'invalid_findings' using errcode = '22023';
  end if;
  select a.security_autofix into v_autofix from public.agencies a where a.id = v_site.agency_id;

  with f as (
    select x->>'vulnerability_id' as vid, x->>'type' as ctype, x->>'slug' as cslug, x->>'name' as cname,
           x->>'installed_version' as installed, nullif(x->>'fixed_version', '') as fixed,
           x->>'severity' as severity, coalesce((x->>'fixable')::boolean, false) as fixable
      from jsonb_array_elements(p_findings) x
  )
  insert into public.site_vulnerabilities as sv (site_id, agency_id, vulnerability_id, component_type, component_slug,
                                                 component_name, installed_version, fixed_version, severity, fixable)
  select p_site, v_site.agency_id, vid, ctype, cslug, cname, installed, fixed, severity, fixable from f
  on conflict (site_id, vulnerability_id, component_type, component_slug) do update
     set component_name = excluded.component_name, installed_version = excluded.installed_version,
         fixed_version = excluded.fixed_version, severity = excluded.severity, fixable = excluded.fixable,
         status = 'open', resolved_at = null, updated_at = now(),
         -- opnieuw open (bijv. terug naar een oude versie): automatisch oplossen mag dan opnieuw
         autofix_run_id = case when sv.status = 'resolved' then null else sv.autofix_run_id end,
         autofix_target = case when sv.status = 'resolved' then null else sv.autofix_target end,
         autofix_at = case when sv.status = 'resolved' then null else sv.autofix_at end;

  update public.site_vulnerabilities sv
     set status = 'resolved', resolved_at = now(), updated_at = now()
   where sv.site_id = p_site and sv.status = 'open'
     and not exists (
       select 1 from jsonb_array_elements(p_findings) x
        where x->>'vulnerability_id' = sv.vulnerability_id and x->>'type' = sv.component_type and x->>'slug' = sv.component_slug);

  select count(*),
         (array['low','medium','high','critical'])[max(case severity when 'low' then 1 when 'medium' then 2 when 'high' then 3 else 4 end)],
         count(*) filter (where fixable),
         coalesce(jsonb_agg(distinct component_name), '[]'::jsonb)
    into v_open, v_max, v_fixable, v_items
    from public.site_vulnerabilities where site_id = p_site and status = 'open';

  if v_open = 0 then
    perform app.resolve_alert(p_site, 'vulnerability');
  else
    perform app.raise_alert(p_site, v_site.agency_id, 'vulnerability',
      case v_max when 'critical' then 'critical' when 'high' then 'critical' when 'medium' then 'warning' else 'info' end,
      jsonb_build_object('count', v_open, 'max_severity', v_max, 'fixable', v_fixable, 'items', v_items,
                         'autofix', v_autofix and v_max in ('high','critical')));
  end if;

  update public.sites set vulns_checked_at = now() where id = p_site;
  return v_open;
end $$;

-- Start automatisch een veilige update voor ernstige/kritieke lekken — alleen als het bureau dat heeft aangezet.
-- Per onderdeel hooguit één poging per doelversie (een tegengehouden update wordt niet eindeloos herhaald).
-- Geeft de run-id terug, of null als er niets te doen is of er al een run loopt (dan de volgende ronde opnieuw).
create or replace function public.start_security_fix(p_site uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_site  public.sites%rowtype;
  v_items jsonb;
  v_id    uuid;
begin
  select * into v_site from public.sites where id = p_site;
  if v_site.id is null then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.agencies a where a.id = v_site.agency_id and a.security_autofix) then
    return null;
  end if;
  if exists (select 1 from public.update_runs r where r.site_id = p_site and r.status <> 'done') then
    return null;
  end if;

  -- Alleen onderdelen met een open ernstig/kritiek lek, een klaarstaande veilige update en nog geen poging voor die versie.
  select coalesce(jsonb_agg(distinct jsonb_build_object('type', c.type, 'slug', c.slug)), '[]'::jsonb) into v_items
    from jsonb_array_elements(p_items) i
    join public.site_components c on c.site_id = p_site and c.type = i->>'type' and c.slug = i->>'slug'
   where c.update_available and c.latest_version is not null
     and exists (select 1 from public.site_vulnerabilities sv
                  where sv.site_id = p_site and sv.component_type = c.type and sv.component_slug = c.slug
                    and sv.status = 'open' and sv.severity in ('high','critical') and sv.fixable
                    and sv.autofix_target is distinct from c.latest_version);
  if jsonb_array_length(v_items) = 0 then
    return null;
  end if;

  begin
    v_id := app.insert_update_run(p_site, v_items, null, 'security');
  exception when others then
    if sqlerrm in ('run_active', 'read_only', 'not_connected', 'connector_outdated', 'no_update_available') then
      return null;
    end if;
    raise;
  end;

  update public.site_vulnerabilities sv
     set autofix_run_id = v_id, autofix_target = c.latest_version, autofix_at = now(), updated_at = now()
    from public.site_components c
   where sv.site_id = p_site and sv.status = 'open' and sv.severity in ('high','critical')
     and c.site_id = sv.site_id and c.type = sv.component_type and c.slug = sv.component_slug
     and v_items @> jsonb_build_array(jsonb_build_object('type', c.type, 'slug', c.slug));
  return v_id;
end $$;

-- Sites waar Verploy nu automatisch een veilige update mag starten (ook na het aanzetten van de instelling,
-- of als er eerder nog een run liep): bureau heeft het aan, open ernstig/kritiek lek met klaarstaande
-- veilige update, nog niet geprobeerd voor die versie, en geen lopende run.
create or replace function public.pending_security_fixes(p_limit int default 20)
returns table (site_id uuid, items jsonb) language sql stable security definer set search_path = '' as $$
  select sv.site_id, jsonb_agg(distinct jsonb_build_object('type', c.type, 'slug', c.slug))
    from public.site_vulnerabilities sv
    join public.agencies a on a.id = sv.agency_id and a.security_autofix
    join public.sites s on s.id = sv.site_id and s.connection_status = 'connected'
    join public.site_components c on c.site_id = sv.site_id and c.type = sv.component_type and c.slug = sv.component_slug
   where sv.status = 'open' and sv.severity in ('high','critical') and sv.fixable
     and c.update_available and c.latest_version is not null
     and sv.autofix_target is distinct from c.latest_version
     and not exists (select 1 from public.update_runs r where r.site_id = sv.site_id and r.status <> 'done')
   group by sv.site_id
   limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.pending_security_fixes(int) from public, anon, authenticated;
grant execute on function public.pending_security_fixes(int) to service_role;
revoke all on function public.sites_due_for_vulnerability_check(int) from public, anon, authenticated;
revoke all on function public.sync_site_vulnerabilities(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.start_security_fix(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sites_due_for_vulnerability_check(int) to service_role;
grant execute on function public.sync_site_vulnerabilities(uuid, jsonb) to service_role;
grant execute on function public.start_security_fix(uuid, jsonb) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20260930000000', 'vulnerabilities');
notify pgrst, 'reload schema';
commit;
