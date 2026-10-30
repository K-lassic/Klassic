// 악기 목록 (tasks T065, BR-PLY-03): 국악기 먼저 · 다른 악기. (사용자 음원 .sf2 목록은 2026-09-29 기능 삭제로 뺐다)
import { Router } from 'express';
import { query } from '../db/pool.js';
import { instruments } from '../config/shared.js';
import { wrap } from './errors.js';

export const instrumentsRouter = Router();

instrumentsRouter.get('/instruments', wrap(async (_req, res) => {
  const rows = await query<Record<string, any>>(
    'SELECT code, name, family, midi_program, is_percussion, soundfont_file, range_low, range_high FROM v_instrument_menu ORDER BY menu_group, menu_order, name');
  // bank·program(서비스 음원 소리 번호, 결정 C11)은 DB 에 없으므로 shared/instruments.json 에서 코드로 붙인다
  const sound = new Map(instruments.instruments.map((i) => [i.code, { bank: i.bank, program: i.program }]));
  const toItem = (r: Record<string, any>) => ({
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
