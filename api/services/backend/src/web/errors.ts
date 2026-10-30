// #23 공통 오류 응답 — { error:{code,message,fix,gate,retry_after,details}, api_version } (기능 목록 H26 · web-api.yaml ErrorResponse).
//
//   구조에서의 위치: backend 의 모든 라우터가 throw new ApiError('코드') → 마지막 errorHandler 가 응답으로 바꾼다.
//     코드 · 문구 · HTTP 상태는 api/shared/errors/*.json 한 곳에서 온다 (화면 · model-api 와 같은 파일).
//   v0.1.1 backend/src/web/errors.ts 와 같은 동작.
import type { Request, Response, NextFunction } from 'express';
import { shared } from '../config/shared.js';
import { logger } from '../lib/logger.js';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly details: Record<string, unknown> = {},
    readonly retryAfter: Date | null = null,
    readonly httpOverride?: number,
  ) {
    super(code);
  }
}

export function errorBody(code: string, details: Record<string, unknown> = {}, retryAfter: Date | null = null) {
  const codes = shared().errorCodes;
  const known = codes.gate_codes[code];
  const def = known ?? codes.gate_codes.INTERNAL_ERROR;
  return {
    error: {
      code: known ? code : 'INTERNAL_ERROR',
      message: def.message,
      fix: def.web_fix ?? def.fix, // 웹 전용 문구가 있으면 그것
      gate: def.gate,
      retry_after: retryAfter ? retryAfter.toISOString() : null,
      details,
    },
    api_version: codes.api_version,
  };
}

export function sendError(res: Response, err: ApiError): void {
  const codes = shared().errorCodes;
  const def = codes.gate_codes[err.code] ?? codes.gate_codes.INTERNAL_ERROR;
  const status = err.httpOverride ?? def.http;
  if (err.retryAfter) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((err.retryAfter.getTime() - Date.now()) / 1000))));
  }
  res.status(status).json(errorBody(err.code, err.details, err.retryAfter));
}

/** Express 마지막 오류 처리기 — 예상 못 한 오류는 내용을 숨기고 INTERNAL_ERROR (로그에는 원인을 남김) */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) return sendError(res, err);
  const e = err as { type?: string; code?: string };
  if (e?.type === 'entity.parse.failed') return sendError(res, new ApiError('BAD_REQUEST', { reason: 'json' }));
  if (e?.type === 'entity.too.large') return sendError(res, new ApiError('UPLOAD_TOO_LARGE'));
  logger.error({ err }, 'unhandled error');
  sendError(res, new ApiError('INTERNAL_ERROR'));
}

/** async 라우트 처리기 감싸기 — 비동기 오류를 errorHandler 로 넘긴다 */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
