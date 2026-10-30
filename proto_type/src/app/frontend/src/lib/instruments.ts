// 악기 목록 — 원본은 app/shared/instruments.json(두 언어가 같은 파일을 읽음).
// GET /api/instruments 가 안 되면 이 파일로 대신 채운다(연주는 막지 않음, U2).
import shared from '../../../shared/instruments.json';
import type { Instrument, InstrumentCatalog } from '@/types/api';
import { gmDisplayName } from './gmNames';

interface SharedInstrument {
  code: string; name_ko: string; family: string; gm_program: number; bank: number; program: number; is_percussion: boolean;
  soundfont: string; range_low: number | null; range_high: number | null;
}

export function fromShared(i: SharedInstrument): Instrument {
  return {
    id: i.code, name: i.name_ko, group: i.family === 'gugak' ? 'gugak' : 'other',
    gm_program: i.gm_program, bank: i.bank, program: i.program, percussion: i.is_percussion,
    range_low: i.range_low, range_high: i.range_high, soundfont: i.soundfont,
  };
}

export function sharedCatalog(): InstrumentCatalog {
  const all = (shared.instruments as SharedInstrument[]).map(fromShared);
  return {
    default_set: shared.default_ensemble.map((d) => d.instrument),
    gugak: all.filter((i) => i.group === 'gugak'),
    others: all.filter((i) => i.group === 'other'),
  };
}

export const DEFAULT_MELODY = shared.default_ensemble.find((d) => d.part_role === 'melody')?.instrument ?? 'gayageum';
export const DEFAULT_PERCUSSION = shared.default_ensemble.find((d) => d.part_role === 'percussion')?.instrument ?? 'janggu';

export function findInstrument(cat: InstrumentCatalog, code: string | null | undefined): Instrument | undefined {
  if (!code) return undefined;
  return [...cat.gugak, ...cat.others].find((i) => i.id === code);
}

/** 원래 악기 코드 'original:N'(N = GM 번호) → N, 아니면 null (score-core ORIGINAL_PREFIX 와 같은 모양) */
export function originalProgram(code: string | null | undefined): number | null {
  const m = code ? /^original:(\d{1,3})$/.exec(code) : null;
  return m ? Number(m[1]) : null;
}

/** 악기 이름. 원래 악기('original:N')는 코드 그대로 보이지 않게 GM 이름으로(2026-09-30 황송해, SD_02 ㉞):
 *  서비스 서양악기 목록에 같은 GM 번호가 있으면 그 이름(예 0 → 피아노), 없으면 "한국어(English)"(예 53 → 목소리(Voice Oohs)) */
export function instrumentName(cat: InstrumentCatalog, code: string | null | undefined): string {
  const found = findInstrument(cat, code);
  if (found) return found.name;
  const gm = originalProgram(code);
  if (gm !== null) return cat.others.find((i) => i.gm_program === gm && !i.percussion)?.name ?? gmDisplayName(gm) ?? '원래 악기';
  return code ?? '알 수 없는 악기';
}

export function isPercussionCode(cat: InstrumentCatalog, code: string): boolean {
  return findInstrument(cat, code)?.percussion ?? false;
}
