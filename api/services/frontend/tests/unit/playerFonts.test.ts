// (#42 · 2026-10-30 팀장 피드백 "재생 지연") 연주에 필요한 음원만 받는다 — 국악기만 쓰면 gugak.sf2 하나
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fontsFor } from '@/player/soundNumbers';
import type { ScoreDoc } from '@/types/score';

const doc = (...instruments: string[]) => ({ parts: instruments.map((instrument) => ({ instrument })) }) as unknown as ScoreDoc;
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('#42 필요한 음원만 받기', () => {
  it('기본 편성(가야금 · 장구)은 gugak.sf2 만', () => {
    expect(fontsFor(doc('gayageum', 'janggu'))).toEqual(['gugak']);
    expect(fontsFor(doc('daegeum', 'buk'))).toEqual(['gugak']);
  });
  it('일반 악기가 하나라도 있으면 FluidR3 도', () => {
    expect(fontsFor(doc('gayageum', 'piano'))).toEqual(['gugak', 'fluid']);
    expect(fontsFor(doc('violin'))).toEqual(['fluid']);
  });
  it('목록에 없는 악기(원래 악기 original:N)는 GM 번호라 FluidR3', () => {
    expect(fontsFor(doc('original:53'))).toEqual(['fluid']);
  });
  it('악보가 없으면 아무것도', () => {
    expect(fontsFor(null)).toEqual([]);
    expect(fontsFor(doc())).toEqual([]);
  });
  it('연주기는 gugak.sf2 를 먼저 받고, FluidR3 는 ensureFonts 에서 필요할 때만 받는다', () => {
    const p = read('src/player/player.ts');
    const ready = p.slice(p.indexOf('ensureReady(): Promise<boolean>'), p.indexOf('ensureFonts(doc: ScoreDoc)'));
    // 처음 준비에서는 gugak.sf2 를 받고, FluidR3 는 gugak.sf2 를 못 받았을 때만
    expect(ready).toContain('await fetchFont(SOUNDFONT_URLS.gugak)');
    expect(ready).toMatch(/if \(!gugakBuf\) \{[\s\S]*fetchFont\(SOUNDFONT_URLS\.fluid\)/);
    expect(ready).not.toContain('Promise.all');
    expect(p).toMatch(/ensureFonts\(doc: ScoreDoc\)[\s\S]*fontsFor\(doc\)\.includes\('fluid'\)/);
    expect(p).toMatch(/async play\([\s\S]*await this\.ensureFonts\(doc\);/);
  });
  it('구간별 시간을 남긴다 — 음원 받기 · 싣기 · MIDI · 첫 소리', () => {
    const p = read('src/player/player.ts');
    for (const k of ['fetchGugakMs', 'fetchFluidMs', 'loadMs', 'loadFluidMs', 'midiMs', 'firstSoundMs']) {
      expect(p).toContain(`measure('${k}'`);
    }
  });
});
