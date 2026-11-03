# syntax=docker/dockerfile:1.7
# #138 구조에서의 위치: 운영자 tools 작업 → /scripts 설치기 → 외부 engines 볼륨.
# model-api와 같은 Python 3.11/Bookworm 계열이며 설치 단계에만 빌드 도구를 둔다.
FROM python:3.11-slim-bookworm@sha256:94a8fee35252d06ab75856f15f12c7bae67b10e8a6da93c7fded82b2610926cd
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates build-essential util-linux libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.11.1 \
    && useradd --uid 1000 --create-home --shell /bin/bash app \
    && mkdir -p /opt/gugak-engines && chown app:app /opt/gugak-engines
ENV ENGINES_DIR=/opt/gugak-engines \
    UV_PYTHON_INSTALL_DIR=/opt/gugak-engines/.uv-python \
    UV_CACHE_DIR=/tmp/uv-cache UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    MPLCONFIGDIR=/tmp/matplotlib XDG_CACHE_HOME=/tmp/engine-cache
COPY locks /locks
COPY scripts /scripts
RUN sed -i 's/\r$//' /scripts/*.sh && chmod 0555 /scripts/*.sh
USER 1000:1000
WORKDIR /home/app
ENTRYPOINT ["bash", "/scripts/install_all.sh"]
