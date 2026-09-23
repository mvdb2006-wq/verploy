-- ============================================================================
-- Verploy — fase 5: diagnose bij een gezakte update
--  • diagnoses: per run één uitleg (oorzaak + oplossing) in de taal van het bureau
--  • bron: 'rules' (regelgebaseerde analyse van foutmeldingen) of 'ai' (Claude, verfijnd)
--  • record_run_outcome neemt de samenvatting mee in de melding (en dus de e-mail)
-- ============================================================================

set check_function_bodies = off;

create table public.diagnoses (
  run_id       uuid primary key references public.update_runs(id) on delete cascade,
  agency_id    uuid not null references public.agencies(id) on delete cascade,
  source       text not null check (source in ('rules','ai')),
  model        text,
  locale       text not null check (locale in ('nl','en','de','fr','es')),
  summary      text not null check (char_length(summary) between 1 and 400),
  cause        text not null check (char_length(cause) between 1 and 2000),
  fix          text not null check (char_length(fix) between 1 and 2000),
  culprit_slug text,
  culprit_name text,
  confidence   text not null check (confidence in ('high','medium','low')),
  -- wat de analyse zag (foutmeldingen zonder serverpaden, gezakte checks, versies)
  evidence     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index diagnoses_agency_idx on public.diagnoses(agency_id);
create trigger diagnoses_touch before update on public.diagnoses
  for each row execute function app.touch_updated_at();
create trigger diagnoses_agency before insert or update on public.diagnoses
  for each row execute function app.check_run_agency();

alter table public.diagnoses enable row level security;
revoke all on public.diagnoses from anon, authenticated, public;
grant all on public.diagnoses to service_role;
grant select on public.diagnoses to authenticated;
create policy diagnoses_read on public.diagnoses for select to authenticated
  using ((select app.is_member(agency_id)));

-- Melding bij de uitkomst: nu met de samenvatting van de diagnose (als die er is).
create or replace function public.record_run_outcome(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.update_runs%rowtype;
  v_params jsonb;
  v_summary text;
begin
  select * into v_run from public.update_runs where id = p_run;
  if v_run.id is null or v_run.status <> 'done' then
    raise exception 'run_not_done' using errcode = 'P0001';
  end if;
  select d.summary into v_summary from public.diagnoses d where d.run_id = p_run;
  v_params := jsonb_build_object(
    'run_id', v_run.id, 'reason_key', v_run.reason_key, 'reason_params', v_run.reason_params,
    'items', (select coalesce(jsonb_agg(i->>'name'), '[]'::jsonb) from jsonb_array_elements(v_run.items) i))
    || case when v_summary is not null then jsonb_build_object('diagnosis', v_summary) else '{}'::jsonb end;
  if v_run.verdict = 'deployed' then
    perform app.resolve_alert(v_run.site_id, t)
       from unnest(array['update_blocked','update_rolled_back','update_failed']) t;
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
