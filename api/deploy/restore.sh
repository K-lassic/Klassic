#!/usr/bin/env bash
# =============================================================================
# #97 복원 — backup.sh 가 만든 폴더를 새 프로젝트에 되살린다 (담당: 팀장)
#
#   구조에서의 위치: 서버 PC Git Bash → 백업 폴더 → 새 프로젝트의 db · 볼륨 storage · model-storage.
#     복원은 데이터가 없는 프로젝트에만 한다. 데이터가 있거나 실제 서비스(klassic-api)면 멈춘다.
#     실제 서비스를 되살릴 때는 deploy/README.md 「백업 · 복원」의 절차를 사람이 확인하며 따른다.
#   비밀값은 현재 api/.env 를 쓴다. 백업 때와 DB 비밀번호 · 세션 키가 같아야 로그인이 이어진다.
#
#   #141 엔진 볼륨: -E <새 볼륨 이름> 을 주면 engines.tar.gz 를 그 볼륨에 풀고 파일 해시 · 링크 목록을 백업과 대조한다.
#     이미 있는 볼륨에는 쓰지 않는다. -p 없이 -E 만 주면 엔진만 복원한다 (실제 서비스의 엔진 볼륨을 잃었을 때).
#     복원한 볼륨은 ENGINES_VOLUME_NAME=<새 볼륨 이름> 으로 model-api 에 붙인다.
#
#   사용 (api/ 폴더): bash deploy/restore.sh -p <새 프로젝트> -i <백업 폴더> [-E <새 엔진 볼륨>]
#                     bash deploy/restore.sh -i <백업 폴더> -E <새 엔진 볼륨>      (엔진만)
# =============================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash 가 컨테이너 안 경로(/from)를 Windows 경로로 바꾸지 않게

PROJECT=
INPUT=
ENGINES_TARGET=
USAGE="사용: bash deploy/restore.sh -p <새 프로젝트> -i <백업 폴더> [-E <새 엔진 볼륨>]  ·  엔진만: -i <백업 폴더> -E <새 엔진 볼륨>"
while getopts 'p:i:E:' opt; do
  case "$opt" in
    p) PROJECT=$OPTARG ;;
    i) INPUT=$OPTARG ;;
    E) ENGINES_TARGET=$OPTARG ;;
    *) echo "$USAGE" >&2; exit 2 ;;
  esac
done

[ -f compose.yaml ] || { echo "api/ 폴더에서 실행한다" >&2; exit 2; }
[ -n "$INPUT" ] && { [ -n "$PROJECT" ] || [ -n "$ENGINES_TARGET" ]; } || { echo "$USAGE" >&2; exit 2; }
[ "$PROJECT" != klassic-api ] || { echo "실제 서비스에는 이 스크립트로 복원하지 않는다" >&2; exit 1; }
[ -f "$INPUT/MANIFEST.txt" ] || { echo "백업 폴더가 아니다: $INPUT" >&2; exit 1; }
case "$INPUT" in *.incomplete*) echo "끝나지 않은 백업이다" >&2; exit 1 ;; esac

if [ -n "$PROJECT" ]; then
  for v in db-data storage model-storage; do
    if docker volume inspect "${PROJECT}_$v" >/dev/null 2>&1; then
      echo "${PROJECT}_$v 가 이미 있다 — 새 프로젝트 이름을 쓴다" >&2
      exit 1
    fi
  done
fi
if [ -n "$ENGINES_TARGET" ]; then
  [ -f "$INPUT/engines.tar.gz" ] || { echo "엔진이 없는 백업이다 — backup.sh -e 로 만든 백업이 필요하다" >&2; exit 1; }
  # 덮어쓰기 금지 — 있는 볼륨(실제 klassic_engines 포함)에는 절대 풀지 않는다
  if docker volume inspect "$ENGINES_TARGET" >/dev/null 2>&1; then
    echo "엔진 볼륨 $ENGINES_TARGET 가 이미 있다 — 새 이름을 쓴다" >&2
    exit 1
  fi
  # #141 리뷰 P2 — 새 프로젝트의 DB · 파일 볼륨과 같은 이름이면 그 볼륨에 엔진을 풀게 된다
  if [ -n "$PROJECT" ]; then
    for v in db-data storage model-storage; do
      if [ "$ENGINES_TARGET" = "${PROJECT}_$v" ]; then
        echo "엔진 볼륨 $ENGINES_TARGET 는 프로젝트 볼륨 ${PROJECT}_$v 와 같다 — 다른 이름을 쓴다" >&2
        exit 1
      fi
    done
  fi
fi

COMPOSE=(docker compose -p "$PROJECT" -f compose.yaml)
DB_IMAGE=mariadb:12.0.2

echo "[1/4] 백업 확인"
(cd "$INPUT" && grep -E '^[0-9a-f]{64}' MANIFEST.txt | sha256sum -c --quiet)

# #141 엔진 볼륨 — 새 볼륨에 풀고, 백업 때의 해시 · 링크 목록과 같은지 본다
restore_engines() {
  echo "[엔진] $ENGINES_TARGET 에 복원 — 몇 분 걸린다"
  # #141 리뷰 P2 — 시작 검사 뒤에 같은 이름의 볼륨이 생겼으면 docker volume create 가 그 볼륨을 돌려주므로 여기서 다시 막는다
  if docker volume inspect "$ENGINES_TARGET" >/dev/null 2>&1; then
    echo "엔진 볼륨 $ENGINES_TARGET 가 복원 직전에 생겼다 — 쓰지 않는다" >&2
    exit 1
  fi
  docker volume create "$ENGINES_TARGET" >/dev/null
  gzip -dc "$INPUT/engines.tar.gz" | docker run --rm -i -v "$ENGINES_TARGET:/to" "$DB_IMAGE" tar -C /to --numeric-owner -xf -
  docker run --rm -v "$ENGINES_TARGET:/from:ro" -w /from "$DB_IMAGE" sh -c 'find . -type f -print0 | sort -z | xargs -0 sha256sum' \
    | cmp -s - <(tr -d '\r' < "$INPUT/engines.sha256") || { echo "엔진 파일 해시가 백업과 다르다 — $ENGINES_TARGET 를 쓰지 않는다" >&2; exit 1; }
  docker run --rm -v "$ENGINES_TARGET:/from:ro" -w /from "$DB_IMAGE" sh -c 'find . -type l -printf "%p -> %l\n" | sort' \
    | cmp -s - <(tr -d '\r' < "$INPUT/engines.links") || { echo "엔진 링크 목록이 백업과 다르다 — $ENGINES_TARGET 를 쓰지 않는다" >&2; exit 1; }
  echo "  엔진: 파일 $(wc -l < "$INPUT/engines.sha256") · 링크 $(wc -l < "$INPUT/engines.links") — 백업과 같다"
  echo "  model-api 에 붙이기: ENGINES_VOLUME_NAME=$ENGINES_TARGET"
}

if [ -z "$PROJECT" ]; then
  restore_engines
  echo "완료: 엔진 볼륨 $ENGINES_TARGET"
  exit 0
fi

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

[ -z "$ENGINES_TARGET" ] || restore_engines

echo "[4/4] 행 수 대조"
ROWS=$("${COMPOSE[@]}" exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot -N "$MARIADB_DATABASE" -e "SELECT CONCAT(\"account=\",(SELECT COUNT(*) FROM account),\" score_request=\",(SELECT COUNT(*) FROM score_request),\" upload_file=\",(SELECT COUNT(*) FROM upload_file),\" shared_score=\",(SELECT COUNT(*) FROM shared_score))"')
WANT=$(grep '^rows=' "$INPUT/MANIFEST.txt" | cut -d= -f2-)
echo "  백업: $WANT"
echo "  복원: $ROWS"
[ "$(printf %s "$ROWS" | tr -d '\r')" = "$(printf %s "$WANT" | tr -d '\r')" ] || { echo "행 수가 다르다" >&2; exit 1; }
echo "완료: 프로젝트 $PROJECT. 서비스는 docker compose -p $PROJECT -f compose.yaml up -d --wait 로 띄운다."
