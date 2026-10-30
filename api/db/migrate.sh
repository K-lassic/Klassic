#!/bin/sh
# =============================================================================
# #17 마이그레이션 실행기 — api/db/migrations/*.sql 을 이름 순서대로 한 번씩 적용한다.
#
#   - deploy/compose.yaml 의 migrate 서비스(mariadb:12.0.2 이미지)가 db 가 healthy 가 된 뒤 한 번 실행한다.
#   - 적용한 파일은 schema_migration 표에 남기고, 다음 실행에서는 건너뛴다 (v0.1.1 과 같은 표 이름 · 모양).
#   - 파일 이름은 YYYYMMDD_HHMM_<설명>.sql 만 받는다 (두 사람이 동시에 만들어도 겹치지 않게 — db/README.md).
#   - 비밀번호는 명령줄에 넣지 않고 MYSQL_PWD 로만 넘긴다 (ps · 로그에 남지 않게).
#   - DDL 은 트랜잭션으로 되돌릴 수 없다 — 파일 하나가 중간에 실패하면 기록을 남기지 않고 멈춘다.
#     그때는 DB 상태를 확인하고 고친 뒤 다시 실행한다.
# =============================================================================
set -eu

: "${DB_HOST:?DB_HOST 가 필요합니다}"
: "${DB_NAME:?DB_NAME 이 필요합니다}"
: "${DB_USER:?DB_USER 가 필요합니다}"
: "${DB_PASSWORD:?DB_PASSWORD 가 필요합니다}"
DB_PORT="${DB_PORT:-3306}"
DIR="${MIGRATIONS_DIR:-/db/migrations}"

export MYSQL_PWD="$DB_PASSWORD"

# 모든 연결은 UTC · utf8mb4 (v0.1.1 과 같음)
# 같은 compose 내부망 접속이라 서버 인증서 확인은 끈다 (켜 두면 매 연결마다 경고만 나온다)
sql() {
  mariadb --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --default-character-set=utf8mb4 \
    --skip-ssl-verify-server-cert \
    --init-command="SET time_zone = '+00:00'" "$DB_NAME" "$@"
}

sql -e "CREATE TABLE IF NOT EXISTS schema_migration (
          file_name  VARCHAR(200) NOT NULL PRIMARY KEY,
          applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) DEFAULT CHARSET=utf8mb4"

# 적용 기록이 없는데 스키마가 이미 있으면(손으로 만든 DB) 기준 파일을 다시 돌리지 않고 멈춘다
recorded=$(sql -N -e "SELECT COUNT(*) FROM schema_migration")
if [ "$recorded" = "0" ]; then
  existing=$(sql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'score_request'")
  if [ "$existing" != "0" ]; then
    echo "이 DB 에는 이미 스키마가 있는데 적용 기록(schema_migration)이 없습니다. 어느 DB 인지 확인하세요." >&2
    exit 1
  fi
fi

applied=0
for f in "$DIR"/*.sql; do
  [ -e "$f" ] || continue
  name=$(basename "$f")

  # 이름 규칙 확인 — 따옴표 같은 문자가 SQL 에 섞이지 않는 것도 여기서 보장된다
  if ! echo "$name" | grep -Eq '^[0-9]{8}_[0-9]{4}_[A-Za-z0-9._-]+\.sql$'; then
    echo "파일 이름 규칙(YYYYMMDD_HHMM_설명.sql)에 맞지 않습니다: $name" >&2
    exit 1
  fi

  done_already=$(sql -N -e "SELECT COUNT(*) FROM schema_migration WHERE file_name = '$name'")
  [ "$done_already" = "0" ] || continue

  echo "적용: $name"
  sql < "$f"
  sql -e "INSERT INTO schema_migration (file_name) VALUES ('$name')"
  applied=$((applied + 1))
done

echo "마이그레이션 완료 — 이번에 적용 $applied 개"
