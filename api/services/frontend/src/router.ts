// 화면 경로 — v0.1.1 router.ts 와 같은 경로. 지금은 골격(#21)이라 모두 빈 화면(Placeholder)을 연다.
// 화면 이슈에서 component 만 바꾼다: S1 #40 · S2 #41 · S3 #43 · S0 #39. 로그인 확인(requiresLogin)은 #39 에서 붙인다.
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const Placeholder = () => import('./pages/Placeholder.vue');

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: Placeholder, meta: { title: '악보 올리기' } },
  { path: '/r/:requestNo/listen', name: 'listen', component: Placeholder, meta: { title: '듣기와 편집' } },
  { path: '/r/:requestNo/download', name: 'download', component: Placeholder, meta: { title: '내려받기' } },
  { path: '/tour', name: 'tour', component: Placeholder, meta: { title: '체험하기' } },
  { path: '/login', name: 'login', component: Placeholder, meta: { title: '로그인' } },
  { path: '/signup', redirect: (to) => ({ name: 'login', query: { ...to.query, tab: 'signup' } }) },
  { path: '/api-guide', name: 'api-guide', component: Placeholder, meta: { title: 'API활용' } },
  { path: '/api-guide/examples', name: 'api-examples', component: Placeholder, meta: { title: 'API 활용 예시' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.afterEach((to) => {
  document.title = `${(to.meta.title as string) ?? 'Klassic'} · Klassic`;
});
