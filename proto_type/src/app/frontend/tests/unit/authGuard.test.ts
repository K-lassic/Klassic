// 2026-09-29 RBAC — S1~S3 은 로그인해야 열리고(/login?next=), S0 는 잠김(G15)이면 버튼을 막는다 (SD_02 §9B · UC16 A2·E4)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('로그인 가드', () => {
  beforeEach(() => { setActivePinia(createPinia()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('로그인 안 했으면 S1 대신 /login?next= 로 간다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { account: null, roles: [] })));
    const { router } = await import('../../src/router');
    await router.push('/');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.next).toBe('/');
  });

  it('로그인했으면 그대로 연다, API활용은 누구나', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { account: { account_id: 1, login_id: 'a@b.kr', display_name: '가' }, roles: ['user'] })));
    const { router } = await import('../../src/router');
    await router.push('/r/R-0929-AAAA1111/listen');
    expect(router.currentRoute.value.name).toBe('listen');
    await router.push('/api-guide');
    expect(router.currentRoute.value.name).toBe('api-guide');
  });
});

describe('S0 로그인 화면', () => {
  beforeEach(() => { setActivePinia(createPinia()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('잠김(LOGIN_LOCKED)이면 G15 차단 블록을 보이고 로그인 버튼을 막는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(423, { error: {
      code: 'LOGIN_LOCKED', message: '잠시 로그인할 수 없습니다.', fix: '잠금이 풀린 뒤 로그인해 주십시오.', gate: 'G15',
      retry_after: new Date(Date.now() + 600_000).toISOString(), details: {} } })));
    const { router } = await import('../../src/router');
    const S0 = (await import('../../src/pages/S0Login.vue')).default;
    await router.push('/login?next=/');
    const w = mount(S0, { global: { plugins: [router] } });
    await w.get('#auth-email').setValue('a@b.kr');
    await w.get('#auth-pw').setValue('wrong-password');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('G15 로그인 잠금');
    expect(w.get('button[type="submit"]').attributes('aria-disabled')).toBe('true');
  });
});
