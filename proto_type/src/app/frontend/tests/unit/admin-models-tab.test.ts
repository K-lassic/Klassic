// 모델 탭 화면 — 불러오는 중이면 2초마다 새로 고치고, 끝나거나 화면을 떠나면 멈춘다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ModelsTab from '../../src/admin/pages/s6/ModelsTab.vue';

const base = {
  kind: 'omr_staff', provider: 'venv', provider_ref: '~/venvs/homr', enabled: true, loaded_at: null, avg_load_ms: 20000, max_load_ms: 41000,
  last_outcome: null, last_error: null, installed: true, version: '0.3',
};
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

describe('ModelsTab 새로 고침', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('loading → 2초마다 GET /admin/models, ready 가 되면 멈춤, 떠나면 더 안 부름', async () => {
    let modelCalls = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url === '/admin/settings') return json({ setting_version_id: 1, fallback_enabled: true, engine_order: { staff: ['homr'], jeongganbo: [], recommend: [] } });
      if (url === '/admin/model-api-status') return json({ health: null, versions: null, checked_at: null });
      modelCalls += 1;
      const state = modelCalls < 3 ? 'loading' : 'ready';
      return json([{ ...base, model_name: 'homr', display_name: 'homr 오선보', in_use_by: ['staff#1'], state, expected_seconds: 30, load_started_at: '2026-09-28T09:59:50Z' }]);
    });
    vi.stubGlobal('fetch', fetch);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/ops/:tab', component: { template: '<div/>' } }] });
    const wrapper = mount(ModelsTab, { global: { plugins: [createPinia(), router] } });
    await flushPromises();

    expect(modelCalls).toBe(1);
    expect(wrapper.text()).toContain('불러오는 중');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('약 30초 중 10초');
    expect(wrapper.text()).toContain('오선보 순서 1번째');
    expect(wrapper.text()).toContain('2초마다 새로 고치고');

    await vi.advanceTimersByTimeAsync(2000);
    expect(modelCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(modelCalls).toBe(3);
    await flushPromises();
    expect(wrapper.text()).toContain('준비됨');
    expect(wrapper.text()).toContain('불러오기를 마쳤습니다');

    await vi.advanceTimersByTimeAsync(10000);
    expect(modelCalls).toBe(3); // 멈춤
    // 순서에서 쓰는 모델은 등록 해제를 막고 이유를 붙인다
    expect(wrapper.text()).toContain('쓰는 중이라 해제할 수 없습니다');
    wrapper.unmount();
  });

  it('화면을 떠나면 불러오는 중이어도 새로 고침을 멈춘다', async () => {
    let modelCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url !== '/admin/models') return json({ engine_order: { staff: [], jeongganbo: [], recommend: [] } });
      modelCalls += 1;
      return json([{ ...base, model_name: 'homr', display_name: 'homr', in_use_by: [], state: 'loading', expected_seconds: null }]);
    }));
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] });
    const wrapper = mount(ModelsTab, { global: { plugins: [createPinia(), router] } });
    await flushPromises();
    expect(wrapper.text()).toContain('처음 한 번은 시간이 더 걸릴 수 있습니다');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(modelCalls).toBe(1);
  });
});
