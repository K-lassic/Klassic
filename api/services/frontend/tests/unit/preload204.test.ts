// (2026-10-01 황송해 204번) 2 · 3단계 화면이 열리면 [재생] 전에 음원을 미리 받아 싣는다 — 1단계 · 만료 · 데이터 절약 모드는 아님
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';

const fake = vi.hoisted(() => ({
  state: 'idle', base: 'gugak', rate: 1, volume: 0.8, muted: false, speed: 1, position: 0, duration: 0,
  on: () => () => undefined, stop: () => undefined, preload: vi.fn(),
  setVolume: () => undefined, setMuted: () => undefined, setSpeed: () => undefined,
}));
vi.mock('@/player/player', () => ({ player: fake, PLAYBACK_RATE_MIN: 0.5, PLAYBACK_RATE_MAX: 2, PLAYBACK_BASE_BPM: 100 }));

import C5PlayerBar from '@/components/C5PlayerBar.vue';
import type { ScoreDoc } from '@/types/score';

const doc = { tempoBpm: 120, parts: [] } as unknown as ScoreDoc;
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('204 음원 미리 불러오기', () => {
  beforeEach(() => fake.preload.mockReset());

  it('preload 를 주면 화면이 열릴 때 미리 불러온다', () => {
    mount(C5PlayerBar, { props: { doc, preload: true } });
    expect(fake.preload).toHaveBeenCalledTimes(1);
  });
  it('preload 가 없거나(1단계 공유 듣기) 보관이 끝났으면 미리 받지 않는다', () => {
    mount(C5PlayerBar, { props: { doc } });
    mount(C5PlayerBar, { props: { doc, preload: true, expired: true } });
    expect(fake.preload).not.toHaveBeenCalled();
  });
  it('2 · 3단계 연주 막대에 preload · 연주기는 데이터 절약 모드면 건너뜀 · 같은 준비 약속을 [재생]이 기다림', () => {
    expect(read('src/pages/S1Result.vue')).toMatch(/<C5PlayerBar\s+ref="player"\s+preload/);
    expect(read('src/pages/S2Edit.vue')).toContain('<C5PlayerBar preload ');
    const p = read('src/player/player.ts');
    expect(p).toMatch(/preload\(\): void \{[\s\S]*saveData\) return;[\s\S]*void this\.ensureReady\(\);/);
    expect(p).toContain('if (this.readyP) return this.readyP;');
  });
});
