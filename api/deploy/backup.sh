#!/usr/bin/env bash
# =============================================================================
# #97 백업 — DB · 사용자 파일을 한 폴더에 모은다 (담당: 팀장)
#
#   구조에서의 위치: 서버 PC Git Bash → docker compose → db 컨테이너(mariadb-dump) · 볼륨 storage · model-storage
#     → 백업 폴더(기본 D:\klassic-backup\<시각>\). 서비스 · 볼륨은 바꾸지 않는다 (읽기 전용).
#   담는 것: db.sql.gz · storage.tar.gz · model-storage.tar.gz · MANIFEST.txt(해시 · 판본 · 행 수)
#   담지 않는 것: api/.env 비밀값 · 엔진 볼륨(다시 만들 수 있음) · 음원(저장소에 있음)
#   비밀번호는 컨테이너 안 환경변수로만 쓴다 — 명령줄 · 파일 이름 · 출력에 나오지 않는다.
#   자동 실행은 하지 않는다. 사람이 필요한 때 실행한다 (deploy/README.md 「백업 · 복원」).
#
#   사용 (api/ 폴더): bash deploy/backup.sh [-p 프로젝트] [-o 백업 위치]
# =============================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash 가 컨테이너 안 경로(/from)를 Windows 경로로 바꾸지 않게

PROJECT=klassic-api
OUT_ROOT=/d/klassic-backup
while getopts 'p:o:' opt; do
  case "$opt" in
    p) PROJECT=$OPTARG ;;
    o) OUT_ROOT=$OPTARG ;;
    *) echo "사용: bash deploy/backup.sh [-p 프로젝트] [-o 백업 위치]" >&2; exit 2 ;;
  esac
done

[ -f compose.yaml ] || { echo "api/ 폴더에서 실행한다" >&2; exit 2; }
COMPOSE=(docker compose -p "$PROJECT" -f compose.yaml)
DB_IMAGE=mariadb:12.0.2

"${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx db || { echo "$PROJECT 의 db 가 실행 중이 아니다" >&2; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
DEST="$OUT_ROOT/$STAMP"
WORK="$DEST.incomplete"     # 끝까지 성공해야 이름을 바꾼다 — 중간에 멈춘 백업을 믿지 않게
mkdir -p "$WORK"

echo "[1/4] DB 백업"
"${COMPOSE[@]}" exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb-dump -uroot --single-transaction --routines --triggers --events --hex-blob "$MARIADB_DATABASE"' \
  | gzip -c > "$WORK/db.sql.gz"
gzip -t "$WORK/db.sql.gz"
# mariadb-dump 는 다 끝나면 마지막 줄에 완료 표시를 남긴다 — 도중에 끊긴 덤프를 잡는다
gzip -dc "$WORK/db.sql.gz" | tail -1 | grep -q 'Dump completed' || { echo "DB 덤프가 끝까지 쓰이지 않았다" >&2; exit 1; }

backup_volume() {
  local name=$1 file=$2 vol="${PROJECT}_$1"
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    echo "  $vol 없음 — 건너뜀"
    return
  fi
  docker run --rm -v "$vol:/from:ro" "$DB_IMAGE" tar -C /from --numeric-owner -cf - . | gzip -c > "$WORK/$file"
  gzip -t "$WORK/$file"
  echo "  $name: $(gzip -dc "$WORK/$file" | tar -tf - | grep -vc '/$') 파일"
}

echo "[2/4] 사용자 파일 백업"
backup_volume storage storage.tar.gz
backup_volume model-storage model-storage.tar.gz

echo "[3/4] 기록"
ROWS=$("${COMPOSE[@]}" exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot -N "$MARIADB_DATABASE" -e "SELECT CONCAT(\"account=\",(SELECT COUNT(*) FROM account),\" score_request=\",(SELECT COUNT(*) FROM score_request),\" upload_file=\",(SELECT COUNT(*) FROM upload_file),\" shared_score=\",(SELECT COUNT(*) FROM shared_score))"')
{
  echo "created_at=$STAMP"
  echo "project=$PROJECT"
  echo "git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "db_image=$DB_IMAGE"
  echo "rows=$ROWS"
  (cd "$WORK" && sha256sum ./*.gz)
} > "$WORK/MANIFEST.txt"

echo "[4/4] 확인"
(cd "$WORK" && grep -E '^[0-9a-f]{64}' MANIFEST.txt | sha256sum -c --quiet)
mv "$WORK" "$DEST"
echo "완료: $DEST"
du -sh "$DEST" | cut -f1
echo "복원에는 api/.env 도 필요하다. 이 백업에는 들어 있지 않다."
