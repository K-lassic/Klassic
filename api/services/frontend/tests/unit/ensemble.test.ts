// 화면 연주 악기 구성 — 타악 성부가 없는 악보에는 장구를 놓지 않는다(모델 API arrange.ADD_MISSING_PERCUSSION = False 와 같은 규칙)
import { describe, expect, it } from 'vitest';
import { applyDefaultEnsemble } from '@/lib/ensemble';
import { sharedCatalog } from '@/lib/instruments';
import type { Part, ScoreDoc } from '@/types/score';

const cat = sharedCatalog();

function part(id: string, isPercussion: boolean): Part {
  return { id, name: id, instrument: 'piano', isPercussion, volume: 100, origin: 'original', notes: [] };
}

function doc(parts: Part[]): ScoreDoc {
  return { version: 1, ppq: 480, tempoBpm: 90, timeSignature: { beats: 4, beatType: 4 }, keyFifths: 0, parts };
}

describe('타악 성부가 없으면 장구가 빠진다', () => {
  it('기본 구성: 선율 성부만 있으면 장구 성부가 생기지 않는다', () => {
    const out = applyDefaultEnsemble(doc([part('P1', false)]), cat);
    expect(out.parts.map((p) => p.instrument)).toEqual(['gayageum']);
  });
  it('기본 구성: 타악 성부가 있으면 그 성부에만 장구를 놓는다', () => {
    const out = applyDefaultEnsemble(doc([part('P1', false), part('P2', true)]), cat);
    expect(out.parts.map((p) => p.instrument)).toEqual(['gayageum', 'janggu']);
  });
});
