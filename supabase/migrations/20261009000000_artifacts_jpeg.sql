-- Screenshots van afgeronde runs worden JPEG (kleiner); de bucket moet dat type ook toestaan.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg'] where id = 'run-artifacts';
  end if;
end $$;
