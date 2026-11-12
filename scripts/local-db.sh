#!/usr/bin/env bash
# Starts a throwaway local Postgres for tests and applies the Supabase shim + real migrations.
# Usage: scripts/local-db.sh [start|stop|reset]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl || echo /usr/lib/postgresql/16/bin/pg_ctl)")}"
DATA="${SIGNFLOW_PGDATA:-/tmp/signflow-pg}"
PORT="${SIGNFLOW_PGPORT:-54329}"
RUN=""; if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; fi
cmd="${1:-start}"
if [ "$cmd" = "stop" ] || [ "$cmd" = "reset" ]; then
  $RUN "$PGBIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1 || true
  [ "$cmd" = "reset" ] && rm -rf "$DATA"
  [ "$cmd" = "stop" ] && exit 0
fi
if [ ! -d "$DATA" ]; then
  mkdir -p "$DATA"; [ -n "$RUN" ] && chown postgres "$DATA"
  $RUN "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
fi
if ! $RUN "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  $RUN "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" -l "$DATA/log.txt" -w start >/dev/null
fi
URL="postgres://postgres@127.0.0.1:$PORT"
psql "$URL/postgres" -qAt -c "drop database if exists signflow_test" -c "create database signflow_test" >/dev/null
psql "$URL/signflow_test" -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/support/supabase-shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do psql "$URL/signflow_test" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
echo "$URL/signflow_test"
