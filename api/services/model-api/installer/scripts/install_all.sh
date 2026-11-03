#!/usr/bin/env bash
# #138 구조에서의 위치: tools 일회성 컨테이너 → 각 고정 설치기. 메모리가 겹치지 않게 순차 실행한다.
set -euo pipefail
engines=("$@")
if [[ ${#engines[@]} -eq 0 ]]; then engines=(homr jeongganbo); fi
rc=0
for engine in "${engines[@]}"; do
  case "$engine" in homr|jeongganbo) ;; *) echo "지원하지 않는 엔진: $engine" >&2; exit 2;; esac
  bash "/scripts/install_$engine.sh" || { echo "[$engine] 설치 실패" >&2; rc=1; }
done
exit "$rc"
