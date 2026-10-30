// 2026-09-30 황송해 53~69 — 단계 이동 · 화면 다듬기 · 서비스 이름 · 그리지 못한 이유
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import StepNav from '@/components/StepNav.vue';
import C3ResultBand from '@/components/C3ResultBand.vue';
import C4InstrumentPicker from '@/components/C4InstrumentPicker.vue';
import { precheck } from '@/lib/scoreCheck';
import type { InstrumentCatalog, Recommendation } from '@/types/api';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('StepNav [이전] [다음](63번)', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }, { path: '/x', name: 'x', component: { render: () => null } }] });
  it('이전 · 다음 링크, 막힘 이유, 이벤트', async () => {
    const w = mount(StepNav, { props: { prev: true, prevTo: { name: 'x' }, next: true, nextReason: '먼저 고르십시오' }, global: { plugins: [router] } });
    expect(w.get('[data-test="step-prev"]').text()).toContain('이전');
    expect(w.get('[data-test="step-next"] button').attributes('aria-disabled')).toBe('true');
    expect(w.text()).toContain('먼저 고르십시오');
    const n = mount(StepNav, { props: { next: true }, global: { plugins: [router] } });
    expect(n.find('[data-test="step-prev"]').exists()).toBe(false);
    await n.get('[data-test="step-next"] button').trigger('click');
    expect(n.emitted('next')).toHaveLength(1);
  });
});

describe('화면 다듬기(소스 · 부품)', () => {
  it('53 S2: 원본과 같으면 편집 상태 줄 · [원본으로 되돌리기] 숨김 / 56 전체 음 반음씩 옮기기 흰 카드 / 57 ens-h 없음', () => {
    const src = read('src/pages/S2Edit.vue');
    expect(src).toContain(`v-if="ed.isEdited || ed.listenMode !== 'edit' || ed.saveState === 'failed'" class="status-line status-end layout-row"`);
    expect(src).toContain('전체 음 반음씩 옮기기');
    expect(src.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('조옮김 (반음)');
    expect(src).toMatch(/\.transpose-card \{[^}]*background: var\(--color-white\)/);
    expect(src).not.toContain('id="ens-h"');
    // (2026-09-30 93번) 전체 구성 고르기(C4 big-legend)는 뺐다
    expect(src).not.toContain('big-legend');
    expect(src).toMatch(/<StepNav\s+prev :prev-to="\{ name: 'home', query: \{ r: requestNo \} \}"/);
  });
  it('54 짧은 띠: 정상(trust)이면 "완료 · 결과 악보입니다" 없음, 주의는 그대로', () => {
    expect(mount(C3ResultBand, { props: { band: 'trust', variant: 'short' } }).text()).toBe('');
    expect(mount(C3ResultBand, { props: { band: 'caution', variant: 'short' } }).text()).toContain('주의');
  });
  it('55 C5 상태 글 줄(.status.small) 없음', () => {
    expect(read('src/components/C5PlayerBar.vue')).not.toMatch(/class="status small"/);
  });
  it('58 · 59 C4: 준비 중 안내 · [다시 추천받기] · [기본으로 되돌리기] 없음', () => {
    const catalog = { default_set: ['gayageum'], gugak: [{ id: 'gayageum', name: '가야금', group: 'gugak', percussion: false }], others: [] } as unknown as InstrumentCatalog;
    const rec = { available: true, pending: true, reason: null, combinations: [], model: null, features: null } as unknown as Recommendation;
    const w = mount(C4InstrumentPicker, { props: { catalog, modelValue: { kind: 'default' } as never, recommendation: rec } });
    expect(w.text()).not.toMatch(/다시 추천받기|AI 추천 모델을 준비 중|기본으로 되돌리기/);
    expect(w.find('.chip.s-waiting').exists()).toBe(false);
  });
  it('61 "완료" 칩 · 단계 숫자는 갈색', () => {
    expect(read('src/styles/tokens.css')).toMatch(/--status-done: var\(--color-clay-brown\)/);
    expect(read('src/components/C9StepBar.vue')).toMatch(/\.on \.num \{ background: var\(--color-primary\)/);
  });
  it('62 서비스 이름 Klassic(머리 · 탭 제목 · 바닥글 · 관리자)', () => {
    const app = read('src/App.vue');
    // (2026-09-30 86번) K 는 금색 span → (2026-10-01 203번) 금색 K 뺌, 글자 그대로 Klassic
    expect(app).toContain('<span class="brand-name">Klassic</span>');
    expect(app).toContain('aria-label="Klassic 처음으로"');
    // (2026-09-30 175번) 바닥글은 "Klassic"만 남김 — "3팀"은 뺐다
    expect(app).toContain('<span class="slim-brand">Klassic</span>');
    expect(app.split('<footer')[1].replace(/<!--[\s\S]*?-->/g, '')).not.toContain('3팀');
    expect(app).not.toContain('국악보 변환');
    expect(read('src/router.ts')).toContain("· Klassic`");
    expect(read('index.html')).toContain('<title>Klassic');
    expect(read('admin.html')).toContain('<title>Klassic');
    expect(read('src/admin/components/C7AdminBar.vue')).toContain('Klassic 관리자');
  });
});

describe('64 악보를 그리지 못한 이유', () => {
  it('비었음 · 형식 오류 · MusicXML 아님 · 음표 없음을 가려 말한다', () => {
    expect(precheck('  ')).toContain('비어 있어');
    expect(precheck('<score-partwise><part>')).toContain('형식이 맞지 않아');
    expect(precheck('<html></html>')).toContain('MusicXML)이 아니라서');
    expect(precheck('<score-partwise><part id="P1"><measure><note><rest/></note></measure></part></score-partwise>')).toContain('음표를 찾지 못해');
    expect(precheck('<score-partwise><part id="P1"><measure><note><pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>')).toBeNull();
  });
});

vi.mock('opensheetmusicdisplay', () => ({
  OpenSheetMusicDisplay: class { async load() { throw new Error('bad measure'); } render() {} },
}));
describe('64 그리기 도구가 실패하면 그 원인을 적는다', () => {
  it('읽는 중 오류 → "읽는 중 문제 … (자세히: …)"', async () => {
    const { default: ScoreView } = await import('@/components/ScoreView.vue');
    const xml = '<score-partwise><part id="P1"><measure><note><pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>';
    const w = mount(ScoreView, { props: { musicxml: xml } });
    await flushPromises(); await flushPromises();
    expect(w.get('[data-test="draw-fail"]').text()).toContain('악보 파일을 읽는 중 문제가 생겨 그리지 못했습니다 (자세히: bad measure).');
    const e = mount(ScoreView, { props: { musicxml: '<score-partwise><part id="P1"><measure/></part></score-partwise>' } });
    await flushPromises();
    expect(e.get('[data-test="draw-fail"]').text()).toContain('음표를 찾지 못해');
  });
});

describe('60 [이전](2단계 → 1단계)은 나가기 확인 없이', () => {
  it('allowNextLeave 뒤 한 번은 묻지 않는다', async () => {
    const { allowNextLeave, useLeaveGuard, LEAVE_TITLE } = await import('@/composables/useLeaveGuard');
    const { ref } = await import('vue');
    const LeaveConfirm = (await import('@/components/LeaveConfirm.vue')).default;
    const G = defineComponent({ setup() { const l = useLeaveGuard(ref(true), ref('R-1')); return () => h('div', [l.open.value ? h(LeaveConfirm, { title: LEAVE_TITLE, lines: [] }) : null]); } });
    const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/r', name: 'listen', component: G }, { path: '/', name: 'home', component: { render: () => null } }] });
    await r.push('/r');
    const w = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [r] }, attachTo: document.body });
    await flushPromises();
    allowNextLeave();
    await r.push({ name: 'home' });
    expect(r.currentRoute.value.name).toBe('home');
    expect(document.querySelector('[data-test="leave-confirm"]')).toBeNull();
    w.unmount();
  });
});
