// 화면 경로 — v0.1.1 router.ts 와 같은 경로. 아직 옮기지 않은 화면은 빈 화면(Placeholder)을 연다.
// 화면 이슈에서 component 만 바꾼다: S1 #40(옮김) · S2 #41(옮김) · S3 #43 · S0 #39(옮김).
// 2026-09-29 RBAC(FR-068 · UC16 A2): S1~S3 은 로그인해야 연다 — 아니면 /login?next= 로 보냈다가 돌아온다. S4-A 는 누구나.
import { createRouter, createWebHistory, type RouteLocationNormalized, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from './stores/auth';

const Placeholder = () => import('./pages/Placeholder.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('./pages/S1Home.vue'), meta: { title: '악보 올리기', requiresLogin: true } },
  { path: '/r/:requestNo/listen', name: 'listen', component: () => import('./pages/S2Edit.vue'), props: true, meta: { title: '듣기와 편집', requiresLogin: true } },
  { path: '/r/:requestNo/download', name: 'download', component: Placeholder, props: true, meta: { title: '내려받기', requiresLogin: true } },
  // S1-T 체험하기(2026-09-30 황송해 165번 — SD_02 §4-7): 로그인 없이 누구나
  { path: '/tour', name: 'tour', component: Placeholder, meta: { title: '체험하기' } },
  { path: '/login', name: 'login', component: () => import('./pages/S0Login.vue'), meta: { title: '로그인' } },
  // (2026-09-30 황송해 170번) 가입 화면 바로 열기 — /signup = /login?tab=signup (next 등 그대로)
  { path: '/signup', redirect: (to) => ({ name: 'login', query: { ...to.query, tab: 'signup' } }) },
  { path: '/api-guide', name: 'api-guide', component: Placeholder, meta: { title: 'API활용' } },
  { path: '/api-guide/examples', name: 'api-examples', component: Placeholder, meta: { title: 'API 활용 예시' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

/** 로그인 가드 — 시험에서 메모리 라우터에 붙일 수 있게 따로 내보낸다 (v0.1.1 은 router.beforeEach 안에 바로 썼다) */
export async function loginGuard(to: RouteLocationNormalized) {
  // (2026-10-01 황송해 209번, UC16 A5) 로그인한 브라우저는 로그아웃하기 전까지 로그인 · 가입 화면에 들어가지 못한다
  if (to.name === 'login') {
    const auth = useAuthStore();
    await auth.fetchMe();
    if (auth.loggedIn) { auth.notice = '이미 로그인되어 있습니다.'; return { name: 'home' }; }
    return true;
  }
  if (!to.meta.requiresLogin) return true;
  const auth = useAuthStore();
  await auth.fetchMe();
  if (auth.loggedIn) return true;
  return { name: 'login', query: { next: to.fullPath } };
}

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(loginGuard);

router.afterEach((to) => {
  // 서비스 이름(2026-09-30 황송해 62번): 국악보 → Klassic
  document.title = `${(to.meta.title as string) ?? 'Klassic'} · Klassic`;
});
