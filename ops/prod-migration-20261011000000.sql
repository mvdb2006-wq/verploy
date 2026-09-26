-- Verploy — productiemigratie 20261011000000 (signup_notices). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261011000000') then raise exception 'migratie 20261011000000 is al toegepast'; end if; end $$;
-- Interne melding bij elke nieuwe registratie (naar ops_config.alert_email, team@verploy.com). Een trigger op
-- auth.users zet de registratie in een wachtrij; /api/cron/ops (elke 5 minuten) mailt ze via Resend. Zo telt
-- elke nieuwe gebruiker mee, ook via een uitnodiging, en kan een registratie nooit mislukken door de melding.
--
-- Achterwaarts compatibel: nieuwe tabel, functies en trigger.

create table public.signup_notices (
  user_id       uuid primary key,
  email         text not null,
  intended_plan text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  attempts      int not null default 0
);
create index signup_notices_pending_idx on public.signup_notices(created_at) where sent_at is null;
alter table public.signup_notices enable row level security;
revoke all on public.signup_notices from anon, authenticated, public;
grant all on public.signup_notices to service_role;

create or replace function app.queue_signup_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null then
    insert into public.signup_notices (user_id, email, intended_plan)
    values (new.id, new.email, nullif(btrim(new.raw_user_meta_data->>'intended_plan'), ''))
    on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new;   -- een registratie mag nooit mislukken door de melding
end $$;

drop trigger if exists verploy_signup_notice on auth.users;
create trigger verploy_signup_notice after insert on auth.users
  for each row execute function app.queue_signup_notice();

-- Wachtende meldingen met wat er nu bekend is: bevestigd, bureau (naam) en of het via een uitnodiging ging.
create or replace function public.pending_signup_notices(p_limit int default 20)
returns table (user_id uuid, email text, intended_plan text, created_at timestamptz, attempts int,
               confirmed boolean, agency_name text, invited boolean)
language sql stable security definer set search_path = '' as $$
  select n.user_id, n.email, n.intended_plan, n.created_at, n.attempts,
         u.email_confirmed_at is not null,
         (select a.name from public.agency_members m join public.agencies a on a.id = m.agency_id where m.user_id = n.user_id limit 1),
         exists (select 1 from public.agency_invitations i where i.email = lower(n.email))
    from public.signup_notices n
    left join auth.users u on u.id = n.user_id
   where n.sent_at is null and n.attempts < 5
   order by n.created_at
   limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public.pending_signup_notices(int) from anon, authenticated, public;
grant execute on function public.pending_signup_notices(int) to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261011000000', 'signup_notices');
notify pgrst, 'reload schema';
commit;
