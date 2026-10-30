// 모든 /api 경로의 권한 판정 (FR-068, SD_01 P7 7.5·7.6 · G13, design/UC_16 BR-AUTH-04).
// ① 누구인지(세션 → 계정) ② 역할 모으기 ③ 경로 → 유스케이스 ④ 권한표. 요청 번호의 소유 확인(⑤)은 ownership.ts 가 한다.
import type { Request, Response, NextFunction } from 'express';
import { ApiError, sendError } from '../web/errors.js';
import { recordGate } from '../services/gateEvents.js';
import { isAllowed, permissionTable, ucOf } from './permissions.js';
import { rolesOf } from './accounts.js';

export async function authz(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const path = (req.baseUrl + req.path).replace(/\/+$/, '') || '/';
    const uc = ucOf(req.method, path);
    const roles = req.accountId ? await rolesOf(req.accountId) : [];
    req.roles = roles;
    if (uc && isAllowed(roles, uc, await permissionTable())) { next(); return; }
    if (!uc) {
      // 대응표에 없는 경로 — 없는 경로와 같게 404 (권한을 드러내지 않음)
      sendError(res, new ApiError('REQUEST_NOT_FOUND'));
      return;
    }
    const code = req.accountId ? 'AUTH_FORBIDDEN' : 'AUTH_LOGIN_REQUIRED';
    await recordGate('G13', 'web', req.accountId ? 'account' : 'session',
      req.accountId ? String(req.accountId) : (req.sessionId ?? null), code);
    sendError(res, new ApiError(code, { uc }));
  } catch (e) {
    next(e);
  }
}
