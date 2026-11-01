// 결정 C11: 화면 연주는 파트마다 악기 목록의 (bank, program) 으로 소리를 고른다 — 첼로와 아쟁이 겹치지 않는다.
import { describe, expect, it } from 'vitest';
import { midiSoundNumbers } from '@/player/soundNumbers';
import { findInstrument, sharedCatalog } from '@/lib/instruments';

describe('화면 연주 소리 번호', () => {
  it('gugak.sf2 가 실렸을 때만 서비스 번호, 아니면 GM 번호', () => {
    expect(midiSoundNumbers('gugak')).toBe('service');
    expect(midiSoundNumbers('fluid')).toBe('gm');
    expect(midiSoundNumbers('none')).toBe('gm');
  });

  it('첼로(0/42)와 아쟁(1/5)이 다른 소리 번호, 장구·북은 국악 타악 세트(128/1)', () => {
    const cat = sharedCatalog();
    const sound = (code: string) => { const i = findInstrument(cat, code)!; return [i.bank, i.program]; };
    expect(sound('cello')).toEqual([0, 42]);
    expect(sound('ajaeng')).toEqual([1, 5]);
    expect(sound('janggu')).toEqual([128, 1]);
    expect(sound('buk')).toEqual([128, 1]);
    const melodic = [...cat.gugak, ...cat.others].filter((i) => !i.percussion).map((i) => `${i.bank}:${i.program}`);
    expect(new Set(melodic).size).toBe(melodic.length);
    // 내려받기용 GM 호환 번호는 그대로(둘 다 42)
    expect([findInstrument(cat, 'cello')!.gm_program, findInstrument(cat, 'ajaeng')!.gm_program]).toEqual([42, 42]);
  });
});
