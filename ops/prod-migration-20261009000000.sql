-- Verploy — productiemigratie 20261009000000 (artifacts_jpeg). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen.
begin;
do $$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '20261009000000') then raise exception 'migratie 20261009000000 is al toegepast'; end if; end $$;
-- Screenshots van afgeronde runs worden JPEG (kleiner); de bucket moet dat type ook toestaan.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg'] where id = 'run-artifacts';
  end if;
end $$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261009000000', 'artifacts_jpeg');
notify pgrst, 'reload schema';
commit;
