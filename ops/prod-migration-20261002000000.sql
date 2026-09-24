-- Verploy — productiemigratie 20261002000000 (partial_updates). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261002000000') then raise exception 'migratie 20261002000000 is al toegepast'; end if; end $$;
-- Gedeeltelijk geslaagde veilige updates ("fail isolated where possible").
--
-- De worker zet onderdelen die op de testkopie niet konden worden bijgewerkt (zonder de kopie te raken)
-- apart, en zet de overige geteste onderdelen wél live: verdict `deployed` met reason `run.reason.partial`.
-- De melding noemt dan alleen de onderdelen die aandacht vragen (`reason_params.attention`), niet de hele
-- lijst. Ook bij een tegengehouden run noemt de melding voortaan de betrokken onderdelen als de worker die
-- kan aanwijzen. Alleen de functie verandert; geen tabellen, geen rechten.

create or replace function public.record_run_outcome(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.update_runs%rowtype;
  v_params jsonb;
  v_summary text;
  v_items jsonb;
begin
  select * into v_run from public.update_runs where id = p_run;
  if v_run.id is null or v_run.status <> 'done' then
    raise exception 'run_not_done' using errcode = 'P0001';
  end if;
  select d.summary into v_summary from public.diagnoses d where d.run_id = p_run;
  v_items := case when jsonb_typeof(v_run.reason_params -> 'attention') = 'array' and jsonb_array_length(v_run.reason_params -> 'attention') > 0
                  then v_run.reason_params -> 'attention'
                  else (select coalesce(jsonb_agg(i->>'name'), '[]'::jsonb) from jsonb_array_elements(v_run.items) i) end;
  v_params := jsonb_build_object(
    'run_id', v_run.id, 'reason_key', v_run.reason_key, 'reason_params', v_run.reason_params, 'items', v_items,
    'total', jsonb_array_length(v_run.items))
    || case when v_summary is not null then jsonb_build_object('diagnosis', v_summary) else '{}'::jsonb end;
  if v_run.verdict = 'deployed' then
    perform app.resolve_alert(v_run.site_id, t)
       from unnest(array['update_blocked','update_rolled_back','update_failed']) t;
    if v_run.reason_key = 'run.reason.partial' then
      -- De rest staat live; alleen de onderdelen die niet konden worden bijgewerkt vragen aandacht.
      perform app.raise_alert(v_run.site_id, v_run.agency_id, 'update_blocked', 'warning',
        v_params || jsonb_build_object('partial', true, 'deployed', coalesce(v_run.reason_params -> 'deployed', '0'::jsonb)));
    end if;
  elsif v_run.verdict = 'blocked' then
    perform app.raise_alert(v_run.site_id, v_run.agency_id, 'update_blocked', 'warning', v_params);
  elsif v_run.verdict = 'rolled_back' then
    perform app.raise_alert(v_run.site_id, v_run.agency_id, 'update_rolled_back', 'critical', v_params);
  elsif v_run.verdict = 'error' then
    perform app.raise_alert(v_run.site_id, v_run.agency_id, 'update_failed',
      case when v_run.reason_key = 'run.reason.rollback_failed' then 'critical' else 'warning' end, v_params);
  end if;
end $$;
revoke all on function public.record_run_outcome(uuid) from public, anon, authenticated;
grant execute on function public.record_run_outcome(uuid) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261002000000', 'partial_updates');
notify pgrst, 'reload schema';
commit;
