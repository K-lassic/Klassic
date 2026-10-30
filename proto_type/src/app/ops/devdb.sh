#!/usr/bin/env bash
# 개발·시험용 로컬 MariaDB (팀 DB 가 아님). 2026-10-02 부터 운영 서비스는 팀 DB(ABC10pioneer3)를 쓴다 — 이 DB 는 시험·개발용.
#   데이터: app/.devdb/data   소켓: app/.devdb/mysqld.sock   포트: 127.0.0.1:${DEVDB_PORT:-26133}
#   사용: bash ops/devdb.sh start | stop | status | reset | sql [DB]
# 팀 DB(ABC10pioneer3)에 적용할 때는 이 스크립트가 아니라 `npm run db:migrate`(.env 의 DB_*)를 쓴다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$HERE/.devdb"
DATA="$ROOT/data"
SOCK="$ROOT/mysqld.sock"
PORT="${DEVDB_PORT:-26133}"
BIN="${MARIADB_BIN:-/opt/homebrew/opt/mariadb/bin}"

start() {
  mkdir -p "$ROOT"
  if [ ! -d "$DATA/mysql" ]; then
    "$BIN/mariadb-install-db" --datadir="$DATA" --auth-root-authentication-method=socket \
      --skip-test-db >/dev/null
  fi
  if [ -S "$SOCK" ] && "$BIN/mariadb-admin" --socket="$SOCK" -u"$(whoami)" ping >/dev/null 2>&1; then
    echo "devdb already running (port $PORT)"
  else
  "$BIN/mariadbd" --datadir="$DATA" --socket="$SOCK" --port="$PORT" --bind-address=127.0.0.1 \
    --pid-file="$ROOT/mysqld.pid" --log-error="$ROOT/error.log" \
    --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci \
    --default-time-zone='+00:00' >/dev/null 2>&1 &
  for _ in $(seq 1 40); do
    "$BIN/mariadb-admin" --socket="$SOCK" -u"$(whoami)" ping >/dev/null 2>&1 && break
    sleep 0.25
  done
  fi
  # 개발용 계정: 앱·시험이 TCP 로 접속한다. 비밀번호는 개발용 고정값이며 팀 DB 와 무관하다.
  "$BIN/mariadb" --socket="$SOCK" -u"$(whoami)" <<SQL
CREATE USER IF NOT EXISTS 'gugak_dev'@'127.0.0.1' IDENTIFIED BY 'gugak_dev';
CREATE DATABASE IF NOT EXISTS gugak_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS gugak_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON gugak_dev.* TO 'gugak_dev'@'127.0.0.1';
GRANT ALL PRIVILEGES ON gugak_test.* TO 'gugak_dev'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`gugak_t%\`.* TO 'gugak_dev'@'127.0.0.1';
SQL
  echo "devdb started on 127.0.0.1:$PORT (user gugak_dev / db gugak_dev, gugak_test)"
}

stop() {
  if [ -f "$ROOT/mysqld.pid" ]; then
    "$BIN/mariadb-admin" --socket="$SOCK" -u"$(whoami)" shutdown 2>/dev/null || kill "$(cat "$ROOT/mysqld.pid")" || true
    echo "devdb stopped"
  else
    echo "devdb not running"
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  status) "$BIN/mariadb-admin" --socket="$SOCK" -u"$(whoami)" ping 2>/dev/null || echo "devdb not running" ;;
  reset) stop; rm -rf "$DATA"; start ;;
  sql) exec "$BIN/mariadb" --socket="$SOCK" -u"$(whoami)" --default-character-set=utf8mb4 "${2:-gugak_dev}" ;;
  *) echo "usage: $0 start|stop|status|reset|sql [db]"; exit 2 ;;
esac
