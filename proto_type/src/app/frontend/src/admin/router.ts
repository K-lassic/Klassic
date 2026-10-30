// 관리자 라우터 — admin.html#/… (해시 방식: 서버에 admin.html 한 파일만 있으면 된다)
import { createRouter, createWebHashHistory, type Router } from 'vue-router';
import { useSessionStore } from './stores/session';

export const S6_TABS = [
  { id: 'metrics', label: '지표' },
  { id: 'jobs', label: '요청 기록' },
  { id: 'evaluation', label: '평가셋' },
  { id: 'settings', label: '설정' },
  { id: 'models', label: '모델' },
  { id: 'audit', label: '변경 이력' },
] as const;
export type S6TabId = (typeof S6_TABS)[number]['id'];

export function createAdminRouter(): Router {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', redirect: '/ops/metrics' },
      { path: '/login', name: 'login', component: () => import('./pages/SALogin.vue'), meta: { public: true } },
      { path: '/ops', redirect: '/ops/metrics' },
      {
        path: '/ops/:tab(metrics|jobs|evaluation|settings|models|audit)',
        name: 'ops',
        component: () => import('./pages/S6Ops.vue'),
      },
      { path: '/keys', name: 'keys', component: () => import('./pages/S4BKeys.vue') },
      { path: '/accounts', name: 'accounts', component: () => import('./pages/S7Accounts.vue') },
      // S8 공유 악보 관리(2026-09-30 황송해, UC19)
      { path: '/shared', name: 'shared', component: () => import('./pages/S8SharedScores.vue') },
      { path: '/:rest(.*)*', redirect: '/ops/metrics' },
    ],
  });

  router.beforeEach(async (to) => {
    const session = useSessionStore();
    const state = await session.ensure();
    if (to.meta.public) {
      if (state === 'authed') return typeof to.query.redirect === 'string' ? to.query.redirect : '/ops/metrics';
      return true;
    }
    if (state !== 'authed') return { name: 'login', query: { redirect: to.fullPath } };
    return true;
  });

  return router;
}
