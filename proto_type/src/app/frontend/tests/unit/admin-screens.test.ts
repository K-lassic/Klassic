// 관리자 화면 연기 시험 — 가짜 응답으로 각 화면을 그려 보고 Vue 경고 없이 핵심 문구가 나오는지 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import MetricsTab from '../../src/admin/pages/s6/MetricsTab.vue';
import JobsTab from '../../src/admin/pages/s6/JobsTab.vue';
import SettingsTab from '../../src/admin/pages/s6/SettingsTab.vue';
import S4BKeys from '../../src/admin/pages/S4BKeys.vue';
import C7AdminBar from '../../src/admin/components/C7AdminBar.vue';
import { useSessionStore } from '../../src/admin/stores/session';

const scope = { image_requests: 10, first_pass_trust: 4, first_pass_rate: 0.4, caution_count: 1, fallback_rate: 0.3, edit_usage_rate: 0.2, max_wait_ms: 94000, service_down_count: 0 };
const settings = {
  setting_version_id: 7, api_apply_status: 'applied', timeout_seconds: 120, max_concurrency_recognize: 2, max_concurrency_render: 1, web_concurrency_share: 1,
  default_call_limit_per_hour: 100, apply_rate_limit_count: 1, apply_rate_window_minutes: 60, structure_threshold: null, grade_caution_boundary: 0.7,
  grade_distrust_boundary: 0.4, web_max_active_per_client: 1, web_hourly_request_cap: 20, score_file_max_bytes: 5242880, recommend_timeout_ms: 3000,
  llm_recommend_timeout_ms: 300000, login_max_failures: 5, login_lock_minutes: 15, fallback_enabled: true,
  engine_order: { staff: ['homr'], jeongganbo: ['jeongganbo-omr'], recommend: ['rules'] },
};
const models = [
  { model_name: 'homr', kind: 'omr_staff', provider: 'venv', display_name: 'homr', enabled: true, in_use_by: ['staff#1'], state: 'ready' },
  { model_name: 'audiveris', kind: 'omr_staff', provider: 'venv', display_name: 'audiveris', enabled: true, in_use_by: [], state: 'cold' },
  { model_name: 'jeongganbo-omr', kind: 'omr_jeongganbo', provider: 'venv', display_name: '정간보', enabled: true, in_use_by: ['jeongganbo#1'], state: 'ready' },
  { model_name: 'rules', kind: 'recommend', provider: 'builtin', display_name: '규칙표', enabled: true, in_use_by: ['recommend#1'], state: 'ready' },
];
const routes: Record<string, unknown> = {
  '/admin/metrics': { scopes: { all: scope, web: scope, api: scope }, fallback_by_reason: [{ channel: 'web', reason: 'NO_SCORE_STRUCTURE', count: 6 }], missing_log_count: 1 },
  '/admin/jobs': { items: [{ request_no: 'R-0928-7KQ4M2XZ', channel: 'web', route: 'fallback', status: 'completed', fallback_reason: 'NO_SCORE_STRUCTURE', file_kind: 'image', chosen_score_type: 'staff', received_at: '2026-09-28T01:00:00Z' }], total: 1 },
  '/admin/settings': settings,
  '/admin/models': models,
  '/admin/keys': [{ key_id: 1, key_kind: 'external', key_prefix: 'gk_7Qx12', call_limit_per_hour: 100, issued_at: '2026-09-28T01:00:00Z', status: 'active', application_no: 'A-0928003100', application_purged: 0 },
    { key_id: 2, key_kind: 'service', key_prefix: 'gk_Svc01', call_limit_per_hour: null, issued_at: '2026-09-27T01:00:00Z', status: 'active', application_no: null, application_purged: 0 }],
  '/admin/applications': [{ application_no: 'A-0928003100', applicant_name_masked: '박**', affiliation: '○○대학교', contact_email_masked: 'p***@x.kr', purpose: '수업', applied_at: '2026-09-28T01:00:00Z', delete_due_at: '2026-10-05T01:00:00Z', is_retained: 0, key_prefix: 'gk_7Qx12', key_status: 'active' }],
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.split('?')[0];
    if (init?.method === 'PUT' && path === '/admin/settings') {
      return new Response(JSON.stringify({ error: { code: 'SETTINGS_INVALID_VALUE', message: '저장할 수 없는 값입니다.', gate: 'G6', retry_after: null, details: { field: 'timeout_seconds', reason: '서버 기준: 600초 이하' } } }), { status: 422, headers: { 'content-type': 'application/json' } });
    }
    const body = routes[path];
    if (body === undefined) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x', gate: null, retry_after: null } }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); warn.mockRestore(); });

async function render(component: unknown, path = '/ops/metrics') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/ops/:tab', name: 'ops', component: { template: '<div/>' } }, { path: '/keys', name: 'keys', component: { template: '<div/>' } }, { path: '/login', name: 'login', component: { template: '<div/>' } }] });
  await router.push(path);
  const wrapper = mount(component as never, { global: { plugins: [pinia, router] }, attachTo: document.body });
  await flushPromises();
  return { wrapper, router };
}
const vueWarnings = () => warn.mock.calls.filter((c) => String(c[0]).includes('[Vue warn]'));

describe('관리자 화면 그리기', () => {
  it('지표 탭: 장구 면 숫자·채널 표·대체 이유·기록 누락', async () => {
    const { wrapper, router } = await render(MetricsTab);
    expect(wrapper.text()).toContain('한 번에 완성률 (신뢰만)');
    expect(wrapper.text()).toContain('40%');
    expect(wrapper.text()).toContain('기록이 빠진 요청 1건');
    expect(wrapper.findAll('th[scope="row"]').length).toBeGreaterThan(5);
    await wrapper.findAll('button.link-btn').find((b) => b.text() === '악보 구조를 찾지 못함')!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ route: 'fallback', reason: 'NO_SCORE_STRUCTURE' });
    expect(vueWarnings()).toEqual([]);
    wrapper.unmount();
  });

  it('요청 기록 탭: 목록과 상세 서랍', async () => {
    const { wrapper } = await render(JobsTab, '/ops/jobs');
    expect(wrapper.text()).toContain('R-0928-7KQ4M2XZ');
    expect(wrapper.find('.chip.s-fallback').text()).toBe('대체');
    await wrapper.get('button[aria-label="R-0928-7KQ4M2XZ 자세히"]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(vueWarnings()).toEqual([]);
    wrapper.unmount();
  });

  it('설정 탭: 잘못된 값이면 G6 블록 + C7 표시, 서버 422 는 그 칸에', async () => {
    const { wrapper } = await render(SettingsTab, '/ops/settings');
    const session = useSessionStore();
    expect(wrapper.text()).toContain('바뀐 값이 없습니다');
    await wrapper.get('#set-grade_caution_boundary').setValue('0.3');
    expect(wrapper.text()).toContain('저장할 수 없습니다');
    expect(wrapper.text()).toContain('불신 경계보다 커야');
    expect(wrapper.get('#set-grade_caution_boundary').attributes('aria-invalid')).toBe('true');
    expect(session.settingsBlocked).toBe(true);
    await wrapper.get('#set-grade_caution_boundary').setValue('0.7');
    expect(session.settingsBlocked).toBe(false);

    await wrapper.get('#set-timeout_seconds').setValue('900');
    await wrapper.findAll('button').find((b) => b.text().includes('저장하고 모델 서버에 반영'))!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('서버 기준: 600초 이하');
    expect(wrapper.get('#set-timeout_seconds').attributes('aria-invalid')).toBe('true');
    expect(vueWarnings()).toEqual([]);
    wrapper.unmount();
  });

  it('키 관리: 신청 표 · 한도 G6 · 탭 키보드', async () => {
    const { wrapper } = await render(S4BKeys, '/keys');
    expect(wrapper.text()).toContain('A-0928003100');
    expect(wrapper.text()).toContain('p***@x.kr');
    const tab = wrapper.get('#keys-tab-applications');
    await tab.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect(wrapper.get('#keys-tab-keys').attributes('aria-selected')).toBe('true');
    await wrapper.get('button[aria-label="gk_7Qx12… 한도 조정"]').trigger('click');
    await wrapper.get('#key-limit').setValue('0');
    expect(wrapper.text()).toContain('호출 한도는 1 이상이어야 합니다');
    expect(wrapper.text()).toContain('G6 운영 값 검증');
    expect(vueWarnings()).toEqual([]);
    wrapper.unmount();
  });

  it('C7 머리띠: 가린 운영자 이름 · 메뉴 · 설정 G6 표시', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSessionStore();
    session.state = 'authed';
    session.me = { login_id: 'kimoperator' };
    session.settingsBlocked = true;
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/ops/:tab', name: 'ops', component: { template: '<div/>' } }, { path: '/keys', name: 'keys', component: { template: '<div/>' } }, { path: '/login', name: 'login', component: { template: '<div/>' } }] });
    await router.push('/ops/settings');
    const wrapper = mount(C7AdminBar, { global: { plugins: [pinia, router] } });
    expect(wrapper.text()).toContain('kim**');
    expect(wrapper.text()).not.toContain('kimoperator');
    expect(wrapper.text()).toContain('내부망 접속');
    expect(wrapper.get('a[aria-current="page"]').text()).toContain('설정 (G6 값 확인)');
    expect(wrapper.text()).toContain('키 관리');
    expect(wrapper.text()).toContain('모델');
    wrapper.unmount();
  });
});
