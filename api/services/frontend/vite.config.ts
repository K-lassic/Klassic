import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// 두 진입점: index.html(일반 사용자) · admin.html(관리자) — 관리자 코드가 사용자 번들에 들어가지 않는다(v0.1.1 research R13)
// 개발 서버(npm run dev)만 쓰는 대상 주소 — 기본은 v0.1.1 대역(proto_type 9503 · 26101). api/ 로 붙이려면 9603 · 26201
const devPublic = process.env.DEV_PUBLIC_TARGET ?? 'http://127.0.0.1:9503';
const devAdmin = process.env.DEV_ADMIN_TARGET ?? 'http://127.0.0.1:26101';

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
