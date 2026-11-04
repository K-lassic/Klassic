// (2026-10-01 황송해 210 · 211번) 체험하기는 운영체제 동작 줄이기와 관계없이 늘 움직임 + [움직임 줄이기] 단추, 4단계 나가기 경고 없음
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import S1Tour from '@/pages/S1Tour.vue';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

async function mountTour() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'home', component: { template: '<div />' } }, { path: '/tour', name: 'tour', component: S1Tour }] });
  await router.push('/tour');
  return mount(S1Tour, { global: { plugins: [router] }, attachTo: document.body });
}

describe('210 체험하기 움직임', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() });
  });

  it('운영체제 동작 줄이기(@media)에 걸지 않고 .calm 에만 약한 움직임', () => {
    const t = read('src/pages/S1Tour.vue');
    const style = t.slice(t.indexOf('<style'));
    expect(style).not.toContain('@media (prefers-reduced-motion');
    expect(style).toContain('.tour.calm .pic *, .tour.calm .pic *::before, .tour.calm .pic *::after { animation: none; }');
    expect(style).toContain('.tour.calm .tile { animation: rm-lit1');
  });
  it('[움직임 줄이기] 누르면 .calm · aria-pressed · 글자 바뀜 · 이 브라우저에 기억', async () => {
    const w = await mountTour();
    const btn = w.get('[data-test="tour-calm"]');
    expect(btn.text()).toBe('움직임 줄이기');
    expect(btn.attributes('aria-pressed')).toBe('false');
    expect(w.get('.tour').classes()).not.toContain('calm');
    await btn.trigger('click');
    expect(w.get('.tour').classes()).toContain('calm');
    expect(w.get('[data-test="tour-calm"]').attributes('aria-pressed')).toBe('true');
    expect(w.get('[data-test="tour-calm"]').text()).toBe('움직임 켜기');
    expect(localStorage.getItem('klassic.tour.calm')).toBe('1');
    w.unmount();
  });
});

describe('211 4단계 나가기 경고 없음', () => {
  it('S3Download 는 나가기 경고를 쓰지 않는다', () => {
    const t = read('src/pages/S3Download.vue');
    expect(t).not.toContain('useLeaveGuard(');
    expect(t).not.toContain('<LeaveConfirm');
  });
});

describe('(2026-11-03 #146) 체험하기 장을 넘겨도 [다음] 버튼이 오르내리지 않음', () => {
  it('여섯 장 제목 · 문장을 보이지 않게 겹쳐 높이를 맞추고, 그림 상자 높이는 고정', async () => {
    const w = await mountTour();
    const sizers = w.findAll('.tour-sizer');
    expect(sizers).toHaveLength(6);
    for (const s of sizers) expect(s.attributes('aria-hidden')).toBe('true');
    // 높이 맞춤용 사본에는 id · 시험 표시가 없어 진짜 장과 겹치지 않는다
    expect(w.findAll('#tour-title')).toHaveLength(1);
    expect(w.findAll('[data-test="tour-pic"]')).toHaveLength(1);
    const src = read('src/pages/S1Tour.vue');
    const style = src.slice(src.indexOf('<style'));
    expect(style).toContain('.tour-sizer { visibility: hidden;');
    expect(style).toMatch(/\.pic \{[^}]*height: 260px;/);
    expect(src).not.toContain('mode="out-in"');
    w.unmount();
  });
});
