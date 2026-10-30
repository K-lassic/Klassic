// 악보 요청 API (tasks T059·T062~T066·T074, FR-002~FR-016·FR-022): 올리기 → 상태 → 결과·대체·내려받기
import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { parseMusicXml, parseMidi } from '@gugak/score-core';
import { exec, one, tx } from '../db/pool.js';
import { currentSettings } from '../config/settings.js';
import { errorCodes, fallbackCode, uploadRules } from '../config/shared.js';
import { ApiError, wrap } from './errors.js';
import { checkUpload } from './uploadCheck.js';
import { inspectUploadRemote } from '../services/uploadInspect.js';
import { enforceWebLimit } from './webLimit.js';
import { loadOwnedRequest } from './ownership.js';
import { recordGate } from '../services/gateEvents.js';
import { saveFile, readStored } from '../services/storage.js';
import { newRequestNo } from '../lib/ids.js';
import { enqueueRecognition, answerTypeQuestion } from '../services/requestWorker.js';
import { completeDirect } from '../services/directRoute.js';
import { switchToUserFallback } from '../services/fallback.js';
import { buildRequestStatus } from '../services/requestStatus.js';
import { logger } from '../lib/logger.js';
import { recordInitialSelection } from '../services/placedEnsemble.js';
import { sharedRouter } from './shared.js';
import { examplesRouter, receiveExample } from './examples.js';
import { myScoresRouter } from './myScores.js';

// 파일은 메모리로 받아 검사한 뒤에만 저장한다. 25MB 까지 받아야 "용량 초과"를 이유와 함께 알릴 수 있다
// (2026-09-30 T187 여러 쪽) 사진 여러 장 — 파일 수 상한은 한 요청 최대 쪽 수(upload-rules.json max_pages, 10)
const MAX_PAGES = uploadRules.max_pages ?? 10;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: MAX_PAGES } });

/** multer 가 파일 수 상한(10)을 넘겨 멈추면 G1 UPLOAD_TOO_MANY_PAGES 로 반려하고 게이트 기록을 남긴다(count 단계, BR-UPL-02) */
const receiveFiles: RequestHandler = (req, res, next) => {
  upload.any()(req, res, (err: unknown) => {
    if ((err as { code?: string } | undefined)?.code !== 'LIMIT_FILE_COUNT') { next(err); return; }
    recordGate('G1', 'web', 'session', req.sessionId ?? null, 'UPLOAD_TOO_MANY_PAGES')
      .then(() => next(new ApiError('UPLOAD_TOO_MANY_PAGES', { max_pages: MAX_PAGES })), next);
  });
};

export const requestsRouter = Router();
// 공유 악보 · 좋아요(2026-09-30 황송해, UC18) — server.ts 를 건드리지 않으려고 요청 라우터에 붙인다
requestsRouter.use(sharedRouter);
// 예시 악보 목록 · 미리보기(2026-09-30 황송해 72번) — 같은 까닭으로 여기에 붙인다
requestsRouter.use(examplesRouter);
// 내가 만든 악보(2026-09-30 황송해 160번) — 같은 까닭으로 여기에 붙인다
requestsRouter.use(myScoresRouter);

// 올리기 처리 — 파일 올리기(multipart)와 예시 올리기(2026-09-30 황송해 72번, 서버 전용 폴더의 예시 파일)가 함께 쓴다
const createRequest = wrap(async (req, res) => {
  const checkStart = new Date();
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const scoreType = typeof req.body?.score_type === 'string' ? req.body.score_type : undefined;
  const s = await currentSettings();

  // 받는 파일은 사진·PDF(2026-09-29 황송해 결정, 웹·API 같음) — MIDI·MusicXML 은 G1 UPLOAD_UNSUPPORTED_TYPE
  let verdict = checkUpload(files.map((f) => ({ originalName: f.originalname, data: f.buffer })), scoreType,
    { scoreFileMaxBytes: s.score_file_max_bytes ?? undefined });
  // PDF: 열기(손상·암호) · 쪽수(최대 10쪽) · 쪽마다 300dpi 사진 크기는 모델 API 검사기가 판정한다(UC3 A7 · E2 · E9).
  // (2026-09-29 황송해 결정, BR-UPL-06) 모델 API 에 닿지 않아 확인할 수 없으면 접수하지 않는다 — 503 UPLOAD_CHECK_UNAVAILABLE
  let pdfPageCount: number | null = null;
  if (verdict.remoteCheck && files.length === 1) {
    const remote = await inspectUploadRemote(files[0].originalname, files[0].buffer, scoreType);
    if (remote) {
      verdict = { ...verdict, ok: remote.ok, code: remote.code, details: remote.details, shortEdgePx: remote.shortEdgePx };
      pdfPageCount = remote.pdfPageCount;
    } else if (verdict.ok) {
      // 웹 판정(용량·종류)으로 이미 반려할 파일이면 그 사유를 그대로 쓴다
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

  const file = files[0];
  const kind = verdict.kind!;
  const requestNo = newRequestNo();
  // (2026-09-30 T187 여러 쪽) 파일마다 저장 — 한 개면 예전처럼 original.<ext>, 여러 장이면 올린 순서대로 original{n}.<ext>
  const stored: { fileNo: number; file: Express.Multer.File; uri: string; shortEdgePx: number | null }[] = [];
  for (const [i, f] of files.entries()) {
    const ext = (f.originalname.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '').toLowerCase();
    const uri = await saveFile(`${requestNo}/original${files.length > 1 ? i + 1 : ''}${ext}`, f.buffer);
    const edge = verdict.pages?.find((p) => p.fileNo === i + 1)?.shortEdgePx ?? verdict.shortEdgePx;
    stored.push({ fileNo: i + 1, file: f, uri, shortEdgePx: edge });
  }
  // 사진·PDF 만 통과하므로 늘 'recognize'(PDF 는 모델 API 가 모든 쪽을 사진으로 바꿔 쪽마다 인식). 'direct' 갈래는 이제 닿지 않는다
  const isPicture = kind === 'image' || kind === 'pdf';
  const route = isPicture ? 'recognize' : 'direct';
  const requestId = await tx(async (conn) => {
    const [ins] = await conn.query(
      `INSERT INTO score_request (request_no, channel, session_id, account_id, file_kind, chosen_score_type, route, status,
                                  setting_version_id, client_addr_hash, example_id)
       VALUES (?, 'web', ?, ?, ?, ?, ?, 'received', ?, ?, ?)`,
      [requestNo, req.sessionId, req.accountId ?? null, kind, isPicture ? scoreType : null, route, s.setting_version_id, req.clientAddrHash,
       // (2026-09-30 황송해 192번) 예시로 올린 요청이면 예시 id(receiveExample 이 res.locals 에 남김)
       typeof res.locals.exampleId === 'string' ? res.locals.exampleId : null]);
    const id = (ins as { insertId: number }).insertId;
    // PDF: 전체 쪽수(모델 API 검사 값). (2026-09-29 여러 쪽) pdf_converted_page 는 더 쓰지 않는다 — 쪽 판정은 request_page(모델 API)
    const pdfPages = kind === 'pdf' && pdfPageCount ? pdfPageCount : null;
    // upload_file 은 파일마다 한 줄(file_no 1~n = 올린 순서, 2026-09-30 T187). PDF 는 한 줄
    for (const st of stored) {
      await conn.query(
        `INSERT INTO upload_file (request_id, file_no, original_name, size_bytes, image_short_side_px, pdf_page_count, storage_uri)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, st.fileNo, st.file.originalname.slice(0, 255), st.file.size, st.shortEdgePx, pdfPages, st.uri]);
    }
    await conn.query(
      "INSERT INTO stage_timing (request_id, stage_code, started_at, ended_at) VALUES (?, 'check', ?, CURRENT_TIMESTAMP(3))",
      [id, checkStart]);
    // 처음 연주 구성(FR-020, initial_default)은 여기서 적지 않는다 — 악보 성부를 알아야 실제로 놓이는 악기만
    // 적을 수 있다(타악 성부가 없으면 장구는 연주되지 않음, 2026-09-29). 직행은 아래 completeDirect 뒤, 그 밖은 결과 표시 때
    return id;
  });

  if (route === 'direct') {
    try {
      await completeDirect(requestId, requestNo, kind as 'midi' | 'musicxml', file.buffer, verdict.musicxmlText);
    } catch (e) {
      // 검사는 통과했지만 악보로 풀지 못한 파일 — 직행에는 대체가 없으므로(SD_03 §18 #8) 손상으로 알린다
      logger.warn({ err: e, requestNo }, 'direct parse failed');
      await exec('DELETE FROM instrument_selection WHERE request_id = ?', [requestId]);
      await exec('DELETE FROM stage_timing WHERE request_id = ?', [requestId]);
      await exec('DELETE FROM upload_file WHERE request_id = ?', [requestId]);
      await exec('DELETE FROM score_request WHERE request_id = ?', [requestId]);
      throw new ApiError('UPLOAD_CORRUPTED');
    }
    await recordInitialSelection(requestId).catch((e) => logger.warn({ err: e, requestNo }, 'initial selection record failed'));
  } else {
    await enqueueRecognition(requestId);
  }
  res.status(202).json(await buildRequestStatus(requestId));
});

requestsRouter.post('/requests', receiveFiles, createRequest);
requestsRouter.post('/requests/example', receiveExample, createRequest);

requestsRouter.get('/requests/:no', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req, { allowExpired: true });
  res.json(await buildRequestStatus(r.request_id));
}));

requestsRouter.post('/requests/:no/type-confirmation', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const changeTo = req.body?.change_to ?? null;
  if (changeTo !== null && !['staff', 'jeongganbo'].includes(changeTo)) throw new ApiError('BAD_REQUEST', { field: 'change_to' });
  await answerTypeQuestion(r.request_id, changeTo);
  res.status(202).json(await buildRequestStatus(r.request_id));
}));

async function currentResult(requestId: number) {
  return one<{ result_id: number; origin: string; musicxml_uri: string; midi_uri: string | null; original_ensemble_id: number | null }>(
    'SELECT result_id, origin, musicxml_uri, midi_uri, original_ensemble_id FROM v_current_result WHERE request_id = ? AND deleted_at IS NULL',
    [requestId]);
}

requestsRouter.get('/requests/:no/score', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  if (r.status !== 'completed') throw new ApiError('REQUEST_NOT_FOUND', { reason: 'not_completed', status: r.status }, null, 409);
  const cur = await currentResult(r.request_id);
  if (!cur) throw new ApiError('RESULT_EXPIRED');
  const musicxml = (await readStored(cur.musicxml_uri)).toString('utf8');
  let scoredoc: unknown;
  try {
    scoredoc = parseMusicXml(musicxml);
  } catch (e) {
    if (!cur.midi_uri) throw e; // MIDI 가 없는 결과(변환 실패, 2026-09-30)는 MusicXML 만
    scoredoc = parseMidi(new Uint8Array(await readStored(cur.midi_uri)));
  }
  const last = await one<{ outcome: string }>('SELECT outcome FROM engine_attempt WHERE request_id = ? ORDER BY page_no DESC, attempt_no DESC LIMIT 1', [r.request_id]);
  const code = fallbackCode(r.fallback_reason, last?.outcome);
  res.json({
    scoredoc, musicxml,
    has_original_instruments: cur.original_ensemble_id != null,
    fallback: r.route === 'fallback',
    fallback_reason: code,
    fallback_message: code ? errorCodes.fallback_reasons[code]?.message ?? null : null,
    retry_hint: code ? errorCodes.fallback_reasons[code]?.retry_hint ?? null : null,
  });
}));

requestsRouter.post('/requests/:no/fallback', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  if (r.status !== 'completed' || r.route !== 'recognize') {
    // 이미 대체이거나 직행이면 바꿀 것이 없다
    res.json(await buildRequestStatus(r.request_id));
    return;
  }
  const ok = await switchToUserFallback(r.request_id);
  if (!ok) throw new ApiError('INTERNAL_ERROR', { reason: 'template_unavailable' });
  res.json(await buildRequestStatus(r.request_id));
}));

requestsRouter.post('/requests/:no/events', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const col = req.body?.event === 'result_shown' ? 'result_shown_at' : req.body?.event === 'first_played' ? 'first_played_at' : null;
  if (!col) throw new ApiError('BAD_REQUEST', { field: 'event' });
  await exec(`UPDATE score_request SET ${col} = COALESCE(${col}, CURRENT_TIMESTAMP(3)) WHERE request_id = ?`, [r.request_id]);
  // 결과 표시 = 기본 국악기 구성으로 처음 연주(SD_03 1.15) — 실제로 놓이는 악기만 기록
  if (col === 'result_shown_at' && r.status === 'completed') {
    await recordInitialSelection(r.request_id).catch((e) => logger.warn({ err: e, requestNo: r.request_no }, 'initial selection record failed'));
  }
  res.status(204).end();
}));

requestsRouter.get('/requests/:no/original/:format', wrap(async (req: Request, res) => {
  const r = await loadOwnedRequest(req);
  const format = req.params.format;
  if (format !== 'musicxml' && format !== 'midi') throw new ApiError('BAD_REQUEST', { field: 'format' });
  const cur = await currentResult(r.request_id);
  if (!cur) throw new ApiError('RESULT_EXPIRED');
  // MIDI 변환에 실패한 결과는 MIDI 가 없다 — MusicXML 로 받게 안내(2026-09-30 SD_04 §8-1)
  if (format === 'midi' && !cur.midi_uri) throw new ApiError('MIDI_UNAVAILABLE');
  const data = await readStored(format === 'midi' ? cur.midi_uri! : cur.musicxml_uri);
  try {
    await exec('INSERT INTO download_event (request_id, format, result_id) VALUES (?, ?, ?)', [r.request_id, format, cur.result_id]);
  } catch (e) {
    if ((e as { sqlState?: string }).sqlState === '45000') throw new ApiError('RESULT_EXPIRED');
    throw e;
  }
  res.setHeader('Content-Type', format === 'midi' ? 'audio/midi' : 'application/vnd.recordare.musicxml+xml');
  res.setHeader('Content-Disposition', `attachment; filename="${r.request_no}.${format === 'midi' ? 'mid' : 'musicxml'}"`);
  res.send(data);
}));
