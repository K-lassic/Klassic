# syntax=docker/dockerfile:1.7
# =============================================================================
# K-lassic 모델 API 이미지 (Python 3.11 · FastAPI · uvicorn)
# - FluidSynth · LAME 포함 → 악보 → 국악기 연주 MP3 생성 가능
# - 빌드 컨텍스트: src/app   (제외 목록: model-api.Dockerfile.dockerignore)
# =============================================================================
ARG PYTHON_VERSION=3.11

# -----------------------------------------------------------------------------
# 1단계(build): uv 로 uv.lock 에 고정된 패키지를 /opt/venv 에 설치
# -----------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS build
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
RUN pip install --no-cache-dir "uv>=0.11,<0.12"
WORKDIR /app/model-api
COPY model-api/pyproject.toml model-api/uv.lock model-api/.python-version ./
# --frozen: uv.lock 을 고치지 않고 그대로 설치 / --no-dev: pytest · ruff 제외
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# -----------------------------------------------------------------------------
# 2단계(runtime)
# -----------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH

# fluidsynth: MIDI → WAV / lame: WAV → MP3 / libglib2.0-0 · libgl1: OpenCV 실행에 필요한 공유 라이브러리
# (libgl1: jeongganbo 엔진의 opencv-python 이 headless 판이 아니라 libGL.so.1 을 찾는다)
RUN apt-get update \
 && apt-get install -y --no-install-recommends fluidsynth lame libglib2.0-0 libgl1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/venv /opt/venv

WORKDIR /app/model-api
COPY . /app

# root 가 아닌 사용자(uid 1000 — web 이미지의 node 사용자와 같게 맞춰 storage 볼륨을 함께 쓴다)
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin app \
 && mkdir -p /app/storage /opt/gugak-engines \
 && chown app:app /app/storage /opt/gugak-engines
USER app

EXPOSE 9543

# 기존 pm2 설정(ops/ecosystem.config.cjs)과 같은 실행 인자
# - 127.0.0.1: 같은 네트워크 네임스페이스를 쓰는 gateway 를 통해서만 들어온다
# - --root-path /api: 밖에서 /api/v1/... 로 보이게 한다 (gateway 가 /api 를 떼고 넘김)
CMD ["python", "-m", "uvicorn", "app.main:app", \
     "--host", "127.0.0.1", "--port", "9543", "--root-path", "/api", \
     "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1", \
     "--workers", "1", "--no-access-log"]
