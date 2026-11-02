#!/usr/bin/env bash
# CPU 전용 엔진 볼륨 만들기 — 정간보 환경에서 GPU 패키지를 빼 용량을 줄인다 (#25 · #96 후보, 시험용)
#
#   구조에서의 위치: 운영자가 서버 PC 에서 설치 이미지로 한 번 실행한다 → 새 볼륨을 만든다.
#     model-api 는 ENGINES_VOLUME_NAME 으로 그 볼륨을 읽기 전용으로 붙인다. 코드 · DB 는 바꾸지 않는다.
#   읽는 것: 기존 klassic_engines(/src, 읽기 전용) · 내려받는 것: 공식 PyTorch CPU 빌드 2개와 고정 목록의 패키지.
#   저장하는 것: 대상 볼륨(/opt/gugak-engines)의 homr · Python 3.8 · 정간보 환경.
#   한계: 기존 볼륨에서 복사하므로 빈 PC 에서는 돌지 않고, 패키지 해시는 아직 고정하지 않았다.
#   실행 방법 · 시험 결과: deploy/README.md 「CPU 전용 엔진 볼륨 시험」
set -euo pipefail

D=/opt/gugak-engines
PY38=$D/.uv-python/cpython-3.8-linux-x86_64-gnu/bin/python3.8
TORCH='https://download.pytorch.org/whl/cpu/torch-2.0.1%2Bcpu-cp38-cp38-linux_x86_64.whl'
VISION='https://download.pytorch.org/whl/cpu/torchvision-0.15.2%2Bcpu-cp38-cp38-linux_x86_64.whl'

# 기존 설치를 덮어쓰지 않게 빈 볼륨에서만 시작한다
test -z "$(ls -A "$D")" || { echo "대상 볼륨이 비어 있지 않아 멈춘다" >&2; exit 2; }

echo "[1] homr · Python · 저장소 · 가중치 복사"
cp -a /src/.uv-python /src/homr "$D"/
mkdir -p "$D/jeongganbo"
cp -a /src/jeongganbo/repo /src/jeongganbo/VERSION /src/jeongganbo/requirements.lock.txt "$D/jeongganbo/"

echo "[2] 고정 목록에서 GPU 패키지와 torch 줄만 바꾼다 — 나머지 버전은 그대로"
cd "$D/jeongganbo"
grep -vE '^(nvidia-|triton==|torch==|torchvision==)' requirements.lock.txt > requirements.cpu.lock.txt
echo "torch @ $TORCH" >> requirements.cpu.lock.txt
echo "torchvision @ $VISION" >> requirements.cpu.lock.txt

echo "[3] 설치 — --no-deps 로 목록 밖 패키지가 들어오지 않게 한다"
uv venv --python "$PY38" .venv
export VIRTUAL_ENV=$D/jeongganbo/.venv
uv pip install --python .venv/bin/python --no-deps -r requirements.cpu.lock.txt

echo "[4] 패키지 목록 · 일관성"
uv pip freeze --python .venv/bin/python > requirements.cpu.freeze.txt
uv pip check --python .venv/bin/python

echo "[5] CPU 빌드 확인 · 모델 불러오기"
(cd repo && ../.venv/bin/python -B -c "
import torch
assert torch.version.cuda is None, torch.version.cuda
assert torch.cuda.is_available() is False
from jngbomr import Inferencer
Inferencer(device='cpu')
print('torch', torch.__version__, 'model ok')")

echo "installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ) variant=cpu python=$(.venv/bin/python -V 2>&1) torch=2.0.1+cpu" > INSTALL_INFO
du -sm "$D/homr" "$D/.uv-python" "$D/jeongganbo"
du -sb "$D"
echo "DONE"
