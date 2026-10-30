// #39 로그인 · 가입 · 머리 메뉴 — v0.1.1 authGuard.test.ts · loginGuard209.test.ts 의 동작 시험을 옮기고,
// 실패 안내는 #19 전 임시 블록(서버 message · fix) 기준으로 본다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from '@/App.vue';
import S0Login from '@/pages/S0Login.vue';
import { loginGuard, routes } from '@/router';
import { useAuthStore } from '@/stores/auth';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const ME = { account: { account_id: 1, login_id: 'a@b.kr', display_name: '가나' }, roles: ['user'] };
const GUEST = { account: null, roles: [] };

/** 경로별 응답 — 부른 순서대로 [method, url, body] 를 남긴다 */
function stubApi(handlers: Record<string, () => Response>) {
  const calls: [string, string, unknown][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push([method, url, init?.body ? JSON.parse(init.body as string) : undefined]);
    const h = handlers[`${method} ${url}`];
    if (!h) throw new Error(`시험에 없는 호출: ${method} ${url}`);
    return h();
  }));
  return calls;
}

function makeRouter() {
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.beforeEach(loginGuard);
  return router;
}

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('로그인 가드', () => {
  it('로그인 안 했으면 S1 대신 /login?next= 로 간다', async () => {
    stubApi({ 'GET /api/auth/me': () => jsonResponse(200, GUEST) });
    const router = makeRouter();
    await router.push('/r/12/download');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.next).toBe('/r/12/download');
  });

  it('로그인했으면 그대로 연다, API활용은 누구나', async () => {
    stubApi({ 'GET /api/auth/me': () => jsonResponse(200, ME) });
    const router = makeRouter();
    await router.push('/r/R-0929-AAAA1111/listen');
    expect(router.currentRoute.value.name).toBe('listen');
    await router.push('/api-guide');
    expect(router.currentRoute.value.name).toBe('api-guide');
  });

  it('(209번) 로그인한 브라우저는 로그인 · 가입 화면 대신 처음 화면 + 알림', async () => {
    stubApi({ 'GET /api/auth/me': () => jsonResponse(200, ME) });
    const router = makeRouter();
    await router.push('/signup');
    expect(router.currentRoute.value.name).toBe('home');
    expect(useAuthStore().notice).toBe('이미 로그인되어 있습니다.');
  });

  it('me 호출이 실패하면 로그인 안 한 것으로 본다', async () => {
    stubApi({ 'GET /api/auth/me': () => jsonResponse(502, { error: { code: 'WEB_UNAVAILABLE', message: '', gate: null, retry_after: null } }) });
    const router = makeRouter();
    await router.push('/');
    expect(router.currentRoute.value.name).toBe('login');
  });
});

describe('S0 로그인 · 가입 화면', () => {
  async function open(path: string) {
    const router = makeRouter();
    await router.push(path);
    const w = mount(S0Login, { global: { plugins: [router] } });
    return { router, w };
  }

  it('로그인하면 계약 모양({ email, password })으로 보내고 next 로 돌아간다', async () => {
    const calls = stubApi({ 'GET /api/auth/me': () => jsonResponse(200, GUEST), 'POST /api/auth/login': () => jsonResponse(200, ME) });
    const { router, w } = await open('/login?next=/api-guide');
    await w.get('#auth-email').setValue('a@b.kr');
    await w.get('#auth-pw').setValue('password1');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c[1] === '/api/auth/login')?.[2]).toEqual({ email: 'a@b.kr', password: 'password1' });
    expect(router.currentRoute.value.fullPath).toBe('/api-guide');
    expect(useAuthStore().account?.display_name).toBe('가나');
  });

  it('가입은 { email, password, name } — 비밀번호 8자 미만이면 버튼이 막힌다', async () => {
    const calls = stubApi({ 'GET /api/auth/me': () => jsonResponse(200, GUEST), 'POST /api/auth/signup': () => jsonResponse(201, ME) });
    const { w } = await open('/login?tab=signup');
    await w.get('#auth-email').setValue('a@b.kr');
    await w.get('#auth-pw').setValue('short');
    await w.get('#auth-name').setValue(' 가나 ');
    expect(w.get('button[type="submit"]').attributes('aria-disabled')).toBe('true');
    await w.get('#auth-pw').setValue('password1');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c[1] === '/api/auth/signup')?.[2]).toEqual({ email: 'a@b.kr', password: 'password1', name: '가나' });
  });

  it('next 는 같은 사이트 경로만 — 바깥 주소면 처음 화면으로', async () => {
    stubApi({ 'GET /api/auth/me': () => jsonResponse(200, GUEST), 'POST /api/auth/login': () => jsonResponse(200, ME) });
    const { router, w } = await open('/login?next=//evil.example/x');
    await w.get('#auth-email').setValue('a@b.kr');
    await w.get('#auth-pw').setValue('password1');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).not.toContain('evil');
  });

  it('실패하면 서버 문구를 보이고 비밀번호를 비운다 (LOGIN_FAILED)', async () => {
    stubApi({
      'GET /api/auth/me': () => jsonResponse(200, GUEST),
      'POST /api/auth/login': () => jsonResponse(401, { error: { code: 'LOGIN_FAILED', message: '이메일이나 비밀번호가 맞지 않습니다.', fix: '다시 넣어 주십시오.', gate: 'G15', retry_after: null } }),
    });
    const { w } = await open('/login');
    await w.get('#auth-email').setValue('a@b.kr');
    await w.get('#auth-pw').setValue('wrong-password');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(w.get('[data-test="auth-fail"]').text()).toContain('이메일이나 비밀번호가 맞지 않습니다.');
    expect((w.get('#auth-pw').element as HTMLInputElement).value).toBe('');
  });

  it('잠김(LOGIN_LOCKED)이면 버튼을 막고, 다시 시도 시각이 지나면 푼다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    stubApi({
      'GET /api/auth/me': () => jsonResponse(200, GUEST),
      'POST /api/auth/login': () => jsonResponse(423, { error: {
        code: 'LOGIN_LOCKED', message: '잠시 로그인할 수 없습니다.', fix: '잠금이 풀린 뒤 로그인해 주십시오.', gate: 'G15',
        retry_after: new Date(Date.now() + 600_000).toISOString() } }),
    });
    const { w } = await open('/login');
    await w.get('#auth-email').setValue('a@b.kr');
    await w.get('#auth-pw').setValue('wrong-password');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('잠시 로그인할 수 없습니다.');
    await w.get('#auth-pw').setValue('password1');
    expect(w.get('button[type="submit"]').attributes('aria-disabled')).toBe('true');
    vi.advanceTimersByTime(600_000);
    await flushPromises();
    expect(w.get('button[type="submit"]').attributes('aria-disabled')).toBeUndefined();
  });
});

describe('머리 메뉴', () => {
  it('로그인했으면 "○○ 님 · [로그아웃]", 로그아웃하면 로그인 화면으로', async () => {
    const calls = stubApi({
      'GET /api/auth/me': () => jsonResponse(200, ME),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    const router = makeRouter();
    await router.push('/api-guide');
    const w = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('.who').text()).toContain('가나 님');
    await w.get('.who button').trigger('click');
    await flushPromises();
    expect(calls.some((c) => c[0] === 'POST' && c[1] === '/api/auth/logout')).toBe(true);
    expect(useAuthStore().loggedIn).toBe(false);
    expect(router.currentRoute.value.name).toBe('login');
  });

  it('로그인 안 했으면 [로그인] 링크가 지금 주소를 next 로 싣는다 · 관리자 링크는 없다', async () => {
    stubApi({ 'GET /api/auth/me': () => jsonResponse(200, GUEST) });
    const router = makeRouter();
    await router.push('/api-guide');
    const w = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.get('.who a').attributes('href')).toBe('/login?next=/api-guide');
    expect(w.html()).not.toContain('admin');
  });

  it('(209번) 알림은 [닫기] · 6초 뒤 사라진다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubApi({ 'GET /api/auth/me': () => jsonResponse(200, ME) });
    const router = makeRouter();
    await router.push('/api-guide');
    const w = mount(App, { global: { plugins: [router] } });
    useAuthStore().notice = '이미 로그인되어 있습니다.';
    await flushPromises();
    expect(w.get('[data-test="site-notice"]').attributes('role')).toBe('status');
    vi.advanceTimersByTime(6000);
    await flushPromises();
    expect(w.find('[data-test="site-notice"]').exists()).toBe(false);
  });
});
