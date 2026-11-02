// 화면 다듬기 16차 (2026-09-30 황송해 결정 156~160, SD_02 머리말 · UC_07 A9 · SD_01 3.8)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import MyScoresList from '@/components/MyScoresList.vue';
import { createPinia, setActivePinia } from 'pinia';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { setActivePinia(createPinia()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('160 내가 만든 악보', () => {
  it('목록(곡 · 만든 시각 · 남은 시간 · 편집) · [받기]로 그 악보 받기 카드', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [
      { id: 'R-1', title: '아리랑 세마치', file_name: 'a.png', score_type: 'staff', created_at: '2026-09-30T05:02:00Z', expires_at: 'x', remaining_seconds: 21 * 3600 + 5, edited: true, edit_ops: [{ op: 'transpose', semitones: 2 }], midi_available: true, fallback: false },
      { id: 'R-2', title: 'page1.jpg', file_name: 'page1.jpg', score_type: 'staff', created_at: '2026-09-30T02:40:00Z', expires_at: 'x', remaining_seconds: 1800, edited: false, edit_ops: null, midi_available: false, fallback: false },
    ] })));
    const w = mount(MyScoresList, { props: { currentNo: 'R-1' } });
    await flushPromises();
    const rows = w.findAll('[data-test="my-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('아리랑 세마치');
    expect(rows[0].text()).toContain('(지금 악보)');
    expect(rows[0].text()).toContain('21시간 남음');
    expect(rows[0].text()).not.toContain('편집본'); // 186번: "편집" 칸 뺌
    expect(rows[0].get('[data-test="my-download"]').text()).toBe('저장하기'); // 185번
    expect(rows[1].text()).toContain('30분 남음');
    expect(w.find('[data-test="download-card"]').exists()).toBe(false);
    await w.findAll('[data-test="my-download"]')[1].trigger('click');
    expect(w.findAll('[data-test="download-card"]')).toHaveLength(1);
    expect((w.get('[data-test="pick-midi"]').element as HTMLInputElement).disabled).toBe(true); // MIDI 없는 결과
  });
  it('목록이 비었거나 못 불러오면 안내', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [] })));
    const w = mount(MyScoresList);
    await flushPromises();
    expect(w.get('[data-test="my-empty"]').text()).toBe('아직 만든 악보가 없습니다.');
  });
});

describe('156~159 배치', () => {
  it('2단계 카드 가운데 · 3단계 제목 가운데 · 악보 7 : 3 · 악보 아래 설명 없음', () => {
    expect(read('src/pages/S1Result.vue')).toContain('.track-card > h2 { text-align: center; }');
    const s2 = read('src/pages/S2Edit.vue');
    // (213번) .center-h 는 공통 styleguide.css 로 옮겼다
    expect(read('src/styles/styleguide.css')).toContain('.center-h { text-align: center; justify-self: stretch; }');
    expect(s2).toContain('grid-template-columns: minmax(0, 7fr) minmax(360px, 3fr)'); // 196번: 패널 최소 360px
    expect(s2).not.toContain('음표를 누르면 오른쪽');
    // (2026-09-30 164번) 목록은 4단계에서 1단계로 옮겼다(round18.test.ts)
    expect(read('src/pages/S3Download.vue')).not.toContain('<MyScoresList');
  });
});
