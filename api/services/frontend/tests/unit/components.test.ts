// 공통 부품 (#38) — C9 단계 표시는 v0.1.1 stepsAndNotes.test.ts 의 같은 시험을 옮겼다
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import C9StepBar from '@/components/C9StepBar.vue';
import GuardedButton from '@/components/GuardedButton.vue';
import LeaveConfirm from '@/components/LeaveConfirm.vue';
import PageNav from '@/components/PageNav.vue';
import StepNav from '@/components/StepNav.vue';
import { isSameFlow } from '@/composables/useLeaveGuard';
import { routes } from '@/router';

describe('C9 단계 표시', () => {
  it('3단계 화면: 1·2·3 켜짐, 3이 지금(aria-current), 4는 꺼짐 · 이름 표시 · 요청 번호 없음', () => {
    const w = mount(C9StepBar, { props: { current: 3 } });
    const li = (n: number) => w.get(`[data-test="step-${n}"]`);
    expect([1, 2, 3, 4].map((n) => li(n).classes().includes('on'))).toEqual([true, true, true, false]);
    expect(li(3).attributes('aria-current')).toBe('step');
    expect(li(3).classes()).toContain('now');
    expect(li(1).attributes('aria-current')).toBeUndefined();
    expect(w.text()).toContain('1단계');
    expect(w.findAll('.name').map((n) => n.text())).toEqual(['악보 올리기', '다른 악기로 변환하기', '악보 음계 변환하기', '저장하기']);
    expect(w.text()).not.toMatch(/R-|—/);
  });
  it('1단계 화면: 1만 켜짐', () => {
    const w = mount(C9StepBar, { props: { current: 1 } });
    expect(w.findAll('li.on')).toHaveLength(1);
  });
});

describe('GuardedButton — 막힌 이유를 글자로', () => {
  it('이유가 있으면 누름을 막고 aria-describedby 로 이유를 읽힌다', async () => {
    const w = mount(GuardedButton, { props: { reason: '악보를 먼저 올리십시오' }, slots: { default: '다음' } });
    await w.get('button').trigger('click');
    expect(w.emitted('click')).toBeUndefined();
    expect(w.get('button').attributes('aria-disabled')).toBe('true');
    const why = w.get('.why');
    expect(why.text()).toBe('사유: 악보를 먼저 올리십시오');
    expect(w.get('button').attributes('aria-describedby')).toBe(why.attributes('id'));
  });
  it('이유가 없으면 click 을 낸다', async () => {
    const w = mount(GuardedButton, { slots: { default: '다음' } });
    await w.get('button').trigger('click');
    expect(w.emitted('click')).toHaveLength(1);
  });
});

describe('StepNav — [이전] [다음]', () => {
  it('nextReason 이 있으면 [다음]이 막힌다', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    const w = mount(StepNav, { props: { prev: true, next: true, nextReason: '고를 악기가 없습니다' }, global: { plugins: [router] } });
    expect(w.text()).toContain('이전');
    expect(w.text()).toContain('사유: 고를 악기가 없습니다');
  });
});

describe('PageNav — 쪽 넘기기', () => {
  it('지금 쪽은 aria-current, 처음 쪽에서 [이전]은 막힘, 다른 쪽을 누르면 go', async () => {
    const w = mount(PageNav, { props: { page: 1, pages: 3, hasNext: true, label: '쪽' } });
    expect(w.get('[data-test="page-1"]').attributes('aria-current')).toBe('page');
    expect(w.get('[data-test="page-prev"]').attributes('disabled')).toBeDefined();
    await w.get('[data-test="page-3"]').trigger('click');
    expect(w.emitted('go')).toEqual([[3]]);
  });
});

describe('LeaveConfirm — 나가기 확인 창', () => {
  it('열리면 [취소]에 초점, Esc 는 취소, [나가기]는 confirm', async () => {
    const w = mount(LeaveConfirm, { props: { title: '나가시겠습니까?', lines: ['편집이 사라집니다.'] }, attachTo: document.body });
    expect(document.activeElement).toBe(w.get('[data-test="leave-cancel"]').element);
    await w.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    expect(w.emitted('cancel')).toHaveLength(1);
    await w.get('[data-test="leave-ok"]').trigger('click');
    expect(w.emitted('confirm')).toHaveLength(1);
    w.unmount();
  });
});

describe('같은 악보 흐름 판정', () => {
  it('결과 · 편집 · 내려받기 사이는 같은 흐름, 다른 요청이나 다른 화면은 아님', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    const to = (path: string) => router.resolve(path) as Parameters<typeof isSameFlow>[0];
    expect(isSameFlow(to('/?r=12'), '12')).toBe(true);
    expect(isSameFlow(to('/r/12/listen'), '12')).toBe(true);
    expect(isSameFlow(to('/r/12/download'), '12')).toBe(true);
    expect(isSameFlow(to('/r/13/listen'), '12')).toBe(false);
    expect(isSameFlow(to('/api-guide'), '12')).toBe(false);
    expect(isSameFlow(to('/r/12/listen'), null)).toBe(false);
  });
});
