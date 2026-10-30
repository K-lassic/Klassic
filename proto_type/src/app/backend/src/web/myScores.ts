// 내가 만든 악보 (2026-09-30 황송해 160번 — design/UC_07 A9 · SD_01 3.8 · SD_02 S3)
// 로그인한 계정의 완료된 웹 요청 중 보관 기간(24시간) 안인 것만 최근 순으로. 소유는 계정 기준이라 다른 기기에서도 보인다.
// 다른 계정의 요청은 절대 내지 않는다(WHERE account_id = 나).
import { Router } from 'express';
import { exec, one, query } from '../db/pool.js';
import { ApiError, wrap } from './errors.js';
import { readStored } from '../services/storage.js';
import { purgeRequest } from '../services/jobs/purgeResults.js';
import { exampleList } from './examples.js';

export const myScoresRouter = Router();

const LIMIT = 50;

interface Row {
  request_no: string; received_at: Date; completed_at: Date | null; chosen_score_type: string | null; route: string;
  expires_at: Date; remaining_seconds: number; file_name: string | null; shared_title: string | null;
  musicxml_uri: string | null; midi_uri: string | null; ops_json: string | null; from_share_id: number | null; example_id: string | null;
}

/** 결과 MusicXML 의 곡 제목(work-title · movement-title) — 엔진이 붙인 "Untitled" 같은 이름은 쓰지 않는다 */
async function songTitle(uri: string | null): Promise<string | null> {
  if (!uri) return null;
  try {
    const head = (await readStored(uri)).subarray(0, 8192).toString('utf8');
    const m = head.match(/<work-title>([^<]+)<\/work-title>/) ?? head.match(/<movement-title>([^<]+)<\/movement-title>/);
    const t = m?.[1]?.trim();
    return t && !/^untitled/i.test(t) ? t : null;
  } catch { return null; }
}

myScoresRouter.get('/my-scores', wrap(async (req, res) => {
  if (!req.accountId) throw new ApiError('AUTH_LOGIN_REQUIRED');
  const rows = await query<Row>(
    `SELECT r.request_no, r.received_at, r.completed_at, r.chosen_score_type, r.route,
            v.expires_at, v.remaining_seconds,
            (SELECT u.original_name FROM upload_file u WHERE u.request_id = r.request_id ORDER BY u.file_no LIMIT 1) AS file_name,
            (SELECT s.title FROM shared_score s WHERE s.share_id = r.from_share_id) AS shared_title,
            cr.musicxml_uri, cr.midi_uri, e.ops_json, r.from_share_id, r.example_id
       FROM score_request r
       JOIN v_request_retention v ON v.request_id = r.request_id
       LEFT JOIN v_current_result cr ON cr.request_id = r.request_id AND cr.deleted_at IS NULL
       LEFT JOIN edited_score e ON e.request_id = r.request_id AND e.deleted_at IS NULL
      WHERE r.account_id = ? AND r.channel = 'web' AND r.status = 'completed' AND v.is_expired = 0
        AND r.from_share_id IS NULL  -- (2026-09-30 황송해 190번) 공유 악보에서 만든 요청은 목록에서 뺀다(24시간 뒤 정리)
      ORDER BY r.received_at DESC
      LIMIT ${LIMIT}`, [req.accountId]);
  const items = await Promise.all(rows.map(async (x) => {
    let ops: unknown[] | null = null;
    try { const v = x.ops_json ? JSON.parse(x.ops_json) : null; ops = Array.isArray(v) && v.length ? v : null; } catch { ops = null; }
    // (2026-09-30 황송해 192번) 예시로 올린 요청은 예시 이름 먼저(화면이 끝 괄호를 뗀다)
    const exampleTitle = x.example_id ? exampleList().find((z) => z.id === x.example_id)?.title ?? null : null;
    const title = x.shared_title ?? exampleTitle ?? (await songTitle(x.musicxml_uri)) ?? x.file_name ?? x.request_no;
    return {
      id: x.request_no,
      title,
      file_name: x.shared_title ? null : x.file_name,
      score_type: x.chosen_score_type,
      created_at: new Date(x.completed_at ?? x.received_at).toISOString(),
      expires_at: new Date(x.expires_at).toISOString(),
      remaining_seconds: Number(x.remaining_seconds),
      edited: !!ops,
      edit_ops: ops,
      midi_available: x.midi_uri != null,
      fallback: x.route === 'fallback',
      // (2026-09-30 황송해 180번) 공유 악보로 만든 요청 — 화면은 [제거]를 두지 않는다
      from_shared: x.from_share_id != null,
      from_example: exampleTitle != null,
    };
  }));
  res.json({ items });
}));

// 내가 만든 악보 지우기 (2026-09-30 황송해 176번 — UC_07 A10 · SD_01 3.9) — 보관 기간을 기다리지 않고 바로 지운다.
// 이 계정의 완료된 웹 요청만. 다른 계정 · 없음 · 미완료는 REQUEST_NOT_FOUND(있는지 드러내지 않음). 이미 지운 요청은 그대로 204.
// 지우는 방법은 24시간 정리(P0 0.1)와 같다(purgeRequest). 공유 복사본(storage/shared · shared_score)은 남긴다.
myScoresRouter.delete('/my-scores/:no', wrap(async (req, res) => {
  if (!req.accountId) throw new ApiError('AUTH_LOGIN_REQUIRED');
  const row = await one<{ request_id: number; request_no: string; status: string; purged_at: Date | null; from_share_id: number | null }>(
    `SELECT request_id, request_no, status, purged_at, from_share_id FROM score_request
      WHERE request_no = ? AND channel = 'web' AND account_id = ?`, [String(req.params.no ?? ''), req.accountId]);
  if (!row || row.status !== 'completed') throw new ApiError('REQUEST_NOT_FOUND');
  // (2026-09-30 황송해 180번) [제거]는 내 악보만 — 공유 악보로 만든 요청은 지울 수 없다(24시간 뒤 저절로 정리)
  if (row.from_share_id != null) throw new ApiError('MY_SCORE_FROM_SHARED');
  await purgeRequest(row.request_id, row.request_no);
  await exec('UPDATE score_request SET owner_deleted_at = COALESCE(owner_deleted_at, CURRENT_TIMESTAMP(3)) WHERE request_id = ?', [row.request_id]);
  res.status(204).end();
}));
