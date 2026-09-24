#!/usr/bin/env bash
# Bouwt ops/prod-upgrade-v2.sql: één transactie die (1) een reservekopie van de v1-tabellen maakt
# in schema backup_v1, (2) alle migraties uit supabase/migrations toepast en (3) ze registreert in
# supabase_migrations.schema_migrations, zodat `supabase db push` ze later niet opnieuw draait.
# Bedoeld voor de SQL Editor van Supabase (daar is geen CLI/DB-wachtwoord nodig).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=ops/prod-upgrade-v2.sql
{
  echo "-- Verploy v2 — productie-upgrade. Gegenereerd door ops/build-prod-upgrade.sh; niet met de hand wijzigen."
  echo "begin;"
  cat <<'EOF'
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
EOF
  for f in supabase/migrations/*.sql; do printf '\n-- ===== %s =====\n' "$(basename "$f")"; cat "$f"; done
  echo
  echo "create schema if not exists supabase_migrations;"
  echo "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
  for f in supabase/migrations/*.sql; do
    b=$(basename "$f" .sql); echo "insert into supabase_migrations.schema_migrations (version, name) values ('${b%%_*}', '${b#*_}') on conflict do nothing;"
  done
  echo "notify pgrst, 'reload schema';"
  echo "commit;"
} > "$OUT"
echo "$OUT: $(wc -c < "$OUT") bytes"
