# =============================================================================
# frontend 이미지 — Vite 빌드 → Nginx 정적 서빙 (담당: 황송해 · #21)
#   builder: node 22 slim 에서 score-core 빌드 → npm ci → vue-tsc · vite build
#   최종:    nginx-unprivileged(uid 101, non-root) 에 dist/ 와 default.conf 만 옮긴다
# =============================================================================

FROM node:22.21.1-bookworm-slim AS builder

# score-core 먼저 (#40) — 바뀌는 일이 적어서 캐시가 오래 간다. package.json 의 file:../../packages/score-core 가 가리키는 자리에 빌드해 둔다
WORKDIR /app/packages/score-core
COPY --from=score-core package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY --from=score-core src ./src
RUN npm run build

# 저장소와 같은 상대 위치로 둔다 — src/i18n/errorCodes.ts 의 ../../../../shared/… 가 그대로 풀린다 (#19 공유 방식)
WORKDIR /app/services/frontend

# 의존성 먼저 — 코드만 바뀌면 npm ci 캐시를 다시 쓴다
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html admin.html ./
COPY public ./public
COPY src ./src
# api/shared · api/packages/score-core 는 compose 의 additional_contexts(shared · score-core)로 받는다
COPY --from=shared . /app/shared
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28.0-bookworm

# 기본 설정을 프로젝트 설정으로 바꾼다 (사용자 8080 · 관리자 8081)
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/services/frontend/dist /usr/share/nginx/html

# 베이스 이미지가 이미 USER 101(nginx) 이다 — 명시해 둔다
USER 101
EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:8080/index.html"]

CMD ["nginx", "-g", "daemon off;"]
