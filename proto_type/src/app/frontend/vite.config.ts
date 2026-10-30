import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// 두 진입점: index.html(일반 사용자) · admin.html(관리자) — 관리자 코드가 사용자 번들에 들어가지 않는다(research R13)
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
      '/api': 'http://127.0.0.1:9523',
      '/soundfonts': 'http://127.0.0.1:9523',
      '/admin/': { target: 'http://127.0.0.1:26101', bypass: (req) => (req.url?.startsWith('/admin.html') ? req.url : undefined) },
    },
  },
  test: { environment: 'jsdom', include: ['tests/unit/**/*.test.ts'] },
});
