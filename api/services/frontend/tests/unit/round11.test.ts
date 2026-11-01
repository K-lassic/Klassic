// 화면 다듬기 11차 (2026-09-30 황송해 결정 117~122, SD_02 머리말 · UC_03 BR-UPL-03)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fake = vi.hoisted(() => ({
  state: 'idle', base: 'gugak', rate: 1, position: 0, duration: 0, volume: 0.8, muted: false,
  on() { return () => {}; }, stop() {}, async play() { return true; }, pause() {}, async resume() { return true; }, seek() {}, setRate() {},
  setVolume(v: number) { this.volume = v; if (v > 0) this.muted = false; },
  setMuted(m: boolean) { this.muted = m; },
}));
vi.mock('@/player/player', () => ({ player: fake, PLAYBACK_RATE_MIN: 0.5, PLAYBACK_RATE_MAX: 2, PLAYBACK_BASE_BPM: 100 }));

import C5PlayerBar from '@/components/C5PlayerBar.vue';
import type { ScoreDoc } from '@/types/score';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
beforeEach(() => { fake.volume = 0.8; fake.muted = false; });
afterEach(() => { document.body.innerHTML = ''; });

describe('118 소리 크기', () => {
  it('음량 막대 0~100%(5 단위) · aria-valuetext · [음소거] 토글(aria-pressed)', async () => {
    const w = mount(C5PlayerBar, { props: { doc: { parts: [] } as unknown as ScoreDoc, label: '' } });
    const r = w.get('[data-test="volume"]');
    expect(r.attributes()).toMatchObject({ type: 'range', min: '0', max: '100', step: '5', 'aria-valuetext': '음량 80%' });
    await r.setValue('40');
    expect(fake.volume).toBe(0.4);
    expect(w.get('[data-test="volume"]').attributes('aria-valuetext')).toBe('음량 40%');
    const m = w.get('[data-test="mute"]');
    expect(m.attributes('aria-pressed')).toBe('false');
    await m.trigger('click');
    expect(fake.muted).toBe(true);
    expect(w.get('[data-test="mute"]').attributes('aria-pressed')).toBe('true');
    expect(w.get('[data-test="volume-text"]').text()).toBe('음소거');
    expect(w.get('[data-test="volume"]').attributes('aria-valuetext')).toBe('음량 40% (음소거)');
  });
  it('연주기: GainNode 로 소리 크기 · 브라우저 저장소는 try/catch', () => {
    const src = read('src/player/player.ts');
    expect(src).toContain('this.synth = new Synthetizer(this.gain, baseBuf);');
    expect(src).toMatch(/try \{ window\.localStorage\.setItem/);
    expect(src).toMatch(/try \{\s*const raw = window\.localStorage\.getItem/);
  });
});

describe('117 · 119 결과 악보', () => {
  it('2단계 결과 악보는 성부 이름을 그리지 않는다(화면만) · 작은 사진을 키웠으면 [?] 에 알린다', () => {
    const src = read('src/pages/S1Result.vue');
    expect(src).toContain(':part-names="false"');
    expect(src).toContain('px 로 키워 읽었습니다.');
    expect(read('src/components/ScoreView.vue')).toContain('drawPartNames: props.partNames');
  });
});
