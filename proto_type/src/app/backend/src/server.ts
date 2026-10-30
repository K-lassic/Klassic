// 웹 서비스 시작 (tasks T028): 웹(WEB_PORT)과 관리자(ADMIN_PORT)는 따로 듣는다. 관리자 쪽은 내부망만(FR-051, research R13).
//   node dist/server.js --role=web | --role=admin | --role=both
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, APP_ROOT } from './config/env.js';
import { uploadRules, uploadRulesHash } from './config/shared.js';
import { currentSettings } from './config/settings.js';
import { errorHandler, sendError, ApiError } from './web/errors.js';
import { sessionMiddleware, sessionRouter } from './web/session.js';
import { requestsRouter } from './web/requests.js';
import { recommendationRouter } from './web/recommendation.js';
import { instrumentsRouter } from './web/instruments.js';
import { editsRouter } from './web/edits.js';
import { exportsRouter } from './web/exports.js';
import { keyApplicationsRouter } from './web/keyApplications.js';
import { apiDocsRouter } from './web/apiDocs.js';
import { modelsPublicRouter } from './web/models.js';
import { accountsRouter } from './auth/accounts.js';
import { authz } from './auth/authz.js';
import { networkGuard } from './admin/networkGuard.js';
import { authRouter, requireOperator } from './admin/auth.js';
import { metricsRouter } from './admin/metrics.js';
import { jobsRouter } from './admin/jobs.js';
import { evaluationRouter } from './admin/evaluation.js';
import { modelApiStatusRouter } from './admin/modelApiStatus.js';
import { settingsRouter } from './admin/settings.js';
import { auditRouter } from './admin/audit.js';
import { keysRouter } from './admin/keys.js';
import { modelsAdminRouter } from './admin/models.js';
import { accountsAdminRouter } from './admin/accounts.js';
import { startWorker } from './services/requestWorker.js';
import { recoverRenders } from './services/renderQueue.js';
import { startJobs } from './services/jobs/index.js';
import { logger } from './lib/logger.js';

const FRONTEND_DIST = resolve(APP_ROOT, 'frontend', 'dist');
const SOUNDFONTS = resolve(APP_ROOT, 'assets', 'soundfonts');

function base(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  return app;
}

export function createWebApp(): Express {
  const app = base();
  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  // 2026-09-29 RBAC(FR-068): 모든 /api 경로는 세션 → 계정 → 역할 → 권한표(authz)를 거친다.
  // API활용 안내(UC11)·가입·로그인(UC16)은 권한표에서 누구나 허용이다.
  app.use('/api', sessionMiddleware);
  app.use('/api', authz);
  app.use('/api', accountsRouter, apiDocsRouter, keyApplicationsRouter);
  app.use('/api', requestsRouter, recommendationRouter, instrumentsRouter, editsRouter, exportsRouter, sessionRouter, modelsPublicRouter);
  app.use('/api', (_req, res) => sendError(res, new ApiError('REQUEST_NOT_FOUND')));
  // 음원은 매번 바뀌었는지 묻는다(ETag → 안 바뀌었으면 304). 전에는 7일 캐시라 gugak.sf2 를 다시 만든 뒤(2026-09-29 국악기 번호 변경)
  // 브라우저가 옛 음원을 계속 써서 국악기 소리가 안 날 수 있었다.
  app.use('/soundfonts', express.static(SOUNDFONTS, { maxAge: 0, fallthrough: false }));
  if (existsSync(FRONTEND_DIST)) {
    // 관리자 빌드는 웹 포트로 내주지 않는다(research R13) — 정적 파일보다 먼저 막는다
    app.get('/admin.html', (_req, res) => { res.status(404).end(); });
    // 예시 파일은 서버 전용 폴더(app/assets/examples)로 옮겨 외부에 내주지 않는다 — 옛 주소는 첫 화면 대신 404
    // (2026-09-30 황송해 요청, SD_02·UC_01 예시 비공개). 목록·미리보기는 로그인 필요 API, 변환은 POST /api/requests/example
    app.get(/^\/examples(\/|$)/, (_req, res) => { res.status(404).end(); });
    app.use(express.static(FRONTEND_DIST, { index: 'index.html' }));
    app.get(/^\/(?!api\/|soundfonts\/).*/, (_req, res) => { res.sendFile(resolve(FRONTEND_DIST, 'index.html')); });
  }
  app.use(errorHandler);
  return app;
}

export function createAdminApp(): Express {
  const app = base();
  app.use(networkGuard);
  app.use('/admin', authRouter);
  app.use('/admin', requireOperator, metricsRouter, jobsRouter, evaluationRouter, modelApiStatusRouter, settingsRouter,
    auditRouter, keysRouter, modelsAdminRouter, accountsAdminRouter);  // 계정·권한(S7, FR-069 — 2026-09-29)
  app.use('/admin', (_req, res) => sendError(res, new ApiError('REQUEST_NOT_FOUND')));
  if (existsSync(FRONTEND_DIST)) {
    app.get('/', (_req, res) => { res.redirect('/admin.html'); });
    app.use(express.static(FRONTEND_DIST, { index: false }));
  }
  app.use(errorHandler);
  return app;
}

async function startupCheck(): Promise<void> {
  // 공유 업로드 규칙과 설정 판본의 MIDI·MusicXML 상한이 같은지(quickstart §7)
  const s = await currentSettings();
  const ruleBytes = uploadRules.kinds.midi.max_bytes;
  if (s.score_file_max_bytes !== ruleBytes) {
    logger.warn({ settings: s.score_file_max_bytes, rules: ruleBytes }, 'score_file_max_bytes differs from shared/upload-rules.json — settings value wins');
  }
  logger.info({ rules_version: uploadRules.version, rules_hash: uploadRulesHash, setting_version: s.setting_version_id }, 'upload rules loaded');
}

async function main(): Promise<void> {
  const role = (process.argv.find((a) => a.startsWith('--role='))?.split('=')[1] ?? 'both') as 'web' | 'admin' | 'both';
  await startupCheck();
  if (role === 'web' || role === 'both') {
    await recoverRenders();
    await startWorker();
    startJobs();
    createWebApp().listen(env.WEB_PORT, env.WEB_HOST, () => logger.info({ host: env.WEB_HOST, port: env.WEB_PORT }, 'web listening'));
  }
  if (role === 'admin' || role === 'both') {
    createAdminApp().listen(env.ADMIN_PORT, env.ADMIN_HOST, () => logger.info({ host: env.ADMIN_HOST, port: env.ADMIN_PORT }, 'admin listening'));
  }
}

// 직접 실행(node · tsx · pm2)이면 --role= 인자가 있다. 시험은 createWebApp 만 가져다 쓴다
const isMain = process.argv.some((a) => a.startsWith('--role='));
if (isMain) {
  main().catch((e) => { logger.fatal({ err: e }, 'startup failed'); process.exit(1); });
}
