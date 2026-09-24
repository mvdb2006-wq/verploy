#!/usr/bin/env bash
# Bouwt ops/prod-migration-<versie>.sql: één losse migratie als transactie, inclusief registratie in
# supabase_migrations.schema_migrations. Voor de SQL Editor van Supabase (zonder CLI of DB-wachtwoord).
# Gebruik: ops/build-prod-migration.sh 20260930000000
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:?versie, bijv. 20260930000000}"
F=$(ls supabase/migrations/"${V}"_*.sql)
NAME=$(basename "$F" .sql); NAME=${NAME#*_}
OUT="ops/prod-migration-${V}.sql"
{
  echo "-- Verploy — productiemigratie ${V} (${NAME}). Gegenereerd door ops/build-prod-migration.sh; niet met de hand wijzigen."
  echo "begin;"
  echo "do \$\$ begin if exists (select 1 from supabase_migrations.schema_migrations where version = '${V}') then raise exception 'migratie ${V} is al toegepast'; end if; end \$\$;"
  cat "$F"
  echo
  echo "insert into supabase_migrations.schema_migrations (version, name) values ('${V}', '${NAME}');"
  echo "notify pgrst, 'reload schema';"
  echo "commit;"
} > "$OUT"
echo "$OUT: $(wc -c < "$OUT") bytes"
