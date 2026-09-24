-- Verploy v2 — productie-upgrade. Gegenereerd door ops/build-prod-upgrade.sh; niet met de hand wijzigen.
begin;
create schema if not exists backup_v1;
revoke all on schema backup_v1 from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['agencies','agency_members','sites','health_snapshots','site_plugins','alerts','reports','update_runs','update_jobs'] loop
    if to_regclass('public.' || t) is not null and to_regclass('backup_v1.' || t) is null
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sites' and column_name = 'api_key') then
      execute format('create table backup_v1.%I as table public.%I', t, t);
    end if;
  end loop;
  if to_regclass('backup_v1.auth_users') is null then
    create table backup_v1.auth_users as select id, email, created_at, raw_user_meta_data from auth.users;
  end if;
end $$;

-- ===== 20260924000000_v2_foundation.sql =====
-- ============================================================================
-- Verploy v2 — fundament
--  • plans (centrale prijzen/limieten), agencies, agency_members, invitations
--  • sites + site_credentials (versleuteld secret, koppelcode), request-nonces
--  • health_snapshots + site_components (heartbeat-data)
--  • RLS op elke tabel, minimale grants, RPC's voor alle gevoelige mutaties
--
-- Werkt op een lege database én op de v1-productiestaat (23-09-2026):
-- bestaande v1-objecten worden hernoemd, de data wordt overgezet, daarna
-- worden de v1-objecten verwijderd.
-- ============================================================================

set check_function_bodies = off;

create schema if not exists app;
comment on schema app is 'Interne helpers voor RLS en triggers (niet via de API aanroepbaar).';
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ── 0. v1 opzijzetten (alleen als die bestaat) ────────────────────────────────
do $$
declare t text;
begin
  if to_regclass('public.sites') is not null
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'sites' and column_name = 'api_key') then
    drop view if exists public.site_overview;
    drop view if exists public.latest_health_snapshots;
    foreach t in array array['agencies','agency_members','sites','health_snapshots','site_plugins',
                             'alerts','reports','update_runs','update_jobs'] loop
      if to_regclass('public.' || t) is not null then
        execute format('alter table public.%I rename to %I', t, t || '_v1');
      end if;
    end loop;
  end if;
end $$;

-- ── 1. Helpers ────────────────────────────────────────────────────────────────
create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── 2. Plans: de ENIGE plek voor prijzen en limieten ──────────────────────────
create table public.plans (
  id              text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name            text not null,
  price_cents     integer not null check (price_cents >= 0),
  currency        text not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  sites_limit     integer not null check (sites_limit > 0),
  sort_order      integer not null,
  is_public       boolean not null default true,
  stripe_price_id text unique
);
comment on table public.plans is 'Centrale prijzen en site-limieten. Wijzig hier; UI, limiet-trigger en Stripe lezen dit.';

insert into public.plans (id, name, price_cents, sites_limit, sort_order) values
  ('solo',   'Solo',    1900,   5, 1),
  ('studio', 'Studio',  4900,  15, 2),
  ('agency', 'Agency',  9900,  40, 3),
  ('scale',  'Scale',  24900, 120, 4);

-- ── 3. Agencies ───────────────────────────────────────────────────────────────
create table public.agencies (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(btrim(name)) between 2 and 120),
  slug                   text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  dashboard_locale       text not null default 'nl' check (dashboard_locale in ('nl','en','de','fr','es')),
  brand_color            text not null default '#22D98A' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  brand_logo_path        text,
  report_sender_name     text check (report_sender_name is null or char_length(report_sender_name) <= 120),
  plan_id                text not null default 'studio' references public.plans(id),
  plan_status            text not null default 'trialing'
                         check (plan_status in ('trialing','active','past_due','canceled','comped')),
  trial_ends_at          timestamptz default (now() + interval '14 days'),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger agencies_touch before update on public.agencies
  for each row execute function app.touch_updated_at();

-- ── 4. Members (één bureau per gebruiker) ─────────────────────────────────────
create table public.agency_members (
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id),
  unique (user_id)
);
create index agency_members_agency_idx on public.agency_members(agency_id);

create table public.agency_invitations (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  email       text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role        text not null check (role in ('admin','member')),
  token_hash  text not null unique,
  invited_by  uuid references auth.users(id) on delete set null,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index agency_invitations_agency_idx on public.agency_invitations(agency_id);
create unique index agency_invitations_open_uniq on public.agency_invitations(agency_id, email)
  where accepted_at is null;

-- ── 5. Rechten-helpers (SECURITY DEFINER → geen RLS-recursie) ─────────────────
create or replace function app.is_member(p_agency uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members m
                 where m.agency_id = p_agency and m.user_id = (select auth.uid()));
$$;

create or replace function app.has_role(p_agency uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.agency_members m
                 where m.agency_id = p_agency and m.user_id = (select auth.uid())
                   and m.role = any(p_roles));
$$;

create or replace function app.my_agency() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.agency_id from public.agency_members m where m.user_id = (select auth.uid());
$$;

-- Mag dit bureau nieuwe dingen doen (sites toevoegen, updates starten)?
create or replace function app.agency_is_writable(p_agency uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.agencies a
    where a.id = p_agency
      and ( a.plan_status in ('active','comped')
         or (a.plan_status = 'trialing' and a.trial_ends_at > now()) )
  );
$$;

revoke all on function app.is_member(uuid), app.has_role(uuid, text[]), app.my_agency(),
  app.agency_is_writable(uuid), app.touch_updated_at() from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, text[]), app.my_agency(),
  app.agency_is_writable(uuid) to authenticated, service_role;

-- Laatste owner kan niet verdwijnen of gedegradeerd worden
create or replace function app.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (select 1 from public.agency_members m
                   where m.agency_id = old.agency_id and m.role = 'owner' and m.user_id <> old.user_id)
       and exists (select 1 from public.agencies a where a.id = old.agency_id) then
      raise exception 'last_owner' using errcode = 'P0001',
        hint = 'Een bureau moet minstens één eigenaar hebben.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger agency_members_protect_owner before update or delete on public.agency_members
  for each row execute function app.protect_last_owner();

-- ── 6. Sites ──────────────────────────────────────────────────────────────────
create table public.sites (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references public.agencies(id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 120),
  url               text not null check (url ~ '^https?://[^/\s]+(/[^\s]*)?$' and url !~ '/$'),
  client_name       text check (client_name is null or char_length(client_name) <= 120),
  client_email      text check (client_email is null or client_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  report_locale     text not null default 'nl' check (report_locale in ('nl','en','de','fr','es')),
  status            text not null default 'pending' check (status in ('pending','online','offline')),
  connection_status text not null default 'awaiting_pairing'
                    check (connection_status in ('awaiting_pairing','connected','revoked')),
  connector_version text,
  wp_version        text,
  php_version       text,
  last_heartbeat_at timestamptz,
  paired_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (agency_id, url)
);
create index sites_agency_idx on public.sites(agency_id);
create trigger sites_touch before update on public.sites
  for each row execute function app.touch_updated_at();

-- Tier-limiet en abonnementsstatus, voor ELK pad (UI, API, service role)
create or replace function app.enforce_site_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit int;
  v_count int;
begin
  if not app.agency_is_writable(new.agency_id) then
    raise exception 'subscription_inactive' using errcode = 'P0001',
      hint = 'Het abonnement van dit bureau is niet actief.';
  end if;
  select p.sites_limit into v_limit
    from public.agencies a join public.plans p on p.id = a.plan_id
   where a.id = new.agency_id
   for update of a;                      -- serialiseert gelijktijdige inserts per bureau
  select count(*) into v_count from public.sites s where s.agency_id = new.agency_id;
  if v_count >= v_limit then
    raise exception 'site_limit_reached' using errcode = 'P0001',
      detail = format('limit=%s', v_limit),
      hint = 'Upgrade het abonnement om meer sites te koppelen.';
  end if;
  return new;
end $$;
create trigger sites_enforce_limit before insert on public.sites
  for each row execute function app.enforce_site_limit();

-- Geheimen: GEEN policies → alleen service_role
create table public.site_credentials (
  site_id                     uuid primary key references public.sites(id) on delete cascade,
  agency_id                   uuid not null references public.agencies(id) on delete cascade,
  secret_ciphertext           text,
  secret_version              integer not null default 0,
  previous_secret_ciphertext  text,
  previous_valid_until        timestamptz,
  pairing_code_hash           text unique,
  pairing_expires_at          timestamptz,
  updated_at                  timestamptz not null default now()
);
create trigger site_credentials_touch before update on public.site_credentials
  for each row execute function app.touch_updated_at();

create or replace function app.create_site_credentials() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.site_credentials (site_id, agency_id) values (new.id, new.agency_id);
  return new;
end $$;
create trigger sites_create_credentials after insert on public.sites
  for each row execute function app.create_site_credentials();

create table public.signed_request_nonces (
  site_id    uuid not null references public.sites(id) on delete cascade,
  nonce      text not null check (nonce ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  primary key (site_id, nonce)
);
create index signed_request_nonces_created_idx on public.signed_request_nonces(created_at);

-- ── 7. Heartbeat-data ─────────────────────────────────────────────────────────
create table public.health_snapshots (
  id                bigint generated always as identity primary key,
  agency_id         uuid not null references public.agencies(id) on delete cascade,
  site_id           uuid not null references public.sites(id) on delete cascade,
  captured_at       timestamptz not null default now(),
  received_at       timestamptz not null default now(),
  connector_version text,
  wp_version        text,
  php_version       text,
  memory_limit_mb   integer,
  memory_peak_mb    integer,
  disk_free_mb      integer,
  db_size_mb        numeric(12,2),
  ssl_expires_at    timestamptz,
  domain_expires_at timestamptz,
  raw               jsonb not null default '{}'::jsonb
);
create index health_snapshots_site_time_idx on public.health_snapshots(site_id, captured_at desc);
create index health_snapshots_agency_idx on public.health_snapshots(agency_id);

create table public.site_components (
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  site_id          uuid not null references public.sites(id) on delete cascade,
  type             text not null check (type in ('plugin','theme','core')),
  slug             text not null check (char_length(slug) between 1 and 255),
  name             text not null,
  version          text,
  latest_version   text,
  update_available boolean not null default false,
  active           boolean not null default true,
  updated_at       timestamptz not null default now(),
  primary key (site_id, type, slug)
);
create index site_components_agency_idx on public.site_components(agency_id);

-- Kindtabellen moeten dezelfde agency_id hebben als hun site
create or replace function app.check_site_agency() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.sites s where s.id = new.site_id and s.agency_id = new.agency_id) then
    raise exception 'agency_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger health_snapshots_agency before insert or update on public.health_snapshots
  for each row execute function app.check_site_agency();
create trigger site_components_agency before insert or update on public.site_components
  for each row execute function app.check_site_agency();

-- ── 8. RLS + grants ───────────────────────────────────────────────────────────
alter table public.plans                 enable row level security;
alter table public.agencies              enable row level security;
alter table public.agency_members        enable row level security;
alter table public.agency_invitations    enable row level security;
alter table public.sites                 enable row level security;
alter table public.site_credentials      enable row level security;
alter table public.signed_request_nonces enable row level security;
alter table public.health_snapshots      enable row level security;
alter table public.site_components       enable row level security;

-- Supabase geeft standaard alles aan anon/authenticated: eerst alles intrekken.
revoke all on public.plans, public.agencies, public.agency_members, public.agency_invitations,
  public.sites, public.site_credentials, public.signed_request_nonces,
  public.health_snapshots, public.site_components from anon, authenticated, public;
grant all on public.plans, public.agencies, public.agency_members, public.agency_invitations,
  public.sites, public.site_credentials, public.signed_request_nonces,
  public.health_snapshots, public.site_components to service_role;

-- plans: publiek leesbaar voor ingelogde gebruikers (prijzen tonen)
grant select on public.plans to authenticated;
create policy plans_read on public.plans for select to authenticated using (true);

-- agencies
grant select on public.agencies to authenticated;
grant update (name, dashboard_locale, brand_color, brand_logo_path, report_sender_name)
  on public.agencies to authenticated;
create policy agencies_read on public.agencies for select to authenticated
  using ((select app.is_member(id)));
create policy agencies_update on public.agencies for update to authenticated
  using ((select app.has_role(id, array['owner','admin'])))
  with check ((select app.has_role(id, array['owner','admin'])));

-- agency_members: lezen binnen eigen bureau; mutaties alleen via RPC
grant select on public.agency_members to authenticated;
create policy agency_members_read on public.agency_members for select to authenticated
  using ((select app.is_member(agency_id)));

-- agency_invitations: owner/admin lezen; aanmaken/accepteren via RPC
grant select on public.agency_invitations to authenticated;
create policy agency_invitations_read on public.agency_invitations for select to authenticated
  using ((select app.has_role(agency_id, array['owner','admin'])));
grant delete on public.agency_invitations to authenticated;
create policy agency_invitations_delete on public.agency_invitations for delete to authenticated
  using ((select app.has_role(agency_id, array['owner','admin'])) and accepted_at is null);

-- sites
grant select on public.sites to authenticated;
grant insert (agency_id, name, url, client_name, client_email, report_locale) on public.sites to authenticated;
grant update (name, client_name, client_email, report_locale) on public.sites to authenticated;
grant delete on public.sites to authenticated;
create policy sites_read on public.sites for select to authenticated
  using ((select app.is_member(agency_id)));
create policy sites_insert on public.sites for insert to authenticated
  with check ((select app.has_role(agency_id, array['owner','admin'])));
create policy sites_update on public.sites for update to authenticated
  using ((select app.has_role(agency_id, array['owner','admin'])))
  with check ((select app.has_role(agency_id, array['owner','admin'])));
create policy sites_delete on public.sites for delete to authenticated
  using ((select app.has_role(agency_id, array['owner','admin'])));

-- site_credentials + signed_request_nonces: GEEN policies (alleen service_role)

-- heartbeat-data: alleen lezen voor leden
grant select on public.health_snapshots, public.site_components to authenticated;
create policy health_snapshots_read on public.health_snapshots for select to authenticated
  using ((select app.is_member(agency_id)));
create policy site_components_read on public.site_components for select to authenticated
  using ((select app.is_member(agency_id)));

-- ── 9. RPC's (de enige manier om gevoelige dingen te muteren) ─────────────────
create or replace function app.slugify(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(
           lower(translate(p, 'áàäâãåéèëêíìïîóòöôõúùüûçñ', 'aaaaaaeeeeiiiiooooouuuucn')),
           '[^a-z0-9]+', '-', 'g')), ''), 'bureau');
$$;

create or replace function public.create_agency(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_id   uuid;
  v_slug text;
  v_base text;
  i int := 1;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.agency_members where user_id = v_uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  v_base := left(app.slugify(p_name), 60);
  v_slug := v_base;
  while exists (select 1 from public.agencies where slug = v_slug) loop
    i := i + 1; v_slug := v_base || '-' || i;
  end loop;
  insert into public.agencies (name, slug) values (btrim(p_name), v_slug) returning id into v_id;
  insert into public.agency_members (agency_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;

-- Maakt een eenmalige koppelcode (8 tekens, 30 min geldig). Alleen de hash wordt bewaard.
create or replace function public.create_pairing_code(p_site uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid;
  v_code   text := '';
  v_alpha  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- geen 0/O/1/I
  v_bytes  bytea := extensions.gen_random_bytes(8);
begin
  select agency_id into v_agency from public.sites where id = p_site;
  if v_agency is null or not app.has_role(v_agency, array['owner','admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for i in 0..7 loop
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  update public.site_credentials
     set pairing_code_hash  = encode(extensions.digest(v_code, 'sha256'), 'hex'),
         pairing_expires_at = now() + interval '30 minutes'
   where site_id = p_site;
  return v_code;
end $$;

-- Uitnodigen: geeft het ruwe token terug (voor de e-mail); alleen de hash wordt bewaard.
create or replace function public.invite_member(p_email text, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid := app.my_agency();
  v_token  text := encode(extensions.gen_random_bytes(24), 'hex');
  v_email  text := lower(btrim(p_email));
begin
  if v_agency is null or not app.has_role(v_agency, array['owner','admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('admin','member') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if p_role = 'admin' and not app.has_role(v_agency, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.agency_members m join auth.users u on u.id = m.user_id
             where m.agency_id = v_agency and lower(u.email) = v_email) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  delete from public.agency_invitations where agency_id = v_agency and email = v_email and accepted_at is null;
  insert into public.agency_invitations (agency_id, email, role, token_hash, invited_by)
  values (v_agency, v_email, p_role, encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()));
  return v_token;
end $$;

create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text := lower((select auth.jwt()) ->> 'email');
  v_inv   public.agency_invitations%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_inv from public.agency_invitations
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
   for update;
  if not found or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'invalid_invitation' using errcode = 'P0001';
  end if;
  if v_inv.email <> v_email then
    raise exception 'invitation_email_mismatch' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.agency_members where user_id = v_uid) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  insert into public.agency_members (agency_id, user_id, role) values (v_inv.agency_id, v_uid, v_inv.role);
  update public.agency_invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.agency_id;
end $$;

create or replace function public.update_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_agency uuid := app.my_agency();
begin
  if v_agency is null or not app.has_role(v_agency, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('owner','admin','member') then raise exception 'invalid_role' using errcode = '22023'; end if;
  update public.agency_members set role = p_role where agency_id = v_agency and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid := app.my_agency();
  v_uid uuid := (select auth.uid());
begin
  if v_agency is null then raise exception 'forbidden' using errcode = '42501'; end if;
  -- Zelf vertrekken mag altijd; anderen verwijderen alleen door owner
  if p_user <> v_uid and not app.has_role(v_agency, array['owner']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.agency_members where agency_id = v_agency and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;

-- Leden van het EIGEN bureau met e-mailadres (auth.users is niet leesbaar voor gebruikers).
create or replace function public.list_members()
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.created_at
    from public.agency_members m
    join auth.users u on u.id = m.user_id
   where m.agency_id = app.my_agency()
   order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.email;
$$;
revoke all on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated, service_role;

-- Toont bureau/e-mail/rol van een uitnodiging; het token zelf is het geheim.
create or replace function public.peek_invitation(p_token text)
returns table (agency_name text, email text, role text, valid boolean)
language sql stable security definer set search_path = '' as $$
  select a.name, i.email, i.role, (i.accepted_at is null and i.expires_at > now())
    from public.agency_invitations i
    join public.agencies a on a.id = i.agency_id
   where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;
revoke all on function public.peek_invitation(text) from public;
grant execute on function public.peek_invitation(text) to anon, authenticated, service_role;

revoke all on function public.create_agency(text), public.create_pairing_code(uuid),
  public.invite_member(text, text), public.accept_invitation(text),
  public.update_member_role(uuid, text), public.remove_member(uuid),
  app.slugify(text), app.enforce_site_limit(), app.create_site_credentials(),
  app.check_site_agency(), app.protect_last_owner() from public, anon;
grant execute on function public.create_agency(text), public.create_pairing_code(uuid),
  public.invite_member(text, text), public.accept_invitation(text),
  public.update_member_role(uuid, text), public.remove_member(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
grant execute on all functions in schema public to service_role;

-- ── 9b. Functies voor de plugin-API (alleen service_role) ──────────────────────

-- Wisselt een koppelcode atomair in voor een nieuw (versleuteld) secret.
-- Het vorige secret blijft 10 minuten geldig (lopende requests tijdens rotatie).
create or replace function public.consume_pairing_code(p_code_hash text, p_secret_box text, p_connector_version text)
returns table (site_id uuid, agency_id uuid, secret_version integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_site uuid;
  v_agency uuid;
  v_version int;
begin
  update public.site_credentials c
     set previous_secret_ciphertext = c.secret_ciphertext,
         previous_valid_until = case when c.secret_ciphertext is null then null else now() + interval '10 minutes' end,
         secret_ciphertext = p_secret_box,
         secret_version = c.secret_version + 1,
         pairing_code_hash = null,
         pairing_expires_at = null
   where c.pairing_code_hash = p_code_hash
     and c.pairing_expires_at > now()
  returning c.site_id, c.agency_id, c.secret_version into v_site, v_agency, v_version;
  if v_site is null then
    return;
  end if;
  update public.sites
     set connection_status = 'connected',
         paired_at = now(),
         connector_version = coalesce(p_connector_version, connector_version)
   where id = v_site;
  return query select v_site, v_agency, v_version;
end $$;

-- Slaat één heartbeat atomair op: snapshot, componenten (vervangen) en site-status.
create or replace function public.ingest_heartbeat(p_site uuid, p_snapshot jsonb, p_components jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid;
  v_id bigint;
begin
  select agency_id into v_agency from public.sites where id = p_site and connection_status = 'connected' for update;
  if v_agency is null then
    raise exception 'site_not_connected' using errcode = 'P0001';
  end if;

  insert into public.health_snapshots (agency_id, site_id, captured_at, connector_version, wp_version, php_version,
                                       memory_limit_mb, memory_peak_mb, disk_free_mb, db_size_mb, raw)
  values (v_agency, p_site,
          coalesce((p_snapshot ->> 'captured_at')::timestamptz, now()),
          p_snapshot ->> 'connector_version', p_snapshot ->> 'wp_version', p_snapshot ->> 'php_version',
          (p_snapshot ->> 'memory_limit_mb')::int, (p_snapshot ->> 'memory_peak_mb')::int,
          (p_snapshot ->> 'disk_free_mb')::int, (p_snapshot ->> 'db_size_mb')::numeric,
          coalesce(p_snapshot -> 'raw', '{}'::jsonb))
  returning id into v_id;

  insert into public.site_components (agency_id, site_id, type, slug, name, version, latest_version, update_available, active, updated_at)
  select v_agency, p_site, c ->> 'type', c ->> 'slug', c ->> 'name', c ->> 'version', c ->> 'latest_version',
         coalesce((c ->> 'update_available')::boolean, false), coalesce((c ->> 'active')::boolean, true), now()
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
  on conflict (site_id, type, slug) do update
     set name = excluded.name, version = excluded.version, latest_version = excluded.latest_version,
         update_available = excluded.update_available, active = excluded.active, updated_at = now();

  -- Verwijderde plugins/thema's verdwijnen ook uit Verploy
  delete from public.site_components sc
   where sc.site_id = p_site
     and not exists (select 1 from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
                     where c ->> 'type' = sc.type and c ->> 'slug' = sc.slug);

  update public.sites
     set status = 'online',
         last_heartbeat_at = now(),
         connector_version = p_snapshot ->> 'connector_version',
         wp_version = p_snapshot ->> 'wp_version',
         php_version = p_snapshot ->> 'php_version'
   where id = p_site;

  delete from public.signed_request_nonces where site_id = p_site and created_at < now() - interval '15 minutes';
  return v_id;
end $$;

revoke all on function public.consume_pairing_code(text, text, text), public.ingest_heartbeat(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_pairing_code(text, text, text), public.ingest_heartbeat(uuid, jsonb, jsonb)
  to service_role;

-- ── 10. v1-data overzetten en v1 opruimen ─────────────────────────────────────
do $$
begin
  if to_regclass('public.agencies_v1') is null then
    return;
  end if;

  -- Bestaande bureaus (oprichtersaccount): gratis Scale, zodat niets op slot gaat
  -- voordat Stripe (fase 7) er is.
  insert into public.agencies (id, name, slug, plan_id, plan_status, trial_ends_at, created_at)
  select a.id, a.name, a.slug, 'scale', 'comped', null, a.created_at
    from public.agencies_v1 a;

  insert into public.agency_members (agency_id, user_id, role, created_at)
  select distinct on (m.user_id) m.agency_id, m.user_id, m.role::text, m.joined_at
    from public.agency_members_v1 m
   order by m.user_id, m.joined_at;

  -- Sites: alle v1-keys zijn als gelekt behandeld → opnieuw koppelen via koppelcode
  alter table public.sites disable trigger sites_enforce_limit;
  insert into public.sites (id, agency_id, name, url, client_name, status, connection_status,
                            connector_version, wp_version, php_version, last_heartbeat_at, created_at)
  select s.id, s.agency_id, left(s.name, 120), rtrim(s.url, '/'), s.client_name,
         'pending', 'awaiting_pairing',
         s.connector_version, s.wp_version, s.php_version, s.last_heartbeat_at, s.created_at
    from public.sites_v1 s
   where s.active;
  alter table public.sites enable trigger sites_enforce_limit;

  insert into public.health_snapshots (agency_id, site_id, captured_at, received_at, connector_version,
                                       wp_version, php_version, memory_limit_mb, db_size_mb,
                                       ssl_expires_at, raw)
  select s.agency_id, h.site_id, h.captured_at, h.captured_at, h.raw_data ->> 'connector_version',
         h.wp_version, h.php_version, h.memory_limit_mb, h.db_size_mb, h.ssl_expires_at,
         coalesce(h.raw_data, '{}'::jsonb)
    from public.health_snapshots_v1 h
    join public.sites s on s.id = h.site_id;

  insert into public.site_components (agency_id, site_id, type, slug, name, version, latest_version,
                                      update_available, active, updated_at)
  select s.agency_id, p.site_id, 'plugin', p.slug, p.name, p.version, p.latest_version,
         p.update_available, p.active, p.last_checked_at
    from public.site_plugins_v1 p
    join public.sites s on s.id = p.site_id
  on conflict do nothing;

  drop table if exists public.update_jobs_v1, public.update_runs_v1, public.reports_v1, public.alerts_v1,
    public.site_plugins_v1, public.health_snapshots_v1, public.sites_v1, public.agency_members_v1,
    public.agencies_v1 cascade;

  drop function if exists public.process_heartbeat(text, jsonb) cascade;
  drop function if exists public.agency_at_site_limit(uuid) cascade;
  drop function if exists public.agency_sites_limit(plan_tier) cascade;
  drop function if exists public.is_agency_member(uuid) cascade;
  drop function if exists public.is_agency_owner(uuid) cascade;
  drop function if exists public.my_agency_id() cascade;
  drop function if exists public.set_updated_at() cascade;

  drop type if exists public.plan_tier, public.site_status, public.alert_severity, public.alert_status,
    public.update_run_status, public.report_status, public.member_role cascade;
end $$;

-- ===== 20260925000000_monitoring.sql =====
-- ============================================================================
-- Verploy — fase 3: monitoring en waarschuwingen
--  • SSL- en domeingegevens op sites (door de backend gecontroleerd)
--  • alerts: één open melding per site+type, escalatie, herstel
--  • app.evaluate_site / app.sweep: alle drempelregels op één plek
--  • meldingenwachtrij voor e-mail (claim → versturen → bevestigen/opnieuw)
--  • pg_cron (indien beschikbaar): elke 5 minuten app.sweep()
-- ============================================================================

set check_function_bodies = off;

-- ── 1. SSL/domein op sites (alleen de server schrijft deze kolommen) ─────────
alter table public.sites
  add column ssl_valid         boolean,
  add column ssl_expires_at    timestamptz,
  add column ssl_issuer        text,
  add column ssl_error         text check (ssl_error is null or ssl_error in
                               ('expired','self_signed','hostname_mismatch','untrusted','unreachable')),
  add column ssl_checked_at    timestamptz,
  add column domain_expires_at timestamptz,
  add column domain_error      text check (domain_error is null or domain_error in ('not_published','lookup_failed')),
  add column domain_checked_at timestamptz;

-- ── 2. Alerts ─────────────────────────────────────────────────────────────────
create table public.alerts (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null references public.agencies(id) on delete cascade,
  site_id              uuid not null references public.sites(id) on delete cascade,
  type                 text not null check (type in ('site_offline','ssl_expiring','ssl_invalid','ssl_missing',
                        'domain_expiring','php_eol','memory_low','disk_low','core_update','plugin_updates')),
  severity             text not null check (severity in ('info','warning','critical')),
  status               text not null default 'open' check (status in ('open','resolved')),
  params               jsonb not null default '{}'::jsonb,
  opened_at            timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  acknowledged_at      timestamptz,
  acknowledged_by      uuid references auth.users(id) on delete set null,
  notified_at          timestamptz,           -- melding (e-mail) verstuurd of bewust overgeslagen
  resolved_notified_at timestamptz,           -- herstelmelding (alleen site_offline)
  notify_attempts      integer not null default 0,
  notify_claimed_at    timestamptz
);
create unique index alerts_one_open_per_type on public.alerts(site_id, type) where status = 'open';
create index alerts_agency_status_idx on public.alerts(agency_id, status, opened_at desc);
create index alerts_pending_notify_idx on public.alerts(opened_at) where notified_at is null;

create trigger alerts_agency before insert or update on public.alerts
  for each row execute function app.check_site_agency();

alter table public.alerts enable row level security;
revoke all on public.alerts from anon, authenticated, public;
grant all on public.alerts to service_role;
grant select on public.alerts to authenticated;
create policy alerts_read on public.alerts for select to authenticated
  using ((select app.is_member(agency_id)));

-- ── 3. Alert-helpers ─────────────────────────────────────────────────────────
-- Opent of werkt bij. Escalatie (warning → critical) zet de melding opnieuw klaar.
create or replace function app.raise_alert(p_site uuid, p_agency uuid, p_type text, p_severity text, p_params jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_rank constant jsonb := '{"info":0,"warning":1,"critical":2}';
  v_existing public.alerts%rowtype;
begin
  select * into v_existing from public.alerts where site_id = p_site and type = p_type and status = 'open' for update;
  if not found then
    insert into public.alerts (agency_id, site_id, type, severity, params, notified_at)
    values (p_agency, p_site, p_type, p_severity, coalesce(p_params, '{}'::jsonb),
            case when p_severity = 'info' then now() end);          -- info: alleen in-app
  else
    update public.alerts
       set params = coalesce(p_params, '{}'::jsonb),
           severity = p_severity,
           updated_at = now(),
           -- escalatie: opnieuw melden en bevestiging vervalt
           notified_at = case when (v_rank ->> p_severity)::int > (v_rank ->> v_existing.severity)::int
                               and p_severity <> 'info' then null else notified_at end,
           notify_attempts = case when (v_rank ->> p_severity)::int > (v_rank ->> v_existing.severity)::int then 0 else notify_attempts end,
           acknowledged_at = case when (v_rank ->> p_severity)::int > (v_rank ->> v_existing.severity)::int then null else acknowledged_at end
     where id = v_existing.id
       and (severity <> p_severity or params <> coalesce(p_params, '{}'::jsonb));
  end if;
end $$;

create or replace function app.resolve_alert(p_site uuid, p_type text)
returns void language sql security definer set search_path = '' as $$
  update public.alerts
     set status = 'resolved', resolved_at = now(), updated_at = now(),
         -- alleen een herstelmelding als de openingsmelding ook echt verstuurd is
         resolved_notified_at = case when type = 'site_offline' and notified_at is not null then null else now() end
   where site_id = p_site and type = p_type and status = 'open';
$$;

-- PHP-beveiligingsondersteuning volgens php.net/supported-versions (opgehaald 24-09-2026).
-- Oudere branches dan 8.2 zijn end-of-life.
create or replace function app.php_security_eol(p_version text) returns date
language sql immutable set search_path = '' as $$
  select case
    when p_version is null or p_version !~ '^\d+\.\d+' then null
    when (split_part(p_version, '.', 1))::int < 8 then date '2022-11-28'
    when (split_part(p_version, '.', 1))::int > 8 then null
    else case (split_part(p_version, '.', 2))::int
      when 0 then date '2023-11-26'
      when 1 then date '2025-12-31'
      when 2 then date '2026-12-31'
      when 3 then date '2027-12-31'
      when 4 then date '2028-12-31'
      when 5 then date '2029-12-31'
      else null end
  end;
$$;

-- ── 4. Alle drempelregels (enige bron; zie PLAN.md §6) ───────────────────────
create or replace function app.evaluate_site(p_site uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s    public.sites%rowtype;
  snap public.health_snapshots%rowtype;
  v_eol date;
  v_days int;
  v_updates int;
  v_core public.site_components%rowtype;
begin
  select * into s from public.sites where id = p_site;
  if not found then return; end if;

  -- Niet (meer) gekoppeld: geen meldingen over deze site
  if s.connection_status <> 'connected' then
    update public.alerts set status = 'resolved', resolved_at = now(), updated_at = now(), resolved_notified_at = now()
     where site_id = p_site and status = 'open';
    return;
  end if;

  -- Offline: 45 min geen heartbeat (3 gemiste van 15 min)
  if coalesce(s.last_heartbeat_at, s.paired_at, s.created_at) < now() - interval '45 minutes' then
    perform app.raise_alert(s.id, s.agency_id, 'site_offline', 'critical',
      jsonb_build_object('since', s.last_heartbeat_at));
    update public.sites set status = 'offline' where id = s.id and status <> 'offline';
  else
    perform app.resolve_alert(s.id, 'site_offline');
  end if;

  -- SSL
  if s.url like 'http://%' then
    perform app.raise_alert(s.id, s.agency_id, 'ssl_missing', 'warning', '{}');
    perform app.resolve_alert(s.id, 'ssl_invalid');
    perform app.resolve_alert(s.id, 'ssl_expiring');
  else
    perform app.resolve_alert(s.id, 'ssl_missing');
    if s.ssl_checked_at is not null then
      if s.ssl_valid is false and s.ssl_error is distinct from 'expired' and s.ssl_error is distinct from 'unreachable' then
        perform app.raise_alert(s.id, s.agency_id, 'ssl_invalid', 'critical', jsonb_build_object('error', s.ssl_error));
      else
        perform app.resolve_alert(s.id, 'ssl_invalid');
      end if;
      if s.ssl_expires_at is not null and s.ssl_expires_at < now() + interval '14 days' then
        v_days := greatest(0, floor(extract(epoch from (s.ssl_expires_at - now())) / 86400)::int);
        perform app.raise_alert(s.id, s.agency_id, 'ssl_expiring',
          case when s.ssl_expires_at < now() + interval '3 days' then 'critical' else 'warning' end,
          jsonb_build_object('expires_at', s.ssl_expires_at, 'days', v_days));
      else
        perform app.resolve_alert(s.id, 'ssl_expiring');
      end if;
    end if;
  end if;

  -- Domein (alleen als de registry een verloopdatum publiceert)
  if s.domain_expires_at is not null and s.domain_expires_at < now() + interval '30 days' then
    v_days := greatest(0, floor(extract(epoch from (s.domain_expires_at - now())) / 86400)::int);
    perform app.raise_alert(s.id, s.agency_id, 'domain_expiring',
      case when s.domain_expires_at < now() + interval '7 days' then 'critical' else 'warning' end,
      jsonb_build_object('expires_at', s.domain_expires_at, 'days', v_days));
  else
    perform app.resolve_alert(s.id, 'domain_expiring');
  end if;

  -- PHP end-of-life
  v_eol := app.php_security_eol(s.php_version);
  if v_eol is not null and v_eol < current_date + 180 then
    perform app.raise_alert(s.id, s.agency_id, 'php_eol',
      case when v_eol < current_date then 'critical' else 'warning' end,
      jsonb_build_object('version', substring(s.php_version from '^\d+\.\d+'), 'eol', v_eol));
  else
    perform app.resolve_alert(s.id, 'php_eol');
  end if;

  -- Uit de laatste heartbeat: geheugen en schijf
  -- Laatst ontvangen (id), niet captured_at: de klok van de plugin is niet leidend.
  select * into snap from public.health_snapshots where site_id = s.id order by id desc limit 1;
  if found then
    if snap.memory_limit_mb is not null and snap.memory_limit_mb < 128 then
      perform app.raise_alert(s.id, s.agency_id, 'memory_low',
        case when snap.memory_limit_mb < 64 then 'critical' else 'warning' end,
        jsonb_build_object('mb', snap.memory_limit_mb));
    else
      perform app.resolve_alert(s.id, 'memory_low');
    end if;
    if snap.disk_free_mb is not null and snap.disk_free_mb < 1024 then
      perform app.raise_alert(s.id, s.agency_id, 'disk_low',
        case when snap.disk_free_mb < 256 then 'critical' else 'warning' end,
        jsonb_build_object('mb', snap.disk_free_mb));
    else
      perform app.resolve_alert(s.id, 'disk_low');
    end if;
  end if;

  -- Updates
  select * into v_core from public.site_components where site_id = s.id and type = 'core' and update_available limit 1;
  if found then
    perform app.raise_alert(s.id, s.agency_id, 'core_update', 'warning', jsonb_build_object('version', v_core.latest_version));
  else
    perform app.resolve_alert(s.id, 'core_update');
  end if;
  select count(*) into v_updates from public.site_components
   where site_id = s.id and type in ('plugin','theme') and update_available;
  if v_updates > 0 then
    perform app.raise_alert(s.id, s.agency_id, 'plugin_updates', 'info', jsonb_build_object('count', v_updates));
  else
    perform app.resolve_alert(s.id, 'plugin_updates');
  end if;
end $$;

-- Evalueert alle sites; aangeroepen door pg_cron (elke 5 min) en de onderhouds-cron.
create or replace function public.sweep_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.sites loop
    perform app.evaluate_site(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Heartbeat-ingest: identiek aan fase 2, plus evaluatie aan het EINDE (nadat site-status
-- en componenten zijn bijgewerkt), in dezelfde transactie.
create or replace function public.ingest_heartbeat(p_site uuid, p_snapshot jsonb, p_components jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_agency uuid;
  v_id bigint;
begin
  select agency_id into v_agency from public.sites where id = p_site and connection_status = 'connected' for update;
  if v_agency is null then
    raise exception 'site_not_connected' using errcode = 'P0001';
  end if;

  insert into public.health_snapshots (agency_id, site_id, captured_at, connector_version, wp_version, php_version,
                                       memory_limit_mb, memory_peak_mb, disk_free_mb, db_size_mb, raw)
  values (v_agency, p_site,
          coalesce((p_snapshot ->> 'captured_at')::timestamptz, now()),
          p_snapshot ->> 'connector_version', p_snapshot ->> 'wp_version', p_snapshot ->> 'php_version',
          (p_snapshot ->> 'memory_limit_mb')::int, (p_snapshot ->> 'memory_peak_mb')::int,
          (p_snapshot ->> 'disk_free_mb')::int, (p_snapshot ->> 'db_size_mb')::numeric,
          coalesce(p_snapshot -> 'raw', '{}'::jsonb))
  returning id into v_id;

  insert into public.site_components (agency_id, site_id, type, slug, name, version, latest_version, update_available, active, updated_at)
  select v_agency, p_site, c ->> 'type', c ->> 'slug', c ->> 'name', c ->> 'version', c ->> 'latest_version',
         coalesce((c ->> 'update_available')::boolean, false), coalesce((c ->> 'active')::boolean, true), now()
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
  on conflict (site_id, type, slug) do update
     set name = excluded.name, version = excluded.version, latest_version = excluded.latest_version,
         update_available = excluded.update_available, active = excluded.active, updated_at = now();

  delete from public.site_components sc
   where sc.site_id = p_site
     and not exists (select 1 from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
                     where c ->> 'type' = sc.type and c ->> 'slug' = sc.slug);

  update public.sites
     set status = 'online',
         last_heartbeat_at = now(),
         connector_version = p_snapshot ->> 'connector_version',
         wp_version = p_snapshot ->> 'wp_version',
         php_version = p_snapshot ->> 'php_version'
   where id = p_site;

  delete from public.signed_request_nonces where site_id = p_site and created_at < now() - interval '15 minutes';
  perform app.evaluate_site(p_site);
  return v_id;
end $$;
revoke all on function public.ingest_heartbeat(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_heartbeat(uuid, jsonb, jsonb) to service_role;

-- ── 5. Meldingenwachtrij (e-mail) — alleen service_role ──────────────────────
-- Claimt openstaande meldingen (openen én herstel) met SKIP LOCKED; een claim
-- verloopt na 10 min, zodat een gecrasht proces niets laat liggen.
create or replace function public.claim_alert_notifications(p_limit int default 25)
returns table (
  alert_id uuid, kind text, type text, severity text, params jsonb, opened_at timestamptz,
  site_id uuid, site_name text, site_url text, agency_name text, locale text, recipients text[]
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id, case when a.status = 'open' then 'opened' else 'resolved' end as kind
      from public.alerts a
     where ((a.status = 'open' and a.notified_at is null)
         or (a.status = 'resolved' and a.type = 'site_offline' and a.notified_at is not null and a.resolved_notified_at is null))
       and a.notify_attempts < 5
       and (a.notify_claimed_at is null or a.notify_claimed_at < now() - interval '10 minutes')
     order by a.opened_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), claimed as (
    update public.alerts a set notify_claimed_at = now(), notify_attempts = a.notify_attempts + 1
      from due where a.id = due.id
    returning a.*, due.kind
  )
  select c.id, c.kind, c.type, c.severity, c.params, c.opened_at, s.id, s.name, s.url, ag.name, ag.dashboard_locale,
         array(select u.email::text from public.agency_members m join auth.users u on u.id = m.user_id
                where m.agency_id = c.agency_id and m.role in ('owner','admin') and u.email is not null order by u.email)
    from claimed c
    join public.sites s on s.id = c.site_id
    join public.agencies ag on ag.id = c.agency_id;
end $$;

-- Bevestigt (sent = true) of geeft vrij voor een nieuwe poging (sent = false).
create or replace function public.complete_alert_notification(p_alert uuid, p_kind text, p_sent boolean)
returns void language sql security definer set search_path = '' as $$
  update public.alerts
     set notify_claimed_at = null,
         notified_at = case when p_kind = 'opened' and p_sent then now() else notified_at end,
         resolved_notified_at = case when p_kind = 'resolved' and p_sent then now() else resolved_notified_at end
   where id = p_alert;
$$;

-- Bevestigen in de UI: melding blijft open (de oorzaak bestaat nog), maar verdwijnt uit "nieuw".
create or replace function public.acknowledge_alert(p_alert uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_agency uuid;
begin
  select agency_id into v_agency from public.alerts where id = p_alert;
  if v_agency is null or not app.is_member(v_agency) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.alerts set acknowledged_at = now(), acknowledged_by = (select auth.uid()) where id = p_alert and acknowledged_at is null;
end $$;

-- De server schrijft SSL/domein-resultaten weg en evalueert direct.
create or replace function public.record_site_checks(
  p_site uuid, p_ssl_valid boolean, p_ssl_expires_at timestamptz, p_ssl_issuer text, p_ssl_error text,
  p_domain_expires_at timestamptz, p_domain_error text, p_domain_checked boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.sites
     set ssl_valid = p_ssl_valid, ssl_expires_at = p_ssl_expires_at, ssl_issuer = p_ssl_issuer,
         ssl_error = p_ssl_error, ssl_checked_at = now(),
         domain_expires_at = case when p_domain_checked then p_domain_expires_at else domain_expires_at end,
         domain_error = case when p_domain_checked then p_domain_error else domain_error end,
         domain_checked_at = case when p_domain_checked then now() else domain_checked_at end
   where id = p_site;
  perform app.evaluate_site(p_site);
end $$;

revoke all on function public.sweep_alerts(), public.claim_alert_notifications(int),
  public.complete_alert_notification(uuid, text, boolean), public.acknowledge_alert(uuid),
  public.record_site_checks(uuid, boolean, timestamptz, text, text, timestamptz, text, boolean),
  app.raise_alert(uuid, uuid, text, text, jsonb), app.resolve_alert(uuid, text), app.evaluate_site(uuid),
  app.php_security_eol(text) from public, anon, authenticated;
grant execute on function public.acknowledge_alert(uuid) to authenticated;
grant execute on function public.sweep_alerts(), public.claim_alert_notifications(int),
  public.complete_alert_notification(uuid, text, boolean),
  public.record_site_checks(uuid, boolean, timestamptz, text, text, timestamptz, text, boolean) to service_role;
grant execute on all functions in schema app to service_role;

-- ── 6. Planning: pg_cron als die er is (Supabase), anders via de onderhouds-cron ──
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('verploy-sweep-alerts', '*/5 * * * *', 'select public.sweep_alerts()');
  end if;
end $$;

-- ===== 20260926000000_update_runs.sql =====
-- ============================================================================
-- Verploy — fase 4: veilige updates (kernflow)
--  • testinstellingen per site (extra pagina's, pixel-drempel, te maskeren zones)
--  • update_runs: state machine, één actieve run per site, lease voor de worker
--  • update_run_events: tijdlijn (alleen toevoegen)
--  • test_results: per fase/pagina/viewport de checks, screenshots en pixel-diff
--  • RPC's: create_update_run / cancel_update_run (leden), claim/lease/advance (worker)
--  • storage-bucket run-artifacts (privé; alleen de service role leest en schrijft)
-- ============================================================================

set check_function_bodies = off;

-- ── 1. Testinstellingen per site ──────────────────────────────────────────────
alter table public.sites
  add column test_paths     text[]       not null default '{}'
    check (cardinality(test_paths) <= 5),
  add column test_masks     text[]       not null default '{}'
    check (cardinality(test_masks) <= 10),
  add column diff_threshold numeric(5,4) not null default 0.02
    check (diff_threshold between 0.001 and 0.5);

grant update (test_paths, test_masks, diff_threshold) on public.sites to authenticated;

-- ── 2. Runs ──────────────────────────────────────────────────────────────────
create table public.update_runs (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references public.agencies(id) on delete cascade,
  site_id          uuid not null references public.sites(id) on delete cascade,
  created_by       uuid references auth.users(id) on delete set null,
  status           text not null default 'queued' check (status in (
                     'queued','preparing','baseline','staging_create','staging_baseline','staging_update',
                     'staging_test','deploy_snapshot','deploy_apply','postcheck','rollback','cleanup','done')),
  -- [{type, slug, name, from_version, to_version, result?: {status, version}}]
  items            jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  verdict          text check (verdict in ('deployed','blocked','rolled_back','error','cancelled')),
  -- waarom (blocked/rolled_back/error): i18n-sleutel + parameters
  reason_key       text,
  reason_params    jsonb not null default '{}'::jsonb,
  attempt          int  not null default 0,
  max_attempts     int  not null default 3 check (max_attempts between 1 and 10),
  worker_id        text,
  lease_until      timestamptz,
  not_before       timestamptz not null default now(),
  step_started_at  timestamptz,
  step_state       jsonb not null default '{}'::jsonb,
  cancel_requested boolean not null default false,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now(),
  check ((status = 'done') = (verdict is not null and finished_at is not null))
);
create index update_runs_agency_idx on public.update_runs(agency_id, created_at desc);
create index update_runs_site_idx on public.update_runs(site_id, created_at desc);
create index update_runs_claim_idx on public.update_runs(not_before) where status <> 'done';
-- Eén actieve run per site
create unique index update_runs_one_active on public.update_runs(site_id) where status <> 'done';
create trigger update_runs_touch before update on public.update_runs
  for each row execute function app.touch_updated_at();
create trigger update_runs_agency before insert or update on public.update_runs
  for each row execute function app.check_site_agency();

create table public.update_run_events (
  id         bigint generated always as identity primary key,
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  run_id     uuid not null references public.update_runs(id) on delete cascade,
  step       text not null,
  level      text not null default 'info' check (level in ('info','warning','error')),
  message_key text not null check (message_key ~ '^[a-z0-9_.]+$'),
  params     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index update_run_events_run_idx on public.update_run_events(run_id, id);

create table public.test_results (
  id              bigint generated always as identity primary key,
  agency_id       uuid not null references public.agencies(id) on delete cascade,
  run_id          uuid not null references public.update_runs(id) on delete cascade,
  phase           text not null check (phase in ('production_before','staging_before','staging_after','production_after')),
  page_key        text not null,
  page_label      text not null default '',
  page_url        text not null,
  viewport        text not null check (viewport in ('desktop','mobile')),
  http_status     int,
  load_ms         int,
  passed          boolean not null,
  -- [{check, ok, detail?}] — check ∈ http, php_error, js_errors, resources, landmarks, visual, login
  checks          jsonb not null default '[]'::jsonb,
  js_errors       jsonb not null default '[]'::jsonb,
  -- meetgegevens voor latere vergelijking: fout, PHP-fout, mislukte bestanden, landmarks, tekstlengte …
  facts           jsonb not null default '{}'::jsonb,
  screenshot_path text,
  diff_path       text,
  diff_ratio      numeric(7,6),
  created_at      timestamptz not null default now(),
  unique (run_id, phase, page_key, viewport)
);
create index test_results_run_idx on public.test_results(run_id);

-- agency_id van events/resultaten moet gelijk zijn aan die van de run
create or replace function app.check_run_agency() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.update_runs r where r.id = new.run_id and r.agency_id = new.agency_id) then
    raise exception 'agency_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger update_run_events_agency before insert or update on public.update_run_events
  for each row execute function app.check_run_agency();
create trigger test_results_agency before insert or update on public.test_results
  for each row execute function app.check_run_agency();

-- Een site met een lopende run kan niet worden verwijderd (de staging moet eerst worden opgeruimd)
create or replace function app.protect_site_with_run() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.update_runs r where r.site_id = old.id and r.status <> 'done') then
    raise exception 'run_active' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger sites_protect_run before delete on public.sites
  for each row execute function app.protect_site_with_run();

-- ── 3. RLS: leden lezen, niemand schrijft direct (alleen RPC's en service role) ──
alter table public.update_runs       enable row level security;
alter table public.update_run_events enable row level security;
alter table public.test_results      enable row level security;

revoke all on public.update_runs, public.update_run_events, public.test_results from anon, authenticated, public;
grant all on public.update_runs, public.update_run_events, public.test_results to service_role;
grant select on public.update_runs, public.update_run_events, public.test_results to authenticated;

create policy update_runs_read on public.update_runs for select to authenticated
  using ((select app.is_member(agency_id)));
create policy update_run_events_read on public.update_run_events for select to authenticated
  using ((select app.is_member(agency_id)));
create policy test_results_read on public.test_results for select to authenticated
  using ((select app.is_member(agency_id)));

-- ── 4. RPC's voor het dashboard ──────────────────────────────────────────────

-- Start een run. De server bepaalt de doelversies (uit de laatste heartbeat), niet de browser.
-- p_items: [{type, slug}]
create or replace function public.create_update_run(p_site uuid, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site   public.sites%rowtype;
  v_items  jsonb := '[]'::jsonb;
  v_item   jsonb;
  v_comp   public.site_components%rowtype;
  v_id     uuid;
begin
  select * into v_site from public.sites where id = p_site;
  if v_site.id is null or not app.is_member(v_site.agency_id) then
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
    insert into public.update_runs (agency_id, site_id, created_by, items)
    values (v_site.agency_id, p_site, (select auth.uid()), v_items)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'run_active' using errcode = 'P0001';
  end;
  insert into public.update_run_events (agency_id, run_id, step, message_key, params)
  values (v_site.agency_id, v_id, 'queued', 'run.queued', jsonb_build_object('count', jsonb_array_length(v_items)));
  return v_id;
end $$;

-- Annuleren kan zolang er nog niets op productie is gebeurd.
create or replace function public.cancel_update_run(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.update_runs%rowtype;
begin
  select * into v_run from public.update_runs where id = p_run for update;
  if v_run.id is null or not app.is_member(v_run.agency_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_run.status not in ('queued','preparing','baseline','staging_create','staging_baseline','staging_update','staging_test') then
    raise exception 'not_cancellable' using errcode = 'P0001';
  end if;
  if v_run.status = 'queued' and v_run.worker_id is null then
    -- Nog door geen worker opgepakt: direct afsluiten, er is niets op te ruimen.
    update public.update_runs
       set status = 'done', verdict = 'cancelled', reason_key = 'run.reason.cancelled',
           finished_at = now(), cancel_requested = true
     where id = p_run;
  else
    update public.update_runs set cancel_requested = true where id = p_run;
  end if;
  insert into public.update_run_events (agency_id, run_id, step, message_key)
  values (v_run.agency_id, p_run, v_run.status, 'run.cancel_requested');
end $$;

-- ── 5. RPC's voor de worker (alleen service role) ────────────────────────────

-- Pakt de oudste wachtende run, of een run waarvan de lease verlopen is (worker gecrasht).
-- attempt telt de pogingen voor de huidige stap; advance zet hem op 1 (de lopende poging).
create or replace function public.claim_update_run(p_worker text, p_lease_seconds int default 120)
returns setof public.update_runs
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  select r.id into v_id from public.update_runs r
   where r.status <> 'done'
     and r.not_before <= now()
     and (r.lease_until is null or r.lease_until < now())
   order by r.not_before, r.created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;
  return query
  update public.update_runs r
     set worker_id   = p_worker,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         attempt     = r.attempt + 1,
         started_at  = coalesce(r.started_at, now()),
         step_started_at = coalesce(r.step_started_at, now())
   where r.id = v_id
  returning r.*;
end $$;

-- Verlengt de lease; geeft cancel_requested terug (null = de worker is de run kwijt).
create or replace function public.renew_update_run(p_run uuid, p_worker text, p_lease_seconds int default 120)
returns boolean
language sql security definer set search_path = '' as $$
  update public.update_runs
     set lease_until = now() + make_interval(secs => p_lease_seconds)
   where id = p_run and worker_id = p_worker and status <> 'done'
  returning cancel_requested;
$$;

-- Naar de volgende stap. step_state wordt samengevoegd; bij 'done' zijn verdict en finished_at verplicht.
create or replace function public.advance_update_run(
  p_run uuid, p_worker text, p_status text,
  p_step_state jsonb default '{}'::jsonb,
  p_verdict text default null, p_reason_key text default null, p_reason_params jsonb default '{}'::jsonb,
  p_items jsonb default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.update_runs
     set status          = p_status,
         step_state      = step_state || coalesce(p_step_state, '{}'::jsonb),
         -- de worker die de run vasthoudt, begint direct aan poging 1 van de volgende stap
         attempt         = case when p_status = 'done' then attempt else 1 end,
         step_started_at = now(),
         items           = coalesce(p_items, items),
         verdict         = coalesce(p_verdict, verdict),
         reason_key      = coalesce(p_reason_key, reason_key),
         reason_params   = case when p_reason_key is null then reason_params else coalesce(p_reason_params, '{}'::jsonb) end,
         finished_at     = case when p_status = 'done' then now() else null end,
         worker_id       = case when p_status = 'done' then null else worker_id end,
         lease_until     = case when p_status = 'done' then null else lease_until end
   where id = p_run and worker_id = p_worker and status <> 'done';
  if not found then
    raise exception 'lease_lost' using errcode = 'P0001';
  end if;
end $$;

-- Geeft een run terug aan de wachtrij (tijdelijke fout): opnieuw proberen na p_delay seconden.
create or replace function public.release_update_run(p_run uuid, p_worker text, p_delay_seconds int default 30)
returns void
language sql security definer set search_path = '' as $$
  update public.update_runs
     set worker_id = null, lease_until = null,
         not_before = now() + make_interval(secs => greatest(p_delay_seconds, 0))
   where id = p_run and worker_id = p_worker and status <> 'done';
$$;

revoke all on function public.create_update_run(uuid, jsonb), public.cancel_update_run(uuid),
  public.claim_update_run(text, int), public.renew_update_run(uuid, text, int),
  public.advance_update_run(uuid, text, text, jsonb, text, text, jsonb, jsonb),
  public.release_update_run(uuid, text, int),
  app.check_run_agency(), app.protect_site_with_run() from public, anon, authenticated;
grant execute on function public.create_update_run(uuid, jsonb), public.cancel_update_run(uuid) to authenticated;
grant execute on function public.create_update_run(uuid, jsonb), public.cancel_update_run(uuid),
  public.claim_update_run(text, int), public.renew_update_run(uuid, text, int),
  public.advance_update_run(uuid, text, text, jsonb, text, text, jsonb, jsonb),
  public.release_update_run(uuid, text, int) to service_role;

-- ── 6. Storage: screenshots en diffs (privé; het dashboard serveert ze na een RLS-controle) ──
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('run-artifacts', 'run-artifacts', false, 10485760, array['image/png'])
    on conflict (id) do nothing;
  end if;
end $$;

-- ── 7. Uitkomst van een run → melding (zelfde meldingen + e-mailroute als monitoring) ──
alter table public.alerts drop constraint alerts_type_check;
alter table public.alerts add constraint alerts_type_check check (type in ('site_offline','ssl_expiring','ssl_invalid',
  'ssl_missing','domain_expiring','php_eol','memory_low','disk_low','core_update','plugin_updates',
  'update_blocked','update_rolled_back','update_failed'));

-- Idempotent: dezelfde run opnieuw melden verandert niets.
create or replace function public.record_run_outcome(p_run uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run public.update_runs%rowtype;
  v_params jsonb;
begin
  select * into v_run from public.update_runs where id = p_run;
  if v_run.id is null or v_run.status <> 'done' then
    raise exception 'run_not_done' using errcode = 'P0001';
  end if;
  v_params := jsonb_build_object(
    'run_id', v_run.id, 'reason_key', v_run.reason_key, 'reason_params', v_run.reason_params,
    'items', (select coalesce(jsonb_agg(i->>'name'), '[]'::jsonb) from jsonb_array_elements(v_run.items) i));
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

-- ===== 20260927000000_diagnoses.sql =====
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

-- ===== 20260928000000_reports.sql =====
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

-- ===== 20260929000000_billing.sql =====
-- ============================================================================
-- Verploy — fase 7: abonnementen via Stripe
--  • agencies: periode-einde en "stopt aan einde periode" (alleen de server schrijft)
--  • stripe_events: elke webhook één keer verwerken (idempotent)
--  • apply_stripe_subscription: status uit Stripe → bureau, met bescherming tegen
--    events die in de verkeerde volgorde binnenkomen
--  • past_due blijft schrijfbaar (Stripe probeert nog te incasseren); canceled = alleen-lezen
-- ============================================================================

set check_function_bodies = off;

alter table public.agencies
  add column subscription_period_end        timestamptz,
  add column subscription_cancel_at_end     boolean not null default false,
  add column stripe_synced_at               timestamptz;

create table public.stripe_events (
  id          text primary key,
  type        text not null,
  agency_id   uuid references public.agencies(id) on delete set null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated, public;
grant all on public.stripe_events to service_role;

-- Schrijfbaar = actief, gratis, proefperiode die nog loopt, of een betaling die Stripe nog probeert te innen.
create or replace function app.agency_is_writable(p_agency uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.agencies a
    where a.id = p_agency
      and ( a.plan_status in ('active','comped','past_due')
         or (a.plan_status = 'trialing' and a.trial_ends_at > now()) )
  );
$$;

-- Verwerkt één abonnementsevent. Geeft false terug als het event al verwerkt is of ouder is
-- dan de laatst toegepaste stand (Stripe garandeert geen volgorde).
create or replace function public.apply_stripe_subscription(
  p_event_id text, p_event_type text, p_event_created timestamptz,
  p_agency uuid, p_customer text, p_subscription text, p_price text,
  p_status text, p_period_end timestamptz, p_cancel_at_end boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_agency public.agencies%rowtype;
  v_plan   text;
  v_status text;
begin
  insert into public.stripe_events (id, type, agency_id) values (p_event_id, p_event_type, p_agency)
  on conflict (id) do nothing;
  if not found then return false; end if;

  select * into v_agency from public.agencies where id = p_agency for update;
  if v_agency.id is null then raise exception 'agency_not_found' using errcode = 'P0002'; end if;
  if v_agency.stripe_synced_at is not null and p_event_created < v_agency.stripe_synced_at then
    return false;   -- ouder dan wat we al weten
  end if;
  -- Een bureau hoort bij één Stripe-klant; nooit stilletjes een ander abonnement overnemen.
  if v_agency.stripe_customer_id is not null and p_customer is not null and v_agency.stripe_customer_id <> p_customer then
    raise exception 'customer_mismatch' using errcode = 'P0001';
  end if;

  select p.id into v_plan from public.plans p where p.stripe_price_id = p_price;
  if p_price is not null and v_plan is null then
    raise exception 'unknown_price' using errcode = 'P0001', detail = p_price;
  end if;

  v_status := case
    when p_status in ('active','trialing') then 'active'
    when p_status in ('past_due','unpaid') then 'past_due'
    when p_status in ('canceled','incomplete_expired') then 'canceled'
    else null   -- incomplete / paused: niets veranderen tot de betaling rond is
  end;

  update public.agencies
     set stripe_customer_id         = coalesce(p_customer, stripe_customer_id),
         stripe_subscription_id     = case when v_status = 'canceled' then null else coalesce(p_subscription, stripe_subscription_id) end,
         plan_id                    = coalesce(v_plan, plan_id),
         plan_status                = case when plan_status = 'comped' and v_status is distinct from 'active' then plan_status
                                           else coalesce(v_status, plan_status) end,
         subscription_period_end    = coalesce(p_period_end, subscription_period_end),
         subscription_cancel_at_end = coalesce(p_cancel_at_end, false) and v_status is distinct from 'canceled',
         stripe_synced_at           = p_event_created
   where id = p_agency;
  return true;
end $$;

-- Koppelt een Stripe-klant aan een bureau (bij het starten van de eerste checkout).
create or replace function public.set_stripe_customer(p_agency uuid, p_customer text) returns void
language sql security definer set search_path = '' as $$
  update public.agencies set stripe_customer_id = p_customer where id = p_agency and stripe_customer_id is null;
$$;

create or replace function public.set_plan_price(p_plan text, p_price text) returns void
language sql security definer set search_path = '' as $$
  update public.plans set stripe_price_id = p_price where id = p_plan;
$$;

revoke all on function public.apply_stripe_subscription(text, text, timestamptz, uuid, text, text, text, text, timestamptz, boolean),
  public.set_stripe_customer(uuid, text), public.set_plan_price(text, text) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription(text, text, timestamptz, uuid, text, text, text, text, timestamptz, boolean),
  public.set_stripe_customer(uuid, text), public.set_plan_price(text, text) to service_role;

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values ('20260924000000', 'v2_foundation') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20260925000000', 'monitoring') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20260926000000', 'update_runs') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20260927000000', 'diagnoses') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20260928000000', 'reports') on conflict do nothing;
insert into supabase_migrations.schema_migrations (version, name) values ('20260929000000', 'billing') on conflict do nothing;
notify pgrst, 'reload schema';
commit;
