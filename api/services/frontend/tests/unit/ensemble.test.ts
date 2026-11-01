// 화면 연주 악기 구성 — 타악 성부가 없는 악보에는 장구를 놓지 않는다(모델 API arrange.ADD_MISSING_PERCUSSION = False 와 같은 규칙)
import { describe, expect, it } from 'vitest';
import { applyCombination, applyDefaultEnsemble } from '@/lib/ensemble';
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
  it('추천 조합: 조합에 장구가 있어도 타악 성부가 없으면 놓이지 않는다', () => {
    const out = applyCombination(doc([part('P1', false)]), cat, ['daegeum', 'janggu']);
    expect(out.parts.some((p) => p.instrument === 'janggu')).toBe(false);
  });
  it('타악만의 추천 조합(장구 · 북): 타악 성부가 없으면 깨지지 않고 선율 성부는 기본 선율 악기(가야금)', () => {
    const out = applyCombination(doc([part('P1', false), part('P2', false)]), cat, ['janggu', 'buk']);
    expect(out.parts.map((p) => p.instrument)).toEqual(['gayageum', 'gayageum']);
    expect(out.parts.every((p) => !p.isPercussion)).toBe(true);
  });
  it('타악만의 추천 조합: 타악 성부가 있으면 첫 타악기(장구)만 놓인다', () => {
    const out = applyCombination(doc([part('P1', false), part('P2', true)]), cat, ['janggu', 'buk']);
    expect(out.parts.map((p) => p.instrument)).toEqual(['gayageum', 'janggu']);
  });
  it('국악기 없는 추천 조합(피아노 · 바이올린)도 그대로 놓인다(남는 선율 악기는 복사 트랙)', () => {
    const out = applyCombination(doc([part('P1', false)]), cat, ['piano', 'violin']);
    expect(out.parts.map((p) => p.instrument)).toEqual(['piano', 'violin']);
  });
});
