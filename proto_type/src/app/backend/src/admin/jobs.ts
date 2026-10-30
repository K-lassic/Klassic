// 요청 기록 (tasks T095, FR-034): 목록과 상세(엔진 시도·점검 항목·단계 시간)
import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { ApiError, wrap } from '../web/errors.js';
import { errorCodes } from '../config/shared.js';
import { sharedAdminRouter } from './shared.js';

function fallbackDbReason(code: string): string | null {
  const lower = code.toLowerCase();
  if (['recognition_failed', 'timeout', 'engine_stopped', 'user_request', 'no_structure', 'distrust'].includes(lower)) return lower;
  return errorCodes.fallback_reasons[code.toUpperCase()]?.db ?? null;
}

export const jobsRouter = Router();
// 공유 악보 관리 S8(2026-09-30 황송해, UC19) — server.ts 를 건드리지 않으려고 관리자 라우터에 붙인다(requireOperator 뒤)
jobsRouter.use(sharedAdminRouter);

jobsRouter.get('/jobs', wrap(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const where: string[] = [];
  const params: unknown[] = [];
  if (req.query.channel === 'web' || req.query.channel === 'api') { where.push('l.channel = ?'); params.push(req.query.channel); }
  if (['recognize', 'direct', 'fallback'].includes(String(req.query.route))) { where.push('l.route = ?'); params.push(req.query.route); }
  // 대체 이유(화면은 대문자 코드) · 기록이 빠진 요청(SC-004)
  if (typeof req.query.reason === 'string' && req.query.reason) {
    const db = fallbackDbReason(req.query.reason);
    if (db) { where.push('l.fallback_reason = ?'); params.push(db); }
  }
  if (req.query.missing === '1') where.push('l.request_id IN (SELECT request_id FROM v_missing_log)');
  const sql = `SELECT l.*, s.stage_label FROM v_request_log l JOIN v_request_stage_label s ON s.request_id = l.request_id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.request_id DESC LIMIT ? OFFSET ?`;
  const rows = await query(sql, [...params, limit, offset]);
  const total = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM v_request_log l ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params);
  res.json({ total: Number(total?.n ?? 0), items: rows });
}));

jobsRouter.get('/jobs/:no', wrap(async (req, res) => {
  const log = await one<Record<string, any>>('SELECT * FROM v_request_log WHERE request_no = ?', [req.params.no]);
  if (!log) throw new ApiError('REQUEST_NOT_FOUND');
  const id = log.request_id;
  const [attempts, items, stages, recs, files] = await Promise.all([
    query('SELECT attempt_no, attempt_no AS attempt_seq, engine_name, engine_version, outcome, failure_code, started_at, ended_at, duration_ms FROM engine_attempt WHERE request_id = ? ORDER BY attempt_no', [id]),
    query('SELECT item_code, measured_value, measured_value AS value FROM validity_check_item WHERE request_id = ?', [id]),
    query('SELECT stage_code, started_at, ended_at, duration_ms FROM stage_timing WHERE request_id = ? ORDER BY started_at', [id]),
    query('SELECT recommendation_id, outcome, model_name, model_version, duration_ms, feature_tempo, feature_mode FROM recommendation WHERE request_id = ? ORDER BY recommendation_id', [id]),
    query('SELECT file_id, format, basis, render_status, renderer_name, renderer_version, failure_reason, render_ms FROM derived_file WHERE request_id = ? ORDER BY file_id', [id]),
  ]);
  const edit = await one('SELECT * FROM v_edit_record WHERE request_id = ?', [id]);
  res.json({ ...log, attempts, validity_items: items, stages, stage_timings: stages, recommendations: recs, derived_files: files, edit_record: edit });
}));
