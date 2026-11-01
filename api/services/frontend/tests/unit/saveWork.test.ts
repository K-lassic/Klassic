// [작업 저장하기] (2026-10-01 황송해 202번, SD_02 · UC6 A9) — 서버 저장(finished:false) · 상태 문구 · 2 · 3단계 [이전] · [다음] 가운데
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const put = vi.fn();
vi.mock('@/api/client', () => ({ api: { put: (...a: unknown[]) => put(...a) } }));

import SaveWorkButton from '@/components/SaveWorkButton.vue';
import { useEditorStore } from '@/stores/editor';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('202 작업 저장하기', () => {
  beforeEach(() => { put.mockReset(); setActivePinia(createPinia()); });

  it('지금 편집 기록을 finished:false 로 보내고 저장 시각을 알린다', async () => {
    const ed = useEditorStore();
    ed.requestNo = 'R-1001-AAAA';
    ed.ops = [{ op: 'transpose', semitones: 2 }] as never;
    put.mockResolvedValue(undefined);
    const w = mount(SaveWorkButton, { props: { requestNo: 'R-1001-AAAA' } });
    await w.get('[data-test="save-work"] button').trigger('click');
    await flushPromises();
    expect(put).toHaveBeenCalledTimes(1);
    const [url, body] = put.mock.calls[0] as [string, { ops: unknown[]; finished: boolean }];
    expect(url).toBe('/api/requests/R-1001-AAAA/edits');
    expect(body.finished).toBe(false);
    expect(body.ops).toEqual([{ op: 'transpose', semitones: 2 }]);
    // (2026-10-01 205번) 성공 문구는 화면에 보이지 않고 화면 읽기 프로그램에만
    const st = w.get('[data-test="save-work-status"]');
    expect(st.text()).toMatch(/^저장했습니다 \(\d{2}:\d{2}\)$/);
    expect(st.classes()).toContain('sr-only');
  });

  it('다른 악보의 편집 기록은 보내지 않는다 · 실패하면 다시 누르라고 알린다', async () => {
    const ed = useEditorStore();
    ed.requestNo = 'R-OTHER';
    ed.ops = [{ op: 'transpose', semitones: 1 }] as never;
    put.mockRejectedValue(new Error('down'));
    const w = mount(SaveWorkButton, { props: { requestNo: 'R-1001-BBBB' } });
    await w.get('[data-test="save-work"] button').trigger('click');
    await flushPromises();
    expect((put.mock.calls[0] as [string, { ops: unknown[] }])[1].ops).toEqual([]);
    expect(w.get('[data-test="save-work-status"]').text()).toBe('저장하지 못했습니다. 다시 눌러 주십시오.');
    expect(w.get('[data-test="save-work-status"]').classes()).not.toContain('sr-only');
  });

  it('보관 기간이 지나면 막는다', async () => {
    const w = mount(SaveWorkButton, { props: { requestNo: 'R-1', reason: '보관 기간이 지나 저장할 수 없습니다' } });
    await w.get('[data-test="save-work"] button').trigger('click');
    expect(put).not.toHaveBeenCalled();
  });

  it('2단계 · 3단계 단계 이동 줄 가운데에 둔다', () => {
    for (const f of ['src/pages/S1Result.vue', 'src/pages/S2Edit.vue']) {
      const t = read(f);
      const nav = t.slice(t.lastIndexOf('<StepNav'), t.indexOf('</StepNav>', t.lastIndexOf('<StepNav')));
      expect(nav).toContain('<SaveWorkButton');
    }
  });
});
