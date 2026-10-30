// 연주 악기 선택 기록은 "실제로 놓인 악기"만 (2026-09-29 황송해 결정).
// 기본 구성은 가야금 · 장구지만, 악보에 타악 성부가 없으면 장구는 연주되지 않는다 — 그때 instrument_selection 이
// 가야금 · 장구 구성을 가리키면 연주하지 않은 장구가 기록에 남는다. 그래서 화면(frontend src/lib/ensemble.ts
// applyDefaultEnsemble · applyCombination)과 같은 규칙으로 놓이는 악기를 셈하고, 고른 구성과 다르면
// 놓인 악기만 담은 'custom' 구성을 찾아 다시 쓰거나 새로 만든다(모델 API jobs/performance.placed_ensemble_id 와 같은 규칙).
import { parseMidi, parseMusicXml } from '@gugak/score-core';
import { exec, one, query } from '../db/pool.js';
import { instruments as catalog } from '../config/shared.js';
import { readStored } from './storage.js';
import { logger } from '../lib/logger.js';

export interface PartShape { isPercussion: boolean }

const byCode = new Map(catalog.instruments.map((i) => [i.code, i]));
const isPerc = (code: string) => byCode.get(code)?.is_percussion === true;
export const DEFAULT_MELODY = catalog.default_ensemble.find((d) => d.part_role === 'melody')?.instrument ?? 'gayageum';
export const DEFAULT_PERCUSSION = catalog.default_ensemble.find((d) => d.part_role === 'percussion')?.instrument ?? 'janggu';

/**
 * 화면 연주가 실제로 놓는 악기 코드(중복 없이, 선율 먼저).
 * - 선율 성부: 선율 악기를 차례로(남는 선율 악기는 복사 트랙으로 모두 놓임). 선율 악기가 없으면(타악만의 조합) 기본 선율 악기.
 * - 타악 성부: 첫 타악기(없으면 기본 타악기). 타악 성부가 없으면 타악기는 놓이지 않는다.
 * isDefault: 기본 구성(applyDefaultEnsemble)은 선율 성부가 없는 악보에 복사 트랙을 만들지 않는다.
 */
export function placedCodes(parts: PartShape[], codes: string[], opts: { isDefault?: boolean } = {}): string[] {
  const known = codes.filter((c) => byCode.has(c));
  const melodic = known.filter((c) => !isPerc(c));
  const perc = known.filter((c) => isPerc(c));
  const melodyParts = parts.filter((p) => !p.isPercussion).length;
  const percParts = parts.length - melodyParts;
  const out: string[] = [];
  const add = (c: string) => { if (!out.includes(c)) out.push(c); };
  if (opts.isDefault) {
    if (melodyParts > 0) add(DEFAULT_MELODY);
  } else if (melodic.length > 0) {
    if (parts.length > 0) melodic.forEach(add);
  } else if (melodyParts > 0) {
    add(DEFAULT_MELODY);
  }
  if (percParts > 0) add(opts.isDefault ? DEFAULT_PERCUSSION : perc[0] ?? DEFAULT_PERCUSSION);
  return out;
}

/** 지금 결과 악보의 성부 모양(타악 여부). 결과가 없거나 풀지 못하면 null */
export async function currentParts(requestId: number): Promise<PartShape[] | null> {
  const cur = await one<{ musicxml_uri: string; midi_uri: string | null }>(
    'SELECT musicxml_uri, midi_uri FROM v_current_result WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
  if (!cur) return null;
  try {
    // GET /api/requests/:no/score 와 같은 순서(MusicXML 먼저, 안 되면 MIDI) — 화면이 받는 ScoreDoc 과 같게
    try {
      return parseMusicXml((await readStored(cur.musicxml_uri)).toString('utf8')).parts;
    } catch (e) {
      if (!cur.midi_uri) throw e; // MIDI 가 없는 결과(변환 실패, 2026-09-30)는 MusicXML 만
      return parseMidi(new Uint8Array(await readStored(cur.midi_uri))).parts;
    }
  } catch (e) {
    logger.warn({ err: e, requestId }, 'placed ensemble: score parse failed');
    return null;
  }
}

/** 구성의 서비스 악기 코드. 원래 악기 파트가 있으면 null(그대로 둔다) */
export async function ensembleCodes(ensembleId: number): Promise<string[] | null> {
  const rows = await query<{ code: string | null }>(
    `SELECT i.code FROM ensemble_member m LEFT JOIN instrument i ON i.instrument_id = m.instrument_id
      WHERE m.ensemble_id = ? ORDER BY m.part_no`, [ensembleId]);
  if (rows.some((r) => r.code == null)) return null;
  return rows.map((r) => r.code as string);
}

/** 놓인 악기와 같은 구성이면 그 id, 아니면 놓인 악기만 담은 'custom' 구성(같은 것이 있으면 다시 씀) */
export async function ensembleForPlaced(chosenId: number | null, placed: string[]): Promise<number | null> {
  if (placed.length === 0) return chosenId;
  if (chosenId != null) {
    const codes = await ensembleCodes(chosenId);
    if (codes == null) return chosenId;
    const a = new Set(codes);
    if (a.size === placed.length && placed.every((c) => a.has(c))) return chosenId;
  }
  const ordered = [...placed].sort((x, y) => Number(isPerc(x)) - Number(isPerc(y)));
  const members = ordered.map((c) => ({ role: isPerc(c) ? 'percussion' : 'melody', code: c }));
  const signature = members.map((m) => `${m.role}:${m.code}`).join(',');
  const found = await one<{ ensemble_id: number }>(
    `SELECT e.ensemble_id FROM ensemble e
       JOIN ensemble_member m ON m.ensemble_id = e.ensemble_id
       JOIN instrument i ON i.instrument_id = m.instrument_id
      WHERE e.ensemble_kind = 'custom'
      GROUP BY e.ensemble_id
     HAVING COUNT(*) = ? AND COUNT(*) = (SELECT COUNT(*) FROM ensemble_member x WHERE x.ensemble_id = e.ensemble_id)
        AND GROUP_CONCAT(CONCAT(m.part_role, ':', i.code) ORDER BY m.part_no SEPARATOR ',') = ?
      ORDER BY e.ensemble_id LIMIT 1`, [members.length, signature]);
  if (found) return found.ensemble_id;
  const ids = new Map((await query<{ instrument_id: number; code: string }>(
    'SELECT instrument_id, code FROM instrument WHERE code IN (?)', [ordered])).map((r) => [r.code, r.instrument_id]));
  if (members.some((m) => !ids.has(m.code))) return chosenId;
  const ins = await exec("INSERT INTO ensemble (ensemble_kind) VALUES ('custom')");
  for (const [i, m] of members.entries()) {
    await exec('INSERT INTO ensemble_member (ensemble_id, part_no, part_role, instrument_id) VALUES (?, ?, ?, ?)',
      [ins.insertId, i + 1, m.role, ids.get(m.code)]);
  }
  return ins.insertId;
}

export async function defaultEnsembleId(): Promise<number | null> {
  return (await one<{ ensemble_id: number }>("SELECT ensemble_id FROM ensemble WHERE ensemble_kind = 'default'"))?.ensemble_id ?? null;
}

/** 기본 구성 · 추천 조합을 지금 결과 악보에 놓았을 때 기록할 구성 id. 악보를 모르면 고른 구성 그대로 */
export async function placedSelection(requestId: number, chosenId: number | null, opts: { isDefault?: boolean } = {}): Promise<number | null> {
  if (chosenId == null) return null;
  const parts = await currentParts(requestId);
  const codes = await ensembleCodes(chosenId);
  if (!parts || !codes) return chosenId;
  return ensembleForPlaced(chosenId, placedCodes(parts, codes, opts));
}

/**
 * 처음 연주 구성(initial_default) 기록 — 결과를 보여 줄 때(SD_03 1.15). 이미 사용자가 고른 기록이 있으면 두고,
 * 마지막 기록이 initial_default 인데 악보가 바뀌어(대체 템플릿 받기 등) 놓이는 악기가 달라졌으면 새로 적는다.
 */
export async function recordInitialSelection(requestId: number): Promise<void> {
  const def = await defaultEnsembleId();
  if (def == null) return;
  const parts = await currentParts(requestId);
  if (!parts) return;
  const ensembleId = await ensembleForPlaced(def, placedCodes(parts, [DEFAULT_MELODY, DEFAULT_PERCUSSION], { isDefault: true }));
  const last = await one<{ ensemble_id: number; source: string }>(
    'SELECT ensemble_id, source FROM instrument_selection WHERE request_id = ? ORDER BY selection_id DESC LIMIT 1', [requestId]);
  if (last && (last.source !== 'initial_default' || last.ensemble_id === ensembleId)) return;
  await exec("INSERT INTO instrument_selection (request_id, ensemble_id, source) VALUES (?, ?, 'initial_default')", [requestId, ensembleId]);
}
