#!/usr/bin/env bash
# #138 구조에서의 위치: homr 설치기 → 고정 uv.lock·ONNX SHA-256 → engines/homr.
set -euo pipefail
source /scripts/common.sh
initialize homr
[[ "$INSTALL_SKIP" == 0 ]] || exit 0
started=$SECONDS
cp /locks/homr/{pyproject.toml,uv.lock} "$DIR/"
cd "$DIR"
# 잠금 파일을 설치 중 새로 해석하거나 업데이트하지 않는다.
uv sync --frozen --no-install-project --python /usr/local/bin/python3.11
.venv/bin/homr --init
uv pip check --python .venv/bin/python
.venv/bin/python -c "import importlib.metadata as m; assert m.version('homr') == '0.7.0'"
printf '%s\n' "$(source_value homr version)" > VERSION
python3 /scripts/install_state.py complete homr
echo "[homr] 설치·가중치 검증 완료 ($((SECONDS-started))초)"
