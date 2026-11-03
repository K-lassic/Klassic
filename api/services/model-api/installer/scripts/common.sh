#!/usr/bin/env bash
# #138 구조에서의 위치: 엔진별 설치기 → 볼륨 잠금·완료 표식 검사. 기존 설치를 덮어쓰지 않는다.
set -euo pipefail
initialize() {
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
