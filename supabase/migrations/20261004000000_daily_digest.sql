-- Ochtendmail "Afgelopen nacht": elke ochtend om 07:00 (tijdzone van het bureau) één korte mail aan
-- eigenaren en beheerders, met wat Verploy deed en wat op hen wacht. Alleen als er iets te melden is.
--
-- Achterwaarts compatibel: twee nieuwe kolommen (standaard aan, nog nooit verstuurd) en één worker-RPC.

alter table public.agencies
  add column daily_digest boolean not null default true,
  add column digest_sent_at timestamptz;
grant update (daily_digest) on public.agencies to authenticated;

-- Bureaus waarvoor het nu 07:xx is en die vandaag nog geen ochtendmail kregen; atomair geclaimd
-- (SKIP LOCKED), zodat twee workers nooit dezelfde mail sturen. `since`: vorige mail (of 24 uur terug).
create or replace function public.claim_daily_digests(p_hour int default 7, p_limit int default 50)
returns table (agency_id uuid, agency_name text, locale text, since timestamptz, recipients text[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id, coalesce(a.digest_sent_at, now() - interval '24 hours') as since
      from public.agencies a
     where a.daily_digest
       and (a.digest_sent_at is null or a.digest_sent_at < now() - interval '20 hours')
       and extract(hour from now() at time zone a.timezone) = p_hour
       and exists (select 1 from public.sites s where s.agency_id = a.id and s.connection_status = 'connected')
     order by a.id
     limit greatest(1, least(p_limit, 500))
     for update skip locked
  ), claimed as (
    update public.agencies a set digest_sent_at = now()
      from due where a.id = due.id
    returning a.id, a.name, a.dashboard_locale, due.since
  )
  select c.id, c.name, c.dashboard_locale, greatest(c.since, now() - interval '48 hours'),
         array(select u.email::text from public.agency_members m join auth.users u on u.id = m.user_id
                where m.agency_id = c.id and m.role in ('owner','admin') and u.email is not null order by u.email)
    from claimed c;
end $$;

revoke all on function public.claim_daily_digests(int, int) from public, anon, authenticated;
grant execute on function public.claim_daily_digests(int, int) to service_role;
