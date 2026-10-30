// 처리 설정 캐시 (tasks T025): v_current_setting + setting_engine_order. 새 요청마다 판본 번호를 찍는다(BR-OPS-02).
import { query, one } from '../db/pool.js';

export interface Settings {
  setting_version_id: number;
  timeout_seconds: number;
  fallback_enabled: boolean;
  max_concurrency_recognize: number;
  max_concurrency_render: number;
  web_concurrency_share: number;
  default_call_limit_per_hour: number | null;
  apply_rate_limit_count: number | null;
  apply_rate_window_minutes: number | null;
  structure_threshold: number | null;
  grade_caution_boundary: number | null;
  grade_distrust_boundary: number | null;
  web_max_active_per_client: number | null;
  web_hourly_request_cap: number | null;
  score_file_max_bytes: number | null;
  recommend_timeout_ms: number | null;
  llm_recommend_timeout_ms: number | null;
  login_max_failures: number | null;
  login_lock_minutes: number | null;
  api_apply_status: string;
  created_at: Date;
  created_by: number;
  engine_order: { staff: string[]; jeongganbo: string[]; recommend: string[] };
}

// 값이 비어 있을 때 쓰는 기본값 — research R17 임시값과 같다(V-2: 빈 판본이 게이트를 끄지 않게)
const FALLBACKS = {
  timeout_seconds: 180, max_concurrency_recognize: 2, max_concurrency_render: 2, web_concurrency_share: 1,
  login_max_failures: 5, login_lock_minutes: 10, score_file_max_bytes: 5 * 1024 * 1024, recommend_timeout_ms: 3000,
};

let cache: { at: number; value: Settings } | null = null;
const TTL_MS = 5000;

export function invalidateSettings(): void {
  cache = null;
}

export async function currentSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const s = await one<Record<string, unknown>>('SELECT * FROM v_current_setting');
  if (!s) throw new Error('처리 설정 판본이 없습니다 — db/seeds/001_initial.sql 을 적용하세요');
  const orders = await query<{ score_type: string; engine_name: string }>(
    'SELECT score_type, engine_name FROM setting_engine_order WHERE setting_version_id = ? ORDER BY score_type, seq',
    [s.setting_version_id],
  );
  const engine_order = { staff: [] as string[], jeongganbo: [] as string[], recommend: [] as string[] };
  for (const o of orders) (engine_order as Record<string, string[]>)[o.score_type]?.push(o.engine_name);
  const num = (k: keyof typeof FALLBACKS) => (s[k] == null ? FALLBACKS[k] : Number(s[k]));
  const nn = (k: string) => (s[k] == null ? null : Number(s[k]));
  const value: Settings = {
    setting_version_id: Number(s.setting_version_id),
    timeout_seconds: num('timeout_seconds'),
    fallback_enabled: Boolean(s.fallback_enabled),
    max_concurrency_recognize: num('max_concurrency_recognize'),
    max_concurrency_render: num('max_concurrency_render'),
    web_concurrency_share: num('web_concurrency_share'),
    default_call_limit_per_hour: nn('default_call_limit_per_hour'),
    apply_rate_limit_count: nn('apply_rate_limit_count'),
    apply_rate_window_minutes: nn('apply_rate_window_minutes'),
    structure_threshold: nn('structure_threshold'),
    grade_caution_boundary: nn('grade_caution_boundary'),
    grade_distrust_boundary: nn('grade_distrust_boundary'),
    web_max_active_per_client: nn('web_max_active_per_client'),
    web_hourly_request_cap: nn('web_hourly_request_cap'),
    score_file_max_bytes: num('score_file_max_bytes'),
    recommend_timeout_ms: num('recommend_timeout_ms'),
    llm_recommend_timeout_ms: nn('llm_recommend_timeout_ms'),
    login_max_failures: num('login_max_failures'),
    login_lock_minutes: num('login_lock_minutes'),
    api_apply_status: String(s.api_apply_status),
    created_at: s.created_at as Date,
    created_by: Number(s.created_by),
    engine_order,
  };
  cache = { at: Date.now(), value };
  return value;
}

/** 설정 판본 하나(접수 당시 값)의 처리 시간 제한 */
export async function timeoutForVersion(settingVersionId: number): Promise<number> {
  const row = await one<{ timeout_seconds: number | null }>(
    'SELECT timeout_seconds FROM processing_setting_version WHERE setting_version_id = ?', [settingVersionId]);
  return row?.timeout_seconds ?? FALLBACKS.timeout_seconds;
}
