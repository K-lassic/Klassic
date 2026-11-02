// #23 Express 앱 — web(사용자 API) · admin(관리자 API) 두 역할. 기능 라우터는 이후 이슈에서 붙인다.
//
//   구조에서의 위치
//     Nginx 사용자 server ─ /api/*   ─▶ web   :9523  (이 파일의 createWebApp)
//     Nginx 관리자 server ─ /admin/* ─▶ admin :26101 (이 파일의 createAdminApp)
//     web · admin ─▶ MariaDB(db) · web ─▶ model-api(서비스 이름)
//   v0.1.1 과 다른 점: 화면 정적 파일은 내주지 않는다 — 화면은 Nginx(#21). 음원 /soundfonts 는 Nginx 를 거쳐 여기서 내준다 (#36).
//   /api 요청 순서 (#27): /api/health(세션 없이) → sessionMiddleware → authz(경로 → UC → 권한표) → 라우터 → 404 → errorHandler
//   붙인 라우터: 세션 · 인증 · 권한 #27 · 요청 · 예시 #34 / 모델 상태 #35 · 편집 · 내보내기 · 악기 · 음원 #36 / 붙일 것: 관리자 API (P3)
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { currentSettings } from './config/settings.js';
import { getPool } from './db/pool.js';
import { ApiError, errorHandler, sendError, wrap } from './web/errors.js';
import { sessionMiddleware, sessionRouter } from './web/session.js';
import { authz } from './auth/authz.js';
import { accountsRouter } from './auth/accounts.js';
import { requestsRouter } from './web/requests.js';
import { examplesRouter } from './web/examples.js';
import { modelsRouter } from './web/models.js';
import { editsRouter } from './web/edits.js';
import { exportsRouter } from './web/exports.js';
import { instrumentsRouter } from './web/instruments.js';
import { myScoresRouter } from './web/myScores.js';
import { sharedRouter } from './web/shared.js';

function base(): Express {
  const app = express();
  app.disable('x-powered-by');
  // 실제 접속 주소는 Nginx 가 넘긴 X-Forwarded-For 에서 — 믿을 범위는 설정값 (#37 에서 확정)
  app.set('trust proxy', env().TRUST_PROXY.split(',').map((s) => s.trim()).filter(Boolean));
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  return app;
}

/**
 * 준비 상태 — DB 에 닿고 처리 설정 판본을 읽을 수 있을 때만 200 (작성규칙 1-3 · #5 C2).
 * v0.1.1 은 DB 를 보지 않고 늘 200 이었다. 준비가 안 됐으면 503 SERVICE_NOT_READY 와 무엇이 안 됐는지.
 */
async function readiness(): Promise<{ ok: true; setting_version: number } | { ok: false; reason: string }> {
  try {
    await getPool().query('SELECT 1');
  } catch {
    return { ok: false, reason: 'db' };
  }
  try {
    const s = await currentSettings();
    return { ok: true, setting_version: s.setting_version_id };
  } catch {
    return { ok: false, reason: 'settings' };
  }
}

export function createWebApp(): Express {
  const app = base();
  app.get('/api/health', wrap(async (_req, res) => {
    const r = await readiness();
    if (!r.ok) return sendError(res, new ApiError('SERVICE_NOT_READY', { reason: r.reason }));
    res.json({ status: 'ok', role: 'web', setting_version: r.setting_version });
  }));
  // 음원은 로그인 없이 받는다 (세션 앞) — 브라우저가 매번 바뀌었는지 묻고(ETag) 안 바뀌면 304 로 다시 받지 않는다 (#36 · v0.1.1 과 같음)
  app.use('/soundfonts', express.static(env().SOUNDFONTS_DIR, { maxAge: 0 }), (_req, res) => sendError(res, new ApiError('REQUEST_NOT_FOUND')));
  // 상태 확인 다음부터는 모든 /api 가 세션 → 권한 판정을 지난다 (상태 확인이 세션을 만들지 않게 순서를 둔다)
  app.use('/api', sessionMiddleware);
  app.use('/api', authz);
  app.use('/api', accountsRouter, sessionRouter, requestsRouter, examplesRouter, modelsRouter, editsRouter, exportsRouter, instrumentsRouter, myScoresRouter, sharedRouter);
  // 권한표에는 있지만 아직 만들지 않은 경로(#36 이후) · 대응표에 없는 경로 → 404 (권한 존재를 드러내지 않음 — H9)
  app.use('/api', (_req, res) => sendError(res, new ApiError('REQUEST_NOT_FOUND')));
  app.use(errorHandler);
  return app;
}

export function createAdminApp(): Express {
  const app = base();
  // compose healthcheck 용 — 관리자 server 는 127.0.0.1 에만 열리고(Nginx #22), 접속 허용 범위 검사는 관리자 API 이슈에서 붙인다
  app.get('/admin/health', wrap(async (_req, res) => {
    const r = await readiness();
    if (!r.ok) return sendError(res, new ApiError('SERVICE_NOT_READY', { reason: r.reason }));
    res.json({ status: 'ok', role: 'admin', setting_version: r.setting_version });
  }));
  app.use('/admin', (_req, res) => sendError(res, new ApiError('REQUEST_NOT_FOUND')));
  app.use(errorHandler);
  return app;
}
