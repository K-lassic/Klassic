#!/usr/bin/env bash
# =============================================================================
# #97 백업 — DB · 사용자 파일을 한 폴더에 모은다 (담당: 팀장)
#
#   구조에서의 위치: 서버 PC Git Bash → docker compose → db 컨테이너(mariadb-dump) · 볼륨 storage · model-storage
#     → 백업 폴더(기본 D:\klassic-backup\<시각>\). 서비스 · 볼륨은 바꾸지 않는다 (읽기 전용).
#   담는 것: db.sql.gz · storage.tar.gz · model-storage.tar.gz · MANIFEST.txt(해시 · 판본 · 행 수)
#     -e 를 주면 엔진 볼륨도 담는다 (#141): engines.tar.gz · engines.sha256(파일 해시 목록) · engines.links(링크 목록).
#     엔진은 약 6GB 라 기본으로는 담지 않는다. 엔진 볼륨은 프로젝트 밖 외부 볼륨이라 이름(-E, 기본 klassic_engines)으로 고른다.
#   담지 않는 것: api/.env 비밀값 · 음원(저장소에 있음)
#   비밀번호는 컨테이너 안 환경변수로만 쓴다 — 명령줄 · 파일 이름 · 출력에 나오지 않는다.
#   자동 실행은 하지 않는다. 사람이 필요한 때 실행한다 (deploy/README.md 「백업 · 복원」).
#
#   사용 (api/ 폴더): bash deploy/backup.sh [-p 프로젝트] [-o 백업 위치] [-e [-E 엔진 볼륨]]
# =============================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash 가 컨테이너 안 경로(/from)를 Windows 경로로 바꾸지 않게

PROJECT=klassic-api
OUT_ROOT=/d/klassic-backup
WITH_ENGINES=0
ENGINES_VOL=klassic_engines
while getopts 'p:o:eE:' opt; do
  case "$opt" in
    p) PROJECT=$OPTARG ;;
    o) OUT_ROOT=$OPTARG ;;
    e) WITH_ENGINES=1 ;;
    E) ENGINES_VOL=$OPTARG ;;
    *) echo "사용: bash deploy/backup.sh [-p 프로젝트] [-o 백업 위치] [-e [-E 엔진 볼륨]]" >&2; exit 2 ;;
  esac
done

[ -f compose.yaml ] || { echo "api/ 폴더에서 실행한다" >&2; exit 2; }
COMPOSE=(docker compose -p "$PROJECT" -f compose.yaml)
DB_IMAGE=mariadb:12.0.2

"${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx db || { echo "$PROJECT 의 db 가 실행 중이 아니다" >&2; exit 1; }
if [ "$WITH_ENGINES" = 1 ]; then
  docker volume inspect "$ENGINES_VOL" >/dev/null 2>&1 || { echo "엔진 볼륨 $ENGINES_VOL 이 없다 — -E 로 이름을 고른다" >&2; exit 1; }
fi

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

# #141 엔진 볼륨 — 읽기 전용으로 열어 묶고, 파일 해시 · 링크 목록을 따로 남긴다 (복원 뒤 대조용)
if [ "$WITH_ENGINES" = 1 ]; then
  echo "[2+/4] 엔진 볼륨 백업 ($ENGINES_VOL) — 몇 분 걸린다"
  docker run --rm -v "$ENGINES_VOL:/from:ro" "$DB_IMAGE" tar -C /from --numeric-owner -cf - . | gzip -c > "$WORK/engines.tar.gz"
  gzip -t "$WORK/engines.tar.gz"
  docker run --rm -v "$ENGINES_VOL:/from:ro" -w /from "$DB_IMAGE" sh -c 'find . -type f -print0 | sort -z | xargs -0 sha256sum' > "$WORK/engines.sha256"
  docker run --rm -v "$ENGINES_VOL:/from:ro" -w /from "$DB_IMAGE" sh -c 'find . -type l -printf "%p -> %l\n" | sort' > "$WORK/engines.links"
  echo "  엔진: 파일 $(wc -l < "$WORK/engines.sha256") · 링크 $(wc -l < "$WORK/engines.links")"
fi

echo "[3/4] 기록"
ROWS=$("${COMPOSE[@]}" exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot -N "$MARIADB_DATABASE" -e "SELECT CONCAT(\"account=\",(SELECT COUNT(*) FROM account),\" score_request=\",(SELECT COUNT(*) FROM score_request),\" upload_file=\",(SELECT COUNT(*) FROM upload_file),\" shared_score=\",(SELECT COUNT(*) FROM shared_score))"')
{
  echo "created_at=$STAMP"
  echo "project=$PROJECT"
  echo "git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "db_image=$DB_IMAGE"
  echo "rows=$ROWS"
  if [ "$WITH_ENGINES" = 1 ]; then
    echo "engines_volume=$ENGINES_VOL"
    echo "engines_files=$(wc -l < "$WORK/engines.sha256") engines_links=$(wc -l < "$WORK/engines.links")"
    # 설치기(#138)로 만든 볼륨이면 엔진별 설치 기록이 있다 — 판본 확인용
    for e in homr jeongganbo; do
      if grep -q " \./$e/INSTALL_MANIFEST.json\$" "$WORK/engines.sha256"; then echo "engines_${e}_manifest=있음"; else echo "engines_${e}_manifest=없음"; fi
    done
  fi
  (cd "$WORK" && sha256sum ./*.gz $( [ "$WITH_ENGINES" = 1 ] && echo ./engines.sha256 ./engines.links ))
} > "$WORK/MANIFEST.txt"

echo "[4/4] 확인"
(cd "$WORK" && grep -E '^[0-9a-f]{64}' MANIFEST.txt | sha256sum -c --quiet)
mv "$WORK" "$DEST"
echo "완료: $DEST"
du -sh "$DEST" | cut -f1
echo "복원에는 api/.env 도 필요하다. 이 백업에는 들어 있지 않다."
