// 재생 빠르기(FR-065) — 재생 막대에서 곡 전체 빠르기 배율을 고른다. 듣기만 바뀌고 악보(doc)는 그대로.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const fake = vi.hoisted(() => ({
  state: 'idle', base: 'gugak', rate: 1,
  on: () => () => {},
  stop: () => {},
  play: async () => true,
  setRate(r: number) { this.rate = Math.min(2, Math.max(0.5, r)); },
}));
vi.mock('@/player/player', () => ({ player: fake, PLAYBACK_RATE_MIN: 0.5, PLAYBACK_RATE_MAX: 2, PLAYBACK_BASE_BPM: 100 }));

import C5PlayerBar from '@/components/C5PlayerBar.vue';
import type { ScoreDoc } from '@/types/score';

const doc = { tempoBpm: 120, parts: [] } as unknown as ScoreDoc;

describe('C5PlayerBar — 재생 빠르기(가로 막대, 2026-09-30 황송해)', () => {
  it('0.5~2.0배 막대 · 옆에 "1.0배 · 100 bpm" · aria-valuetext', () => {
    const w = mount(C5PlayerBar, { props: { doc, label: '기본 국악기 구성' } });
    const r = w.get('[data-test="rate"]');
    expect(r.attributes('type')).toBe('range');
    expect(r.attributes('min')).toBe('0.5');
    expect(r.attributes('max')).toBe('2');
    expect(r.attributes('aria-valuetext')).toBe('1.0배 · 100 bpm');
    expect(w.get('[data-test="rate-text"]').text()).toBe('1.0배 · 100 bpm');
    expect(w.find('select').exists()).toBe(false);
  });

  it('끌면 연주기 배율과 표시가 바로 바뀌고 악보(doc)는 그대로', async () => {
    const before = JSON.stringify(doc);
    const w = mount(C5PlayerBar, { props: { doc, label: '' } });
    await w.get('[data-test="rate"]').setValue('1.5');
    expect(fake.rate).toBe(1.5);
    expect(w.get('[data-test="rate-text"]').text()).toBe('1.5배 · 150 bpm');
    expect(w.get('[data-test="rate"]').attributes('aria-valuetext')).toBe('1.5배 · 150 bpm');
    await w.get('[data-test="rate"]').setValue('0.75');
    expect(w.get('[data-test="rate-text"]').text()).toBe('0.75배 · 75 bpm');
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('보관 기간이 지나면 끌 수 없다 · 2단계(showRate=false)는 막대도 [악기 바꾸기]도 없다', () => {
    const w = mount(C5PlayerBar, { props: { doc, label: '', expired: true } });
    expect(w.get('[data-test="rate"]').attributes('disabled')).toBeDefined();
    const s2 = mount(C5PlayerBar, { props: { doc, label: '', showRate: false, canChange: false } });
    expect(s2.find('[data-test="rate"]').exists()).toBe(false);
    expect(s2.text()).not.toContain('악기 바꾸기');
    expect(s2.text()).not.toContain('재생 빠르기');
  });
});

describe('재생 속도 계산(기준 100 bpm, 2026-09-30)', () => {
  it('곡 빠르기와 관계없이 배율 × 100 bpm 으로 들린다', async () => {
    const { playbackSpeed, PLAYBACK_BASE_BPM } = await import('@/player/tempo');
    expect(PLAYBACK_BASE_BPM).toBe(100);
    expect(playbackSpeed(1, 120)).toBeCloseTo(100 / 120);
    expect(playbackSpeed(1.5, 120)).toBeCloseTo(150 / 120);
    expect(playbackSpeed(1, 100)).toBe(1);
    expect(playbackSpeed(2, null)).toBe(2);
  });
});
