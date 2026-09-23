#!/usr/bin/env bash
# Start een lokale Supabase-compatibele stack: Postgres 16 + GoTrue + PostgREST + gateway.
# Vereist: LOCAL_SB_BIN (map met `auth`, `postgrest` en GoTrue `migrations/`), Postgres-binaries.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${LOCAL_SB_BIN:?zet LOCAL_SB_BIN naar de map met auth + postgrest}"
: "${PGDATA_DIR:=/home/claude/pgdata/db}"
: "${PG_PORT:=54322}"
: "${PG_HOST:=/tmp}"
: "${PG_DB:=verploy_dev}"
export LOCAL_JWT_SECRET="${LOCAL_JWT_SECRET:-local-dev-jwt-secret-please-change-0123456789}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | tail -1)"
LOGDIR="${LOGDIR:-/tmp/verploy-local}"; mkdir -p "$LOGDIR"

if ! su postgres -c "$PGBIN/pg_ctl -D $PGDATA_DIR status" >/dev/null 2>&1; then
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA_DIR -o '-p $PG_PORT -k /tmp' -l $LOGDIR/postgres.log start" >/dev/null
fi
if ! psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -tAc "select 1 from pg_database where datname = '$PG_DB'" | grep -q 1; then
  "$HERE/reset-db.sh" "$PG_DB"
fi

DB="postgres://supabase_auth_admin:auth-admin-local@127.0.0.1:$PG_PORT/$PG_DB?sslmode=disable"
GOTRUE_ENV=(GOTRUE_DB_DRIVER=postgres DATABASE_URL="$DB" GOTRUE_DB_MIGRATIONS_PATH="$LOCAL_SB_BIN/migrations" \
  GOTRUE_JWT_SECRET="$LOCAL_JWT_SECRET" API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 GOTRUE_SITE_URL="${SITE_URL:-http://127.0.0.1:3000}")
( cd "$LOCAL_SB_BIN" && env "${GOTRUE_ENV[@]}" ./auth migrate > "$LOGDIR/auth-migrate.log" 2>&1 ) || { cat "$LOGDIR/auth-migrate.log"; exit 1; }
pushd "$LOCAL_SB_BIN" >/dev/null
env "${GOTRUE_ENV[@]}" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_URI_ALLOW_LIST="${SITE_URL:-http://127.0.0.1:3000}/**" \
  GOTRUE_API_HOST=127.0.0.1 PORT=9999 GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=false GOTRUE_LOG_LEVEL=warn \
  setsid ./auth serve > "$LOGDIR/auth.log" 2>&1 < /dev/null &
echo $! > "$LOGDIR/auth.pid"
popd >/dev/null

# Wacht tot GoTrue zijn migraties heeft gedraaid (auth.users bestaat)
for i in $(seq 1 60); do
  psql -h "$PG_HOST" -p "$PG_PORT" -U postgres -d "$PG_DB" -tAc "select to_regclass('auth.users') is not null" | grep -q t && break; sleep 0.5
done

PGRST_DB_URI="postgres://authenticator:authenticator-local@127.0.0.1:$PG_PORT/$PG_DB" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$LOCAL_JWT_SECRET" \
PGRST_SERVER_PORT=3001 PGRST_SERVER_HOST=127.0.0.1 PGRST_DB_CHANNEL_ENABLED=true \
  setsid "$LOCAL_SB_BIN/postgrest" > "$LOGDIR/postgrest.log" 2>&1 < /dev/null & echo $! > "$LOGDIR/postgrest.pid"

setsid node "$HERE/gateway.mjs" > "$LOGDIR/gateway.log" 2>&1 < /dev/null & echo $! > "$LOGDIR/gateway.pid"
sleep 1
node "$HERE/keys.mjs" > "$LOGDIR/keys.env"
echo "[local-supabase] klaar: http://127.0.0.1:54321  (keys in $LOGDIR/keys.env)"
