// 연주 악기 구성 적용(화면 연주 전용) — 기본 국악기 · 추천 조합 · 직접 고른 악기.
// '원래 악기'는 score-core(applyInstrumentMode 'original')가 맡는다.
import type { ScoreDoc, Part } from '@/types/score';
import type { InstrumentCatalog } from '@/types/api';
import { DEFAULT_MELODY, DEFAULT_PERCUSSION, instrumentName, isPercussionCode } from './instruments';

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

/**
 * 추천 조합 적용 — 선율 악기는 선율 성부에 차례로, 남는 선율 악기는 원래 선율(parts[0]) 복사 트랙으로(FR-023 과 같은 규칙).
 * 타악 악기는 타악 성부에만.
 */
export function applyCombination(doc: ScoreDoc, cat: InstrumentCatalog, instruments: string[]): ScoreDoc {
  const melodic = instruments.filter((c) => !isPercussionCode(cat, c));
  const perc = instruments.filter((c) => isPercussionCode(cat, c));
  const parts = doc.parts.map(clonePart);
  let m = 0;
  for (const p of parts) {
    if (p.isPercussion) {
      const code = perc[0] ?? DEFAULT_PERCUSSION;
      p.instrument = code; p.name = instrumentName(cat, code);
    } else {
      const code = melodic.length ? melodic[m % melodic.length] : DEFAULT_MELODY;
      m += 1;
      p.instrument = code; p.name = instrumentName(cat, code);
    }
  }
  const melodyParts = parts.filter((p) => !p.isPercussion).length;
  const base = doc.parts.find((p) => !p.isPercussion) ?? doc.parts[0];
  for (let i = melodyParts; i < melodic.length && base; i += 1) {
    const code = melodic[i];
    parts.push({
      ...clonePart(base), id: `P${parts.length + 1}`, instrument: code, name: instrumentName(cat, code),
      origin: 'melody_copy', sourceInstrument: null,
      notes: base.notes.map((n, k) => ({ ...n, id: `P${parts.length + 1}-c${k}` })),
    });
  }
  return { ...doc, parts };
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
  | { kind: 'recommend'; index: number }
  | { kind: 'original' }
  | { kind: 'instrument'; code: string };

export function choiceKey(c: InstrumentChoice): string {
  switch (c.kind) {
    case 'default': return 'default';
    case 'recommend': return `rec:${c.index}`;
    case 'original': return 'orig';
    case 'instrument': return `ins:${c.code}`;
  }
}

export function choiceFromKey(k: string): InstrumentChoice {
  if (k === 'default') return { kind: 'default' };
  if (k === 'orig') return { kind: 'original' };
  const [t, v] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
  if (t === 'rec') return { kind: 'recommend', index: Number(v) };
  return { kind: 'instrument', code: v };
}
