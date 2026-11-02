# syntax=docker/dockerfile:1.7
# #24 model-api: 공통 설정은 이미지에 포함하고 엔진·음원은 읽기 전용으로 마운트한다.
FROM python:3.11-slim-bookworm AS build
ARG UV_VERSION=0.11.1
RUN pip install --no-cache-dir uv==${UV_VERSION}
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
WORKDIR /app/services/model-api
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

FROM python:3.11-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/opt/venv/bin:$PATH \
    SHARED_DIR=/app/shared ENGINES_DIR=/opt/gugak-engines SOUNDFONTS_DIR=/app/shared/soundfonts \
    XDG_CACHE_HOME=/tmp/engine-cache MPLCONFIGDIR=/tmp/matplotlib
RUN apt-get update && apt-get install -y --no-install-recommends libfluidsynth3 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/shared/soundfonts /storage \
    && chown app:app /storage
COPY --from=build /opt/venv /opt/venv
WORKDIR /app/services/model-api
COPY --from=shared errors /app/shared/errors
COPY --from=shared upload-rules.json instruments.json /app/shared/
# 음원은 11/02 팀 지시에 따라 Compose에서 읽기 전용으로 붙인다.
COPY app ./app
COPY assets ./assets
USER 1000:1000
EXPOSE 9543
HEALTHCHECK --interval=10s --timeout=8s --start-period=300s --retries=3 CMD ["python", "-m", "app.healthcheck"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9543", "--root-path", "/api", "--workers", "1", "--no-access-log", "--no-proxy-headers"]
