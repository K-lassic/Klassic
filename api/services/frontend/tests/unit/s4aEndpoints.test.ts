// S4-A [엔드포인트 목록] — 쓰임새 묶음 · 세 칸 · 줄마다 "자세히" (2026-09-30 황송해 198번, SD_02 §7 · UC11 A2 · BR-API-02)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ep = (method: string, path: string, feature: string, input = '없음') =>
  ({ method, path, feature, input, response: '200 Successful Response', example: `curl -X ${method} "x${path}"`, engine: null });

// 서버가 주는 순서(이름 순 아님) 그대로
const ENDPOINTS = [
  ep('GET', '/v1/health', '서버 상태 (UC11 기본흐름 1)'),
  ep('POST', '/v1/omr/staff', '오선보 이미지 인식', 'multipart/form-data'),
  ep('GET', '/v1/performances/{request_no}/result', '연주 결과'),
  ep('POST', '/v1/performances', '연주 요청 (UC13)', 'multipart/form-data'),
  ep('GET', '/v1/performances/{request_no}', '연주 요청 상태'),
  ep('POST', '/v1/recommend', '국악기 조합 추천', 'multipart/form-data'),
  ep('GET', '/v1/brand-new', '새 기능 (UC12 A10 · BR-SHR-09)'),
];

async function mountEndpoints() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('api-docs')
    ? jsonResponse(200, { server_status: 'running', spec_source: 'live', api_version: 'v1', checked_at: null, endpoints: ENDPOINTS, guideline: {}, manual: {} })
    : jsonResponse(200, { account: null, roles: [] }))));
  const { router } = await import('../../src/router');
  const S4A = (await import('../../src/pages/S4AApiGuide.vue')).default;
  await router.push('/api-guide');
  const w = mount(S4A, { global: { plugins: [router] } });
  await flushPromises();
  await w.find('#tab-endpoints').trigger('click');
  return w;
}

describe('S4-A [엔드포인트 목록] (198번)', () => {
  beforeEach(() => { setActivePinia(createPinia()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('쓰임새 묶음으로 나누고, 모르는 경로는 "그 밖"에 둔다(목록은 서버 그대로)', async () => {
    const w = await mountEndpoints();
    const panel = w.find('#panel-endpoints');
    expect(panel.findAll('.ep-group > h2').map((h) => h.text())).toEqual(['악보 읽기', '연주 만들기', '더 해 보기', '서버 확인', '그 밖']);
    expect(panel.findAll('[data-test="ep-row"]')).toHaveLength(ENDPOINTS.length);
  });

  it('표는 하는 일 · 주소 · 보내는 것 세 칸이고, 쉬운 설명을 쓴다', async () => {
    const w = await mountEndpoints();
    const read = w.find('[data-test="ep-group-read"]');
    expect(read.findAll('thead th').map((t) => t.text())).toEqual(['하는 일', '주소', '보내는 것']);
    const cells = read.find('[data-test="ep-row"]').findAll('td');
    expect(cells[0].text()).toContain('오선보 사진을 디지털 악보로 바꿉니다');
    expect(cells[1].text()).toContain('POST');
    expect(cells[1].text()).toContain('/v1/omr/staff');
    expect(cells[2].text()).toBe('악보 사진');
    expect(w.find('[data-test="ep-group-more"]').text()).toContain('악보 파일(MIDI · MusicXML)');
  });

  it('연주 만들기는 부르는 순서(요청 → 상태 → 결과)로 보인다', async () => {
    const w = await mountEndpoints();
    const paths = w.find('[data-test="ep-group-play"]').findAll('[data-test="ep-row"] code').map((c) => c.text());
    expect(paths).toEqual(['/v1/performances', '/v1/performances/{request_no}', '/v1/performances/{request_no}/result']);
  });

  it('내부 참조 번호(UC · FR · BR)는 보이지 않고, 입력 · 응답 · 예시는 "자세히" 접기 안에 있다', async () => {
    const w = await mountEndpoints();
    const panel = w.find('#panel-endpoints');
    const visible = panel.findAll('[data-test="ep-row"]').map((r) => r.findAll('td')[0].element.firstChild?.textContent ?? '').join(' ');
    expect(visible).not.toMatch(/UC\d|FR-|BR-/);
    expect(w.find('[data-test="ep-group-other"]').text()).toContain('새 기능');
    const more = w.find('[data-test="ep-group-read"] details.ep-more');
    expect(more.attributes('open')).toBeUndefined();
    expect(more.text()).toContain('multipart/form-data');
    expect(more.text()).toContain('200 Successful Response');
    expect(more.text()).toContain('curl -X POST');
  });
});
