#!/usr/bin/env bash
LOGDIR="${LOGDIR:-/tmp/verploy-local}"
for s in gateway postgrest auth; do [ -f "$LOGDIR/$s.pid" ] && kill "$(cat "$LOGDIR/$s.pid")" 2>/dev/null; rm -f "$LOGDIR/$s.pid"; done
echo "[local-supabase] gestopt (Postgres blijft draaien)"
