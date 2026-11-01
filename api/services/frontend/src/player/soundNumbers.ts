// 화면 연주 소리 번호 고르기 (결정 C11, 2026-09-29) — spessasynth 없이 시험할 수 있게 player.ts 밖에 둔다.
import type { BaseFont } from './player';
import type { ScoreDoc } from '@/types/score';
import shared from '../../../../shared/instruments.json';

/**
 * gugak.sf2 를 실었으면 서비스 음원 번호(국악기 bank 1 · 장구·북 128/1 — score-core serviceSound),
 * 없으면(FluidR3_GM 만) GM 호환 번호(gm_program)로 MIDI 를 만든다.
 */
export function midiSoundNumbers(base: BaseFont): 'service' | 'gm' {
  return base === 'gugak' ? 'service' : 'gm';
}

export type FontKey = 'gugak' | 'fluid';

/** 악기 코드 → 그 악기를 내는 음원. api/shared/instruments.json 의 soundfont 칸 */
const FONT_OF: Record<string, FontKey> = Object.fromEntries(
  shared.instruments.map((i) => [i.code, i.soundfont === 'gugak.sf2' ? 'gugak' : 'fluid']),
);

/**
 * (#42 · 2026-10-30 팀장 피드백 "재생 지연") 이 악보를 소리 내는 데 필요한 음원만 고른다.
 * 기본 편성(가야금 · 장구)처럼 국악기만 쓰면 gugak.sf2(22MB) 하나 — FluidR3_GM.sf2(148MB)는 일반 악기를 쓸 때만 받는다.
 * 목록에 없는 악기(원래 악기 'original:N' 등)는 GM 번호로 부르므로 FluidR3.
 */
export function fontsFor(doc: Pick<ScoreDoc, 'parts'> | null | undefined): FontKey[] {
  const need = new Set<FontKey>();
  for (const p of doc?.parts ?? []) need.add(FONT_OF[p.instrument] ?? 'fluid');
  return (['gugak', 'fluid'] as const).filter((k) => need.has(k));
}
