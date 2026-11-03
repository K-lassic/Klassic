#!/usr/bin/env bash
# #138 구조에서의 위치: 엔진별 설치기 → 볼륨 잠금·완료 표식 검사. 기존 설치를 덮어쓰지 않는다.
set -euo pipefail
initialize() {
  # Compose의 일반 서비스 기본값과 달리 설치 대상은 반드시 명시한다. 파일 작업보다 먼저 검사한다.
  [[ -n "${ENGINES_VOLUME_NAME:-}" ]] || { echo 'ENGINES_VOLUME_NAME을 지정하십시오. 운영 볼륨에는 설치하지 않습니다.' >&2; exit 2; }
  [[ "$ENGINES_VOLUME_NAME" != klassic_engines ]] || { echo '운영 볼륨 klassic_engines에는 설치할 수 없습니다.' >&2; exit 2; }
  ENGINE="$1"
  ROOT="${ENGINES_DIR:?ENGINES_DIR이 필요합니다}"
  [[ "$ROOT" == /* && "$ROOT" != / ]] || { echo '절대 엔진 경로가 필요합니다' >&2; exit 2; }
  [[ ! -L "$ROOT" ]] || { echo '엔진 루트 링크는 허용하지 않습니다' >&2; exit 2; }
  DIR="$ROOT/$ENGINE"
  mkdir -p "$ROOT"
  exec 9>"$ROOT/.$ENGINE.install.lock"
  flock -n 9 || { echo "[$ENGINE] 다른 설치가 진행 중입니다" >&2; exit 2; }
  INSTALL_SKIP=0
  if [[ -f "$DIR/INSTALL_MANIFEST.json" ]]; then
    python3 /scripts/install_state.py verify "$ENGINE"
    echo "[$ENGINE] 잠금·가중치 검증 완료 — 기존 설치 유지"
    INSTALL_SKIP=1
    return
  fi
  if [[ -e "$DIR" && -n "$(ls -A "$DIR")" ]]; then
    echo "[$ENGINE] 완료 표식 없는 기존/부분 설치입니다. 덮어쓰지 않습니다: $DIR" >&2
    exit 2
  fi
  mkdir -p "$DIR"
}
source_value() { python3 /scripts/install_state.py value "$1" "$2"; }
