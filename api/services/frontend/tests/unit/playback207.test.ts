// (2026-10-01 황송해 207 · 208번) 단계 이동 · 들어올 때 자동 재생 없음(빠르기 적용이 멈춘 곡을 다시 틀던 버그),
// 연주 중 악기를 바꾸면 그 자리에서 바뀐 악기로 이어서
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount, flushPromises } from '@vue/test-utils';

const fake = vi.hoisted(() => ({
  state: 'idle', base: 'gugak', rate: 1, volume: 0.8, muted: false, position: 0, duration: 0,
  listeners: new Set<(s: string) => void>(),
  on(fn: (s: string) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(s: string) { this.state = s; this.listeners.forEach((l) => l(s)); },
  stop: vi.fn(), preload: vi.fn(), setRate: vi.fn(), setVolume: () => undefined, setMuted: () => undefined,
  play: vi.fn(async function (this: { emit: (s: string) => void }) { fake.emit('playing'); return true; }),
  switchDoc: vi.fn(() => true),
}));
vi.mock('@/player/player', () => ({ player: fake, PLAYBACK_RATE_MIN: 0.5, PLAYBACK_RATE_MAX: 2, PLAYBACK_BASE_BPM: 100 }));

import C5PlayerBar from '@/components/C5PlayerBar.vue';
import type { ScoreDoc } from '@/types/score';

const docA = { title: 'A', tempoBpm: 100, parts: [] } as unknown as ScoreDoc;
const docB = { title: 'B', tempoBpm: 100, parts: [] } as unknown as ScoreDoc;
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('207 자동 재생 없음 · 화면을 떠나면 멈춤', () => {
  beforeEach(() => { fake.state = 'idle'; fake.listeners.clear(); fake.play.mockClear(); fake.stop.mockClear(); fake.switchDoc.mockClear(); });

  it('들어와도(빠르기 적용 포함) 재생하지 않는다 · 막대가 사라지면 멈춘다', () => {
    const w = mount(C5PlayerBar, { props: { doc: docA, tempoRate: 1.2, preload: true } });
    expect(fake.play).not.toHaveBeenCalled();
    w.unmount();
    expect(fake.stop).toHaveBeenCalled();
  });
  it('연주기: 빠르기는 연주 중일 때만 곧바로 적용(멈춰 있으면 기억만) · 이어서 할 때 적용', () => {
    const p = read('src/player/player.ts');
    expect(p).toContain("if (this.seq && this.state === 'playing') this.applySpeed();");
    expect(p).toMatch(/async resume\(\)[\s\S]*this\.applySpeed\(\);/);
  });
});

describe('208 연주 중 악기 바꾸기', () => {
  beforeEach(() => { fake.state = 'idle'; fake.listeners.clear(); fake.play.mockClear(); fake.switchDoc.mockClear(); });

  it('연주 중에 악보(악기)가 바뀌면 그 자리에서 이어서 — 멈춰 있으면 바꾸지 않음', async () => {
    const w = mount(C5PlayerBar, { props: { doc: docA } });
    await w.setProps({ doc: docB });
    expect(fake.switchDoc).not.toHaveBeenCalled();
    await w.get('[data-test="play"]').trigger('click');
    await flushPromises();
    expect(fake.play).toHaveBeenCalledTimes(1);
    await w.setProps({ doc: docA });
    expect(fake.switchDoc).toHaveBeenCalledWith(docA);
  });
  it('연주기 switchDoc: 지금 위치를 기억해 새 악보를 싣고 그 자리로', () => {
    const p = read('src/player/player.ts');
    expect(p).toMatch(/switchDoc\(doc: ScoreDoc\): boolean \{[\s\S]*const at = this\.position;[\s\S]*loadNewSongList[\s\S]*this\.seq\.currentTime = at;/);
  });
});
