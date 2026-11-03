#!/usr/bin/env bash
# =============================================================================
# #97 복원 — backup.sh 가 만든 폴더를 새 프로젝트에 되살린다 (담당: 팀장)
#
#   구조에서의 위치: 서버 PC Git Bash → 백업 폴더 → 새 프로젝트의 db · 볼륨 storage · model-storage.
#     복원은 데이터가 없는 프로젝트에만 한다. 데이터가 있거나 실제 서비스(klassic-api)면 멈춘다.
#     실제 서비스를 되살릴 때는 deploy/README.md 「백업 · 복원」의 절차를 사람이 확인하며 따른다.
#   비밀값은 현재 api/.env 를 쓴다. 백업 때와 DB 비밀번호 · 세션 키가 같아야 로그인이 이어진다.
#
#   사용 (api/ 폴더): bash deploy/restore.sh -p <새 프로젝트> -i <백업 폴더>
# =============================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash 가 컨테이너 안 경로(/from)를 Windows 경로로 바꾸지 않게

PROJECT=
INPUT=
while getopts 'p:i:' opt; do
  case "$opt" in
    p) PROJECT=$OPTARG ;;
    i) INPUT=$OPTARG ;;
    *) echo "사용: bash deploy/restore.sh -p <새 프로젝트> -i <백업 폴더>" >&2; exit 2 ;;
  esac
done

[ -f compose.yaml ] || { echo "api/ 폴더에서 실행한다" >&2; exit 2; }
[ -n "$PROJECT" ] && [ -n "$INPUT" ] || { echo "사용: bash deploy/restore.sh -p <새 프로젝트> -i <백업 폴더>" >&2; exit 2; }
[ "$PROJECT" != klassic-api ] || { echo "실제 서비스에는 이 스크립트로 복원하지 않는다" >&2; exit 1; }
[ -f "$INPUT/MANIFEST.txt" ] || { echo "백업 폴더가 아니다: $INPUT" >&2; exit 1; }
case "$INPUT" in *.incomplete*) echo "끝나지 않은 백업이다" >&2; exit 1 ;; esac

for v in db-data storage model-storage; do
  if docker volume inspect "${PROJECT}_$v" >/dev/null 2>&1; then
    echo "${PROJECT}_$v 가 이미 있다 — 새 프로젝트 이름을 쓴다" >&2
    exit 1
  fi
done

COMPOSE=(docker compose -p "$PROJECT" -f compose.yaml)
DB_IMAGE=mariadb:12.0.2

echo "[1/4] 백업 확인"
(cd "$INPUT" && grep -E '^[0-9a-f]{64}' MANIFEST.txt | sha256sum -c --quiet)

echo "[2/4] DB 복원"
"${COMPOSE[@]}" up -d --wait db
gzip -dc "$INPUT/db.sql.gz" | "${COMPOSE[@]}" exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot "$MARIADB_DATABASE"'

restore_volume() {
  local file=$1 vol="${PROJECT}_$2"
  [ -f "$INPUT/$file" ] || { echo "  $file 없음 — 건너뜀"; return; }
  docker volume create "$vol" >/dev/null
  gzip -dc "$INPUT/$file" | docker run --rm -i -v "$vol:/to" "$DB_IMAGE" tar -C /to --numeric-owner -xf -
  echo "  $2 복원"
}

echo "[3/4] 사용자 파일 복원"
restore_volume storage.tar.gz storage
restore_volume model-storage.tar.gz model-storage

echo "[4/4] 행 수 대조"
ROWS=$("${COMPOSE[@]}" exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot -N "$MARIADB_DATABASE" -e "SELECT CONCAT(\"account=\",(SELECT COUNT(*) FROM account),\" score_request=\",(SELECT COUNT(*) FROM score_request),\" upload_file=\",(SELECT COUNT(*) FROM upload_file),\" shared_score=\",(SELECT COUNT(*) FROM shared_score))"')
WANT=$(grep '^rows=' "$INPUT/MANIFEST.txt" | cut -d= -f2-)
echo "  백업: $WANT"
echo "  복원: $ROWS"
[ "$(printf %s "$ROWS" | tr -d '\r')" = "$(printf %s "$WANT" | tr -d '\r')" ] || { echo "행 수가 다르다" >&2; exit 1; }
echo "완료: 프로젝트 $PROJECT. 서비스는 docker compose -p $PROJECT -f compose.yaml up -d --wait 로 띄운다."
