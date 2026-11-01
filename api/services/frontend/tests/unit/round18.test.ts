// 164~166 (2026-09-30 황송해 결정 — SD_02 머리말 · §4-3 · §4-7 S1-T · UC_01 A10 · UC_07 A9)
// 164 내가 만든 악보를 1단계로 · 165 체험하기(/tour, 로그인 없이, 6장, 키보드 · aria) · 166 움직임(동작 줄이기면 끔)
// #46: 164 · 165 · 166 · 167(내가 만든 악보 · 체험하기)은 P2 — 그 화면을 옮길 때 v0.1.1 에서 되살린다. 169~172 로그인 화면만 남겼다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { router as appRouter } from '@/router';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('169~172 로그인 화면', () => {
  async function mountLogin(path: string) {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/tour', name: 'tour', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      appRouter.getRoutes().find((r) => r.path === '/signup') as never,
    ] });
    await router.push(path);
    await router.isReady();
    const S0 = (await import('@/pages/S0Login.vue')).default;
    const w = mount(S0, { global: { plugins: [router] } });
    await flushPromises();
    return { w, router };
  }
  it('제목 문구 · 탭 없음, 버튼 가운데, 안내 문구와 가입하기 링크, [체험하기] 그대로', async () => {
    const { w, router } = await mountLogin('/login?next=/r/R-1/listen');
    expect(w.text()).not.toContain('로그인하고 악보를 올려 보십시오');
    expect(w.find('[role="tablist"]').exists()).toBe(false);
    expect(w.find('[role="tab"]').exists()).toBe(false);
    expect(w.get('[data-test="submit-row"]').find('button[type="submit"]').text()).toBe('로그인');
    expect(read('src/pages/S0Login.vue')).toMatch(/\.submit-row \{[^}]*align-items: center/);
    expect(w.get('[data-test="to-signup"]').text()).toBe('처음이십니까? 가입하기에서 이메일로 바로 가입할 수 있습니다.');
    expect(w.find('[data-test="tour-open"]').exists()).toBe(true);
    await w.get('[data-test="to-signup"] a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'signup', next: '/r/R-1/listen' });
    expect(w.find('#auth-name').exists()).toBe(true);
    expect(w.get('[data-test="submit-row"] button').text()).toBe('가입하기');
    // 가입 화면에서 로그인으로 돌아오는 링크
    expect(w.get('[data-test="to-login"]').text()).toBe('이미 계정이 있으십니까? 로그인');
    await w.get('[data-test="to-login"] a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    expect(w.find('#auth-name').exists()).toBe(false);
  });
  it('주소로 바로 가입 화면: /login?tab=signup · /signup', async () => {
    const a = await mountLogin('/login?tab=signup');
    expect(a.w.find('#auth-name').exists()).toBe(true);
    const b = await mountLogin('/signup?next=/');
    expect(b.router.currentRoute.value.name).toBe('login');
    expect(b.router.currentRoute.value.query).toMatchObject({ tab: 'signup', next: '/' });
    expect(b.w.find('#auth-name').exists()).toBe(true);
  });
});
