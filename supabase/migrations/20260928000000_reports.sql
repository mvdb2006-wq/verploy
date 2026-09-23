-- ============================================================================
-- Verploy — fase 6: white-label rapporten
--  • per site: maandrapport aan/uit (report_locale en client_email bestonden al)
--  • reports: wachtrij + resultaat (PDF in privé-bucket 'reports')
--  • request_report (leden), schedule_monthly_reports / claim_report / complete_report (worker)
--  • bucket 'branding' voor het logo van het bureau (privé; de server leest het)
-- ============================================================================

set check_function_bodies = off;

alter table public.sites add column report_monthly boolean not null default false;
grant update (report_monthly) on public.sites to authenticated;

create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  site_id       uuid not null references public.sites(id) on delete cascade,
  created_by    uuid references auth.users(id) on delete set null,
  trigger       text not null check (trigger in ('manual','monthly')),
  period_start  date not null,
  period_end    date not null,
  locale        text not null check (locale in ('nl','en','de','fr','es')),
  send_to       text check (send_to is null or send_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status        text not null default 'queued' check (status in ('queued','generating','ready','sent','failed')),
  attempt       int not null default 0,
  worker_id     text,
  lease_until   timestamptz,
  pdf_path      text,
  pdf_bytes     int,
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_end >= period_start and period_end - period_start <= 366)
);
create index reports_agency_idx on public.reports(agency_id, created_at desc);
create index reports_site_idx on public.reports(site_id, period_start desc);
create index reports_queue_idx on public.reports(created_at) where status in ('queued','generating');
-- Het maandrapport van een periode bestaat maar één keer (ook als de planner vaker draait)
create unique index reports_monthly_once on public.reports(site_id, period_start) where trigger = 'monthly';
create trigger reports_touch before update on public.reports
  for each row execute function app.touch_updated_at();
create trigger reports_agency before insert or update on public.reports
  for each row execute function app.check_site_agency();

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated, public;
grant all on public.reports to service_role;
grant select on public.reports to authenticated;
create policy reports_read on public.reports for select to authenticated
  using ((select app.is_member(agency_id)));

-- Handmatig rapport: elk lid; versturen naar de klant alleen door eigenaar/beheerder.
create or replace function public.request_report(p_site uuid, p_start date, p_end date, p_send boolean default false)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.sites%rowtype;
  v_id uuid;
begin
  select * into v_site from public.sites where id = p_site;
  if v_site.id is null or not app.is_member(v_site.agency_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.agency_is_writable(v_site.agency_id) then
    raise exception 'read_only' using errcode = 'P0001';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 or p_end > current_date then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if p_send and not app.has_role(v_site.agency_id, array['owner','admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_send and v_site.client_email is null then
    raise exception 'no_client_email' using errcode = 'P0001';
  end if;
  if (select count(*) from public.reports r where r.agency_id = v_site.agency_id and r.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.reports (agency_id, site_id, created_by, trigger, period_start, period_end, locale, send_to)
  values (v_site.agency_id, p_site, (select auth.uid()), 'manual', p_start, p_end, v_site.report_locale,
          case when p_send then v_site.client_email end)
  returning id into v_id;
  return v_id;
end $$;

-- Maandrapporten over de vorige kalendermaand (Europe/Amsterdam). Idempotent: draai zo vaak als je wilt.
create or replace function public.schedule_monthly_reports() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_start date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_end   date := (date_trunc('month', v_today) - interval '1 day')::date;
  v_count integer;
begin
  insert into public.reports (agency_id, site_id, trigger, period_start, period_end, locale, send_to)
  select s.agency_id, s.id, 'monthly', v_start, v_end, s.report_locale, s.client_email
    from public.sites s
   where s.report_monthly
     and s.connection_status = 'connected'
     and s.paired_at < v_end + 1
     and app.agency_is_writable(s.agency_id)
  on conflict (site_id, period_start) where trigger = 'monthly' do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.claim_report(p_worker text, p_lease_seconds int default 300)
returns setof public.reports
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  select r.id into v_id from public.reports r
   where (r.status = 'queued' or (r.status = 'generating' and r.lease_until < now()))
     and r.attempt < 3
   order by r.created_at
   limit 1
   for update skip locked;
  if v_id is null then return; end if;
  return query
  update public.reports r
     set status = 'generating', worker_id = p_worker, attempt = r.attempt + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds)
   where r.id = v_id
  returning r.*;
end $$;

-- Rapport klaar (met of zonder verzending) of mislukt. Na 3 mislukte pogingen blijft 'failed' staan.
create or replace function public.complete_report(p_report uuid, p_worker text, p_status text,
  p_pdf_path text default null, p_pdf_bytes int default null, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('ready','sent','failed','queued') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.reports
     set status    = p_status,
         pdf_path  = coalesce(p_pdf_path, pdf_path),
         pdf_bytes = coalesce(p_pdf_bytes, pdf_bytes),
         error     = case when p_status in ('failed','queued') then left(p_error, 500) else null end,
         sent_at   = case when p_status = 'sent' then now() else sent_at end,
         worker_id = null, lease_until = null
   where id = p_report and worker_id = p_worker;
  if not found then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.request_report(uuid, date, date, boolean), public.schedule_monthly_reports(),
  public.claim_report(text, int), public.complete_report(uuid, text, text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.request_report(uuid, date, date, boolean) to authenticated;
grant execute on function public.request_report(uuid, date, date, boolean), public.schedule_monthly_reports(),
  public.claim_report(text, int), public.complete_report(uuid, text, text, text, int, text) to service_role;

-- Opslag: rapporten en logo's (privé; de server controleert rechten en leest met de service role)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('reports', 'reports', false, 20971520, array['application/pdf']),
           ('branding', 'branding', false, 1048576, array['image/png','image/jpeg','image/webp'])
    on conflict (id) do nothing;
  end if;
end $$;

-- Reply-to voor rapportmails aan klanten: de (eerste) eigenaar van het bureau.
create or replace function public.agency_owner_email(p_agency uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from public.agency_members m join auth.users u on u.id = m.user_id
   where m.agency_id = p_agency and m.role = 'owner' order by m.created_at limit 1;
$$;
revoke all on function public.agency_owner_email(uuid) from public, anon, authenticated;
grant execute on function public.agency_owner_email(uuid) to service_role;
