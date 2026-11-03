# #93 구조에서의 위치: Nginx /demo → 예시 서버 → 외부 키로 model-api. DB·파일 볼륨은 필요 없다.
FROM node:22.21.1-bookworm-slim
WORKDIR /app
COPY --chown=node:node server.mjs ./
COPY --chown=node:node public ./public
USER node
EXPOSE 26102
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:26102/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]
