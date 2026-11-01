# =============================================================================
# #23 backend 이미지 — web · admin 이 같이 쓴다 (실행 인자 --role 만 다름)
#
#   구조에서의 위치: Nginx(#22) → web:9523 · admin:26101 → MariaDB(db) · model-api
#   빌드 범위(context)는 이 폴더라 api/shared · api/packages/score-core 가 보이지 않는다
#     → compose 의 additional_contexts(shared · score-core)로 넘겨 이미지에 굽는다 (api/shared/README.md)
#   이미지 안에도 저장소와 같은 위치 관계로 둔다 → package.json 의 file:../../packages/score-core 가 그대로 풀린다
#     /app/services/backend   ← 이 서비스
#     /app/packages/score-core ← 빌드 결과(dist) + 실행 의존성 (backend 의 node_modules 에서 링크로 가리킨다)
#     /app/shared              ← 오류 코드 · 업로드 규칙 · 악기 목록 (SHARED_DIR)
# =============================================================================

# --- 1단계: 빌드 (개발 도구 포함) -----------------------------------------------
FROM node:22.21.1-bookworm-slim AS builder

# score-core 먼저 — 바뀌는 일이 적어서 캐시가 오래 간다
WORKDIR /app/packages/score-core
COPY --from=score-core package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY --from=score-core src ./src
RUN npm run build && npm prune --omit=dev

# backend — 의존성 파일 먼저 COPY → 설치, 코드는 뒤에 (작성규칙 2-1: 코드만 바뀌면 npm ci 캐시를 다시 쓴다)
WORKDIR /app/services/backend
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- 2단계: 실행 (빌드 도구 없음) -----------------------------------------------
FROM node:22.21.1-bookworm-slim

ENV NODE_ENV=production \
    SHARED_DIR=/app/shared

COPY --from=shared errors /app/shared/errors
COPY --from=shared upload-rules.json instruments.json /app/shared/

COPY --from=builder /app/packages/score-core/package.json /app/packages/score-core/
COPY --from=builder /app/packages/score-core/dist /app/packages/score-core/dist
COPY --from=builder /app/packages/score-core/node_modules /app/packages/score-core/node_modules

WORKDIR /app/services/backend
COPY --from=builder /app/services/backend/package.json ./
COPY --from=builder /app/services/backend/node_modules ./node_modules
COPY --from=builder /app/services/backend/dist ./dist
# #34 예시 악보 · 대체 악보 — 이미지에 굽는다 (ASSETS_DIR 기본값 · 정적 공개 경로 없음)
COPY assets ./assets

# #34 볼륨을 붙일 자리 — 빈 볼륨이 처음 붙을 때 이 소유자를 물려받아 node 사용자가 쓸 수 있다
RUN mkdir /storage && chown node:node /storage

# non-root (작성규칙 2-5) — node 이미지에 들어 있는 node 사용자(uid 1000). 파일은 root 소유라 읽기만 된다
USER node
EXPOSE 9523 26101

# exec 형식 (작성규칙 2-4) — node 가 PID 1 이 되어 SIGTERM 을 직접 받는다. 역할은 compose 에서 바꾼다
CMD ["node", "dist/server.js", "--role=web"]
