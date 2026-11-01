// #36 편집 기록 — 편집 자체는 브라우저 IndexedDB 에 있고, [작업 저장하기] · [편집 마치기] 때 연산 목록을 받아 edited_score + edited_track 에 남긴다.
//
//   구조에서의 위치: 화면 → Nginx → web(이 파일) → 볼륨의 결과 MusicXML 읽기 + score-core 로 연산 적용 → DB. 원본 결과는 덮어쓰지 않는다.
//     다른 기기의 "내가 만든 악보"가 편집 반영 파일을 만들 수 있게 연산 목록(ops_json)도 남긴다.
//   v0.1.1 web/edits.ts 에서 달라진 점: 연산을 적용할 수 없으면 500 이 아니라 400 · 결과 파일이 없으면 RESULT_EXPIRED.
import { Router } from 'express';
import { applyOps, parseMusicXml, type ScoreDoc } from '@gugak/score-core';
import { exec, one, query, tx } from '../db/pool.js';
import { ApiError, wrap } from './errors.js';
import { loadOwnedRequest } from './ownership.js';
import { readResult } from './requests.js';

export const editsRouter = Router();

export async function loadBaseDoc(requestId: number, requestNo: string): Promise<{ doc: ScoreDoc; resultId: number } | null> {
  const cur = await one<{ result_id: number; musicxml_uri: string }>(
    'SELECT result_id, musicxml_uri FROM v_current_result WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
  if (!cur) return null;
  return { doc: parseMusicXml((await readResult(cur.musicxml_uri, requestNo)).toString('utf8')), resultId: cur.result_id };
}

/** 연산 적용 — 모양이 잘못된 연산은 사용자 요청 오류로 돌려준다 */
export function applyEditOps(doc: ScoreDoc, ops: unknown[], field: string): ScoreDoc {
  try {
    return applyOps(doc, ops as never);
  } catch {
    throw new ApiError('BAD_REQUEST', { field });
  }
}

/** 편집본 행을 만들거나 갱신하고 edit_id 를 돌려준다 */
export async function upsertEdit(requestId: number, requestNo: string, ops: unknown[], finished: boolean): Promise<number | null> {
  if (ops.length === 0) return null;
  const base = await loadBaseDoc(requestId, requestNo);
  if (!base) throw new ApiError('RESULT_EXPIRED');
  const edited = applyEditOps(base.doc, ops, 'ops');
  const transpose = (ops as { op: string; semitones?: number }[])
    .filter((o) => o.op === 'transpose').reduce((n, o) => n + Number(o.semitones ?? 0), 0);
  const codes = await query<{ instrument_id: number; code: string }>('SELECT instrument_id, code FROM instrument');
  const idOf = new Map(codes.map((c) => [c.code, c.instrument_id]));
  const fallbackId = idOf.get('gayageum')!;
  return tx(async (conn) => {
    await conn.query(
      `INSERT INTO edited_score (request_id, base_result_id, transpose_semitones, ops_json, finished_at)
       VALUES (?, ?, ?, ?, ${finished ? 'CURRENT_TIMESTAMP(3)' : 'NULL'})
       ON DUPLICATE KEY UPDATE base_result_id = VALUES(base_result_id), transpose_semitones = VALUES(transpose_semitones),
                               ops_json = VALUES(ops_json),
                               last_changed_at = CURRENT_TIMESTAMP(3)${finished ? ', finished_at = CURRENT_TIMESTAMP(3)' : ''}`,
      [requestId, base.resultId, transpose, JSON.stringify(ops)]);
    const [rows] = await conn.query('SELECT edit_id FROM edited_score WHERE request_id = ?', [requestId]);
    const editId = (rows as { edit_id: number }[])[0].edit_id;
    await conn.query('DELETE FROM edited_track WHERE edit_id = ?', [editId]);
    for (const [i, p] of edited.parts.entries()) {
      // soundfont_id 는 사용자 음원(.sf2) 기능 삭제로 늘 NULL
      await conn.query(
        'INSERT INTO edited_track (edit_id, track_no, part_origin, instrument_id, soundfont_id, volume_level) VALUES (?, ?, ?, ?, ?, ?)',
        [editId, i + 1, p.origin === 'melody_copy' ? 'melody_copy' : 'original', idOf.get(p.instrument) ?? fallbackId,
         null, Math.max(0, Math.round(p.volume))]);
    }
    return editId;
  });
}

editsRouter.put('/requests/:no/edits', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const ops = req.body?.ops ?? [];
  const summary = req.body?.summary ?? {};
  if (!Array.isArray(ops)) throw new ApiError('BAD_REQUEST', { field: 'ops' });
  // [작업 저장하기]는 finished:false — 편집 마침으로 치지 않고 연산만 남긴다
  if (req.body?.finished === false) {
    if (ops.length === 0) await exec('UPDATE edited_score SET ops_json = NULL WHERE request_id = ? AND deleted_at IS NULL', [r.request_id]);
    else await upsertEdit(r.request_id, r.request_no, ops, false);
    res.status(204).end();
    return;
  }
  if (ops.length === 0 || summary.edited === false) {
    // 원본으로 되돌린 뒤 마쳤다 — 되돌린 시각만 남긴다
    await exec('UPDATE edited_score SET reverted_at = CURRENT_TIMESTAMP(3), finished_at = CURRENT_TIMESTAMP(3), ops_json = NULL WHERE request_id = ?', [r.request_id]);
  } else {
    await upsertEdit(r.request_id, r.request_no, ops, true);
  }
  res.status(204).end();
}));
