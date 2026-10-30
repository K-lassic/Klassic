// SA 로그인 G5 — 잠김(423) 뒤 다시 시도까지 초를 세고, 끝나면 로그인 버튼이 돌아온다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { GateError } from '../../src/api/client';
import { formatRemaining, remainingSeconds, retryAtFromError } from '../../src/admin/lib/lockout';
import SALogin from '../../src/admin/pages/SALogin.vue';
import { useSessionStore } from '../../src/admin/stores/session';

describe('lockout 계산', () => {
  it('남은 초는 올림, 지나면 0', () => {
    const now = Date.parse('2026-09-28T10:00:00Z');
    expect(remainingSeconds(new Date(now + 29_100), now)).toBe(30);
    expect(remainingSeconds(new Date(now - 1), now)).toBe(0);
    expect(remainingSeconds(null, now)).toBe(0);
  });
  it('retry_after 는 ISO 시각이나 초 숫자 모두 받는다', () => {
    const now = Date.parse('2026-09-28T10:00:00Z');
    const iso = new GateError(423, { code: 'ADMIN_LOCKED', message: '', gate: 'G5', retry_after: '2026-09-28T10:05:00Z' });
    expect(retryAtFromError(iso, now)?.toISOString()).toBe('2026-09-28T10:05:00.000Z');
    const secs = new GateError(423, { code: 'ADMIN_LOCKED', message: '', gate: 'G5', retry_after: '90' });
    expect(retryAtFromError(secs, now)?.getTime()).toBe(now + 90_000);
    const none = new GateError(423, { code: 'ADMIN_LOCKED', message: '', gate: 'G5', retry_after: null });
    expect(retryAtFromError(none, now)).toBeNull();
  });
  it('남은 시간 글자', () => {
    expect(formatRemaining(30)).toBe('30초');
    expect(formatRemaining(65)).toBe('1분 5초');
    expect(formatRemaining(120)).toBe('2분');
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('SALogin 화면', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-09-28T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function setup(fetchImpl: (url: string) => Response) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => fetchImpl(url)));
    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSessionStore();
    session.state = 'anonymous';
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: SALogin },
        { path: '/ops/:tab', name: 'ops', component: { template: '<div>ops</div>' } },
      ],
    });
    await router.push('/login');
    await router.isReady();
    const wrapper = mount(SALogin, { global: { plugins: [pinia, router] }, attachTo: document.body });
    return { wrapper, session, router };
  }

  it('423 이면 잠김 블록과 남은 초를 보이고, 시간이 지나면 다시 로그인할 수 있다', async () => {
    const { wrapper } = await setup(() =>
      jsonResponse(423, { error: { code: 'ADMIN_LOCKED', message: '로그인 실패가 많아 잠시 잠겼습니다.', gate: 'G5', retry_after: '2026-09-28T10:00:30Z', details: {} } }),
    );
    await wrapper.get('#login-id').setValue('kimop');
    await wrapper.get('#login-pw').setValue('wrong');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const btn = () => wrapper.get('button[type="submit"]');
    expect(wrapper.text()).toContain('잠시 잠겼습니다');
    expect(wrapper.text()).toContain('30초');
    expect(btn().attributes('disabled')).toBeDefined();
    expect((wrapper.get('#login-pw').element as HTMLInputElement).value).toBe(''); // 비밀번호 칸은 비운다

    await vi.advanceTimersByTimeAsync(10_000);
    expect(wrapper.text()).toContain('20초');

    await vi.advanceTimersByTimeAsync(20_000);
    expect(wrapper.text()).not.toContain('잠시 잠겼습니다');
    expect(wrapper.text()).toContain('잠김이 풀렸습니다');
    await wrapper.get('#login-pw').setValue('again');
    expect(btn().attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('401 이면 "아이디나 비밀번호가 맞지 않습니다" (G5 로그인 실패)', async () => {
    const { wrapper } = await setup(() => jsonResponse(401, { error: { code: 'ADMIN_LOGIN_FAILED', message: 'x', gate: 'G5', retry_after: null } }));
    await wrapper.get('#login-id').setValue('kimop');
    await wrapper.get('#login-pw').setValue('bad');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('아이디나 비밀번호가 맞지 않습니다');
    expect(wrapper.get('#login-pw').attributes('aria-invalid')).toBe('true');
    wrapper.unmount();
  });

  it('403 이면 내부망 밖 블록 — 입력칸과 로그인 버튼이 막힌다', async () => {
    const { wrapper, session } = await setup(() => jsonResponse(403, { error: { code: 'ADMIN_NETWORK_DENIED', message: 'x', gate: 'G5', retry_after: null } }));
    session.state = 'blocked';
    await flushPromises();
    expect(wrapper.text()).toContain('내부망 밖에서 접속했습니다');
    expect(wrapper.get('#login-id').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('내부망에서만 로그인할 수 있습니다');
    wrapper.unmount();
  });
});
