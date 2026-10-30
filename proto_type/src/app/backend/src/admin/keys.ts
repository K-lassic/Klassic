// 키 관리 (tasks T114, UC14, FR-045·052·060): 목록·폐기·한도 변경·서비스 키 발급/교체·신청 내용(가린 값)·보관 처리·라이선스
import { Router } from 'express';
import { query, one, tx, signalMessage } from '../db/pool.js';
import { ApiError, wrap } from '../web/errors.js';
import { newAccessKey } from '../lib/ids.js';
import { addHistory } from './history.js';
import { recordGate } from '../services/gateEvents.js';

export const keysRouter = Router();

keysRouter.get('/keys', wrap(async (_req, res) => {
  res.json({ items: await query('SELECT * FROM v_key_admin_list ORDER BY key_id DESC') });
}));

keysRouter.post('/keys/:id/revoke', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const k = await one<{ status: string }>('SELECT status FROM access_key WHERE key_id = ?', [id]);
  if (!k) throw new ApiError('REQUEST_NOT_FOUND');
  if (k.status !== 'revoked') {
    await tx(async (conn) => {
      await conn.query("UPDATE access_key SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3), revoked_by = ? WHERE key_id = ?", [req.operatorId, id]);
      await addHistory(req.operatorId!, 'access_key', String(id), 'status', 'active', 'revoked', conn);
    });
  }
  res.json(await one('SELECT * FROM v_key_admin_list WHERE key_id = ?', [id]));
}));

keysRouter.put('/keys/:id/limit', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const limit = req.body?.call_limit_per_hour;
  if (!Number.isInteger(limit) || limit < 1) {
    await recordGate('G6', 'admin', 'access_key', String(id), 'SETTINGS_INVALID_VALUE');
    throw new ApiError('SETTINGS_INVALID_VALUE', { field: 'call_limit_per_hour', reason: 'positive_integer' });
  }
  const k = await one<{ call_limit_per_hour: number | null }>('SELECT call_limit_per_hour FROM access_key WHERE key_id = ?', [id]);
  if (!k) throw new ApiError('REQUEST_NOT_FOUND');
  await tx(async (conn) => {
    await conn.query('UPDATE access_key SET call_limit_per_hour = ? WHERE key_id = ?', [limit, id]);
    await addHistory(req.operatorId!, 'access_key', String(id), 'call_limit_per_hour', k.call_limit_per_hour, limit, conn);
  });
  res.json(await one('SELECT * FROM v_key_admin_list WHERE key_id = ?', [id]));
}));

// 서비스 전용 키 발급·교체(UC14 A2): 원문은 한 번만 보이고, 이전 서비스 키는 폐기한다. 웹 서비스 .env 의 SERVICE_API_KEY 를 바꿔야 한다
keysRouter.post('/service-key', wrap(async (req, res) => {
  const key = newAccessKey();
  const newId = await tx(async (conn) => {
    const [old] = await conn.query("SELECT key_id FROM access_key WHERE key_kind = 'service' AND status = 'active'");
    for (const o of old as { key_id: number }[]) {
      await conn.query("UPDATE access_key SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3), revoked_by = ? WHERE key_id = ?", [req.operatorId, o.key_id]);
      await addHistory(req.operatorId!, 'access_key', String(o.key_id), 'status', 'active', 'revoked', conn);
    }
    const [ins] = await conn.query("INSERT INTO access_key (key_kind, key_hash, key_prefix, issued_by) VALUES ('service', ?, ?, ?)", [key.hash, key.prefix, req.operatorId]);
    const id = (ins as { insertId: number }).insertId;
    await addHistory(req.operatorId!, 'access_key', String(id), 'issued', null, key.prefix, conn);
    return id;
  });
  res.status(201).json({ key_id: newId, api_key: key.raw, key_prefix: key.prefix,
    notice: '이 키는 다시 볼 수 없습니다. 웹 서비스 app/.env 의 SERVICE_API_KEY 를 이 값으로 바꾸고 다시 시작하십시오.' });
}));

keysRouter.get('/applications', wrap(async (_req, res) => {
  res.json({ items: await query('SELECT * FROM v_key_application_masked ORDER BY applied_at DESC') });
}));

keysRouter.post('/applications/:no/archive', wrap(async (req, res) => {
  const k = await one<{ key_id: number }>('SELECT key_id FROM access_key WHERE application_no = ?', [req.params.no]);
  const a = k ? await one<{ retained_at: Date | null }>('SELECT retained_at FROM key_application WHERE key_id = ?', [k.key_id]) : null;
  if (!k || !a) throw new ApiError('REQUEST_NOT_FOUND', { reason: 'application_purged_or_missing' });
  if (!a.retained_at) {
    await tx(async (conn) => {
      await conn.query('UPDATE key_application SET retained_at = CURRENT_TIMESTAMP(3), retained_by = ? WHERE key_id = ?', [req.operatorId, k.key_id]);
      await addHistory(req.operatorId!, 'key_application', String(k.key_id), 'retained', null, 'retained', conn);
    });
  }
  res.json(await one('SELECT * FROM v_key_application_masked WHERE application_no = ?', [req.params.no]));
}));

// G7 라이선스 확인(BR-RND-03·06) — 팀장 결정을 기록한다
keysRouter.get('/license', wrap(async (_req, res) => {
  res.json(await one("SELECT policy_code, confirmed, decided_by, decided_at FROM license_policy WHERE policy_code = 'sound_and_renderer'"));
}));

keysRouter.put('/license', wrap(async (req, res) => {
  const confirmed = req.body?.confirmed === true;
  const cur = await one<{ confirmed: number }>("SELECT confirmed FROM license_policy WHERE policy_code = 'sound_and_renderer'");
  await tx(async (conn) => {
    await conn.query(
      "UPDATE license_policy SET confirmed = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP(3) WHERE policy_code = 'sound_and_renderer'",
      [confirmed, req.operatorId]);
    await addHistory(req.operatorId!, 'license_policy', 'sound_and_renderer', 'confirmed', Boolean(cur?.confirmed), confirmed, conn);
  }).catch((e) => { if (signalMessage(e)) throw new ApiError('SETTINGS_INVALID_VALUE'); throw e; });
  res.json(await one("SELECT policy_code, confirmed, decided_by, decided_at FROM license_policy WHERE policy_code = 'sound_and_renderer'"));
}));
