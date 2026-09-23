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
