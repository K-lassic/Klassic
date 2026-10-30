// S4-A [시작하기] — 가이드라인 · 매뉴얼을 초보자용 다섯 부분 + "자세히 보기" 접기로 합침 (2026-09-30 황송해 197번, SD_02 §7 · UC11)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const DOCS = {
  server_status: 'running', spec_source: 'live', api_version: 'v1', checked_at: null, endpoints: [],
  guideline: { auth: '접근 키 안내(서버)' },
  manual: {
    playback_flow: '연주 API 순서(서버)',
    status_values: [{ value: 'received', label: '접수' }, { value: 'completed', label: '완료' }],
    error_codes: [{ code: 'UPLOAD_TOO_LARGE', http: 413, gate: 'G1', message: '큼' }],
    fallback_reasons: [{ code: 'TIMEOUT', message: '시간 초과' }],
  },
};

async function mountAt(path: string) {
  const { router } = await import('../../src/router');
  const S4A = (await import('../../src/pages/S4AApiGuide.vue')).default;
  await router.push(path);
  const w = mount(S4A, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe('S4-A [시작하기] (197번)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('api-docs')
      ? jsonResponse(200, DOCS)
      : jsonResponse(200, { account: null, roles: [] }))));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('탭은 시작하기 · 엔드포인트 목록 · 접근 키 신청 셋이고, 처음에는 [시작하기]가 열린다', async () => {
    const w = await mountAt('/api-guide');
    expect(w.findAll('[role="tab"]').map((t) => t.text())).toEqual(['시작하기', '엔드포인트 목록', '접근 키 신청']);
    expect(w.find('#tab-start').attributes('aria-selected')).toBe('true');
    expect(w.find('#tab-guideline').exists()).toBe(false);
    expect(w.find('#tab-manual').exists()).toBe(false);
  });

  it('예전 주소 ?tab=guideline · ?tab=manual 은 [시작하기]로 연다', async () => {
    for (const q of ['guideline', 'manual']) {
      const w = await mountAt(`/api-guide?tab=${q}`);
      expect(w.find('#tab-start').attributes('aria-selected')).toBe('true');
      w.unmount();
      vi.resetModules();
    }
  });

  it('다섯 부분만 먼저 보이고, 자주 나오는 오류는 다섯 개다', async () => {
    const w = await mountAt('/api-guide');
    const panel = w.find('#panel-start');
    expect(panel.findAll('.step > h2').map((h) => h.text())).toEqual([
      '1. 무엇을 할 수 있나요', '2. API 키 받기', '3. 악보 보내기', '4. 결과 받기', '5. 자주 나오는 오류',
    ]);
    expect(panel.find('.code pre').text()).toContain('/api/v1/omr/jeongganbo');
    expect(panel.findAll('[data-test="common-error"]').map((r) => r.find('code').text())).toEqual([
      'AUTH_KEY_MISSING', 'AUTH_KEY_INVALID', 'VALIDATION_ERROR', 'UPLOAD_TOO_LARGE', 'RATE_LIMIT_EXCEEDED',
    ]);
    await panel.find('[data-test="go-apply"]').trigger('click');
    expect(w.find('#tab-apply').attributes('aria-selected')).toBe('true');
  });

  it('규칙 · 전체 오류 코드 · 서버 안내는 지우지 않고 "자세히 보기" 접기 안에 둔다', async () => {
    const w = await mountAt('/api-guide');
    for (const t of ['more-rules', 'more-errors', 'more-server']) {
      const d = w.find(`details[data-test="${t}"]`);
      expect(d.exists()).toBe(true);
      expect(d.attributes('open')).toBeUndefined();
    }
    expect(w.find('[data-test="more-rules"]').text()).toContain('X-Request-ID');
    expect(w.find('[data-test="more-errors"]').findAll('tbody tr').length).toBeGreaterThan(5);
    const server = w.find('[data-test="more-server"]').text();
    expect(server).toContain('접근 키 안내(서버)');
    expect(server).toContain('연주 API 순서(서버)');
    // (2026-10-01) 항목 목록은 JSON 원문 대신 표, error_codes 는 전체 오류 코드 표로 합침
    expect(server).not.toContain('{');
    const sv = w.find('[data-test="server-table-status_values"]');
    expect(sv.findAll('th').map((t) => t.text())).toEqual(['값', '표시']);
    expect(sv.findAll('tbody tr')).toHaveLength(2);
    expect(w.find('[data-test="server-table-fallback_reasons"]').findAll('th').map((t) => t.text())).toEqual(['코드', '뜻']);
    expect(w.find('[data-test="server-table-error_codes"]').exists()).toBe(false);
    expect(server).toContain('전체 오류 코드\' 표에 합쳤습니다');
    // 전체 오류 코드 표 = 서버 안내와 같은 범위(관리 · 내부 게이트 G5 · G6 · G12 제외)
    const codes = w.find('[data-test="more-errors"]').findAll('tbody tr').map((r) => r.find('code').text());
    expect(codes[0]).toBe('VALIDATION_ERROR');
    expect(codes).toContain('AUTH_KEY_MISSING');
    expect(codes.length).toBeGreaterThan(30);
    const gates = w.find('[data-test="more-errors"]').findAll('tbody tr').map((r) => r.find('td').text());
    expect(gates.some((g) => ['G5', 'G6', 'G12'].includes(g))).toBe(false);
  });
});
