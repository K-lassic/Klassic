import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// 두 진입점: index.html(일반 사용자) · admin.html(관리자) — 관리자 코드가 사용자 번들에 들어가지 않는다(v0.1.1 research R13)
// 개발 서버(npm run dev)만 쓰는 대상 주소 — 기본은 api/ 입구(9603 · 26201, #139).
// v0.1.1 예비 시연(proto_type 9503 · 26101)을 보려면 DEV_PUBLIC_TARGET · DEV_ADMIN_TARGET 으로 명시한다.
const devPublic = process.env.DEV_PUBLIC_TARGET ?? 'http://127.0.0.1:9603';
const devAdmin = process.env.DEV_ADMIN_TARGET ?? 'http://127.0.0.1:26201';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // (#92) '/api/' 로 끝까지 적는다 — '/api' 면 화면 경로 /api-guide 까지 백엔드로 넘어가 빈 화면이 된다 (Nginx 도 location ^~ /api/)
      '/api/': devPublic,
      '/soundfonts': devPublic,
      '/admin/': { target: devAdmin, bypass: (req) => (req.url?.startsWith('/admin.html') ? req.url : undefined) },
    },
  },
  test: { environment: 'jsdom', include: ['tests/unit/**/*.test.ts'] },
});
