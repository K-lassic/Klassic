// S4-C API 활용 예시 (2026-09-30 조성기 — SD_02 §7-1 · UC11 기본흐름 4)
// (2026-10-01) 단계 단추로 한 단계씩 · 머리 단추는 돌아가기 하나 · S4-A 머리말 단추 뺌
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function mountS4C(path = '/api-guide/examples') {
  const { router } = await import('../../src/router');
  const S4C = (await import('../../src/pages/S4CApiExamples.vue')).default;
  await router.push(path);
  const w = mount(S4C, { global: { plugins: [router] }, attachTo: document.body });
  return { w, router };
}

describe('API 활용 예시', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { account: null, roles: [] })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); document.body.innerHTML = ''; });

  it('로그인 없이 /api-guide/examples 를 연다', async () => {
    const { router } = await import('../../src/router');
    await router.push('/api-guide/examples');
    expect(router.currentRoute.value.name).toBe('api-examples');
  });

  it('머리 단추는 [API활용으로 돌아가기] 하나뿐이다', async () => {
    const { w } = await mountS4C();
    const head = w.find('.page-head');
    expect(head.findAll('a, button').map((b) => b.text())).toEqual(['API활용으로 돌아가기']);
    expect(w.text()).not.toContain('예시 홈페이지 보기');
    expect(head.text()).not.toContain('접근 키 신청');
  });

  it('단계 단추 8개 · 한 번에 한 단계만, 누르면 그 단계 설명과 코드가 나온다', async () => {
    const { w, router } = await mountS4C();
    const tabs = w.findAll('[role=tab]');
    expect(tabs).toHaveLength(8);
    expect(w.findAll('section.step')).toHaveLength(1);
    expect(tabs[0].attributes('aria-selected')).toBe('true');
    expect(w.find('section.step h2').text()).toBe('1. 접근 키 받기');

    await tabs[2].trigger('click');
    await flushPromises();
    expect(w.findAll('section.step')).toHaveLength(1);
    expect(w.find('section.step h2').text()).toBe('3. 악보 한 장 인식하기');
    expect(router.currentRoute.value.query.step).toBe('recognize');
    const code = () => w.find('section.step .code pre').text();
    expect(code()).toContain('/api/v1/omr/staff');
    expect(code()).toContain('image=@score.png');
    expect(code()).not.toContain('file=@');
    expect(code()).toContain('X-API-Key: $GUGAK_API_KEY');
    // 언어를 바꾸면 보고 있는 단계의 코드가 바뀐다
    await w.findAll('.langs button').find((b) => b.text() === 'Python')!.trigger('click');
    expect(code()).toContain('files={"image": f}');
    await w.findAll('.langs button').find((b) => b.text().startsWith('JavaScript'))!.trigger('click');
    expect(code()).toContain("form.append('image'");

    // 다음 · 이전 단계
    await w.findAll('.step-nav button').find((b) => b.text().startsWith('다음'))!.trigger('click');
    expect(w.find('section.step h2').text()).toBe('4. 결과 읽고 파일로 저장하기');
    await w.findAll('.step-nav button').find((b) => b.text().includes('이전'))!.trigger('click');
    expect(w.find('section.step h2').text()).toBe('3. 악보 한 장 인식하기');

    // 화살표 키로 옮긴다
    await w.find('[role=tablist]').trigger('keydown', { key: 'End' });
    expect(w.find('section.step h2').text()).toBe('8. 꼭 지켜 주십시오');
    expect(w.find('.step-nav').text()).not.toContain('다음 단계');
  });

  it('?step= 으로 그 단계를 바로 연다 · 오류 단계에 오류 표', async () => {
    const { w } = await mountS4C('/api-guide/examples?step=errors');
    expect(w.find('section.step h2').text()).toBe('7. 오류 처리하기');
    expect(w.text()).toContain('VALIDATION_ERROR');
  });

  it('API활용 화면: 머리말에는 [활용 예시 보기] 단추가 없고 [시작하기] 3번에 있다 · ?tab=apply 면 신청 탭', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('api-docs')
      ? jsonResponse(200, { server_status: 'running', spec_source: 'live', api_version: 'v1', checked_at: null, endpoints: [], guideline: {}, manual: {} })
      : jsonResponse(200, { account: null, roles: [] }))));
    const { router } = await import('../../src/router');
    const S4A = (await import('../../src/pages/S4AApiGuide.vue')).default;
    await router.push('/api-guide?tab=apply');
    const w = mount(S4A, { global: { plugins: [router] } });
    await flushPromises();
    const toExamples = (root: ReturnType<typeof w.find>) => root.findAll('a').filter((a) => a.attributes('href') === '/api-guide/examples');
    expect(toExamples(w.find('.page-head'))).toHaveLength(0);
    expect(toExamples(w.find('#panel-start'))).toHaveLength(1);
    // 맨 위 탭 줄: [접근 키 신청] 탭 바로 옆에 [예시 홈페이지 보기](/demo/, 새 창) — 2026-10-01, 탭 목록 밖 같은 줄
    expect(w.findAll('[data-test=demo-link]')).toHaveLength(1);
    const demo = w.find('#tab-apply').element.parentElement!.nextElementSibling as HTMLAnchorElement;
    expect(demo.dataset.test).toBe('demo-link');
    expect(w.find('[role=tablist] a').exists()).toBe(false);
    expect(demo.getAttribute('href')).toBe('/demo/');
    expect(demo.getAttribute('target')).toBe('_blank');
    expect(demo.textContent).toContain('API 활용 예시 홈페이지 보기');
    expect(w.find('#tab-apply').attributes('aria-selected')).toBe('true');
  });
});
