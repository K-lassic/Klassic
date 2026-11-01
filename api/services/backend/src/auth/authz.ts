// #27 모든 /api 요청의 권한 판정 — ① 누구인지(세션 → 계정) ② 역할 ③ 경로 → UC ④ 권한표 (기능 목록 H9 · G13 · v0.1.1 auth/authz.ts).
//
//   구조에서의 위치: sessionMiddleware 다음, 라우터 앞. 요청 번호의 "이 계정 것인가"(⑤)는 web/ownership.ts 가 라우터 안에서 본다.
//   응답: 대응표에 없는 경로 404 REQUEST_NOT_FOUND (권한 존재를 드러내지 않음) · 로그인 필요 401 AUTH_LOGIN_REQUIRED · 역할 없음 403 AUTH_FORBIDDEN
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
