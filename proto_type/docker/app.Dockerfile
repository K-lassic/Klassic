# syntax=docker/dockerfile:1.7
# =============================================================================
# K-lassic 웹 서비스 이미지 (Node.js)
# - 하나의 이미지로 web · admin · gateway · demo · migrate 역할을 모두 실행한다 (command 로 역할 선택)
# - 빌드 컨텍스트: src/app   (docker-compose.yml 의 build.context)
# - 제외 목록: 같은 폴더의 app.Dockerfile.dockerignore (BuildKit 의 Dockerfile 전용 ignore 파일)
# =============================================================================
ARG NODE_VERSION=22

# -----------------------------------------------------------------------------
# 1단계(build): 의존성 설치 → score-core · frontend · backend 빌드 → 개발 의존성 제거
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

# argon2 등 네이티브 모듈의 미리 빌드된 파일(prebuilt)이 없을 때를 대비한 빌드 도구
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# 의존성 목록만 먼저 복사 → 소스가 바뀌어도 npm ci 레이어는 캐시를 재사용한다
COPY package.json package-lock.json ./
COPY packages/score-core/package.json packages/score-core/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY . .
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# -----------------------------------------------------------------------------
# 2단계(runtime): 실행에 필요한 결과물만 담은 가벼운 이미지
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app /app

# 결과 파일 저장 폴더 — named volume 이 처음 붙을 때 이 소유권(node, uid 1000)이 그대로 복사된다
RUN mkdir -p /app/storage && chown node:node /app/storage

# root 가 아닌 사용자로 실행 (컨테이너 탈출 시 피해 최소화)
USER node

# 9503 gateway(외부 입구) · 9523 web · 26101 admin · 26102 demo
EXPOSE 9503 9523 26101 26102

# 기본 역할은 web. compose 에서 command 로 바꿔 쓴다
CMD ["node", "backend/dist/server.js", "--role=web"]
