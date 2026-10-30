#!/usr/bin/env bash
# homr(오선보 1순위, AGPL-3.0 — 고치지 않고 호출만) 가상환경을 ~/gugak-engines/homr 에 만든다. (T035, research R2)
#  - uv 잠금 파일(uv.lock)로 의존성을 고정하고, 가중치는 설치할 때 미리 받는다(--init).
#  - 이미 .venv 가 있으면 아무것도 바꾸지 않고 끝낸다(여러 사람이 같은 폴더를 쓰므로 덮어쓰지 않는다).
set -euo pipefail
ENGINES_DIR="${ENGINES_DIR:-$HOME/gugak-engines}"
DIR="$ENGINES_DIR/homr"
HOMR_VERSION="${HOMR_VERSION:-0.7.0}"
PY="${HOMR_PYTHON:-3.11}"

if [[ -x "$DIR/.venv/bin/python" ]]; then
  echo "[homr] 이미 설치됨: $DIR — 건너뜀 (VERSION: $(cat "$DIR/VERSION" 2>/dev/null || echo 없음))"
  exit 0
fi
if [[ -d "$DIR" && -n "$(ls -A "$DIR" 2>/dev/null)" ]]; then
  echo "[homr] $DIR 에 다른 파일이 있고 .venv 는 없음 — 누가 설치 중일 수 있어 멈춤(사람 확인)" >&2
  exit 2
fi
command -v uv >/dev/null || { echo "[homr] uv 가 없음" >&2; exit 3; }

mkdir -p "$DIR"
cd "$DIR"
cat > pyproject.toml <<TOML
[project]
name = "homr-env"
version = "0.1.0"
requires-python = "==${PY}.*"
dependencies = ["homr==${HOMR_VERSION}"]
TOML
uv lock --python "$PY"
uv sync --frozen --python "$PY"
# 첫 요청이 가중치를 받느라 늦지 않게 지금 받아 둔다
.venv/bin/homr --init
.venv/bin/python -c "import importlib.metadata as m; print(m.version('homr'))" > VERSION
echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ) python=$PY" > INSTALL_INFO
echo "[homr] 설치 끝: $DIR (homr $(cat VERSION))"
