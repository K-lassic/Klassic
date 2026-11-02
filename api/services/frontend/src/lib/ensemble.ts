// 연주 악기 구성 적용(화면 연주 전용) — 기본 국악기 · 직접 고른 악기. (2026-11-02) 추천 조합은 뺐다(docs/API_업데이트_후보.md).
// '원래 악기'는 score-core(applyInstrumentMode 'original')가 맡는다.
import type { ScoreDoc, Part } from '@/types/score';
import type { InstrumentCatalog } from '@/types/api';
import { DEFAULT_MELODY, DEFAULT_PERCUSSION, instrumentName } from './instruments';

function clonePart(p: Part): Part {
  return { ...p, notes: p.notes.map((n) => ({ ...n })) };
}

/** 모든 선율 성부 = 기본 선율 악기, 타악 성부 = 기본 타악기 (R10, BR-PLY-01) */
export function applyDefaultEnsemble(doc: ScoreDoc, cat: InstrumentCatalog): ScoreDoc {
  return {
    ...doc,
    parts: doc.parts.map((p) => {
      const code = p.isPercussion ? DEFAULT_PERCUSSION : DEFAULT_MELODY;
      return { ...clonePart(p), instrument: code, name: instrumentName(cat, code) };
    }),
  };
}

/** "지금 연주: …" 에 쓰는 악기 이름 줄 (중복 제거) */
export function ensembleLabel(
  doc: ScoreDoc | null, cat: InstrumentCatalog, opts: { original?: boolean } = {},
): string {
  if (!doc) return '';
  const names: string[] = [];
  for (const p of doc.parts) {
    const n = opts.original && p.sourceInstrument ? p.sourceInstrument.name : instrumentName(cat, p.instrument);
    if (!names.includes(n)) names.push(n);
  }
  return names.join(' · ');
}

/** 트랙별 선택을 서버 형식(tracks)으로 */
export function tracksOf(doc: ScoreDoc): { part: number; instrument: string }[] {
  return doc.parts.map((p, i) => ({ part: i, instrument: p.instrument }));
}

/** C4 에서 고른 것 */
export type InstrumentChoice =
  | { kind: 'default' }
  | { kind: 'original' }
  | { kind: 'instrument'; code: string };

export function choiceKey(c: InstrumentChoice): string {
  switch (c.kind) {
    case 'default': return 'default';
    case 'original': return 'orig';
    case 'instrument': return `ins:${c.code}`;
  }
}

export function choiceFromKey(k: string): InstrumentChoice {
  if (k === 'default') return { kind: 'default' };
  if (k === 'orig') return { kind: 'original' };
  return { kind: 'instrument', code: k.slice(k.indexOf(':') + 1) };
}
