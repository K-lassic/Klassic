// 화면 연주 소리 번호 고르기 (결정 C11, 2026-09-29) — spessasynth 없이 시험할 수 있게 player.ts 밖에 둔다.
import type { BaseFont } from './player';

/**
 * gugak.sf2 를 실었으면 서비스 음원 번호(국악기 bank 1 · 장구·북 128/1 — score-core serviceSound),
 * 없으면(FluidR3_GM 만) GM 호환 번호(gm_program)로 MIDI 를 만든다.
 */
export function midiSoundNumbers(base: BaseFont): 'service' | 'gm' {
  return base === 'gugak' ? 'service' : 'gm';
}
