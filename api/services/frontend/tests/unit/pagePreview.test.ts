// (2026-11-04 황송해, #181) 여러 쪽을 읽는 동안 먼저 변환된 쪽 — 악보 · 연주 막대 · 악기 바꾸기를 전체 결과 전에 쓴다.
// 바꾼 악기는 같은 요청 번호의 편집 기록에 쌓여 전체 결과에도 이어진다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { useRequestStore } from '@/stores/request';
import { useEditorStore } from '@/stores/editor';
import type { RequestStatus } from '@/types/api';

const XML = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
  + '<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
  + '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>';

const status = (over: Partial<RequestStatus> = {}) => ({
  id: 'R-1104-PREVIEW1', file_kind: 'pdf', score_type: 'staff', status: 'converting', status_label: '변환 중', queue_position: null,
  route: 'recognize', result_band: null, fallback: false, deadline_at: '2026-11-04T10:10:00Z', page_count: 3,
  pages: [{ page_no: 1, outcome: 'converted' }, { page_no: 2, outcome: 'pending' }, { page_no: 3, outcome: 'pending' }],
  preview: { page_no: 1, page_count: 3 }, ...over,
}) as unknown as RequestStatus;

async function open(over: Partial<RequestStatus> = {}, withPreview = true) {
  const { default: S1Result } = await import('@/pages/S1Result.vue');
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'home', component: S1Result },
    { path: '/r/:requestNo/listen', name: 'listen', component: S1Result },
  ] });
  const req = useRequestStore();
  req.status = status(over);
  req.preview = withPreview ? { page_no: 1, page_count: 3, musicxml: XML } : null;
  await router.push('/');
  const w = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { plugins: [router], stubs: { C2GateBlock: true, C3ResultBand: true, C4InstrumentPicker: true, C5PlayerBar: true, ScoreView: true, SaveWorkButton: true } },
  });
  await flushPromises();
  return w;
}

describe('먼저 변환된 쪽 — 연주 · 악기 바꾸기', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

  it('변환 중에 읽은 쪽 수 · 미리보기 악보 · 악기 표 · 연주 막대가 보인다', async () => {
    const w = await open();
    expect(w.get('[data-test="pages-read"]').text()).toBe('3쪽 중 1쪽 읽음');
    expect(w.get('[data-test="page-preview"]').text()).toContain('1쪽을 먼저 보여 드립니다');
    expect(w.find('[data-test="step2-tracks"]').exists()).toBe(true);
    const bar = w.findComponent({ name: 'C5PlayerBar' });
    expect(bar.exists()).toBe(true);
    expect((bar.props('doc') as { parts: unknown[] } | null)?.parts).toHaveLength(1);
    // 다음 단계 · 저장은 전체 결과 뒤에만
    expect(w.findComponent({ name: 'StepNav' }).exists()).toBe(false);
    w.unmount();
  });

  it('미리보기에서 바꾼 악기는 그 요청의 편집 기록에 남는다(전체 결과에 이어짐)', async () => {
    const w = await open();
    await w.get('[data-test="pick-instrument"]').trigger('click');
    w.findComponent({ name: 'C4InstrumentPicker' }).vm.$emit('update:model-value', { kind: 'instrument', code: 'daegeum' });
    await flushPromises();
    const ed = useEditorStore();
    expect(ed.requestNo).toBe('R-1104-PREVIEW1');
    expect(ed.ops).toContainEqual({ op: 'change_instrument', part: 0, instrument: 'daegeum' });
    w.unmount();
  });

  it('미리보기가 없으면 처리 중에 악기 표 · 연주 막대를 두지 않는다', async () => {
    const w = await open({ preview: null }, false);
    expect(w.find('[data-test="step2-tracks"]').exists()).toBe(false);
    expect(w.findComponent({ name: 'C5PlayerBar' }).exists()).toBe(false);
    w.unmount();
  });
});
