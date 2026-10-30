# syntax=docker/dockerfile:1.7
# =============================================================================
# K-lassic 인식 엔진 설치용 일회성 이미지 (homr · jeongganbo)
# - 기존 설치 스크립트(src/app/ops/engines/install_*.sh)를 고치지 않고 그대로 실행한다
# - 결과는 engines 볼륨(/opt/gugak-engines)에 남고, model-api 가 같은 볼륨을 읽는다
# - 베이스를 model-api 와 같은 python:3.11-slim-bookworm 으로 맞춘다
#   → homr .venv 가 가리키는 /usr/local/bin/python3.11 이 model-api 에도 같은 경로로 있다
# 사용: docker compose --profile tools run --rm engines-installer
# =============================================================================
ARG PYTHON_VERSION=3.11
FROM python:${PYTHON_VERSION}-slim-bookworm

# git · curl: jeongganbo 저장소·가중치 받기 / build-essential: 휠이 없는 패키지 빌드 대비
# libglib2.0-0 · libgl1: 설치 끝에 엔진을 불러 보는 확인 단계(OpenCV)에 필요 — model-api 이미지와 같게 맞춘다
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates build-essential libglib2.0-0 libgl1 \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir "uv>=0.11,<0.12"

# uv 가 받는 Python(jeongganbo 용 3.8)도 볼륨 안에 둔다 → model-api 에서도 같은 경로로 실행된다
ENV ENGINES_DIR=/opt/gugak-engines \
    UV_PYTHON_INSTALL_DIR=/opt/gugak-engines/.uv-python \
    UV_CACHE_DIR=/tmp/uv-cache \
    UV_LINK_MODE=copy

# model-api 와 같은 uid 1000 으로 실행해 볼륨 파일 소유자를 맞춘다
RUN useradd --uid 1000 --create-home --shell /bin/bash app \
 && mkdir -p /opt/gugak-engines && chown app:app /opt/gugak-engines
USER app
WORKDIR /home/app

# 엔진 하나가 실패해도 나머지는 설치하고, 마지막에 결과를 모아 알려 준다
# - Windows 에서 받은 저장소는 줄 끝이 CRLF 일 수 있어(git autocrlf) 실행 전에 \r 을 지운다 (원본 파일은 그대로)
CMD ["bash", "-c", "rc=0; for e in homr jeongganbo; do tr -d '\\r' < /scripts/install_$e.sh > /tmp/install_$e.sh; bash /tmp/install_$e.sh || { echo \"[installer] $e 실패 (exit $?)\" >&2; rc=1; }; done; ls -la $ENGINES_DIR; exit $rc"]
