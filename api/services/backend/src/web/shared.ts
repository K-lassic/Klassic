// #90 공유 악보 · 좋아요 — 공유 · 게시판 · 듣기 · 좋아요 · 거두기 · 이 악보로 작업하기 (UC18, web-api.yaml)
//
//   구조에서의 위치: 화면 → Nginx(/api/*) → web(이 파일) → DB shared_score · score_like · 볼륨 storage/shared/<공유 번호>/.
//     결과 MusicXML 만 복사하므로 원본 사진 · 요청 번호 · 올린 사람은 응답에 나가지 않는다.
//     복사본은 요청 폴더 밖이라 24시간 정리에 지워지지 않고, 공유 후 3일(expires_at)이 지나면 주기 정리가 지운다 (#85).
//   v0.1.1 web/shared.ts 에서 달라진 점: 복사 뒤 DB 에 쓰지 못하면 복사본을 지워 고아 파일을 남기지 않고,
//     [이 악보로 작업하기] 는 악보를 먼저 읽어 보고 파일을 쓴다. 관리자 내리기 · 영구 보존은 관리자 API(#100)에서 한다.
import { Router, type Request } from 'express';
import { parseMusicXml, type ScoreDoc } from '@gugak/score-core';
import { exec, one, query, tx } from '../db/pool.js';
import { currentSettings } from '../config/settings.js';
import { newRequestNo, newShareNo } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { completeDirect } from '../services/directRoute.js';
import { recordInitialSelection } from '../services/placedEnsemble.js';
import { buildRequestStatus } from '../services/requestStatus.js';
import { readStored, removeRequestDir, removeStored, saveFile } from '../services/storage.js';
import { ApiError, wrap } from './errors.js';
import { loadOwnedRequest } from './ownership.js';

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

function shareView(s: ShareRow | null) {
  if (!s || s.unshared_at || !s.musicxml_uri || s.purged_at) return { shared: false as const };
  return { shared: true as const, share_no: s.share_no, title: s.title, shared_at: new Date(s.shared_at).toISOString(),
    expires_at: new Date(s.expires_at).toISOString(), taken_down: !!s.taken_down_at };
}

const shareOfRequest = (requestId: number) => one<ShareRow>('SELECT * FROM shared_score WHERE source_request_id = ?', [requestId]);

sharedRouter.get('/requests/:no/share', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  res.json(shareView(await shareOfRequest(r.request_id)));
}));

/** 공유 · 이미 공유 중이면 제목만 바꾼다. 거둔 뒤 다시 공유하면 3일을 새로 센다 */
sharedRouter.put('/requests/:no/share', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req); // 보관 기간이 지났으면 RESULT_EXPIRED
  const title = titleOf(req);
  if (r.status !== 'completed') throw new ApiError('REQUEST_NOT_FOUND', { reason: 'not_completed', status: r.status }, null, 409);
  const cur = await one<{ musicxml_uri: string }>('SELECT musicxml_uri FROM v_current_result WHERE request_id = ? AND deleted_at IS NULL', [r.request_id]);
  if (!cur) throw new ApiError('RESULT_EXPIRED');
  const existing = await shareOfRequest(r.request_id);
  const shareNo = existing?.share_no ?? newShareNo();
  const copied = !existing?.musicxml_uri;
  const uri = existing?.musicxml_uri ?? await saveFile(`shared/${shareNo}/score.musicxml`, await readStored(cur.musicxml_uri));
  try {
    if (existing && (existing.unshared_at || existing.purged_at)) {
      await exec(`UPDATE shared_score SET title = ?, musicxml_uri = ?, unshared_at = NULL, purged_at = NULL,
                  shared_at = CURRENT_TIMESTAMP(3), expires_at = CURRENT_TIMESTAMP(3) + INTERVAL 3 DAY WHERE share_id = ?`, [title, uri, existing.share_id]);
    } else if (existing) {
      await exec('UPDATE shared_score SET title = ?, musicxml_uri = ? WHERE share_id = ?', [title, uri, existing.share_id]);
    } else {
      await exec('INSERT INTO shared_score (share_no, source_request_id, owner_account_id, title, score_type, musicxml_uri) VALUES (?, ?, ?, ?, ?, ?)',
        [shareNo, r.request_id, req.accountId ?? null, title, r.chosen_score_type ?? 'staff', uri]);
    }
  } catch (e) {
    if (copied) await removeStored(`shared/${shareNo}`).catch((rm) => logger.error({ err: rm, shareNo }, '공유 실패한 복사본을 지우지 못함'));
    throw e;
  }
  res.json(shareView(await one<ShareRow>('SELECT * FROM shared_score WHERE share_no = ?', [shareNo])));
}));

/** 공유 거두기 — 복사본을 지우고 목록에서 뺀다 */
sharedRouter.delete('/requests/:no/share', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const s = await shareOfRequest(r.request_id);
  if (s && !s.unshared_at) {
    if (s.musicxml_uri) await removeStored(`shared/${s.share_no}`);
    await exec('UPDATE shared_score SET unshared_at = CURRENT_TIMESTAMP(3), musicxml_uri = NULL WHERE share_id = ?', [s.share_id]);
  }
  res.json({ shared: false });
}));

/** 게시판 — 올린 사람 정보 없음. 예시 악보는 3일 정리에서 빠지므로 남은 날 대신 example 로 알린다 */
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
    items: rows.slice(0, limit).map((x) => ({
      share_no: x.share_no, title: x.title, score_type: x.score_type, shared_at: new Date(x.shared_at).toISOString(),
      expires_at: Number(x.is_example) ? null : new Date(x.expires_at).toISOString(), example: !!Number(x.is_example),
      likes: Number(x.like_count), liked_by_me: !!Number(x.liked),
    })),
    has_more: rows.length > limit,
  });
}));

/** 내림 · 거둠 · 3일 지남은 없는 것과 같다 */
async function visibleShare(no: string): Promise<ShareRow> {
  const s = await one<ShareRow>('SELECT * FROM shared_score WHERE share_no = ?', [no]);
  if (!s || s.unshared_at || s.taken_down_at || !s.musicxml_uri || s.purged_at || new Date(s.expires_at).getTime() <= Date.now()) {
    throw new ApiError('REQUEST_NOT_FOUND');
  }
  return s;
}

sharedRouter.get('/shared-scores/:shareNo/score', wrap(async (req, res) => {
  const s = await visibleShare(String(req.params.shareNo));
  res.json({ share_no: s.share_no, title: s.title, score_type: s.score_type, musicxml: (await readStored(s.musicxml_uri!)).toString('utf8') });
}));

/**
 * 이 악보로 작업하기 — 공유 복사본으로 내 새 요청을 만든다. 인식을 다시 하지 않고 바로 완료한다(route='direct').
 * 새 요청은 이 계정 소유로 24시간 보관되고, 공유자 · 원래 요청은 응답에 내지 않는다. model-api 를 쓰지 않아 웹 한도는 걸지 않는다.
 */
sharedRouter.post('/shared-scores/:shareNo/use', wrap(async (req, res) => {
  if (!req.accountId) throw new ApiError('AUTH_LOGIN_REQUIRED');
  const s = await visibleShare(String(req.params.shareNo));
  const data = await readStored(s.musicxml_uri!);
  const text = data.toString('utf8');
  let doc: ScoreDoc;
  try {
    doc = parseMusicXml(text);
  } catch (e) {
    logger.warn({ err: e, share_no: s.share_no }, '공유 악보를 읽지 못함');
    throw new ApiError('UPLOAD_CORRUPTED');
  }
  const settings = await currentSettings();
  const requestNo = newRequestNo();
  let requestId: number;
  try {
    const uri = await saveFile(`${requestNo}/original.musicxml`, data);
    requestId = await tx(async (conn) => {
      const [ins] = await conn.query(
        `INSERT INTO score_request (request_no, channel, session_id, account_id, file_kind, chosen_score_type, route, from_share_id, status,
                                    setting_version_id, client_addr_hash)
         VALUES (?, 'web', ?, ?, 'musicxml', NULL, 'direct', ?, 'received', ?, ?)`,
        [requestNo, req.sessionId, req.accountId, s.share_id, settings.setting_version_id, req.clientAddrHash ?? null]);
      const id = (ins as { insertId: number }).insertId;
      await conn.query("INSERT INTO upload_file (request_id, file_no, original_name, size_bytes, storage_uri) VALUES (?, 1, 'shared.musicxml', ?, ?)",
        [id, data.length, uri]);
      return id;
    });
    await completeDirect(requestId, requestNo, doc, text);
  } catch (e) {
    await removeRequestDir(requestNo).catch((rm) => logger.error({ err: rm, requestNo }, '실패한 요청의 파일을 지우지 못함'));
    throw e;
  }
  await recordInitialSelection(requestId).catch((e) => logger.warn({ err: e, requestNo }, '기본 악기 기록 실패'));
  res.status(202).json(await buildRequestStatus(requestId));
}));

/** 좋아요 — 다시 누르면 취소 */
sharedRouter.post('/shared-scores/:shareNo/like', wrap(async (req, res) => {
  if (!req.accountId) throw new ApiError('AUTH_LOGIN_REQUIRED');
  const s = await visibleShare(String(req.params.shareNo));
  const had = await one<{ n: number }>('SELECT 1 AS n FROM score_like WHERE share_id = ? AND account_id = ?', [s.share_id, req.accountId]);
  if (had) await exec('DELETE FROM score_like WHERE share_id = ? AND account_id = ?', [s.share_id, req.accountId]);
  else await exec('INSERT IGNORE INTO score_like (share_id, account_id) VALUES (?, ?)', [s.share_id, req.accountId]);
  const c = await one<{ n: number }>('SELECT COUNT(*) AS n FROM score_like WHERE share_id = ?', [s.share_id]);
  res.json({ share_no: s.share_no, liked: !had, likes: Number(c?.n ?? 0) });
}));
