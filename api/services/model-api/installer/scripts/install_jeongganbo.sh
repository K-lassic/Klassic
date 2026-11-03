#!/usr/bin/env bash
# #138 구조에서의 위치: 정간보 설치기 → 고정 Git 커밋·체크포인트 해시·의존성 → engines/jeongganbo.
set -euo pipefail
source /scripts/common.sh
initialize jeongganbo
[[ "$INSTALL_SKIP" == 0 ]] || exit 0
started=$SECONDS
commit="$(source_value jeongganbo commit)"
git init --quiet "$DIR/repo"
git -C "$DIR/repo" remote add origin "$(source_value jeongganbo repository)"
git -C "$DIR/repo" fetch --quiet --depth 1 origin "$commit"
git -C "$DIR/repo" checkout --quiet --detach FETCH_HEAD
[[ "$(git -C "$DIR/repo" rev-parse HEAD)" == "$commit" ]] || exit 3
curl --fail --location --retry 3 --retry-all-errors --proto '=https' --tlsv1.2 \
  -o "$DIR/checkpoints.tar.gz" "$(source_value jeongganbo checkpoint_url)"
python3 /scripts/install_state.py extract-checkpoint
cp /locks/jeongganbo/requirements.lock.txt "$DIR/requirements.lock.txt"
# Python 실행 파일도 볼륨에 남겨 컨테이너가 바뀌어도 절대 경로가 유효하게 한다.
uv python install "$(source_value jeongganbo python)"
uv venv --python "$(source_value jeongganbo python)" "$DIR/.venv"
uv pip install --python "$DIR/.venv/bin/python" --require-hashes -r "$DIR/requirements.lock.txt"
uv pip check --python "$DIR/.venv/bin/python"
(cd "$DIR/repo" && ../.venv/bin/python -B -c "from jngbomr import Inferencer; Inferencer(device='cpu'); print('정간보 CPU 로딩 완료')")
printf '%s\n' "$(source_value jeongganbo version)" > "$DIR/VERSION"
python3 /scripts/install_state.py complete jeongganbo
echo "[jeongganbo] 설치·모델 검증 완료 ($((SECONDS-started))초)"
