// #36 내려받기 — 형식마다 따로. MIDI · MusicXML 은 score-core 로 바로(model-api 없이도 된다), MP3 · PDF 는 렌더링 대기열로.
//
//   구조에서의 위치: 화면 → Nginx → web(이 파일) → 결과 악보 + 편집 연산 + 악기 지정 → 볼륨 storage/<요청 번호>/exports/ · DB derived_file · download_event.
//     MP3 · PDF 는 renderQueue.ts → model-api. 렌더링이 실패해도 화면 연주와 MIDI · MusicXML 받기는 그대로 된다.
//     저장 위치는 derived_file.storage_uri 에 남겨 주기 정리 · DB ↔ 파일 일치 확인이 DB 만 보고 지울 파일을 찾는다.
//   v0.1.1 web/exports.ts 에서 달라진 점: 파일 저장에 실패하면 ready 로 남기지 않고 failed · 파일이 사라졌으면 RESULT_EXPIRED · 번호가 숫자가 아니면 404.
import { Router, type Response } from 'express';
import { applyInstrumentMode, exportScore, toMidi, toMusicXml, type ScoreDoc } from '@gugak/score-core';
import { exec, one } from '../db/pool.js';
import { shared } from '../config/shared.js';
import { ApiError, wrap } from './errors.js';
import { loadOwnedRequest } from './ownership.js';
import { applyEditOps, loadBaseDoc, upsertEdit } from './edits.js';
import { readResult } from './requests.js';
import { saveFile } from '../services/storage.js';
import { enqueueRender, mp3Instruments, queuePosition } from '../services/renderQueue.js';

export const exportsRouter = Router();
type Format = 'mp3' | 'pdf' | 'midi' | 'musicxml';

const FILE_TYPES: Record<Format, [string, string]> = {
  mp3: ['audio/mpeg', 'mp3'], pdf: ['application/pdf', 'pdf'], midi: ['audio/midi', 'mid'],
  musicxml: ['application/vnd.recordare.musicxml+xml', 'musicxml'],
};

function sendFile(res: Response, format: Format, requestNo: string, data: Buffer): void {
  res.setHeader('Content-Type', FILE_TYPES[format][0]);
  res.setHeader('Content-Disposition', `attachment; filename="${requestNo}.${FILE_TYPES[format][1]}"`);
  res.send(data);
}

/** DB 트리거가 보관 기간이 지난 요청의 파일 · 내려받기 기록을 막는다 (G4) */
function expiredOnTrigger(e: unknown): never {
  if ((e as { sqlState?: string }).sqlState === '45000') throw new ApiError('RESULT_EXPIRED');
  throw e;
}

function fileIdOf(value: string): number {
  if (!/^\d{1,18}$/.test(value)) throw new ApiError('REQUEST_NOT_FOUND');
  return Number(value);
}

async function exportTask(fileId: number, requestNo: string) {
  const d = await one<Record<string, any>>('SELECT * FROM derived_file WHERE file_id = ?', [fileId]);
  if (!d) throw new ApiError('REQUEST_NOT_FOUND');
  const notices: string[] = [];
  if (d.format === 'mp3') {
    const lic = await one<{ web_mp3_internal_only: number }>('SELECT web_mp3_internal_only FROM v_mp3_license');
    if (lic?.web_mp3_internal_only) notices.push(shared().errorCodes.status_codes.LICENSE_UNCONFIRMED);
  }
  return {
    id: String(d.file_id), format: d.format, basis: d.basis, status: d.render_status,
    queue_position: d.render_status === 'queued' ? await queuePosition(d.file_id) : null,
    failure_reason: d.failure_reason ?? null, notices,
    download_url: d.render_status === 'ready' ? `/api/requests/${requestNo}/exports/${d.file_id}/file` : null,
    renderer: d.renderer_name ? `${d.renderer_name} ${d.renderer_version}` : null,
  };
}

interface InstrumentsOpt { mode?: string; tracks?: { part: number; instrument: string }[] }

/** 원본 + 연주 악기 구성 → 편집 전 악보(doc)와 연산까지 적용한 악보(edited) */
async function buildDoc(requestId: number, requestNo: string, ops: unknown[], opt: InstrumentsOpt | undefined) {
  const base = await loadBaseDoc(requestId, requestNo);
  if (!base) throw new ApiError('RESULT_EXPIRED');
  let doc: ScoreDoc = base.doc;
  if (opt?.mode === 'default' || opt?.mode === 'original' || opt?.mode === 'custom') {
    doc = applyInstrumentMode(doc, opt.mode, { defaultEnsemble: shared().instruments.default_ensemble as never, tracks: opt.tracks });
  }
  return { doc, edited: applyEditOps(doc, ops, 'edit_ops') };
}

exportsRouter.post('/requests/:no/exports', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  if (r.status !== 'completed') throw new ApiError('REQUEST_NOT_FOUND', { reason: 'not_completed' }, null, 409);
  const format = req.body?.format as Format;
  if (!(format in FILE_TYPES)) throw new ApiError('BAD_REQUEST', { field: 'format' });
  const ops: unknown[] = Array.isArray(req.body?.edit_ops) ? req.body.edit_ops : [];
  const { doc, edited } = await buildDoc(r.request_id, r.request_no, ops, req.body?.instruments);
  const editId = ops.length > 0 ? await upsertEdit(r.request_id, r.request_no, ops, false) : null;
  const basis = editId ? 'edited' : 'original';

  if (format === 'midi' || format === 'musicxml') {
    const out = exportScore(doc, ops as never, format);
    // 파일 이름에 file_id 가 들어가 행을 먼저 만든다. 저장에 실패하면 받을 수 없는 ready 가 남지 않게 failed 로 바꾼다
    const ins = await exec(
      `INSERT INTO derived_file (request_id, format, basis, edit_id, render_status, storage_uri)
       VALUES (?, ?, ?, ?, 'ready', 'pending')`, [r.request_id, format, basis, editId]).catch(expiredOnTrigger);
    try {
      const uri = await saveFile(`${r.request_no}/exports/${ins.insertId}.${FILE_TYPES[format][1]}`, out.data);
      await exec('UPDATE derived_file SET storage_uri = ? WHERE file_id = ?', [uri, ins.insertId]);
    } catch (e) {
      await exec("UPDATE derived_file SET render_status = 'failed', failure_reason = 'RENDER_FAILED', storage_uri = NULL WHERE file_id = ?", [ins.insertId]);
      throw e;
    }
    res.status(202).json(await exportTask(ins.insertId, r.request_no));
    return;
  }

  // MP3 = 편집 반영 MIDI + 성부별 악기, PDF = 편집 반영 MusicXML(화면 악보와 같은 내용)
  const sel = await one<{ ensemble_id: number }>('SELECT ensemble_id FROM v_current_selection WHERE request_id = ?', [r.request_id]);
  const ins = await exec(
    "INSERT INTO derived_file (request_id, format, basis, edit_id, ensemble_id, render_status) VALUES (?, ?, ?, ?, ?, 'queued')",
    [r.request_id, format, basis, editId, format === 'mp3' ? sel?.ensemble_id ?? null : null]).catch(expiredOnTrigger);
  enqueueRender({
    fileId: ins.insertId, requestNo: r.request_no, format,
    score: format === 'mp3' ? toMidi(edited) : toMusicXml(edited),
    // 고른 악기를 성부별로 넘긴다 — 안 넘기면 model-api 가 기본 구성(가야금 · 장구)으로 덮어쓴다
    instruments: format === 'mp3' ? mp3Instruments(edited) : undefined,
  });
  res.status(202).json(await exportTask(ins.insertId, r.request_no));
}));

exportsRouter.get('/requests/:no/exports/:fileId', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const fileId = fileIdOf(req.params.fileId);
  if (!(await one('SELECT file_id FROM derived_file WHERE file_id = ? AND request_id = ?', [fileId, r.request_id]))) throw new ApiError('REQUEST_NOT_FOUND');
  res.json(await exportTask(fileId, r.request_no));
}));

exportsRouter.get('/requests/:no/exports/:fileId/file', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const d = await one<{ file_id: number; format: Format; storage_uri: string | null; render_status: string }>(
    'SELECT file_id, format, storage_uri, render_status FROM derived_file WHERE file_id = ? AND request_id = ? AND deleted_at IS NULL',
    [fileIdOf(req.params.fileId), r.request_id]);
  if (!d || d.render_status !== 'ready' || !d.storage_uri) throw new ApiError('REQUEST_NOT_FOUND');
  const data = await readResult(d.storage_uri, r.request_no);
  await exec('INSERT INTO download_event (request_id, format, file_id) VALUES (?, ?, ?)', [r.request_id, d.format, d.file_id]).catch(expiredOnTrigger);
  sendFile(res, d.format, r.request_no, data);
}));

exportsRouter.get('/requests/:no/original/:format', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const format = req.params.format;
  if (format !== 'musicxml' && format !== 'midi') throw new ApiError('BAD_REQUEST', { field: 'format' });
  const cur = await one<{ result_id: number; musicxml_uri: string; midi_uri: string | null }>(
    'SELECT result_id, musicxml_uri, midi_uri FROM v_current_result WHERE request_id = ? AND deleted_at IS NULL', [r.request_id]);
  if (!cur) throw new ApiError('RESULT_EXPIRED');
  // MIDI 변환에 실패한 결과는 MIDI 가 없다 — MusicXML 로 받게 안내
  if (format === 'midi' && !cur.midi_uri) throw new ApiError('MIDI_UNAVAILABLE');
  const data = await readResult(format === 'midi' ? cur.midi_uri! : cur.musicxml_uri, r.request_no);
  await exec('INSERT INTO download_event (request_id, format, result_id) VALUES (?, ?, ?)', [r.request_id, format, cur.result_id]).catch(expiredOnTrigger);
  sendFile(res, format, r.request_no, data);
}));
