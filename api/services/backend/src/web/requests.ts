// #34 악보 요청 API — 올리기 → 상태 → 결과 악보 · 종류 확인 답 · 대체 결과 요청 (UC1 · UC2, web-api.yaml).
//
//   구조에서의 위치: 화면 → Nginx(/api/*) → web(이 파일, authz 다음 단계) → 볼륨 storage(원본 파일) · DB(score_request · upload_file)
//     PDF 는 저장 전에 model-api 검사(uploadInspect.ts). 인식은 작업자(#35)가 대기열에서 꺼내 model-api 를 부른다.
//   저장 위치는 upload_file.storage_uri 에 남긴다. DB 에 쓰지 못하면 방금 저장한 파일을 지워서 DB ↔ 파일이 어긋나지 않게 한다.
//   v0.1.1 web/requests.ts 에서 달라진 점:
//     용량 상한을 넘는 파일이 500 이 아니라 413 UPLOAD_TOO_LARGE · 한글 파일 이름이 깨지지 않음(UTF-8)
//     · 결과 파일이 사라졌으면 500 이 아니라 RESULT_EXPIRED. 내려받기(/original)는 exports.ts.
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { parseMidi, parseMusicXml } from '@gugak/score-core';
import { exec, one, tx } from '../db/pool.js';
import { currentSettings } from '../config/settings.js';
import { fallbackCode, shared } from '../config/shared.js';
import { ApiError, wrap } from './errors.js';
import { checkUpload } from './uploadCheck.js';
import { enforceWebLimit } from './webLimit.js';
import { loadOwnedRequest } from './ownership.js';
import { receiveExample } from './examples.js';
import { recordGate } from '../services/gateEvents.js';
import { inspectPdf } from '../services/uploadInspect.js';
import { readStored, removeRequestDir, saveFile } from '../services/storage.js';
import { answerTypeQuestion, enqueueRecognition } from '../services/requestWorker.js';
import { switchToUserFallback } from '../services/fallback.js';
import { buildRequestStatus } from '../services/requestStatus.js';
import { recordInitialSelection } from '../services/placedEnsemble.js';
import { newRequestNo } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

function limits() {
  const r = shared().uploadRules;
  return { maxPages: r.max_pages ?? 10, maxBytes: Math.max(...r.user_upload_kinds.map((k) => r.kinds[k].max_bytes)) };
}

let upload: multer.Multer | null = null;
/** 파일은 메모리로 받아 검사한 뒤에만 저장한다. 메모리 상한 = 한 장 상한 × 장 수 → Nginx 본문 상한(210m) 안 */
function uploader(): multer.Multer {
  const { maxPages, maxBytes } = limits();
  upload ??= multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: maxPages }, defParamCharset: 'utf8' });
  return upload;
}

/** multer 가 상한에 걸려 멈추면 G1 코드로 반려하고 게이트 기록을 남긴다 */
const receiveFiles: RequestHandler = (req, res, next) => {
  uploader().any()(req, res, (err: unknown) => {
    if (!(err instanceof multer.MulterError)) { next(err); return; }
    const { maxPages, maxBytes } = limits();
    const rejected = err.code === 'LIMIT_FILE_COUNT' ? new ApiError('UPLOAD_TOO_MANY_PAGES', { max_pages: maxPages })
      : err.code === 'LIMIT_FILE_SIZE' ? new ApiError('UPLOAD_TOO_LARGE', { max_bytes: maxBytes })
      : new ApiError('BAD_REQUEST', { reason: err.code });
    recordGate('G1', 'web', 'session', req.sessionId ?? null, rejected.code).then(() => next(rejected), next);
  });
};

const createRequest = wrap(async (req, res) => {
  const checkStart = new Date();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const scoreType = typeof req.body?.score_type === 'string' ? req.body.score_type : undefined;
  const s = await currentSettings();

  let verdict = checkUpload(files.map((f) => ({ originalName: f.originalname, data: f.buffer })), scoreType);
  let pdfPageCount: number | null = null;
  if (verdict.remoteCheck) {
    const remote = await inspectPdf(files[0].originalname, files[0].buffer, scoreType);
    if (remote) {
      verdict = { ...verdict, ok: remote.ok, code: remote.code, details: remote.details, shortEdgePx: remote.shortEdgePx };
      pdfPageCount = remote.pdfPageCount;
    } else if (verdict.ok) {
      // 확인할 수 없으면 접수하지 않는다. 웹 판정으로 이미 반려할 파일이면 그 사유를 그대로 쓴다
      verdict = { ...verdict, ok: false, code: 'UPLOAD_CHECK_UNAVAILABLE', details: {} };
    }
  }
  if (!verdict.ok) {
    await recordGate('G1', 'web', 'session', req.sessionId ?? null, verdict.code!);
    throw new ApiError(verdict.code!, verdict.details);
  }
  try {
    await enforceWebLimit(req.accountId!, req.clientAddrHash!, s);
  } catch (e) {
    if (e instanceof ApiError) await recordGate('G12', 'web', 'client', req.clientAddrHash ?? null, e.code);
    throw e;
  }

  const requestNo = newRequestNo();
  let requestId: number;
  try {
    // 파일마다 저장 — 한 개면 original.<ext>, 여러 장이면 올린 순서대로 original<n>.<ext>
    const stored: { file: Express.Multer.File; uri: string; shortEdgePx: number | null }[] = [];
    for (const [i, f] of files.entries()) {
      const ext = (f.originalname.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '').toLowerCase();
      const uri = await saveFile(`${requestNo}/original${files.length > 1 ? i + 1 : ''}${ext}`, f.buffer);
      stored.push({ file: f, uri, shortEdgePx: verdict.pages?.[i]?.shortEdgePx ?? verdict.shortEdgePx });
    }
    requestId = await tx(async (conn) => {
      // 받는 파일은 사진 · PDF 뿐이라 경로는 늘 recognize (PDF 는 model-api 가 쪽마다 사진으로 바꿔 인식)
      const [ins] = await conn.query(
        `INSERT INTO score_request (request_no, channel, session_id, account_id, file_kind, chosen_score_type, route, status,
                                    setting_version_id, client_addr_hash, example_id)
         VALUES (?, 'web', ?, ?, ?, ?, 'recognize', 'received', ?, ?, ?)`,
        [requestNo, req.sessionId, req.accountId ?? null, verdict.kind, scoreType, s.setting_version_id, req.clientAddrHash,
         typeof res.locals.exampleId === 'string' ? res.locals.exampleId : null]);
      const id = (ins as { insertId: number }).insertId;
      for (const [i, st] of stored.entries()) {
        await conn.query(
          `INSERT INTO upload_file (request_id, file_no, original_name, size_bytes, image_short_side_px, pdf_page_count, storage_uri)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, i + 1, st.file.originalname.slice(0, 255), st.file.size, st.shortEdgePx, pdfPageCount, st.uri]);
      }
      await conn.query(
        "INSERT INTO stage_timing (request_id, stage_code, started_at, ended_at) VALUES (?, 'check', ?, CURRENT_TIMESTAMP(3))",
        [id, checkStart]);
      return id;
    });
  } catch (e) {
    await removeRequestDir(requestNo).catch((rm) => logger.error({ err: rm, requestNo }, '접수 실패한 파일을 지우지 못함'));
    throw e;
  }

  await enqueueRecognition(requestId);
  res.status(202).json(await buildRequestStatus(requestId));
});

/** 결과 파일 읽기 — DB 에는 있는데 파일이 없으면(주기 정리 · 볼륨 문제) 원인을 로그에 남기고 만료로 알린다 */
export async function readResult(uri: string, requestNo: string): Promise<Buffer> {
  try {
    return await readStored(uri);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    logger.error({ requestNo, uri }, 'DB 에 있는 결과 파일이 저장소에 없음');
    throw new ApiError('RESULT_EXPIRED');
  }
}

export const requestsRouter = Router();

requestsRouter.post('/requests', receiveFiles, createRequest);
requestsRouter.post('/requests/example', receiveExample, createRequest);

requestsRouter.get('/requests/:no', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req, { allowExpired: true });
  res.json(await buildRequestStatus(r.request_id));
}));

requestsRouter.post('/requests/:no/type-confirmation', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const changeTo = req.body?.change_to;
  if (changeTo !== null && changeTo !== 'staff' && changeTo !== 'jeongganbo') throw new ApiError('BAD_REQUEST', { field: 'change_to' });
  await answerTypeQuestion(r.request_id, changeTo);
  res.status(202).json(await buildRequestStatus(r.request_id));
}));

requestsRouter.get('/requests/:no/score', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  if (r.status !== 'completed') throw new ApiError('REQUEST_NOT_FOUND', { reason: 'not_completed', status: r.status }, null, 409);
  const cur = await one<{ musicxml_uri: string; midi_uri: string | null; original_ensemble_id: number | null }>(
    'SELECT musicxml_uri, midi_uri, original_ensemble_id FROM v_current_result WHERE request_id = ? AND deleted_at IS NULL', [r.request_id]);
  if (!cur) throw new ApiError('RESULT_EXPIRED');
  const musicxml = (await readResult(cur.musicxml_uri, r.request_no)).toString('utf8');
  let scoredoc: unknown;
  try {
    scoredoc = parseMusicXml(musicxml);
  } catch (e) {
    if (!cur.midi_uri) throw e; // MIDI 변환에 실패한 결과는 MusicXML 만 있다
    scoredoc = parseMidi(new Uint8Array(await readResult(cur.midi_uri, r.request_no)));
  }
  const last = await one<{ outcome: string }>(
    'SELECT outcome FROM engine_attempt WHERE request_id = ? ORDER BY page_no DESC, attempt_no DESC LIMIT 1', [r.request_id]);
  const code = fallbackCode(r.fallback_reason, last?.outcome);
  const reason = code ? shared().errorCodes.fallback_reasons[code] : null;
  res.json({
    scoredoc, musicxml,
    has_original_instruments: cur.original_ensemble_id != null,
    fallback: r.route === 'fallback',
    fallback_reason: code,
    fallback_message: reason?.message ?? null,
    retry_hint: reason?.retry_hint ?? null,
  });
}));

requestsRouter.post('/requests/:no/fallback', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  // 이미 대체이거나 끝나지 않았으면 바꿀 것이 없다
  if (r.status === 'completed' && r.route === 'recognize' && !(await switchToUserFallback(r.request_id))) {
    throw new ApiError('INTERNAL_ERROR', { reason: 'template_unavailable' });
  }
  res.json(await buildRequestStatus(r.request_id));
}));

// #36 화면 이벤트 — 결과 표시 · 첫 연주 시각. 결과 표시 = 기본 구성으로 처음 연주하므로 실제로 놓이는 악기를 첫 선택으로 남긴다
requestsRouter.post('/requests/:no/events', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const col = req.body?.event === 'result_shown' ? 'result_shown_at' : req.body?.event === 'first_played' ? 'first_played_at' : null;
  if (!col) throw new ApiError('BAD_REQUEST', { field: 'event' });
  await exec(`UPDATE score_request SET ${col} = COALESCE(${col}, CURRENT_TIMESTAMP(3)) WHERE request_id = ?`, [r.request_id]);
  if (col === 'result_shown_at' && r.status === 'completed') {
    await recordInitialSelection(r.request_id).catch((e) => logger.warn({ err: e, requestNo: r.request_no }, '첫 악기 기록 실패'));
  }
  res.status(204).end();
}));
