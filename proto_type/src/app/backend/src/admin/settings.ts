// 처리 설정 (tasks T098, FR-018·FR-052, UC10): 바뀐 값만 받아 이전 판본을 복사한 뒤 덮어써 새 판본을 만든다(결정 대기 Q4 임시안).
// G6: 0·음수 금지, 경계 순서, 등록·사용 중인 모델 이름만. 저장 뒤 모델 API 서버에 반영을 알리고 반영 상태를 남긴다.
import { Router } from 'express';
import { query, tx, exec } from '../db/pool.js';
import { ApiError, wrap } from '../web/errors.js';
import { currentSettings, invalidateSettings } from '../config/settings.js';
import { modelJson, ModelApiDown } from '../services/modelApiClient.js';
import { recordGate } from '../services/gateEvents.js';

export const settingsRouter = Router();

// 저장할 수 있는 컬럼과 검사 규칙
const INT_FIELDS = [
  'timeout_seconds', 'max_concurrency_recognize', 'max_concurrency_render', 'web_concurrency_share',
  'default_call_limit_per_hour', 'apply_rate_limit_count', 'apply_rate_window_minutes',
  'web_max_active_per_client', 'web_hourly_request_cap', 'score_file_max_bytes', 'recommend_timeout_ms',
  'llm_recommend_timeout_ms', 'login_max_failures', 'login_lock_minutes',
] as const;
const RATIO_FIELDS = ['structure_threshold', 'grade_caution_boundary', 'grade_distrust_boundary'] as const;
const KIND_OF: Record<string, string> = { staff: 'omr_staff', jeongganbo: 'omr_jeongganbo', recommend: 'recommend' };

type Body = Record<string, unknown>;

export async function settingsView() {
  const s = await currentSettings();
  const models = await query<{ model_name: string; kind: string; provider: string; enabled: number; display_name: string }>(
    'SELECT model_name, kind, provider, enabled, display_name FROM model_registry ORDER BY kind, model_name');
  return { ...s, models };
}

settingsRouter.get('/settings', wrap(async (_req, res) => { res.json(await settingsView()); }));

export function validateSettings(merged: Record<string, unknown>): { field: string; reason: string } | null {
  for (const f of INT_FIELDS) {
    const v = merged[f];
    if (v == null) continue;
    if (!Number.isInteger(v) || (v as number) < 1) return { field: f, reason: 'positive_integer' };
  }
  if (merged.apply_rate_window_minutes != null && (merged.apply_rate_window_minutes as number) > 10080) {
    return { field: 'apply_rate_window_minutes', reason: 'max_7_days' };
  }
  for (const f of RATIO_FIELDS) {
    const v = merged[f];
    if (v == null) continue;
    if (typeof v !== 'number' || v < 0 || v > 1) return { field: f, reason: 'between_0_and_1' };
  }
  const c = merged.grade_caution_boundary, d = merged.grade_distrust_boundary;
  if ((c == null) !== (d == null)) return { field: c == null ? 'grade_caution_boundary' : 'grade_distrust_boundary', reason: 'both_or_neither' };
  if (c != null && d != null && !((d as number) < (c as number))) return { field: 'grade_distrust_boundary', reason: 'distrust_below_caution' };
  if ((merged.web_concurrency_share as number) > (merged.max_concurrency_recognize as number)) {
    return { field: 'web_concurrency_share', reason: 'not_above_recognize' };
  }
  return null;
}

settingsRouter.put('/settings', wrap(async (req, res) => {
  const body = (req.body ?? {}) as Body;
  const prev = await currentSettings();
  const merged: Record<string, unknown> = { ...prev };
  for (const f of [...INT_FIELDS, ...RATIO_FIELDS]) if (f in body) merged[f] = body[f] === '' ? null : body[f];
  if ('fallback_enabled' in body) merged.fallback_enabled = Boolean(body.fallback_enabled);

  const fail = async (code: 'SETTINGS_INVALID_VALUE' | 'SETTINGS_UNKNOWN_ENGINE', details: Record<string, unknown>) => {
    await recordGate('G6', 'admin', 'operator', String(req.operatorId), code);
    throw new ApiError(code, details);
  };
  const invalid = validateSettings(merged);
  if (invalid) await fail('SETTINGS_INVALID_VALUE', invalid);

  // 엔진 호출 순서: 등록부에 있고 켜져 있으며 종류가 맞는 모델만(G6)
  const order = { ...prev.engine_order };
  const bodyOrder = (body.engine_order ?? {}) as Record<string, unknown>;
  const registry = await query<{ model_name: string; kind: string; provider: string; enabled: number }>(
    'SELECT model_name, kind, provider, enabled FROM model_registry');
  for (const t of ['staff', 'jeongganbo', 'recommend'] as const) {
    if (!(t in bodyOrder)) continue;
    const list = bodyOrder[t];
    if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) await fail('SETTINGS_INVALID_VALUE', { field: `engine_order.${t}`, reason: 'string_list' });
    const names = list as string[];
    if (new Set(names).size !== names.length) await fail('SETTINGS_INVALID_VALUE', { field: `engine_order.${t}`, reason: 'duplicate' });
    for (const n of names) {
      const m = registry.find((r) => r.model_name === n);
      if (!m || !m.enabled || m.kind !== KIND_OF[t]) await fail('SETTINGS_UNKNOWN_ENGINE', { field: `engine_order.${t}`, engine: n });
    }
    // 추천은 규칙표(내장)가 늘 마지막 안전판이어야 한다(FR-008)
    if (t === 'recommend') {
      const last = registry.find((r) => r.model_name === names[names.length - 1]);
      if (!last || last.provider !== 'builtin') await fail('SETTINGS_INVALID_VALUE', { field: 'engine_order.recommend', reason: 'builtin_last' });
    }
    order[t] = names;
  }

  const versionId = await tx(async (conn) => {
    const [ins] = await conn.query(
      `INSERT INTO processing_setting_version
         (created_by, timeout_seconds, max_concurrency, fallback_enabled, default_call_limit_per_hour, apply_rate_limit_count,
          apply_rate_window_minutes, structure_threshold, grade_caution_boundary, grade_distrust_boundary,
          web_max_active_per_client, web_hourly_request_cap, max_concurrency_recognize, max_concurrency_render,
          web_concurrency_share, score_file_max_bytes, recommend_timeout_ms, llm_recommend_timeout_ms,
          login_max_failures, login_lock_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.operatorId, merged.timeout_seconds, merged.max_concurrency_recognize, merged.fallback_enabled,
       merged.default_call_limit_per_hour, merged.apply_rate_limit_count, merged.apply_rate_window_minutes,
       merged.structure_threshold, merged.grade_caution_boundary, merged.grade_distrust_boundary,
       merged.web_max_active_per_client, merged.web_hourly_request_cap, merged.max_concurrency_recognize,
       merged.max_concurrency_render, merged.web_concurrency_share, merged.score_file_max_bytes, merged.recommend_timeout_ms,
       merged.llm_recommend_timeout_ms, merged.login_max_failures, merged.login_lock_minutes]);
    const id = (ins as { insertId: number }).insertId;
    for (const [t, names] of Object.entries(order)) {
      for (const [i, n] of names.entries()) {
        await conn.query('INSERT INTO setting_engine_order (setting_version_id, score_type, seq, engine_name) VALUES (?, ?, ?, ?)', [id, t, i + 1, n]);
      }
    }
    return id;
  }).catch(async (e) => {
    if ((e as { sqlState?: string }).sqlState === '23000' || (e as { code?: string }).code === 'ER_CONSTRAINT_FAILED') {
      await fail('SETTINGS_INVALID_VALUE', { reason: 'db_check', message: (e as Error).message.slice(0, 200) });
    }
    throw e;
  });
  invalidateSettings();

  // 모델 API 서버에 반영(UC10 기본흐름 5). 멈췄으면 unapplied — 웹은 이미 새 판본을 쓴다
  try {
    await modelJson('POST', '/v1/internal/settings/reload', {}, { timeoutMs: 5000 });
    await exec("UPDATE processing_setting_version SET api_apply_status = 'applied', api_applied_at = CURRENT_TIMESTAMP(3) WHERE setting_version_id = ?", [versionId]);
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    await exec("UPDATE processing_setting_version SET api_apply_status = 'unapplied' WHERE setting_version_id = ?", [versionId]);
  }
  invalidateSettings();
  res.json(await settingsView());
}));
