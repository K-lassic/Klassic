# =============================================================================
# frontend 이미지 — Vite 빌드 → Nginx 정적 서빙 (담당: 황송해 · #21)
#   builder: node 22 slim 에서 npm ci → vue-tsc · vite build
#   최종:    nginx-unprivileged(uid 101, non-root) 에 dist/ 와 default.conf 만 옮긴다
# =============================================================================

FROM node:22.21.1-bookworm-slim AS builder
WORKDIR /app

# 의존성 먼저 — 코드만 바뀌면 npm ci 캐시를 다시 쓴다
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html admin.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28.0-bookworm

# 기본 설정을 프로젝트 설정으로 바꾼다 (사용자 8080 · 관리자 8081)
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# 베이스 이미지가 이미 USER 101(nginx) 이다 — 명시해 둔다
USER 101
EXPOSE 8080 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:8080/index.html"]

CMD ["nginx", "-g", "daemon off;"]
