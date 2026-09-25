-- Geplande veilige updates ("Automatische veilige updates: Aan / Uit", moment, frequentie).
--
-- Het bureau zet het één keer aan en kiest een moment; Verploy beslist daarna zelf per update:
--   • gewone updates (patch/minor, WordPress-onderhoudsreleases) → getest op een kopie en live gezet;
--   • grote versiesprongen en WordPress-hoofdversies → één vraag in de inbox (update_approval);
--   • wat al eens is tegengehouden → niet eindeloos opnieuw (de melding van die update staat in de inbox).
-- Die beslissing gebeurt in de worker (src/lib/auto-updates/policy.ts, puur en getest); de database
-- bewaakt alleen de randvoorwaarden en legt de run vast met trigger 'scheduled'.
--
-- Achterwaarts compatibel: alleen nieuwe kolommen met een standaardwaarde (standaard UIT), een extra
-- toegestane triggerwaarde en een extra meldingstype. Betaalstatus en planlimieten blijven ongemoeid.

-- ── 1. Instellingen ──────────────────────────────────────────────────────────
alter table public.agencies
  add column auto_updates boolean not null default false,
  add column auto_update_window text not null default 'night' check (auto_update_window in ('night', 'morning', 'evening')),
  add column auto_update_frequency text not null default 'daily' check (auto_update_frequency in ('daily', 'weekly')),
  add column timezone text not null default 'Europe/Amsterdam' check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$' and length(timezone) <= 64);
-- Wijzigen via de gewone policy agencies_update (eigenaar/beheerder).
grant update (auto_updates, auto_update_window, auto_update_frequency, timezone) on public.agencies to authenticated;

-- Uitzondering per site ("Nooit automatisch"): standaard doet een site mee als het bureau het aanzet.
alter table public.sites add column auto_updates boolean not null default true;
grant update (auto_updates) on public.sites to authenticated;

-- ── 2. Run-trigger en meldingstype ───────────────────────────────────────────
alter table public.update_runs drop constraint if exists update_runs_trigger_check;
alter table public.update_runs add constraint update_runs_trigger_check check (trigger in ('manual', 'security', 'scheduled'));

alter table public.alerts drop constraint if exists alerts_type_check;
alter table public.alerts add constraint alerts_type_check check (type in (
  'site_offline','ssl_expiring','ssl_invalid','ssl_missing','domain_expiring','php_eol','memory_low','disk_low',
  'core_update','plugin_updates','update_blocked','update_rolled_back','update_failed','vulnerability','update_approval'));

-- Tekst in de tijdlijn van de run ("Automatisch gestart (nacht)").
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
          case p_trigger when 'security' then 'run.queued_security' when 'scheduled' then 'run.queued_scheduled' else 'run.queued' end,
          jsonb_build_object('count', jsonb_array_length(v_items)));
  return v_id;
end $$;
revoke all on function app.insert_update_run(uuid, jsonb, uuid, text) from public, anon, authenticated;

-- ── 3. Worker-RPC's (alleen service_role) ────────────────────────────────────

-- Sites die meedoen: bureau heeft het aan en kan schrijven, site doet mee en is gekoppeld. `busy`: er loopt
-- al een run (dan nu niets starten). Het moment (tijdvenster in de tijdzone van het bureau) en de keuze van
-- de onderdelen bepaalt de worker.
create or replace function public.scheduled_update_candidates(p_limit int default 500)
returns table (site_id uuid, agency_id uuid, timezone text, update_window text, frequency text, last_scheduled_at timestamptz, busy boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, a.id, a.timezone, a.auto_update_window, a.auto_update_frequency,
         (select max(r.created_at) from public.update_runs r where r.site_id = s.id and r.trigger = 'scheduled'),
         exists (select 1 from public.update_runs r where r.site_id = s.id and r.status <> 'done')
    from public.sites s
    join public.agencies a on a.id = s.agency_id
   where a.auto_updates and s.auto_updates
     and s.connection_status = 'connected'
     and app.agency_is_writable(a.id)
   order by s.id
   limit greatest(1, least(p_limit, 5000));
$$;

-- Vragen om akkoord vervallen zodra de site niet (meer) automatisch wordt bijgewerkt: dan beslist het
-- bureau zelf over alle updates, zoals voorheen. Geeft het aantal opgeruimde vragen terug.
create or replace function public.clear_update_approvals_outside_schedule()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  with gone as (
    update public.alerts al
       set status = 'resolved', resolved_at = now(), updated_at = now(), resolved_notified_at = now()
      from public.sites s join public.agencies a on a.id = s.agency_id
     where al.site_id = s.id and al.type = 'update_approval' and al.status = 'open'
       and not (a.auto_updates and s.auto_updates and s.connection_status = 'connected')
    returning 1)
  select count(*) into v_n from gone;
  return v_n;
end $$;

-- Start de geplande veilige update met de onderdelen die de worker heeft gekozen. Controleert opnieuw
-- of het bureau het (nog) aan heeft en de site meedoet; null als er intussen iets veranderde.
create or replace function public.start_scheduled_update(p_site uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
  v_id uuid;
begin
  select a.auto_updates and s.auto_updates into v_ok
    from public.sites s join public.agencies a on a.id = s.agency_id where s.id = p_site;
  if not coalesce(v_ok, false) then
    return null;
  end if;
  begin
    v_id := app.insert_update_run(p_site, p_items, null, 'scheduled');
  exception when others then
    if sqlerrm in ('run_active', 'read_only', 'not_connected', 'connector_outdated', 'no_update_available', 'no_items') then
      return null;
    end if;
    raise;
  end;
  return v_id;
end $$;

-- Eén vraag per site met alles wat op akkoord wacht (grote versiesprong, WordPress-hoofdversie).
-- Lege lijst: de vraag vervalt (bijgewerkt, of er is niets meer dat wacht).
-- p_items: [{type, slug, name, from_version, to_version, why}]
create or replace function public.sync_update_approvals(p_site uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid;
begin
  select agency_id into v_agency from public.sites where id = p_site;
  if v_agency is null then
    raise exception 'site_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 then
    perform app.resolve_alert(p_site, 'update_approval');
  else
    perform app.raise_alert(p_site, v_agency, 'update_approval', 'warning',
      jsonb_build_object('count', jsonb_array_length(p_items), 'items', p_items));
  end if;
end $$;

revoke all on function public.scheduled_update_candidates(int) from public, anon, authenticated;
revoke all on function public.clear_update_approvals_outside_schedule() from public, anon, authenticated;
revoke all on function public.start_scheduled_update(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sync_update_approvals(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.scheduled_update_candidates(int) to service_role;
grant execute on function public.clear_update_approvals_outside_schedule() to service_role;
grant execute on function public.start_scheduled_update(uuid, jsonb) to service_role;
grant execute on function public.sync_update_approvals(uuid, jsonb) to service_role;
