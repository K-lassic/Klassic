// 공유 악보 관리 S8 (2026-09-30 황송해 결정 — design/UC_18 UC19 · SD_02 §10B · SD_01 P9 9.6)
// 운영자가 부적절한 공유 악보를 내리고 다시 올린다. 올린 사람 정보는 보이지 않는다(BR-SHR-03). 조치는 변경 이력(BR-SHR-06).
import { Router } from 'express';
import { exec, one, query } from '../db/pool.js';
import { ApiError, wrap } from '../web/errors.js';
import { addHistory } from './history.js';

export const sharedAdminRouter = Router();

sharedAdminRouter.get('/shared-scores', wrap(async (req, res) => {
  const status = String(req.query.status ?? 'all');
  const where = status === 'visible' ? 'WHERE s.unshared_at IS NULL AND s.taken_down_at IS NULL AND s.purged_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP(3)'
    : status === 'taken_down' ? 'WHERE s.taken_down_at IS NOT NULL'
    : status === 'unshared' ? 'WHERE s.unshared_at IS NOT NULL'
    : status === 'expired' ? 'WHERE s.expires_at <= CURRENT_TIMESTAMP(3)' : '';
  const rows = await query<{ share_no: string; title: string; score_type: string; shared_at: Date; expires_at: Date; purged_at: Date | null; unshared_at: Date | null;
    taken_down_at: Date | null; take_down_reason: string | null; likes: number }>(
    `SELECT s.share_no, s.title, s.score_type, s.shared_at, s.expires_at, s.purged_at, s.unshared_at, s.taken_down_at, s.take_down_reason,
            (SELECT COUNT(*) FROM score_like l WHERE l.share_id = s.share_id) AS likes
       FROM shared_score s ${where} ORDER BY s.shared_at DESC LIMIT 500`);
  res.json({
    items: rows.map((r) => ({
      share_no: r.share_no, title: r.title, score_type: r.score_type, shared_at: r.shared_at, expires_at: r.expires_at, likes: Number(r.likes),
      // 3일 지난 것은 상태와 상관없이 '지남'(정리 전) · 정리됨(2026-09-30 BR-SHR-02)
      status: r.purged_at ? 'purged' : new Date(r.expires_at).getTime() <= Date.now() ? 'expired' : r.unshared_at ? 'unshared' : r.taken_down_at ? 'taken_down' : 'visible',
      taken_down_at: r.taken_down_at, take_down_reason: r.take_down_reason,
    })),
  });
}));

async function findShare(no: string) {
  const s = await one<{ share_id: number; share_no: string; unshared_at: Date | null; taken_down_at: Date | null; expired: number; purged_at: Date | null }>(
    'SELECT share_id, share_no, unshared_at, taken_down_at, purged_at, expires_at <= CURRENT_TIMESTAMP(3) AS expired FROM shared_score WHERE share_no = ?', [no]);
  if (!s) throw new ApiError('REQUEST_NOT_FOUND');   // UC19 E1
  return s;
}

/** 내리기(UC19 기본흐름 2) — 파일은 남긴다(다시 올리기 위해) */
sharedAdminRouter.post('/shared-scores/:shareNo/take-down', wrap(async (req, res) => {
  const s = await findShare(String(req.params.shareNo));
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
  if (!s.taken_down_at) {
    await exec('UPDATE shared_score SET taken_down_at = CURRENT_TIMESTAMP(3), taken_down_by = ?, take_down_reason = ? WHERE share_id = ?',
      [req.operatorId, reason || null, s.share_id]);
    await addHistory(req.operatorId!, 'shared_score', s.share_no, 'taken_down', null, reason || '내림');
  }
  res.json({ share_no: s.share_no, status: s.unshared_at ? 'unshared' : 'taken_down' });
}));

/** 다시 올리기(UC19 기본흐름 3) — 올린 사람이 거둔 것은 파일이 없어 되살릴 수 없다(E2) */
sharedAdminRouter.post('/shared-scores/:shareNo/restore', wrap(async (req, res) => {
  const s = await findShare(String(req.params.shareNo));
  if (s.unshared_at || s.purged_at || Number(s.expired)) throw new ApiError('REQUEST_NOT_FOUND', { reason: s.unshared_at ? 'unshared' : 'expired' }, null, 409);
  if (s.taken_down_at) {
    await exec('UPDATE shared_score SET taken_down_at = NULL, taken_down_by = NULL, take_down_reason = NULL WHERE share_id = ?', [s.share_id]);
    await addHistory(req.operatorId!, 'shared_score', s.share_no, 'restored', '내림', '보임');
  }
  res.json({ share_no: s.share_no, status: 'visible' });
}));
