// 나가기 경고 하나로 · 처리 중 예상 완료 시간 (2026-09-30 황송해 결정, SD_02 머리말 ⑫ · ⑮)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import LeaveConfirm from '@/components/LeaveConfirm.vue';
import { LEAVE_TITLE, allowLeaveForSessionExpiry, isSameFlow, resetLeaveBypass, useLeaveGuard } from '@/composables/useLeaveGuard';
import { useRequestStore } from '@/stores/request';
import type { RequestStatus } from '@/types/api';

const active = ref(true);
const Guarded = defineComponent({
  setup() {
    const leave = useLeaveGuard(active, ref('R-1'));
    return () => h('div', [leave.open.value ? h(LeaveConfirm, { title: LEAVE_TITLE, lines: [], onCancel: leave.cancel, onConfirm: leave.confirm }) : null]);
  },
});
const Blank = defineComponent({ render: () => h('p', 'other') });

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Guarded },
      { path: '/r/:requestNo/listen', name: 'listen', component: Guarded },
      { path: '/r/:requestNo/download', name: 'download', component: Guarded },
      { path: '/api-guide', name: 'api-guide', component: Blank },
    ],
  });
}

describe('useLeaveGuard', () => {
  beforeEach(() => { active.value = true; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('같은 악보 흐름(결과 · 편집 · 내려받기) 판단', () => {
    const r = makeRouter();
    expect(isSameFlow(r.resolve({ name: 'home', query: { r: 'R-1' } }), 'R-1')).toBe(true);
    expect(isSameFlow(r.resolve({ name: 'listen', params: { requestNo: 'R-1' } }), 'R-1')).toBe(true);
    expect(isSameFlow(r.resolve({ name: 'download', params: { requestNo: 'R-1' } }), 'R-1')).toBe(true);
    expect(isSameFlow(r.resolve({ name: 'home' }), 'R-1')).toBe(false);
    expect(isSameFlow(r.resolve({ name: 'listen', params: { requestNo: 'R-2' } }), 'R-1')).toBe(false);
    expect(isSameFlow(r.resolve({ name: 'api-guide' }), 'R-1')).toBe(false);
  });

  it('흐름 밖으로 가면 확인 창을 한 번 띄우고 [취소]면 머문다 · [나가기]면 간다 · 흐름 안 이동은 묻지 않는다', async () => {
    const router = makeRouter();
    await router.push({ name: 'listen', params: { requestNo: 'R-1' } });
    const w = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();

    // 흐름 안(편집 → 내려받기)은 그냥 간다
    await router.push({ name: 'download', params: { requestNo: 'R-1' } });
    expect(router.currentRoute.value.name).toBe('download');
    expect(w.find('[data-test="leave-confirm"]').exists()).toBe(false);

    // 머리 메뉴(API활용)로 가면 묻는다 — [취소]
    const nav1 = router.push({ name: 'api-guide' });
    await flushPromises();
    expect(w.findAll('[data-test="leave-confirm"]')).toHaveLength(1);
    expect(w.get('[role="dialog"]').text()).toContain('아직 끝내지 않은 편집이 있습니다. 나가시겠습니까?');
    expect(w.text()).not.toContain('—');
    await w.get('[data-test="leave-cancel"]').trigger('click');
    await nav1;
    expect(router.currentRoute.value.name).toBe('download');

    // 다시 — [나가기]
    const nav2 = router.push({ name: 'home' });
    await flushPromises();
    await w.get('[data-test="leave-ok"]').trigger('click');
    await nav2;
    expect(router.currentRoute.value.name).toBe('home');
    w.unmount();
  });

  it('결과 전(비활성)이면 묻지 않는다 · 새로 고침은 브라우저 기본 경고(beforeunload)', async () => {
    const router = makeRouter();
    await router.push({ name: 'listen', params: { requestNo: 'R-1' } });
    const w = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    const e1 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e1);
    expect(e1.defaultPrevented).toBe(true);
    active.value = false;
    const e2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
    await router.push({ name: 'api-guide' });
    expect(router.currentRoute.value.name).toBe('api-guide');
    w.unmount();
  });
});

describe('로그인 만료로 가는 이동(2026-09-30)', () => {
  afterEach(() => { resetLeaveBypass(); document.body.innerHTML = ''; });
  it('만료(401)로 로그인 화면에 보낼 때는 확인 창 · 브라우저 경고 없이 간다', async () => {
    active.value = true;
    const router = makeRouter();
    await router.push({ name: 'listen', params: { requestNo: 'R-1' } });
    const w = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    allowLeaveForSessionExpiry();
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    await router.push({ name: 'api-guide' });
    expect(router.currentRoute.value.name).toBe('api-guide');
    expect(w.find('[data-test="leave-confirm"]').exists()).toBe(false);
    w.unmount();
  });
});

describe('S1 처리 중 — 예상 완료 시간', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  const status = (over: Partial<RequestStatus>) => ({
    id: 'R-1', file_kind: 'image', score_type: 'staff', status: 'converting', status_label: '', queue_position: null, route: 'recognition',
    result_band: null, fallback: false, deadline_at: '2026-09-30T10:02:10Z', ...over,
  }) as unknown as RequestStatus;

  async function title(over: Partial<RequestStatus>) {
    const { default: S1Result } = await import('@/pages/S1Result.vue');
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'home', component: S1Result }] });
    useRequestStore().status = status(over);
    await router.push('/');
    const w = mount(defineComponent({ render: () => h(RouterView) }), {
      global: { plugins: [router], stubs: { C2GateBlock: true, C3ResultBand: true, C4InstrumentPicker: true, C5PlayerBar: true, C6DownloadCard: true, ScoreView: true } },
    });
    await flushPromises();
    const t = w.get('[data-test="proc-title"]').text();
    w.unmount();
    return t;
  }

  it('읽는 중: "악보를 읽고 있습니다. 예상 완료 시간 : n분"(마감까지 남은 시간을 분으로 올림)', async () => {
    expect(await title({})).toBe('악보를 읽고 있습니다.');   // 2026-09-30 65번: 예상 완료 시간 뺌
  });
  it('차례를 기다릴 때도 같은 마감 · 마감이 지나면 "곧 결과를 드립니다" · 종류 확인 중에는 붙이지 않음', async () => {
    expect(await title({ status: 'queued', queue_position: 2 })).toBe('차례를 기다리고 있습니다.');
    expect(await title({ deadline_at: '2026-09-30T09:59:00Z' })).toBe('악보를 읽고 있습니다.');
    expect(await title({ status: 'awaiting_type_answer', detected_type: 'jeongganbo' })).toBe('악보 종류를 확인해 주십시오');
  });
});

describe('나가기 확인 뒤 다시 막히지 않기(2026-09-30 황송해 60번)', () => {
  it('[나가기] 뒤 전역 가드가 다른 곳으로 돌려보내도(리다이렉트) 확인 창이 다시 뜨지 않고 나간다', async () => {
    active.value = true;
    const router = makeRouter();
    router.addRoute({ path: '/old', name: 'old', component: Blank });
    router.beforeEach((to) => (to.name === 'old' ? { name: 'api-guide' } : true));
    await router.push({ name: 'listen', params: { requestNo: 'R-1' } });
    const w = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    const nav = router.push({ name: 'old' });
    await flushPromises();
    expect(w.findAll('[data-test="leave-confirm"]')).toHaveLength(1);
    await w.get('[data-test="leave-ok"]').trigger('click');
    await flushPromises();
    expect(w.findAll('[data-test="leave-confirm"]')).toHaveLength(0);   // 다시 뜨지 않음
    await nav;
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('api-guide');
    w.unmount();
  });

  it('창이 떠 있는 동안 같은 이동이 또 오면 창을 하나만 두고 같은 답을 쓴다', async () => {
    active.value = true;
    const router = makeRouter();
    await router.push({ name: 'listen', params: { requestNo: 'R-1' } });
    const w = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    void router.push({ name: 'api-guide' });
    await flushPromises();
    const second = router.push({ name: 'api-guide' });
    await flushPromises();
    expect(w.findAll('[data-test="leave-confirm"]')).toHaveLength(1);
    await w.get('[data-test="leave-ok"]').trigger('click');
    await second;
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('api-guide');
    w.unmount();
  });
});
