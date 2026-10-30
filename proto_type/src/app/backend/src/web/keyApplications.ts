// 접근 키 신청 → 즉시 발급 (tasks T109, UC15 · FR-053·054·055·060·061): G10 필수 항목·동의 → G11 신청 빈도(트리거) →
// 한 트랜잭션으로 access_key + key_application. 키 원문은 이 응답에서 한 번만 주고 저장하지 않는다(해시만).
import { Router } from 'express';
import { tx, signalMessage, one } from '../db/pool.js';
import { ApiError, wrap } from './errors.js';
import { newAccessKey, newApplicationNo } from '../lib/ids.js';
import { currentSettings } from '../config/settings.js';
import { recordGate } from '../services/gateEvents.js';

export const keyApplicationsRouter = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

keyApplicationsRouter.post('/key-applications', wrap(async (req, res) => {
  const b = req.body ?? {};
  const fields = { name: b.name, organization: b.organization, contact_email: b.contact_email, purpose: b.purpose };
  const missing = Object.entries(fields).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k);
  if (typeof b.contact_email === 'string' && b.contact_email.trim() && !EMAIL.test(b.contact_email.trim())) missing.push('contact_email');
  if (missing.length) {
    await recordGate('G10', 'web', 'client', req.clientAddrHash ?? null, 'APPLICATION_MISSING_FIELD');
    throw new ApiError('APPLICATION_MISSING_FIELD', { fields: [...new Set(missing)] });
  }
  if (b.consent !== true) {
    await recordGate('G10', 'web', 'client', req.clientAddrHash ?? null, 'APPLICATION_CONSENT_REQUIRED');
    throw new ApiError('APPLICATION_CONSENT_REQUIRED');
  }
  const s = await currentSettings();
  const limit = s.default_call_limit_per_hour ?? 30;
  const key = newAccessKey();
  const applicationNo = newApplicationNo();
  try {
    await tx(async (conn) => {
      const [k] = await conn.query(
        "INSERT INTO access_key (key_kind, key_hash, key_prefix, application_no, call_limit_per_hour) VALUES ('external', ?, ?, ?, ?)",
        [key.hash, key.prefix, applicationNo, limit]);
      await conn.query(
        `INSERT INTO key_application (key_id, applicant_name, affiliation, contact_email, purpose, consent_given, client_addr_hash, account_id)
         VALUES (?, ?, ?, ?, ?, TRUE, ?, ?)`,
        [(k as { insertId: number }).insertId, b.name.trim().slice(0, 100), b.organization.trim().slice(0, 200),
         b.contact_email.trim().toLowerCase().slice(0, 254), b.purpose.trim().slice(0, 1000), req.clientAddrHash,
         req.accountId ?? null]);  // 신청한 계정(FR-053 2026-09-29 RBAC — 로그인한 user 만 신청)
    });
  } catch (e) {
    if (signalMessage(e)?.startsWith('G11')) {
      // 트리거 거절은 롤백되므로 게이트 기록은 앱이 따로 남긴다
      await recordGate('G11', 'web', 'client', req.clientAddrHash ?? null, 'APPLICATION_RATE_LIMITED');
      const w = await one<{ next_allowed_at: Date }>(
        'SELECT MAX(next_allowed_at) AS next_allowed_at FROM v_apply_rate_window WHERE rate_key IN (?, ?) AND is_blocked = 1',
        [`email:${b.contact_email.trim().toLowerCase()}`, `addr:${req.clientAddrHash}`]);
      throw new ApiError('APPLICATION_RATE_LIMITED', {}, w?.next_allowed_at ? new Date(w.next_allowed_at) : new Date(Date.now() + 3600_000));
    }
    throw e;
  }
  res.status(201).json({ application_no: applicationNo, api_key: key.raw, key_prefix: key.prefix, call_limit_per_hour: limit });
}));
