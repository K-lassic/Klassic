#!/usr/bin/env bash
# MALerLab jeongganbo-omr(정간보 인식, MIT)를 ~/gugak-engines/jeongganbo 에 둔다. (T038, research R2)
#  - 저장소는 커밋을 고정해 받고(repo/), 가중치는 v1.0.0 릴리스의 checkpoints.tar.gz 를 푼다.
#  - Python 3.8 가상환경(.venv)은 uv 로 만들고, 저장소의 Pipfile.lock 핀을 그대로 옮긴
#    requirements.lock.txt 로 설치한다(잠금 = 저자가 고정한 판).
#  - 이미 .venv 가 있으면 건너뛴다(덮어쓰지 않음). SejongMusic 코드는 받지 않는다(라이선스 표기 없음).
set -euo pipefail
ENGINES_DIR="${ENGINES_DIR:-$HOME/gugak-engines}"
DIR="$ENGINES_DIR/jeongganbo"
REPO_URL="${JG_REPO_URL:-https://github.com/MALerLab/jeongganbo-omr.git}"
REPO_COMMIT="${JG_REPO_COMMIT:-e95045fce5ab151fc4b87d5be86c4ac5f7621f4c}"
CKPT_URL="${JG_CKPT_URL:-https://github.com/MALerLab/jeongganbo-omr/releases/download/v1.0.0/checkpoints.tar.gz}"
PY="${JG_PYTHON:-3.8}"

if [[ -x "$DIR/.venv/bin/python" ]]; then
  echo "[jeongganbo] 이미 설치됨: $DIR — 건너뜀 (VERSION: $(cat "$DIR/VERSION" 2>/dev/null || echo 없음))"
  exit 0
fi
if [[ -d "$DIR" && -n "$(ls -A "$DIR" 2>/dev/null)" ]]; then
  echo "[jeongganbo] $DIR 에 다른 파일이 있고 .venv 는 없음 — 누가 설치 중일 수 있어 멈춤(사람 확인)" >&2
  exit 2
fi
command -v uv >/dev/null || { echo "[jeongganbo] uv 가 없음" >&2; exit 3; }

mkdir -p "$DIR"
cd "$DIR"
git clone --quiet "$REPO_URL" repo
git -C repo checkout --quiet "$REPO_COMMIT"

# 가중치(약 68MB)
curl -fL --retry 3 -o checkpoints.tar.gz "$CKPT_URL"
tar -xzf checkpoints.tar.gz -C repo
rm -f checkpoints.tar.gz
test -f repo/checkpoints/best/model.pt || { echo "[jeongganbo] checkpoints/best/model.pt 가 없음" >&2; exit 4; }

# Pipfile.lock(default) → 핀 고정 requirements (환경 표지 유지 — 리눅스 전용 CUDA 꾸러미는 Mac 에서 빠진다)
python3 - <<'PY'
import json
lock = json.load(open("repo/Pipfile.lock"))["default"]
lines = []
for name, spec in sorted(lock.items()):
    ver = spec.get("version")
    if not ver:
        continue
    line = f"{name}{ver}"
    if spec.get("markers"):
        line += f" ; {spec['markers']}"
    lines.append(line)
open("requirements.lock.txt", "w").write("\n".join(lines) + "\n")
PY

uv venv --python "$PY" .venv
VIRTUAL_ENV="$DIR/.venv" uv pip install --python .venv/bin/python -r requirements.lock.txt

# 가져오기 확인(가중치까지 CPU 로 한 번 불러 본다)
( cd repo && ../.venv/bin/python -c "
from jngbomr import Inferencer
Inferencer(device='cpu')
print('ok')" )

echo "jeongganbo-omr@${REPO_COMMIT:0:7}+ckpt-v1.0.0" > VERSION
echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ) python=$(.venv/bin/python -V 2>&1) repo=$REPO_URL commit=$REPO_COMMIT ckpt=$CKPT_URL" > INSTALL_INFO
echo "[jeongganbo] 설치 끝: $DIR ($(cat VERSION))"
