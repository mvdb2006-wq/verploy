-- Verploy — productiemigratie 20261008000000 (connector_rollout). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261008000000') then raise exception 'migratie 20261008000000 is al toegepast'; end if; end $$;
-- Een nieuwe Verploy Connector binnen een minuut uitrollen op alle gekoppelde sites (vanaf connector 2.5.3,
-- die meteen naar een nieuwe versie kan kijken). Per site een gewone veilige update van alleen de connector
-- (trigger 'connector'): eerst op een testkopie, dan live. Onafhankelijk van het updatemoment van het
-- bureau: de connector is de verbinding met Verploy zelf.
--
-- Achterwaarts compatibel: één extra triggerwaarde en één worker-RPC.

alter table public.update_runs drop constraint if exists update_runs_trigger_check;
alter table public.update_runs add constraint update_runs_trigger_check check (trigger in ('manual', 'security', 'scheduled', 'connector'));

-- Versie als drie getallen ("2.5" = 2.5.0); onleesbaar = null.
create or replace function app.version_triple(p text) returns int[]
language sql immutable set search_path = '' as $$
  select case when coalesce(p, '') ~ '^[0-9]+(\.[0-9]+){0,2}'
    then (string_to_array(substring(p from '^[0-9]+(?:\.[0-9]+){0,2}'), '.')::int[] || array[0,0,0])[1:3] end;
$$;

-- Start per site die achterloopt (en 2.5.3 of nieuwer heeft) een veilige update naar p_version. Niet als er
-- al iets loopt, niet vaker dan eens per 6 uur en hooguit 3 keer per versie per site (bij een probleem
-- volgt een melding; handmatig kan altijd). Geeft het aantal gestarte runs terug.
create or replace function public.start_connector_updates(p_version text, p_limit int default 20)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_target int[] := app.version_triple(p_version);
  v_site   record;
  v_id     uuid;
  v_n      int := 0;
  v_slug   constant text := 'verploy-connector/verploy-connector.php';
begin
  if v_target is null then
    raise exception 'invalid_version' using errcode = '22023';
  end if;
  for v_site in
    select s.id, s.agency_id, s.connector_version
      from public.sites s
     where s.connection_status = 'connected'
       and app.version_triple(s.connector_version) >= array[2,5,3]
       and app.version_triple(s.connector_version) < v_target
       and app.agency_is_writable(s.agency_id)
       and not exists (select 1 from public.update_runs r where r.site_id = s.id and r.status <> 'done')
       and (select count(*) from public.update_runs r
             where r.site_id = s.id and r.trigger = 'connector' and r.items -> 0 ->> 'to_version' = p_version) < 3
       and not exists (select 1 from public.update_runs r
             where r.site_id = s.id and r.trigger = 'connector' and r.items -> 0 ->> 'to_version' = p_version
               and r.created_at > now() - interval '6 hours')
     order by s.id
     limit greatest(1, least(p_limit, 200))
  loop
    begin
      insert into public.update_runs (agency_id, site_id, created_by, items, trigger)
      values (v_site.agency_id, v_site.id, null, jsonb_build_array(jsonb_build_object(
        'type', 'plugin', 'slug', v_slug, 'name', 'Verploy Connector',
        'from_version', v_site.connector_version, 'to_version', p_version)), 'connector')
      returning id into v_id;
    exception when unique_violation then
      continue;   -- net gestart door iets anders
    end;
    insert into public.update_run_events (agency_id, run_id, step, message_key, params)
    values (v_site.agency_id, v_id, 'queued', 'run.queued_connector', jsonb_build_object('count', 1, 'version', p_version));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.start_connector_updates(text, int) from public, anon, authenticated;
grant execute on function public.start_connector_updates(text, int) to service_role;
revoke all on function app.version_triple(text) from public, anon;

insert into supabase_migrations.schema_migrations (version, name) values ('20261008000000', 'connector_rollout');
notify pgrst, 'reload schema';
commit;
