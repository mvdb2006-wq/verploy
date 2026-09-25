-- Verploy — productiemigratie 20261007000000 (update_intel). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000000') then raise exception 'migratie 20261007000000 is al toegepast'; end if; end $$;
-- Verploy leert van alle sites: per onderdeel en versie hoeveel sites de update zonder problemen live
-- kregen en op hoeveel sites deze versie zelf iets brak. Over alle bureaus heen, alleen als getallen:
-- nooit welke sites of welke bureaus. Een bureau ziet alleen cijfers van onderdelen die het zelf heeft.
--
-- Gebruik: een label bij elke update ("Elders zonder problemen op 212 sites" / "Gaf elders problemen"),
-- en de automatische updates houden een versie die elders vaak misging tegen (één vraag in de inbox).
--
-- Achterwaarts compatibel: één nieuwe tabel en één worker-RPC.

create table public.update_intel (
  type          text not null,
  slug          text not null,
  version       text not null,
  ok_sites      integer not null default 0,
  failed_sites  integer not null default 0,
  refreshed_at  timestamptz not null default now(),
  primary key (type, slug, version)
);
alter table public.update_intel enable row level security;
-- Alleen onderdelen die het bureau zelf op een site heeft (dan kent het de naam al).
create policy update_intel_read on public.update_intel for select to authenticated
  using (exists (select 1 from public.site_components c
                  where c.type = update_intel.type and c.slug = update_intel.slug and (select app.is_member(c.agency_id))));
grant select on public.update_intel to authenticated;

-- Herberekent alles uit de afgeronde runs van het afgelopen half jaar (per site telt één uitkomst):
--   goed    = live gezet (of al actueel) in een run die live ging;
--   mislukt = de update zelf mislukte of liet de testkopie crashen, of het was het enige onderdeel van een run die
--             werd tegengehouden of teruggedraaid (dan ligt het aan deze versie, niet aan een andere).
-- Een licentie- of pakketprobleem zegt niets over de versie en telt niet mee.
create or replace function public.refresh_update_intel()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n   integer;
  v_now timestamptz := clock_timestamp();
begin
  with items as (
    select r.site_id, r.verdict, jsonb_array_length(r.items) as n, i
      from public.update_runs r, jsonb_array_elements(r.items) i
     where r.status = 'done' and r.finished_at > now() - interval '180 days'
       and i ->> 'to_version' is not null and i ->> 'type' is not null and i ->> 'slug' is not null
  ), per_site as (
    select i ->> 'type' as type, i ->> 'slug' as slug, i ->> 'to_version' as version, site_id,
           bool_or(verdict = 'deployed' and coalesce(i ->> 'production', '') in ('updated', 'already_current')) as ok,
           bool_or(coalesce(i ->> 'staging', '') in ('update_failed', 'crashed')
                   or (n = 1 and verdict in ('blocked', 'rolled_back') and coalesce(i ->> 'staging', '') in ('updated', 'already_current'))) as failed
      from items
     group by 1, 2, 3, 4
  ), agg as (
    select type, slug, version,
           count(*) filter (where ok)::int as ok_sites,
           count(*) filter (where failed and not ok)::int as failed_sites
      from per_site
     group by 1, 2, 3
  ), up as (
    insert into public.update_intel as u (type, slug, version, ok_sites, failed_sites, refreshed_at)
    select type, slug, version, ok_sites, failed_sites, v_now from agg
    on conflict (type, slug, version) do update
      set ok_sites = excluded.ok_sites, failed_sites = excluded.failed_sites, refreshed_at = excluded.refreshed_at
    returning 1
  )
  select count(*) into v_n from up;
  -- Wat niet meer voorkomt (ouder dan een half jaar), verdwijnt.
  delete from public.update_intel where refreshed_at < v_now;
  return v_n;
end $$;

revoke all on function public.refresh_update_intel() from public, anon, authenticated;
grant execute on function public.refresh_update_intel() to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261007000000', 'update_intel');
notify pgrst, 'reload schema';
commit;
