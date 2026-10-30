// 지표 (tasks T094, FR-036, SC-007~011): 전체·웹·API 별 5개 지표, 대체 이유별, 기록 빠진 요청
import { Router } from 'express';
import { query, one } from '../db/pool.js';
import { wrap } from '../web/errors.js';

export const metricsRouter = Router();

metricsRouter.get('/metrics', wrap(async (_req, res) => {
  const rows = await query<Record<string, any>>('SELECT * FROM v_metric_by_channel');
  const empty = { image_requests: 0, first_pass_trust: 0, first_pass_rate: null, caution_count: 0, fallback_rate: null, edit_usage_rate: null, max_wait_ms: null, service_down_count: 0 };
  const scopes: Record<string, unknown> = { all: { ...empty }, web: { ...empty }, api: { ...empty } };
  for (const r of rows) {
    scopes[r.scope] = {
      image_requests: Number(r.image_requests ?? 0), first_pass_trust: Number(r.first_pass_trust ?? 0),
      first_pass_rate: r.first_pass_rate == null ? null : Number(r.first_pass_rate), caution_count: Number(r.caution_count ?? 0),
      fallback_rate: r.fallback_rate == null ? null : Number(r.fallback_rate),
      edit_usage_rate: r.edit_usage_rate == null ? null : Number(r.edit_usage_rate),
      max_wait_ms: r.max_wait_ms == null ? null : Number(r.max_wait_ms), service_down_count: Number(r.service_down_count ?? 0),
    };
  }
  const byReason = await query<{ channel: string; fallback_reason: string; cnt: number }>('SELECT * FROM v_fallback_by_reason');
  const missing = await one<{ n: number }>('SELECT COUNT(*) AS n FROM v_missing_log');
  res.json({
    scopes,
    fallback_by_reason: byReason.map((r) => ({ channel: r.channel, reason: r.fallback_reason, count: Number(r.cnt) })),
    missing_log_count: Number(missing?.n ?? 0),
  });
}));
