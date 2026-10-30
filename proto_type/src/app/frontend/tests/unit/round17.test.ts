// 161 · 162 (2026-09-30 황송해 결정 — T164 결정 변경: 재생 빠르기를 받기 파일에도 · 바닥글 맨 아래)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fake = vi.hoisted(() => ({
  state: 'idle', base: 'gugak', rate: 1, position: 0, duration: 0, volume: 0.8, muted: false,
  on() { return () => {}; }, stop() {}, async play() { return true; }, pause() {}, async resume() { return true; }, seek() {},
  setRate(r: number) { this.rate = r; }, setVolume() {}, setMuted() {},
}));
vi.mock('@/player/player', () => ({ player: fake, PLAYBACK_RATE_MIN: 0.5, PLAYBACK_RATE_MAX: 2, PLAYBACK_BASE_BPM: 100 }));

import C5PlayerBar from '@/components/C5PlayerBar.vue';
import { setAutosaveBackend, useEditorStore } from '@/stores/editor';
import type { ScoreDoc } from '@/types/score';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const mem = new Map<string, unknown>();
beforeEach(() => {
  setActivePinia(createPinia()); fake.rate = 1; mem.clear();
  setAutosaveBackend({ get: async (k: string) => mem.get(k) as never, put: async (r: { request_no: string }) => { mem.set(r.request_no, r); }, delete: async (k: string) => { mem.delete(k); } } as never);
});

describe('161 재생 빠르기 → 편집 기록 set_tempo', () => {
  it('하나만 두고 바꾸며, 1.0배면 연산을 뺀다 · 되돌리면 없다', async () => {
    const ed = useEditorStore();
    await ed.open('R-1');
    await ed.push({ op: 'transpose', semitones: 1 });
    await ed.setTempo(150);
    await ed.setTempo(120);
    expect(ed.ops.filter((o) => o.op === 'set_tempo')).toEqual([{ op: 'set_tempo', bpm: 120 }]);
    expect(ed.tempoBpm).toBe(120);
    await ed.setTempo(null);
    expect(ed.ops).toEqual([{ op: 'transpose', semitones: 1 }]);
    await ed.setTempo(150);
    await ed.revertAll();
    expect(ed.tempoBpm).toBeNull();
  });
  it('연주 막대: 편집 기록의 빠르기를 따르고, 막대를 놓으면 rateChange', async () => {
    const w = mount(C5PlayerBar, { props: { doc: { parts: [] } as unknown as ScoreDoc, label: '', tempoRate: 1.5 } });
    expect(fake.rate).toBe(1.5);
    expect(w.get('[data-test="rate"]').attributes('aria-valuetext')).toBe('1.5배 · 150 bpm');
    await w.get('[data-test="rate"]').setValue('1.25');
    await w.get('[data-test="rate"]').trigger('change');
    expect(w.emitted('rateChange')!.at(-1)).toEqual([1.25]);
    await w.setProps({ tempoRate: 1 });
    expect(fake.rate).toBe(1);
  });
  it('2 · 3단계가 편집 기록으로 잇는다', () => {
    for (const p of ['src/pages/S1Result.vue', 'src/pages/S2Edit.vue']) {
      const src = read(p);
      expect(src).toContain('await ed.setTempo(Math.abs(r - 1) < 0.001 ? null : Math.round(r * 100));');
      expect(src).toContain('@rate-change="onRateChange"');
    }
  });
});

describe('162 바닥글', () => {
  it('연주 막대 여백은 바닥글 안(body 여백 아님)', () => {
    const css = read('src/app.css');
    expect(css).not.toMatch(/body\.has-dock \{ padding-bottom/);
    expect(css).toContain('#app { min-height: 100vh;');
  });
});
