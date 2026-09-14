#!/usr/bin/env bash
# Local Postgres + Redis without Docker, for environments where Docker is unavailable.
# Prefer `docker compose up -d` if you have Docker; this is the fallback.
set -euo pipefail

PG_DATA=${PG_DATA:-/var/lib/postgresql/data}
PG_BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -1)

start() {
  redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes --port 6379 --save '' --appendonly no
  if ! pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -l /tmp/pg.out start"
    sleep 2
  fi
  redis-cli ping
  pg_isready -h 127.0.0.1 -p 5432
}

stop() {
  redis-cli shutdown nosave 2>/dev/null || true
  su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA stop" 2>/dev/null || true
}

case "${1:-up}" in
  up) start ;;
  down) stop ;;
  *) echo "usage: $0 {up|down}"; exit 1 ;;
esac
