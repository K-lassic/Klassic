// 관리자 라우터 — admin.html#/… (해시 방식: 서버에 admin.html 한 파일만 있으면 된다)
// 관리자 화면은 P3 — 골격(#21)에서는 진입점이 따로 빌드 · 서빙되는지만 확인한다. 화면 · 로그인 확인은 v0.1.1 admin/router.ts 에서 옮긴다.
import { createRouter, createWebHashHistory, type Router } from 'vue-router';

export function createAdminRouter(): Router {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'home', component: () => import('./pages/AdminPlaceholder.vue') },
      { path: '/:rest(.*)*', redirect: '/' },
    ],
  });
}
