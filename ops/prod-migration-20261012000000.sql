-- Verploy — productiemigratie 20261012000000 (platform_admin). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261012000000') then raise exception 'migratie 20261012000000 is al toegepast'; end if; end $$;
-- Klantoverzicht voor de beheerder van Verploy (Martijn), los van de rollen binnen een bureau.
-- Een platformbeheerder staat in platform_admins; alleen die kan de admin_*-functies aanroepen. Klanten
-- (eigenaren, beheerders, leden van bureaus) zien hier niets van.
--
-- Achterwaarts compatibel: nieuwe tabel en functies.

create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated, public;
grant all on public.platform_admins to service_role;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
revoke all on function public.is_platform_admin() from anon, public;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- Alle bureaus met plan, status, gebruik en eigenaar.
create or replace function public.admin_customers()
returns table (
  id uuid, name text, created_at timestamptz, locale text,
  owner_email text, members int, last_sign_in_at timestamptz,
  plan_id text, plan_name text, price_cents int, sites_limit int,
  plan_status text, trial_ends_at timestamptz, period_end timestamptz, cancel_at_end boolean,
  stripe_customer_id text, stripe_subscription_id text, stripe_synced_at timestamptz,
  sites int, sites_connected int
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select a.id, a.name, a.created_at, a.dashboard_locale,
         (select u.email::text from public.agency_members m join auth.users u on u.id = m.user_id
           where m.agency_id = a.id and m.role = 'owner' order by m.created_at limit 1),
         (select count(*)::int from public.agency_members m where m.agency_id = a.id),
         (select max(u.last_sign_in_at) from public.agency_members m join auth.users u on u.id = m.user_id where m.agency_id = a.id),
         a.plan_id, p.name, p.price_cents, p.sites_limit,
         a.plan_status, a.trial_ends_at, a.subscription_period_end, a.subscription_cancel_at_end,
         a.stripe_customer_id, a.stripe_subscription_id, a.stripe_synced_at,
         (select count(*)::int from public.sites s where s.agency_id = a.id),
         (select count(*)::int from public.sites s where s.agency_id = a.id and s.connection_status = 'connected')
    from public.agencies a
    join public.plans p on p.id = a.plan_id
   order by a.created_at desc;
end $$;
revoke all on function public.admin_customers() from anon, public;
grant execute on function public.admin_customers() to authenticated;

-- Aangemeld maar (nog) geen bureau: registraties die niet verder kwamen dan het account.
create or replace function public.admin_loose_users()
returns table (user_id uuid, email text, created_at timestamptz, confirmed boolean, last_sign_in_at timestamptz, intended_plan text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select u.id, u.email::text, u.created_at, u.email_confirmed_at is not null, u.last_sign_in_at,
         nullif(u.raw_user_meta_data->>'intended_plan', '')
    from auth.users u
   where not exists (select 1 from public.agency_members m where m.user_id = u.id)
   order by u.created_at desc
   limit 500;
end $$;
revoke all on function public.admin_loose_users() from anon, public;
grant execute on function public.admin_loose_users() to authenticated;

-- Eén bureau in detail: leden en sites.
create or replace function public.admin_customer(p_agency uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'members', coalesce((select jsonb_agg(jsonb_build_object(
          'email', u.email, 'role', m.role, 'joined_at', m.created_at, 'last_sign_in_at', u.last_sign_in_at,
          'confirmed', u.email_confirmed_at is not null) order by m.created_at)
        from public.agency_members m join auth.users u on u.id = m.user_id where m.agency_id = p_agency), '[]'::jsonb),
      'sites', coalesce((select jsonb_agg(jsonb_build_object(
          'name', s.name, 'url', s.url, 'connection_status', s.connection_status, 'status', s.status,
          'last_heartbeat_at', s.last_heartbeat_at, 'connector_version', s.connector_version, 'created_at', s.created_at) order by s.name)
        from public.sites s where s.agency_id = p_agency), '[]'::jsonb)
    )
  );
end $$;
revoke all on function public.admin_customer(uuid) from anon, public;
grant execute on function public.admin_customer(uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261012000000', 'platform_admin');
notify pgrst, 'reload schema';
commit;
