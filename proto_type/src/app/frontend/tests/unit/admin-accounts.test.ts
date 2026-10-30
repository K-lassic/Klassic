// S7 계정·권한 화면 (SD_02 §10A · UC17) — 목록 → 상세, 확인 창 → 반영, 막히면 G16 차단 블록, 권한표는 읽기 전용
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import S7Accounts from '../../src/admin/pages/S7Accounts.vue';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const row = {
  account_id: 7, login_id_masked: 'kim**@example.kr', display_name: '김운영', roles: ['operator', 'user'], status: 'active',
  created_at: '2026-09-29T07:00:00Z', last_login_at: '2026-09-29T07:40:00Z', locked_until: null, disabled_at: null, failed_logins: 0, requests_7d: 3,
};
const detail = { account: row, requests: [{ request_no: 'R-0929-8BNAAFTD', status: 'done', route: 'normal', received_at: '2026-09-29T07:47:00Z' }], keys: [], history: [], events: [] };

function mountPage(fetch: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetch);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/ops/:tab', component: { template: '<div/>' } }] });
  return mount(S7Accounts, { attachTo: document.body, global: { plugins: [createPinia(), router] } });
}
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

describe('S7 계정·권한', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('마지막 운영자의 역할 빼기는 확인 창 뒤 G16 차단 블록으로 보인다(사유 입력 없음)', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const wrapper = mountPage(vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
      if (url.startsWith('/admin/accounts?') || url === '/admin/accounts') return json({ items: [row], page: 1, page_size: 50, total: 1 });
      if (url === '/admin/accounts/7' ) return json(detail);
      if (url === '/admin/accounts/7/roles') return json({ error: { code: 'ADMIN_LAST_OPERATOR', gate: 'G16', message: '사용 중인 운영자가 이 계정 하나뿐입니다.', fix: '다른 계정에 먼저 운영자 역할을 준 뒤 다시 해 주십시오.', retry_after: null } }, 409);
      return json({});
    }));
    await flushPromises();
    expect(wrapper.text()).toContain('kim**@example.kr');
    expect(wrapper.text()).toContain('운영자');

    button('kim**@example.kr').click();
    await flushPromises();
    expect(wrapper.text()).toContain('R-0929-8BNAAFTD');
    expect(button('잠금 풀기').disabled).toBe(true);   // 잠겨 있지 않으면 꺼짐

    button('역할 빼기: 운영자').click();
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"] textarea, [role="dialog"] input')).toBeNull();   // 사유 칸 없음
    button('반영').click();
    await flushPromises();

    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toBe(JSON.stringify({ revoke: ['operator'] }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(wrapper.text()).toContain('G16 관리 조작 보호');
    expect(wrapper.text()).toContain('사용 중인 운영자가 이 계정 하나뿐입니다.');
    expect(wrapper.text()).toContain('다른 팀원 계정을 열어');
    wrapper.unmount();
  });

  it('권한표 탭은 읽기 전용이고 설계서와 다르면 경고한다', async () => {
    const wrapper = mountPage(vi.fn(async (url: string) => {
      if (url === '/admin/permissions') {
        return json({ table: { user: ['UC1', 'UC2'], operator: ['UC9', 'UC17'] }, public: ['UC11', 'UC16'], editable: false, design_source: 'design/UC_00 §4-1', design_differs: ['user'] });
      }
      return json({ items: [], page: 1, page_size: 50, total: 0 });
    }));
    await flushPromises();
    button('권한표').click();
    await flushPromises();
    expect(wrapper.text()).toContain('읽기 전용');
    expect(wrapper.text()).toContain('설계서와 다른 역할이 있습니다');
    const uc17 = wrapper.findAll('#acc-panel-permissions tbody tr').find((tr) => tr.find('th').text() === 'UC17');
    expect(uc17?.findAll('td').map((td) => td.text())).toEqual(['—', '—', 'O', '—', '—']);
    expect(wrapper.find('#acc-panel-permissions input, #acc-panel-permissions button').exists()).toBe(false);
    wrapper.unmount();
  });
});
