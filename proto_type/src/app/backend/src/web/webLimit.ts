// 웹 사용자 요청 한도 — 새 게이트 G12 (tasks T080, FR-062, spec Clarifications):
// 계정·접속 주소별로(2026-09-29 RBAC: 세션 → 계정) ① 처리 중·대기 중 요청 1건 ② 시간당 접수 상한. 넘으면 접수 전에 반려하고 다시 시도 시각을 준다.
import { query } from '../db/pool.js';
import type { Settings } from '../config/settings.js';
import { ApiError } from './errors.js';

interface LimitRow { limit_key: string; active_count: number; hourly_count: number; hourly_retry_at: Date | null }

export async function enforceWebLimit(accountId: number, addrHash: string, s: Settings): Promise<void> {
  const rows = await query<LimitRow>(
    'SELECT limit_key, active_count, hourly_count, hourly_retry_at FROM v_web_request_limit WHERE limit_key IN (?, ?)',
    [`account:${accountId}`, `addr:${addrHash}`],
  );
  const maxActive = s.web_max_active_per_client;
  const cap = s.web_hourly_request_cap;
  for (const r of rows) {
    if (maxActive != null && Number(r.active_count) >= maxActive) {
      // 처리 중 요청은 처리 시간 제한 안에 끝나므로 그 뒤를 다시 시도 시각으로 안내한다
      throw new ApiError('WEB_ACTIVE_REQUEST_EXISTS', { scope: r.limit_key.split(':')[0], active: Number(r.active_count) },
        new Date(Date.now() + Math.min(s.timeout_seconds, 60) * 1000));
    }
  }
  for (const r of rows) {
    if (cap != null && Number(r.hourly_count) >= cap) {
      throw new ApiError('WEB_HOURLY_LIMIT', { scope: r.limit_key.split(':')[0], cap },
        r.hourly_retry_at ? new Date(r.hourly_retry_at) : new Date(Date.now() + 3600_000));
    }
  }
}
