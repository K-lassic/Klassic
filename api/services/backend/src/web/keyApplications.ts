// #91 접근 키 신청 → 바로 발급 (UC15) — 필수 항목 · 동의(G10) → 신청 빈도(G11, DB 트리거) → 외부 키 발급.
//
//   구조에서의 위치: 화면 /api-guide → Nginx(/api/*) → web(이 파일 · services/accessKeys.ts) → DB access_key · key_application.
//     model-api 는 같은 표의 key_hash 로 외부 키를 대조한다. 키 원문은 이 응답에서 한 번만 주고 저장하지 않는다(해시만).
//     로그인한 계정만 신청한다 (auth/permissions.ts UC15).
//   v0.1.1 web/keyApplications.ts 에서 달라진 점: 발급 트랜잭션을 명령줄 도구와 같이 쓰려고 services/accessKeys.ts 로 옮겼다.
import { Router } from 'express';
import { currentSettings } from '../config/settings.js';
import { one } from '../db/pool.js';
import { ApplicationRateLimited, issueExternalKey } from '../services/accessKeys.js';
import { recordGate } from '../services/gateEvents.js';
import { ApiError, wrap } from './errors.js';

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
  const email = b.contact_email.trim().toLowerCase();
  const s = await currentSettings();
  try {
    const k = await issueExternalKey({
      name: b.name.trim(), organization: b.organization.trim(), contactEmail: email, purpose: b.purpose.trim(),
      callLimitPerHour: s.default_call_limit_per_hour ?? 30, clientAddrHash: req.clientAddrHash!, accountId: req.accountId ?? null,
    });
    res.status(201).json({ application_no: k.applicationNo, api_key: k.raw, key_prefix: k.prefix, call_limit_per_hour: k.callLimitPerHour });
  } catch (e) {
    if (!(e instanceof ApplicationRateLimited)) throw e;
    // 트리거 거절은 롤백되므로 게이트 기록은 앱이 따로 남긴다
    await recordGate('G11', 'web', 'client', req.clientAddrHash ?? null, 'APPLICATION_RATE_LIMITED');
    const w = await one<{ next_allowed_at: Date }>(
      'SELECT MAX(next_allowed_at) AS next_allowed_at FROM v_apply_rate_window WHERE rate_key IN (?, ?) AND is_blocked = 1',
      [`email:${email}`, `addr:${req.clientAddrHash}`]);
    throw new ApiError('APPLICATION_RATE_LIMITED', {}, w?.next_allowed_at ? new Date(w.next_allowed_at) : new Date(Date.now() + 3600_000));
  }
}));
