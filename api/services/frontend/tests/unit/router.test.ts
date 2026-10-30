// 골격(#21) 라우팅 — v0.1.1 경로가 모두 열리고, 모르는 경로는 처음 화면으로 돌아간다
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { routes } from '@/router';
import { createAdminRouter } from '@/admin/router';

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes });
}

describe('사용자 라우터', () => {
  it.each([
    ['/', 'home'],
    ['/r/12/listen', 'listen'],
    ['/r/12/download', 'download'],
    ['/tour', 'tour'],
    ['/login', 'login'],
    ['/api-guide', 'api-guide'],
    ['/api-guide/examples', 'api-examples'],
  ])('%s → %s', async (path, name) => {
    const router = makeRouter();
    await router.push(path);
    expect(router.currentRoute.value.name).toBe(name);
  });

  it('/signup 은 로그인 화면의 가입 탭으로 간다 (query 유지)', async () => {
    const router = makeRouter();
    await router.push('/signup?next=/tour');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query).toEqual({ next: '/tour', tab: 'signup' });
  });

  it('모르는 경로는 처음 화면으로', async () => {
    const router = makeRouter();
    await router.push('/no/such/page');
    expect(router.currentRoute.value.name).toBe('home');
  });
});

describe('관리자 라우터', () => {
  it('해시 라우터로 처음 화면을 연다', async () => {
    const router = createAdminRouter();
    await router.push('/anything');
    expect(router.currentRoute.value.name).toBe('home');
  });
});
