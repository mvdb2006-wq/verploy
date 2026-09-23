#!/usr/bin/env bash
# Maakt database $1 (standaard verploy_test) opnieuw aan: Supabase-bootstrap,
# GoTrue-auth-schema en alle migraties uit supabase/migrations, in volgorde.
set -euo pipefail
DB="${1:-verploy_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${LOCAL_SB_BIN:?zet LOCAL_SB_BIN naar de map met de GoTrue-binary + migrations}"
: "${PG_PORT:=54322}"
: "${PG_HOST:=/tmp}"
P=(psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -q -v ON_ERROR_STOP=1)
"${P[@]}" -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null
"${P[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>/dev/null
"${P[@]}" -d "$DB" -f "$HERE/00_bootstrap.sql"
"${P[@]}" -d "$DB" -c "alter database $DB set search_path = \"\$user\", public, extensions"
( cd "$LOCAL_SB_BIN" && GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://supabase_auth_admin:auth-admin-local@127.0.0.1:$PG_PORT/$DB?sslmode=disable" \
  GOTRUE_DB_MIGRATIONS_PATH="$LOCAL_SB_BIN/migrations" GOTRUE_JWT_SECRET=reset-db-placeholder-secret-0123456789 \
  API_EXTERNAL_URL=http://localhost GOTRUE_SITE_URL=http://localhost ./auth migrate > /tmp/reset-db-auth.log 2>&1 ) \
  || { cat /tmp/reset-db-auth.log; exit 1; }
for f in "$HERE"/../migrations/*.sql; do
  "${P[@]}" -d "$DB" -1 -f "$f"
done
echo "[reset-db] $DB klaar ($(ls "$HERE"/../migrations/*.sql | wc -l) migratie(s))"
