-- Verploy — productiemigratie 20261001000000 (vuln_check_consistency). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261001000000') then raise exception 'migratie 20261001000000 is al toegepast'; end if; end $$;
-- Lekcontrole zonder tijdsrace.
--
-- Probleem: `last_heartbeat_at = now()` is het begin van de heartbeat-transactie. Las de worker de onderdelen
-- vlak vóór die transactie committe, dan was `vulns_checked_at` (later) nieuwer dan de heartbeat, en werd de site
-- pas bij de volgende heartbeat opnieuw beoordeeld (met een verkeerd "geen lekken" tot die tijd).
--
-- Oplossing: een teller in plaats van tijdstippen.
--  • `sites.heartbeat_seq` loopt op bij elke nieuwe heartbeat (trigger, dus ook voor elke toekomstige schrijver).
--  • De worker leest eerst teller en feed-tijdstip, dan pas onderdelen en lekken, en geeft teller en tijdstip mee.
--  • `sync_site_vulnerabilities` controleert onder rijvergrendeling of die nog actueel zijn; zo niet: niets
--    vastleggen, de site blijft aan de beurt.
--  • Aan de beurt = teller of feed-tijdstip verschilt van wat laatst beoordeeld is.

alter table public.sites
  add column heartbeat_seq bigint not null default 0,
  add column vulns_checked_seq bigint,
  add column vulns_checked_feed_at timestamptz;

create or replace function app.bump_heartbeat_seq()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.last_heartbeat_at is distinct from old.last_heartbeat_at then
    new.heartbeat_seq := old.heartbeat_seq + 1;
  end if;
  return new;
end $$;

create trigger sites_heartbeat_seq before update of last_heartbeat_at on public.sites
  for each row execute function app.bump_heartbeat_seq();

-- Wat al beoordeeld was, geldt als beoordeeld tegen de huidige stand (geen golf van herbeoordelingen bij de uitrol).
update public.sites s
   set vulns_checked_seq = s.heartbeat_seq,
       vulns_checked_feed_at = (select f.fetched_at from public.vulnerability_feed_state f where f.id = 1)
 where s.vulns_checked_at is not null
   and s.vulns_checked_at >= coalesce(s.last_heartbeat_at, '-infinity')
   and s.vulns_checked_at >= coalesce((select f.fetched_at from public.vulnerability_feed_state f where f.id = 1), '-infinity');

create or replace function public.sites_due_for_vulnerability_check(p_limit int default 50)
returns table (site_id uuid) language sql stable security definer set search_path = '' as $$
  select s.id
    from public.sites s
    cross join public.vulnerability_feed_state f
   where s.connection_status = 'connected'
     and f.fetched_at is not null
     and (s.vulns_checked_seq is distinct from s.heartbeat_seq
          or s.vulns_checked_feed_at is distinct from f.fetched_at)
   order by s.vulns_checked_at nulls first
   limit greatest(1, least(p_limit, 500));
$$;

drop function public.sync_site_vulnerabilities(uuid, jsonb);

create function public.sync_site_vulnerabilities(p_site uuid, p_findings jsonb,
                                                 p_heartbeat_seq bigint default null, p_feed_at timestamptz default null)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_site     public.sites%rowtype;
  v_autofix  boolean;
  v_open     int;
  v_max      text;
  v_fixable  int;
  v_items    jsonb;
  v_feed     timestamptz;
begin
  select * into v_site from public.sites where id = p_site for update;
  if v_site.id is null then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_findings) <> 'array' then
    raise exception 'invalid_findings' using errcode = '22023';
  end if;
  -- Verouderde lezing: er kwam een heartbeat (of feed) binnen nadat de worker de onderdelen las.
  -- Niets vastleggen (dus ook geen onterecht "opgelost"); de site blijft aan de beurt.
  select f.fetched_at into v_feed from public.vulnerability_feed_state f where f.id = 1;
  if (p_heartbeat_seq is not null and p_heartbeat_seq <> v_site.heartbeat_seq)
     or (p_feed_at is not null and p_feed_at is distinct from v_feed) then
    return null;
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

  update public.sites
     set vulns_checked_at = now(),
         vulns_checked_seq = coalesce(p_heartbeat_seq, v_site.heartbeat_seq),
         vulns_checked_feed_at = coalesce(p_feed_at, v_feed)
   where id = p_site;
  return v_open;
end $$;

revoke all on function public.sync_site_vulnerabilities(uuid, jsonb, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_site_vulnerabilities(uuid, jsonb, bigint, timestamptz) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261001000000', 'vuln_check_consistency');
notify pgrst, 'reload schema';
commit;
