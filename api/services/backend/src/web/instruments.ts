// #36 악기 목록(GET /api/instruments) · 음원 파일 확인 — 국악기 먼저 · 다른 악기.
//
//   구조에서의 위치: 화면 → Nginx → web(이 파일) → DB 뷰 v_instrument_menu + api/shared/instruments.json(소리 번호는 DB 에 없다).
//     브라우저 연주기는 이 목록과 /soundfonts 의 음원으로 소리를 낸다. 음원은 Git LFS 라 받지 않으면 작은 포인터 파일만 있다.
//   v0.1.1 web/instruments.ts 와 같은 동작.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { env } from '../config/env.js';
import { shared } from '../config/shared.js';
import { logger } from '../lib/logger.js';
import { wrap } from './errors.js';

const SOUNDFONT_FILES = ['gugak.sf2', 'FluidR3_GM.sf2'];
const LFS_POINTER_MAX_BYTES = 1024;

/** 음원이 없어도 악보 · 내려받기는 되므로 시작은 막지 않고 원인을 로그에 남긴다 */
export function checkSoundfonts(): void {
  for (const name of SOUNDFONT_FILES) {
    let bytes = 0;
    try { bytes = statSync(join(env().SOUNDFONTS_DIR, name)).size; } catch { /* 없으면 0 */ }
    if (bytes <= LFS_POINTER_MAX_BYTES) logger.error({ file: name, bytes }, '음원 파일이 없거나 LFS 포인터뿐 — 브라우저 연주가 안 된다 (git lfs pull)');
    else logger.info({ file: name, bytes }, '음원 확인');
  }
}

export const instrumentsRouter = Router();

interface MenuRow { code: string; name: string; family: string; midi_program: number | null; is_percussion: number;
  soundfont_file: string | null; range_low: number | null; range_high: number | null }

instrumentsRouter.get('/instruments', wrap(async (_req, res) => {
  const rows = await query<MenuRow>(
    'SELECT code, name, family, midi_program, is_percussion, soundfont_file, range_low, range_high FROM v_instrument_menu ORDER BY menu_group, menu_order, name');
  const { instruments } = shared();
  // bank · program(서비스 음원 소리 번호)은 DB 에 없으므로 shared/instruments.json 에서 코드로 붙인다
  const sound = new Map(instruments.instruments.map((i) => [i.code, { bank: i.bank, program: i.program }]));
  const toItem = (r: MenuRow) => ({
    id: r.code, name: r.name, group: r.family, gm_program: r.midi_program ?? null,
    bank: sound.get(r.code)?.bank ?? null, program: sound.get(r.code)?.program ?? null, percussion: Boolean(r.is_percussion),
    range_low: r.range_low ?? null, range_high: r.range_high ?? null, soundfont: r.soundfont_file ?? null,
  });
  res.json({
    default_set: instruments.default_ensemble.map((d) => d.instrument),
    gugak: rows.filter((r) => r.family === 'gugak').map(toItem),
    others: rows.filter((r) => r.family === 'other').map(toItem),
  });
}));
