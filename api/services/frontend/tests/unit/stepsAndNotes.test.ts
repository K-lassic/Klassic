// C9 단계 표시 · 악보에서 음표 고르기(고른 음표 패널) · C3 대체 안내 (2026-09-30 황송해 결정, SD_02 §3-4 · §3-10 · §5)
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import C9StepBar from '@/components/C9StepBar.vue';
import NoteInspector from '@/components/NoteInspector.vue';
import C3ResultBand from '@/components/C3ResultBand.vue';
import { matchScoreNote, orderedNoteIds, osmdHalfToneToMidi } from '@/lib/noteMatch';
import type { ScoreDoc } from '@/types/score';

const doc = {
  ppq: 480, tempoBpm: 120, timeSignature: { beats: 4, beatType: 4 },
  parts: [
    { id: 'p0', notes: [
      { id: 'a', startTick: 0, durationTicks: 480, pitch: 60, velocity: 90 },
      { id: 'b', startTick: 480, durationTicks: 480, pitch: 64, velocity: 90 },
      { id: 'c', startTick: 480, durationTicks: 480, pitch: 67, velocity: 90 },
      { id: 'd', startTick: 1920, durationTicks: 480, pitch: 62, velocity: 40 },
    ] },
    { id: 'p1', notes: [{ id: 'x', startTick: 0, durationTicks: 480, pitch: 48, velocity: 90 }] },
  ],
} as unknown as ScoreDoc;
const partLabel = (i: number) => `트랙 ${i + 1}`;

describe('C9 단계 표시', () => {
  it('3단계 화면: 1·2·3 켜짐, 3이 지금(aria-current), 4는 꺼짐 · 이름 표시 · 요청 번호 없음', () => {
    const w = mount(C9StepBar, { props: { current: 3 } });
    const li = (n: number) => w.get(`[data-test="step-${n}"]`);
    expect([1, 2, 3, 4].map((n) => li(n).classes().includes('on'))).toEqual([true, true, true, false]);
    expect(li(3).attributes('aria-current')).toBe('step');
    expect(li(3).classes()).toContain('now');
    expect(li(1).attributes('aria-current')).toBeUndefined();
    expect(w.text()).toContain('1단계');
    expect(w.findAll('.name').map((n) => n.text())).toEqual(['악보 올리기', '다른 악기로 변환하기', '악보 음계 변환하기', '저장하기']);
    expect(w.text()).not.toMatch(/R-|—/);
  });
  it('1단계 화면: 1만 켜짐', () => {
    const w = mount(C9StepBar, { props: { current: 1 } });
    expect(w.findAll('li.on')).toHaveLength(1);
  });
});

describe('악보 음표 ↔ ScoreDoc 음표', () => {
  it('성부 · 시작 시각(온음표 단위)으로 찾고, 화음이면 음 높이가 가까운 쪽', () => {
    expect(osmdHalfToneToMidi(48)).toBe(60); // (2026-09-30 131번) OSMD 1.9.9 는 가운데 도를 48 로 준다
    expect(matchScoreNote(doc, 0, 0, 60)).toBe('a');
    expect(matchScoreNote(doc, 0, 0.25, 67)).toBe('c');
    expect(matchScoreNote(doc, 0, 0.25, 63)).toBe('b');
    expect(matchScoreNote(doc, 1, 0, 48)).toBe('x');
    expect(matchScoreNote(doc, 0, 0.5, 60)).toBeNull(); // 붙임줄 뒷부분처럼 시작이 맞는 음표가 없음
    expect(orderedNoteIds(doc, 0)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('고른 음표 패널(음표 고치기 표 대신, 2026-09-30 정리)', () => {
  const mountIns = (noteId: string | null, extra = {}) => mount(NoteInspector, { props: { doc, noteId, part: 0, partLabel, ...extra } });

  it('이름은 "악보 음표 수정" · 버튼은 악기 이름(같은 악기는 번호, 2026-09-30)', async () => {
    const w = mountIns(null, { trackNames: ['피아노1', '피아노2'] });
    expect(w.get('#note-h').text()).toBe('악보 음표 수정');
    expect(w.text()).not.toContain('트랙');
    // (2026-09-30 133번) 악기 고르기 버튼 줄은 뺐다
    expect(w.find('[data-test="note-track-1"]').exists()).toBe(false);
  });

  it('트랙은 [1트랙][2트랙] 토글(aria-pressed) · 이전/다음 음표 버튼과 음량은 없다', async () => {
    const w = mountIns(null);
    expect(w.get('[data-test="note-empty"]').text()).toBe('악보에서 음표를 눌러 고르십시오.');
    expect(w.find('[data-test="note-track-1"]').exists()).toBe(false); // (2026-09-30 133번)
    expect(w.find('[data-test="note-prev"]').exists()).toBe(false);
    expect(w.find('[data-test="note-next"]').exists()).toBe(false);
    expect(w.find('[data-test="note-vol"]').exists()).toBe(false);
    expect(w.find('select').exists()).toBe(false);
  });

  it('자리 · 음 이름 · 반음 올리기/내리기 · 음역 경고 없음(2026-09-30)', async () => {
    const w = mountIns('d');
    expect(w.get('[data-test="note-where"]').text()).toContain('트랙 1 · 2마디 1박');
    expect(w.text()).not.toContain('음역');
    await w.get('[data-test="note-up"]').trigger('click');
    await w.get('[data-test="note-down"]').trigger('click');
    expect(w.emitted('pitch')).toEqual([['d', 63], ['d', 61]]);
    expect(w.emitted('volume')).toBeUndefined();
  });

  it('키보드: ←/→ 이전·다음 음표(버튼 없이도), ↑/↓ 반음 · 보관 만료면 고치지 않음', async () => {
    const w = mountIns('b');
    const panel = w.get('[data-test="note-inspector"]');
    await panel.trigger('keydown', { key: 'ArrowRight' });
    await panel.trigger('keydown', { key: 'ArrowLeft' });
    expect(w.emitted('select')).toEqual([['c'], ['a']]);
    await panel.trigger('keydown', { key: 'ArrowUp' });
    expect(w.emitted('pitch')![0]).toEqual(['b', 65]);
    const locked = mountIns('b', { disabled: true });
    await locked.get('[data-test="note-inspector"]').trigger('keydown', { key: 'ArrowUp' });
    expect(locked.emitted('pitch')).toBeUndefined();
  });

  it('고른 음표가 없을 때 → 로 첫 음표를 고른다(키보드만으로도)', async () => {
    const w = mountIns(null);
    await w.get('[data-test="note-inspector"]').trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('select')![0]).toEqual(['a']);
  });
});

describe('C3 대체 안내(2026-09-30, UC_02)', () => {
  it('주의: 안내 한 줄 + [대체 템플릿 받기] + "대체 템플릿이란?" 설명', async () => {
    const w = mount(C3ResultBand, { props: { band: 'caution' } });
    expect(w.text()).toContain('결과가 이상하면 대체 악보로 바꿀 수 있습니다.');
    expect(w.get('[data-test="ask-fallback"]').text()).toBe('대체 템플릿 받기');
    expect(w.get('[data-test="fallback-what"]').text()).toMatch(/^대체 템플릿이란\? .*기본 국악 장단 악보입니다\./);
    await w.get('[data-test="ask-fallback"]').trigger('click');
    expect(w.emitted('requestFallback')).toHaveLength(1);
  });
  it('정상(신뢰): 대체 안내 띠 · 버튼이 없다', () => {
    const w = mount(C3ResultBand, { props: { band: 'trust' } });
    expect(w.find('.notice').exists()).toBe(false);
    expect(w.find('[data-test="ask-fallback"]').exists()).toBe(false);
    expect(w.text()).not.toContain('대체 템플릿');
  });
});
