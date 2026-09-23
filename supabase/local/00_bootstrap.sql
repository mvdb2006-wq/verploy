set client_min_messages = warning;
-- Lokale Supabase-compatibele basis voor ontwikkeling en tests.
-- Bootst de rollen en schema's na die het supabase/postgres-image aanmaakt,
-- zodat de echte migraties + RLS-policies ongewijzigd lokaal getest worden.
-- NIET op productie draaien: Supabase heeft dit daar al.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password 'authenticator-local'; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login noinherit createrole password 'auth-admin-local'; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin login noinherit createrole password 'storage-admin-local'; end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, postgres;
alter role supabase_auth_admin set search_path = auth;

create schema if not exists storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role, postgres;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase-standaard: nieuwe objecten in public krijgen ALLE rechten voor anon,
-- authenticated en service_role. Migraties moeten dus zelf intrekken wat niet mag;
-- de RLS-tests bewijzen dat ze dat doen.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

-- Zelfde default als Supabase: search_path met extensions
alter database postgres set search_path = "$user", public, extensions;
