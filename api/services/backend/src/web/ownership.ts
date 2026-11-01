// #27 요청 소유 확인 — 요청 번호는 그 계정에서만 보인다. 아니면 REQUEST_NOT_FOUND, 보관 기간이 지났으면 RESULT_EXPIRED (기능 목록 H10).
//
//   구조에서의 위치: /api/requests/{no}/… 라우터(#34 · #36 등)가 맨 먼저 부른다. authz(역할 판정) 다음 단계(⑤).
//     DB score_request + v_request_retention(보관 기한 계산 뷰). 웹 요청(channel = 'web')만 — 외부 API 요청은 model-api 가 따로 본다.
//   v0.1.1 web/ownership.ts 와 같은 동작.
import type { Request } from 'express';
import { one } from '../db/pool.js';
import { ApiError } from './errors.js';

export interface OwnedRequest {
  request_id: number;
  request_no: string;
  channel: 'web' | 'api';
  session_id: string | null;
  account_id: number | null;
  file_kind: 'image' | 'pdf' | 'midi' | 'musicxml';
  chosen_score_type: 'staff' | 'jeongganbo' | null;
  route: 'recognize' | 'direct' | 'fallback';
  fallback_reason: string | null;
  status: string;
  setting_version_id: number;
  received_at: Date;
  completed_at: Date | null;
  is_expired: number;
  expires_at: Date;
  remaining_seconds: number;
}

export async function loadOwnedRequest(req: Request, opts: { allowExpired?: boolean } = {}): Promise<OwnedRequest> {
  const no = String(req.params.no ?? req.params.id ?? '');
  const row = await one<OwnedRequest>(
    `SELECT r.request_id, r.request_no, r.channel, r.session_id, r.account_id, r.file_kind, r.chosen_score_type, r.route,
            r.fallback_reason, r.status, r.setting_version_id, r.received_at, r.completed_at,
            v.is_expired, v.expires_at, v.remaining_seconds
       FROM score_request r JOIN v_request_retention v ON v.request_id = r.request_id
      WHERE r.request_no = ? AND r.channel = 'web' AND r.account_id = ?`,
    [no, req.accountId ?? -1],
  );
  if (!row) throw new ApiError('REQUEST_NOT_FOUND');
  if (row.is_expired && !opts.allowExpired) throw new ApiError('RESULT_EXPIRED');
  return row;
}
