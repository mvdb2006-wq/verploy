-- Screenshots van afgeronde runs worden JPEG (kleiner); de bucket moet dat type ook toestaan.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg'] where id = 'run-artifacts';
  end if;
end $$;
