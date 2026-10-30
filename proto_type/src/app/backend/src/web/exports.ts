// 내려받기 (tasks T126, UC7, FR-032·FR-033·FR-035): 형식마다 따로. MIDI·MusicXML 은 score-core 로 바로(대기열·모델 API 없음),
// MP3·PDF 는 렌더링 대기열로.
import { Router } from 'express';
import { applyInstrumentMode, exportScore, toMidi, toMusicXml, applyOps, type ScoreDoc } from '@gugak/score-core';
import { exec, one } from '../db/pool.js';
import { ApiError, wrap } from './errors.js';
import { loadOwnedRequest } from './ownership.js';
import { loadBaseDoc, upsertEdit } from './edits.js';
import { saveFile, readStored } from '../services/storage.js';
import { enqueueRender, mp3Instruments, queuePosition } from '../services/renderQueue.js';
import { errorCodes, instruments } from '../config/shared.js';

export const exportsRouter = Router();
type Format = 'mp3' | 'pdf' | 'midi' | 'musicxml';

async function exportTask(fileId: number, requestNo: string) {
  const d = await one<Record<string, any>>('SELECT * FROM derived_file WHERE file_id = ?', [fileId]);
  if (!d) throw new ApiError('REQUEST_NOT_FOUND');
  const notices: string[] = [];
  if (d.format === 'mp3') {
    const lic = await one<{ web_mp3_internal_only: number }>('SELECT web_mp3_internal_only FROM v_mp3_license');
    if (lic?.web_mp3_internal_only) notices.push(errorCodes.status_codes.LICENSE_UNCONFIRMED);
  }
  return {
    id: String(d.file_id), format: d.format, basis: d.basis, status: d.render_status,
    queue_position: d.render_status === 'queued' ? await queuePosition(d.file_id) : null,
    failure_reason: d.failure_reason ?? null, notices,
    download_url: d.render_status === 'ready' ? `/api/requests/${requestNo}/exports/${d.file_id}/file` : null,
    renderer: d.renderer_name ? `${d.renderer_name} ${d.renderer_version}` : null,
  };
}

/** 원본 + 편집 연산 + 연주 악기 구성 → 내보낼 악보 */
async function buildDoc(requestId: number, ops: unknown[], instrumentsOpt: { mode?: string; tracks?: { part: number; instrument: string }[] } | undefined) {
  const base = await loadBaseDoc(requestId);
  if (!base) throw new ApiError('RESULT_EXPIRED');
  let doc: ScoreDoc = base.doc;
  const mode = instrumentsOpt?.mode;
  if (mode === 'default' || mode === 'original' || mode === 'custom') {
    doc = applyInstrumentMode(doc, mode, { defaultEnsemble: instruments.default_ensemble, tracks: instrumentsOpt?.tracks });
  }
  return { doc, edited: applyOps(doc, ops as never) };
}

exportsRouter.post('/requests/:no/exports', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  if (r.status !== 'completed') throw new ApiError('REQUEST_NOT_FOUND', { reason: 'not_completed' }, null, 409);
  const format = req.body?.format as Format;
  if (!['mp3', 'pdf', 'midi', 'musicxml'].includes(format)) throw new ApiError('BAD_REQUEST', { field: 'format' });
  const ops = Array.isArray(req.body?.edit_ops) ? req.body.edit_ops : [];
  const editId = ops.length > 0 ? await upsertEdit(r.request_id, ops, false) : null;
  const basis = editId ? 'edited' : 'original';
  const sel = await one<{ ensemble_id: number }>('SELECT ensemble_id FROM v_current_selection WHERE request_id = ?', [r.request_id]);
  const { doc, edited } = await buildDoc(r.request_id, ops, req.body?.instruments);

  if (format === 'midi' || format === 'musicxml') {
    const out = exportScore(doc, ops as never, format);
    const ins = await exec(
      `INSERT INTO derived_file (request_id, format, basis, edit_id, render_status, storage_uri)
       VALUES (?, ?, ?, ?, 'ready', 'pending')`, [r.request_id, format, basis, editId]).catch((e) => {
      if ((e as { sqlState?: string }).sqlState === '45000') throw new ApiError('RESULT_EXPIRED');
      throw e;
    });
    const uri = await saveFile(`${r.request_no}/exports/${ins.insertId}.${format === 'midi' ? 'mid' : 'musicxml'}`, out.data);
    await exec('UPDATE derived_file SET storage_uri = ? WHERE file_id = ?', [uri, ins.insertId]);
    res.status(202).json(await exportTask(ins.insertId, r.request_no));
    return;
  }

  // MP3 = 편집 반영 MIDI(+ 성부별 악기 지정 — 음원은 기본 음원 gugak.sf2 · FluidR3_GM.sf2 만), PDF = 편집 반영 MusicXML(화면 악보와 같은 내용)
  const ins = await exec(
    `INSERT INTO derived_file (request_id, format, basis, edit_id, ensemble_id, render_status) VALUES (?, ?, ?, ?, ?, 'queued')`,
    [r.request_id, format, basis, editId, format === 'mp3' ? sel?.ensemble_id ?? null : null]).catch((e) => {
    if ((e as { sqlState?: string }).sqlState === '45000') throw new ApiError('RESULT_EXPIRED');
    throw e;
  });
  enqueueRender({
    fileId: ins.insertId, requestId: r.request_id, requestNo: r.request_no, format,
    score: format === 'mp3' ? toMidi(edited) : toMusicXml(edited),
    // 화면에서 고른 악기를 성부별로 넘긴다 — 안 넘기면 모델 API 가 기본 구성(가야금·장구)으로 덮어쓴다
    instruments: format === 'mp3' ? mp3Instruments(edited, instruments) : undefined,
  });
  res.status(202).json(await exportTask(ins.insertId, r.request_no));
}));

exportsRouter.get('/requests/:no/exports/:fileId', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const d = await one('SELECT file_id FROM derived_file WHERE file_id = ? AND request_id = ?', [req.params.fileId, r.request_id]);
  if (!d) throw new ApiError('REQUEST_NOT_FOUND');
  res.json(await exportTask(Number(req.params.fileId), r.request_no));
}));

exportsRouter.get('/requests/:no/exports/:fileId/file', wrap(async (req, res) => {
  const r = await loadOwnedRequest(req);
  const d = await one<{ file_id: number; format: Format; storage_uri: string | null; render_status: string }>(
    'SELECT file_id, format, storage_uri, render_status FROM derived_file WHERE file_id = ? AND request_id = ? AND deleted_at IS NULL',
    [req.params.fileId, r.request_id]);
  if (!d || d.render_status !== 'ready' || !d.storage_uri) throw new ApiError('REQUEST_NOT_FOUND');
  const data = await readStored(d.storage_uri);
  await exec('INSERT INTO download_event (request_id, format, file_id) VALUES (?, ?, ?)', [r.request_id, d.format, d.file_id]).catch((e) => {
    if ((e as { sqlState?: string }).sqlState === '45000') throw new ApiError('RESULT_EXPIRED');
    throw e;
  });
  const types: Record<Format, [string, string]> = {
    mp3: ['audio/mpeg', 'mp3'], pdf: ['application/pdf', 'pdf'], midi: ['audio/midi', 'mid'],
    musicxml: ['application/vnd.recordare.musicxml+xml', 'musicxml'],
  };
  res.setHeader('Content-Type', types[d.format][0]);
  res.setHeader('Content-Disposition', `attachment; filename="${r.request_no}.${types[d.format][1]}"`);
  res.send(data);
}));
