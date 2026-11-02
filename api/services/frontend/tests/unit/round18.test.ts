// 164~166 (2026-09-30 황송해 결정 — SD_02 머리말 · §4-3 · §4-7 S1-T · UC_01 A10 · UC_07 A9)
// 164 내가 만든 악보를 1단계로 · 165 체험하기(/tour, 로그인 없이, 6장, 키보드 · aria) · 166 움직임(동작 줄이기면 끔)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import S1Upload from '@/pages/S1Upload.vue';
import S1Tour from '@/pages/S1Tour.vue';
import { TOUR_SLIDES } from '@/lib/tour';
import { useAuthStore } from '@/stores/auth';
import { router as appRouter } from '@/router';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const noComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');

beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('164 내가 만든 악보 — 1단계로', () => {
  const stubs = { RouterLink: { template: '<a><slot /></a>' }, SharedScoreList: { template: '<section data-test="shared-stub" />' } };
  it('로그인했으면 [다음] 줄 아래 · 악보 공유하기 위에 목록, 4단계에는 없음', async () => {
    const fetch = vi.fn(async (url: string) => (String(url).includes('/api/my-scores')
      ? json({ items: [{ id: 'R-1', title: '아리랑 세마치', file_name: 'a.png', score_type: 'staff', created_at: '2026-09-30T05:02:00Z', expires_at: 'x', remaining_seconds: 3 * 3600, edited: false, edit_ops: null, midi_available: true, fallback: false }] })
      : json({ models: [] })));
    vi.stubGlobal('fetch', fetch);
    useAuthStore().set({ account: { account_id: 1, login_id: 'a@b.c', display_name: '가' }, roles: ['user'] });
    const w = mount(S1Upload, { global: { stubs } });
    await flushPromises();
    const html = w.html();
    const nav = html.indexOf('data-test="step-nav"');
    const mine = html.indexOf('data-test="my-scores"');
    const shared = html.indexOf('data-test="shared-stub"');
    expect(nav).toBeGreaterThan(-1);
    expect(mine).toBeGreaterThan(nav);
    expect(shared).toBeGreaterThan(mine);
    expect(w.findAll('[data-test="my-row"]')).toHaveLength(1);
    // [받기]는 1단계에서도 그 줄 아래 받기 카드(형식 골라 받기)
    await w.get('[data-test="my-download"]').trigger('click');
    expect(w.find('[data-test="download-card"]').exists()).toBe(true);
    expect(read('src/pages/S3Download.vue')).not.toContain('<MyScoresList');
  });
  it('로그인하지 않았으면 목록 영역이 없고 목록도 부르지 않는다', async () => {
    const fetch = vi.fn(async () => json({ models: [] }));
    vi.stubGlobal('fetch', fetch);
    const w = mount(S1Upload, { global: { stubs } });
    await flushPromises();
    expect(w.find('[data-test="my-scores"]').exists()).toBe(false);
    expect(fetch.mock.calls.some((c) => String(c[0]).includes('/api/my-scores'))).toBe(false);
  });
});

describe('165 체험하기', () => {
  it('/tour 는 로그인 없이 열린다 · 로그인 화면에 [체험하기] (183번: 1단계에서는 뺌)', () => {
    const r = appRouter.getRoutes().find((x) => x.path === '/tour');
    expect(r).toBeTruthy();
    expect(r?.meta.requiresLogin).toBeFalsy();
    expect(noComments(read('src/pages/S1Upload.vue'))).not.toContain('tour-open');
    expect(noComments(read('src/pages/S0Login.vue'))).toContain('data-test="tour-open">체험하기</RouterLink>');
  });
  it('최대 6장 · 합쇼체 · "—" 없음', () => {
    expect(TOUR_SLIDES.length).toBeLessThanOrEqual(6);
    expect(TOUR_SLIDES.map((s) => s.title)).toEqual(['Klassic 을 소개합니다', '1단계 · 악보 올리기', '2단계 · 다른 악기로 변환하기', '3단계 · 악보 음계 변환하기', '4단계 · 저장하기', '악보 공유하기']);
    for (const s of TOUR_SLIDES) {
      for (const l of s.lines) { expect(l).toMatch(/(니다|십시오)\.$/); expect(l).not.toContain('—'); }
    }
    const tpl = noComments(read('src/pages/S1Tour.vue').split('<template>').slice(1).join('<template>').split('<style')[0]);
    expect(tpl).not.toContain('—');
  });

  async function mountTour() {
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/tour', name: 'tour', component: S1Tour },
    ] });
    await router.push('/tour');
    await router.isReady();
    const w = mount(S1Tour, { attachTo: document.body, global: { plugins: [router] } });
    await flushPromises();
    return { w, router };
  }

  it('dialog · aria-live 장 번호 · 점 표시 · [이전]/[다음] · ←→ 키 · 마지막 장 [지금 시작하기]', async () => {
    const { w, router } = await mountTour();
    const dlg = w.get('[role="dialog"]');
    expect(dlg.attributes('aria-modal')).toBe('true');
    expect(dlg.attributes('aria-labelledby')).toBe('tour-title');
    expect(w.get('[data-test="tour-count"]').attributes('aria-live')).toBe('polite');
    expect(w.get('[data-test="tour-count"]').text()).toBe('1 / 6');
    expect(w.findAll('.dot')).toHaveLength(6);
    expect(w.get('[data-test="tour-dot-1"]').attributes('aria-current')).toBe('step');
    expect(w.get('[data-test="tour-prev"]').attributes('disabled')).toBeDefined();
    expect(document.activeElement?.id).toBe('tour-title');

    await w.get('[data-test="tour-next"]').trigger('click');
    expect(w.get('[data-test="tour-count"]').text()).toBe('2 / 6');
    expect(w.get('#tour-title').text()).toBe('1단계 · 악보 올리기');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await flushPromises();
    expect(w.get('[data-test="tour-count"]').text()).toBe('3 / 6');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await flushPromises();
    expect(w.get('[data-test="tour-count"]').text()).toBe('2 / 6');

    await w.get('[data-test="tour-dot-6"]').trigger('click');
    expect(w.get('[data-test="tour-count"]').text()).toBe('6 / 6');
    expect(w.find('[data-test="tour-next"]').exists()).toBe(false);
    expect(w.find('[data-test="tour-close"]').exists()).toBe(false); // 188번: [닫기] 뺌(✕ 로 닫음)
    expect(w.find('[data-test="tour-x"]').exists()).toBe(true);
    await w.get('[data-test="tour-start"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('home');
    w.unmount();
  });

  it('Esc 로 닫는다(주소로 바로 열었으면 1단계로)', async () => {
    const { w, router } = await mountTour();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('home');
    w.unmount();
  });

  it('장마다 그 단계 그림(모형)이 있다', async () => {
    const { w } = await mountTour();
    const pics: string[] = [];
    for (let i = 0; i < 6; i++) {
      pics.push(w.get('[data-test="tour-pic"]').classes().find((c) => c.startsWith('pic-')) ?? '');
      if (i < 5) await w.get('[data-test="tour-next"]').trigger('click');
    }
    expect(pics).toEqual(['pic-intro', 'pic-upload', 'pic-instrument', 'pic-pitch', 'pic-save', 'pic-share']);
    w.unmount();
  });
});

describe('166 움직임', () => {
  it('장 넘김 미끄러짐 · 그림 움직임 · 동작 줄이기면 끔 · 새 색 없음', () => {
    const src = read('src/pages/S1Tour.vue');
    expect(src).toContain('<Transition :name="`slide-${dir}`"');
    // (168번) 장마다 되풀이 장면(3.6초) · 글자 차례로 떠오름
    expect(src).toContain('--loop: 3.6s');
    expect(src).toContain('@keyframes tour-rise-in');
    for (const k of ['intro-dot', 'up-drag', 'up-fill', 'inst-flip', 'inst-color', 'pitch-note', 'pitch-btn', 'save-arrow', 'share-row', 'share-on']) expect(src).toContain(`@keyframes ${k}`);
    expect((src.match(/var\(--loop\)[^;]*infinite/g) ?? []).length).toBeGreaterThanOrEqual(20);
    // (2026-10-01 210번) 운영체제 동작 줄이기(@media) 대신 [움직임 줄이기]를 누른 창(.tour.calm)에만 약한 움직임
    const reduce = src.slice(src.indexOf('.tour.calm .slide-next-enter-active'));
    // (182번) 위치가 움직이지 않는 약한 움직임(나타나기 · 색)은 남긴다
    const media = reduce.slice(0, reduce.indexOf('@keyframes tour-fade-in'));
    expect(media).toContain('.tour.calm .pic *, .tour.calm .pic *::before, .tour.calm .pic *::after { animation: none; }');
    expect(media).toContain('.tour.calm .rise { animation-name: tour-fade-in; }');
    for (const k of ['rm-lit1', 'rm-inst', 'rm-pitch', 'rm-f1', 'rm-hon', 'inst-color', 'up-zone']) expect(media).toContain(k);
    expect(media).toContain('.tour.calm .drag, .tour.calm .flow-dot, .tour.calm .dl-arrow, .tour.calm .h-fly, .tour.calm .playhead, .tour.calm .pcur { display: none; }');
    // 동작 줄이기용 키프레임에는 위치 · 크기 변화(transform · left · width)가 없다
    const rmFrames = reduce.slice(reduce.indexOf('@keyframes tour-fade-in'));
    expect(rmFrames).not.toMatch(/transform|left:|width:/);
    // 색은 토큰만 — 겹 가림막(먹 40%, LeaveConfirm 과 같음) 말고는 # 색 값을 쓰지 않는다
    const style = src.slice(src.indexOf('<style'));
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('167 내가 만든 악보 설명', () => {
  it('24시간 보관 문장 없음', () => {
    const t = noComments(read('src/components/MyScoresList.vue').split('<template>')[1]);
    expect(t).not.toContain('24시간');
  });
  it('199 설명 문장 없음', () => {
    const t = noComments(read('src/components/MyScoresList.vue').split('<template>')[1]);
    expect(t).not.toContain('이 계정으로 만든 악보입니다');
    expect(t).not.toContain('data-test="my-desc"');
  });
  it('200 · 201 작업 버튼 · 만든 시각 · 남은 시간 가운데', () => {
    const src = read('src/components/MyScoresList.vue');
    expect(src).toMatch(/\.acts \{[^}]*justify-content: center/);
    expect(src).toMatch(/td\.c \{ text-align: center; \}/);
    expect(src).toContain('<td class="c">{{ clock(it.created_at) }}</td>');
    expect(src).toContain('<td class="c">{{ left(it.remaining_seconds) }}</td>');
  });
});

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
