// 공유 악보 · 좋아요 (2026-09-30 황송해 결정 — design/UC_18 UC18 · SD_01 §9C P9 · SD_03 §11B)
// 결과 악보(MusicXML)만 storage/shared/<공유 번호>/ 로 복사해 모두에게 보인다. 원본 사진 · 요청 번호 · 올린 사람은 내지 않는다(BR-SHR-02·03).
// 복사본은 24시간 결과 정리와 상관없이 공유한 때부터 3일(expires_at) 남고, 3일 뒤 P0 가 지운다(2026-09-30 결정). 거두면 바로 지운다.
import { Router, type Request } from 'express';
import { exec, one, query } from '../db/pool.js';
import { ApiError, wrap } from './errors.js';
import { loadOwnedRequest } from './ownership.js';
import { readStored, removeStored, saveFile } from '../services/storage.js';
import { newShareNo, newRequestNo } from '../lib/ids.js';
import { currentSettings } from '../config/settings.js';
import { completeDirect } from '../services/directRoute.js';
import { recordInitialSelection } from '../services/placedEnsemble.js';
import { buildRequestStatus } from '../services/requestStatus.js';
import { logger } from '../lib/logger.js';

export const sharedRouter = Router();

const TITLE_MAX = 60;
const PAGE_MAX = 50;

interface ShareRow {
  share_id: number; share_no: string; title: string; score_type: 'staff' | 'jeongganbo';
  musicxml_uri: string | null; shared_at: Date; expires_at: Date; purged_at: Date | null; unshared_at: Date | null; taken_down_at: Date | null;
}

function titleOf(req: Request): string {
  const t = typeof req.body?.title === 'string' ? req.body.title.trim().replace(/\s+/g, ' ') : '';
  if (!t || [...t].length > TITLE_MAX) throw new ApiError('BAD_REQUEST', { field: 'title', reason: t ? 'too_long' : 'required', max: TITLE_MAX });
  return t;
}

/** 이 요청의 공유 상태(올린 사람에게만) */
function shareView(s: ShareRow | undefined | null) {
  if (!s || s.unshared_at || !s.musicxml_uri || s.purged_at) return { shared: false as const };
  return { shared: true as const, share_no: s.share_no, title: s.title, shared_at: s.shared_at, expires_at: s.expires_at, taken_down: !!s.taken_down_at };
}

sharedRouter.get('/requests/:no/share', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req, { allowExpired: true });
  const s = await one<ShareRow>('SELECT * FROM shared_score WHERE source_request_id = ?', [r.request_id]);
  res.json(shareView(s));
}));

/** 모두에게 공유(UC18 기본흐름 1 · A1) — 이미 공유했으면 제목만 바꾼다 */
sharedRouter.put('/requests/:no/share', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);            // 보관 기간이 지났으면 RESULT_EXPIRED(G4)
  const title = titleOf(req);
  if (r.status !== 'completed') throw new ApiError('REQUEST_NOT_FOUND', { reason: 'not_completed', status: r.status }, null, 409);
  const cur = await one<{ musicxml_uri: string }>('SELECT musicxml_uri FROM v_current_result WHERE request_id = ? AND deleted_at IS NULL', [r.request_id]);
  if (!cur) throw new ApiError('RESULT_EXPIRED');
  const existing = await one<ShareRow>('SELECT * FROM shared_score WHERE source_request_id = ?', [r.request_id]);
  const shareNo = existing?.share_no ?? newShareNo();
  let uri = existing?.musicxml_uri ?? null;
  if (!uri) uri = await saveFile(`shared/${shareNo}/score.musicxml`, await readStored(cur.musicxml_uri));
  if (existing && (existing.unshared_at || existing.purged_at)) {
    // 거둔 뒤 다시 공유 — 3일을 새로 센다
    await exec(`UPDATE shared_score SET title = ?, musicxml_uri = ?, unshared_at = NULL, purged_at = NULL,
       shared_at = CURRENT_TIMESTAMP(3), expires_at = CURRENT_TIMESTAMP(3) + INTERVAL 3 DAY WHERE share_id = ?`, [title, uri, existing.share_id]);
  } else if (existing) {
    await exec('UPDATE shared_score SET title = ?, musicxml_uri = ? WHERE share_id = ?', [title, uri, existing.share_id]);
  } else {
    await exec(
      `INSERT INTO shared_score (share_no, source_request_id, owner_account_id, title, score_type, musicxml_uri)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [shareNo, r.request_id, req.accountId ?? null, title, r.chosen_score_type ?? 'staff', uri]);
  }
  res.json(shareView(await one<ShareRow>('SELECT * FROM shared_score WHERE share_no = ?', [shareNo])));
}));

/** 공유 거두기(UC18 A4) — 복사본을 지우고 목록에서 뺀다 */
sharedRouter.delete('/requests/:no/share', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const s = await one<ShareRow>('SELECT * FROM shared_score WHERE source_request_id = ?', [r.request_id]);
  if (s && !s.unshared_at) {
    if (s.musicxml_uri) await removeStored(`shared/${s.share_no}`);
    await exec('UPDATE shared_score SET unshared_at = CURRENT_TIMESTAMP(3), musicxml_uri = NULL WHERE share_id = ?', [s.share_id]);
  }
  res.json({ shared: false });
}));

/** 목록(UC18 기본흐름 2 · BR-SHR-03·05) — 올린 사람 정보 없음 */
sharedRouter.get('/shared-scores', wrap(async (req, res) => {
  const sort = req.query.sort === 'recent' ? 'recent' : 'likes';
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const order = sort === 'recent' ? 'v.shared_at DESC, v.share_id DESC' : 'v.like_count DESC, v.shared_at DESC, v.share_id DESC';
  const rows = await query<{ share_no: string; title: string; score_type: string; shared_at: Date; expires_at: Date; is_example: number; like_count: number; liked: number }>(
    `SELECT v.share_no, v.title, v.score_type, v.shared_at, v.expires_at, v.is_example, v.like_count,
            EXISTS(SELECT 1 FROM score_like l WHERE l.share_id = v.share_id AND l.account_id = ?) AS liked
       FROM v_shared_score_list v ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`,
    [req.accountId ?? -1]);
  res.json({
    sort,
    // 예시 공유 악보(2026-09-30 조성기, BR-SHR-08)는 3일 정리에서 빠지므로 남은 날 대신 example 로 알린다
    items: rows.slice(0, limit).map((x) => ({ share_no: x.share_no, title: x.title, score_type: x.score_type, shared_at: x.shared_at,
      expires_at: Number(x.is_example) ? null : x.expires_at, example: !!Number(x.is_example), likes: Number(x.like_count), liked_by_me: !!Number(x.liked) })),
    has_more: rows.length > limit,
  });
}));

async function visibleShare(no: string) {
  const s = await one<ShareRow>('SELECT * FROM shared_score WHERE share_no = ?', [no]);
  if (!s || s.unshared_at || s.taken_down_at || !s.musicxml_uri || s.purged_at || new Date(s.expires_at).getTime() <= Date.now()) {
    throw new ApiError('REQUEST_NOT_FOUND');  // UC18 E4 · 3일 지남(BR-SHR-02)
  }
  return s;
}

/** 듣기(UC18 기본흐름 3) — 복사본 MusicXML. 화면이 기본 국악기로 연주한다 */
sharedRouter.get('/shared-scores/:shareNo/score', wrap(async (req, res) => {
  const s = await visibleShare(String(req.params.shareNo));
  const musicxml = (await readStored(s.musicxml_uri!)).toString('utf8');
  res.json({ share_no: s.share_no, title: s.title, score_type: s.score_type, musicxml });
}));

/**
 * 이 악보로 작업하기(2026-09-30 황송해 109번 — UC18 기본흐름 5 · A5 · BR-SHR-07 · SD_01 9.8)
 * 공유 복사본 MusicXML 로 내 새 요청을 만든다. 인식(모델 API)은 다시 하지 않고 직행(route='direct')으로 바로 완료한다.
 * 새 요청은 이 세션 · 계정 소유(24시간 보관). 공유자 · 원래 요청은 응답에 내지 않는다. 같은 파일 자동 감지(해시)는 하지 않는다.
 * 모델 API 를 쓰지 않으므로 웹 한도(G12)는 걸지 않는다.
 */
sharedRouter.post('/shared-scores/:shareNo/use', wrap(async (req, res) => {
  if (!req.accountId) throw new ApiError('AUTH_LOGIN_REQUIRED');
  const s = await visibleShare(String(req.params.shareNo));
  const data = await readStored(s.musicxml_uri!);
  const text = data.toString('utf8');
  const settings = await currentSettings();
  const requestNo = newRequestNo();
  const uri = await saveFile(`${requestNo}/original.musicxml`, data);
  const ins = await exec(
    `INSERT INTO score_request (request_no, channel, session_id, account_id, file_kind, chosen_score_type, route, from_share_id, status,
                                setting_version_id, client_addr_hash)
     VALUES (?, 'web', ?, ?, 'musicxml', NULL, 'direct', ?, 'received', ?, ?)`,
    [requestNo, req.sessionId, req.accountId, s.share_id, settings.setting_version_id, req.clientAddrHash ?? null]);
  const requestId = Number((ins as { insertId: number }).insertId);
  await exec(
    `INSERT INTO upload_file (request_id, file_no, original_name, size_bytes, image_short_side_px, pdf_page_count, storage_uri)
     VALUES (?, 1, 'shared.musicxml', ?, NULL, NULL, ?)`, [requestId, data.length, uri]);
  try {
    await completeDirect(requestId, requestNo, 'musicxml', data, text);
  } catch (e) {
    logger.warn({ err: e, requestNo }, 'shared use parse failed');
    await exec('DELETE FROM upload_file WHERE request_id = ?', [requestId]);
    await exec('DELETE FROM score_request WHERE request_id = ?', [requestId]);
    throw new ApiError('UPLOAD_CORRUPTED');
  }
  await recordInitialSelection(requestId).catch((e) => logger.warn({ err: e, requestNo }, 'initial selection record failed'));
  res.status(202).json(await buildRequestStatus(requestId));
}));

/** 좋아요 · 취소(UC18 기본흐름 4 · A3 · BR-SHR-04) */
sharedRouter.post('/shared-scores/:shareNo/like', wrap(async (req, res) => {
  if (!req.accountId) throw new ApiError('AUTH_LOGIN_REQUIRED');
  const s = await visibleShare(String(req.params.shareNo));
  const had = await one<{ n: number }>('SELECT 1 AS n FROM score_like WHERE share_id = ? AND account_id = ?', [s.share_id, req.accountId]);
  if (had) await exec('DELETE FROM score_like WHERE share_id = ? AND account_id = ?', [s.share_id, req.accountId]);
  else await exec('INSERT IGNORE INTO score_like (share_id, account_id) VALUES (?, ?)', [s.share_id, req.accountId]);
  const c = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_like WHERE share_id = ?', [s.share_id]);
  res.json({ share_no: s.share_no, liked: !had, likes: Number(c?.n ?? 0) });
}));
