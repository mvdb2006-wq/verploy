-- Verploy — productiemigratie 20261007000100 (update_intel_grant). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261007000100') then raise exception 'migratie 20261007000100 is al toegepast'; end if; end $$;
-- De worker (service role) leest update_intel bij de geplande updates. In productie krijgt de service role
-- geen standaardrechten op nieuwe tabellen; lokaal wel (daardoor miste de test dit).
grant select on public.update_intel to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261007000100', 'update_intel_grant');
notify pgrst, 'reload schema';
commit;
