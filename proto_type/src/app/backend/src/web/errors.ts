// 공통 오류 응답 (tasks T022, FR-048): { error:{code,message,fix,gate,retry_after,details}, api_version }
import type { Request, Response, NextFunction } from 'express';
import { errorCodes } from '../config/shared.js';
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
  const def = errorCodes.gate_codes[code] ?? errorCodes.gate_codes.INTERNAL_ERROR;
  return {
    error: {
      code: errorCodes.gate_codes[code] ? code : 'INTERNAL_ERROR',
      message: def.message,
      fix: def.web_fix ?? def.fix, // 웹 서비스 응답 — 웹 전용 문구가 있으면 그것(예: 웹은 사진만 받음)
      gate: def.gate,
      retry_after: retryAfter ? retryAfter.toISOString() : null,
      details,
    },
    api_version: errorCodes.api_version,
  };
}

export function sendError(res: Response, err: ApiError): void {
  const def = errorCodes.gate_codes[err.code] ?? errorCodes.gate_codes.INTERNAL_ERROR;
  const status = err.httpOverride ?? def.http;
  if (err.retryAfter) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((err.retryAfter.getTime() - Date.now()) / 1000))));
  }
  res.status(status).json(errorBody(err.code, err.details, err.retryAfter));
}

// Express 마지막 오류 처리기
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) return sendError(res, err);
  const e = err as { type?: string; code?: string; status?: number };
  if (e?.type === 'entity.parse.failed') return sendError(res, new ApiError('BAD_REQUEST', { reason: 'json' }));
  if (e?.code === 'LIMIT_UNEXPECTED_FILE' || e?.code === 'LIMIT_FILE_COUNT') return sendError(res, new ApiError('UPLOAD_TOO_MANY_FILES'));
  if (e?.code === 'LIMIT_FILE_SIZE') return sendError(res, new ApiError('UPLOAD_TOO_LARGE'));
  logger.error({ err }, 'unhandled error');
  sendError(res, new ApiError('INTERNAL_ERROR'));
}

/** async 라우트 처리기 감싸기 */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
