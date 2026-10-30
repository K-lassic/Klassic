// 관리자 화면이 기대하는 응답 모양 (app/docs/INTERFACES.md §5 · §7, DB 뷰 이름은 SD_03).
// 서버가 조금 다른 모양(배열 / {items}) 으로 주더라도 api.ts 의 정규화 함수가 흡수한다.

export type Channel = 'web' | 'api';
export type Route = 'recognize' | 'direct' | 'fallback';

export interface AdminMe {
  operator_id?: number;
  login_id_masked?: string;
  login_id?: string; // 가리지 않은 값이 오면 화면에서 가린다
  network?: 'internal' | string;
}

export interface MetricScope {
  image_requests: number;
  first_pass_trust: number;
  first_pass_rate: number | null;
  caution_count: number;
  fallback_rate: number | null;
  edit_usage_rate: number | null;
  max_wait_ms: number | null;
  service_down_count: number;
}

export interface Metrics {
  scopes: { all: MetricScope; web: MetricScope; api: MetricScope };
  fallback_by_reason: { channel: Channel; reason: string; count: number }[];
  missing_log_count: number;
}

/** v_request_log 한 줄 */
export interface JobRow {
  request_no: string;
  channel: Channel;
  route: Route;
  status: string;
  fallback_reason: string | null;
  file_kind: 'image' | 'pdf' | 'midi' | 'musicxml' | string;
  chosen_score_type: string | null;
  confirmed_score_type?: string | null;
  structure_verdict?: 'pass' | 'ambiguous' | 'fail' | null;
  type_mismatch?: boolean | number | null;
  type_answer?: string | null;
  validity_grade?: 'trust' | 'caution' | 'distrust' | null;
  engine_name?: string | null;
  engine_version?: string | null;
  check_ms?: number | null;
  queue_ms?: number | null;
  structure_ms?: number | null;
  recognize_ms?: number | null;
  jg_convert_ms?: number | null;
  validity_ms?: number | null;
  recommend_ms?: number | null;
  render_ms?: number | null;
  received_at: string;
  completed_at?: string | null;
}

export interface EngineAttempt {
  attempt_seq?: number;
  engine_name: string;
  engine_version?: string | null;
  outcome: string;
  failure_code?: string | null;
  duration_ms?: number | null;
}

export interface ValidityItem {
  item_code: string;
  value?: number | string | null;
  verdict?: string | null; // pass · caution · distrust …
  passed?: boolean | null;
}

export interface JobDetail extends JobRow {
  attempts?: EngineAttempt[];
  validity_items?: ValidityItem[];
  stage_timings?: { stage_code: string; duration_ms: number | null }[];
}

export interface JobList {
  items: JobRow[];
  total: number | null;
}

export interface EvaluationMetrics {
  jeongganbo_normal_rate: number | null;
  fake_passed_as_trust: number | null;
  fake_structure_filter_rate: number | null;
  real_false_block_rate: number | null;
  last_run?: { started_at?: string | null; finished_at?: string | null; status?: string | null } | null;
}

export type EngineOrderKey = 'staff' | 'jeongganbo' | 'recommend';
export type EngineOrder = Record<EngineOrderKey, string[]>;

/** 숫자 설정 칸 (processing_setting_version 컬럼 이름 그대로) */
export const NUMERIC_SETTING_KEYS = [
  'timeout_seconds',
  'max_concurrency_recognize',
  'max_concurrency_render',
  'web_concurrency_share',
  'default_call_limit_per_hour',
  'apply_rate_limit_count',
  'apply_rate_window_minutes',
  'structure_threshold',
  'grade_caution_boundary',
  'grade_distrust_boundary',
  'web_max_active_per_client',
  'web_hourly_request_cap',
  'score_file_max_bytes',
  'recommend_timeout_ms',
  'llm_recommend_timeout_ms',
  'login_max_failures',
  'login_lock_minutes',
] as const;
export type NumericSettingKey = (typeof NUMERIC_SETTING_KEYS)[number];

export type ApplyStatus = 'pending' | 'applied' | 'unapplied';

export type SettingsSnapshot = {
  setting_version_id: number | null;
  created_at?: string | null;
  api_apply_status?: ApplyStatus | null;
  api_applied_at?: string | null;
  fallback_enabled: boolean;
  engine_order: EngineOrder;
} & Record<NumericSettingKey, number | null>;

export type SettingsPatch = Partial<Record<NumericSettingKey, number | null>> & {
  fallback_enabled?: boolean;
  engine_order?: Partial<EngineOrder>;
};

export interface AuditRow {
  target_type: string;
  target_ref: string | null;
  operator_id: number | null;
  operator_masked?: string | null;
  changed_at: string;
  field_name: string;
  before_value: string | null;
  after_value: string | null;
}

export interface ModelApiStatus {
  health: null | 'unreachable' | { status?: string; api_version?: string; queue?: Record<string, number>; models_ready?: number; models_total?: number; [k: string]: unknown };
  versions: null | { api_version?: string; engines?: { name: string; version?: string | null; state?: string }[]; [k: string]: unknown };
  snapshot_id?: string | number | null;
  checked_at: string | null;
}

export type ModelKind = 'omr_staff' | 'omr_jeongganbo' | 'recommend';
export type ModelProvider = 'venv' | 'ollama' | 'builtin';
export type ModelState = 'ready' | 'cold' | 'loading' | 'failed' | 'unavailable';

export interface AdminModel {
  model_name: string;
  kind: ModelKind;
  provider: ModelProvider;
  display_name: string;
  provider_ref: string | null;
  enabled: boolean;
  in_use_by: string[]; // 예: ['staff#1']
  state: ModelState;
  loaded_at: string | null;
  expected_seconds: number | null;
  avg_load_ms: number | null;
  max_load_ms: number | null;
  last_outcome: string | null;
  last_error: string | null;
  installed: boolean;
  version: string | null;
  /** 선택 — 불러오기를 시작한 시각(있으면 경과 시간을 이것으로 계산) */
  load_started_at?: string | null;
  /** 선택 — 서버가 계산한 경과 초 */
  elapsed_seconds?: number | null;
}

export interface NewModel {
  model_name: string;
  kind: ModelKind;
  provider: 'venv' | 'ollama';
  display_name: string;
  provider_ref: string;
  config: Record<string, unknown> | null;
}

export interface OllamaAvailable {
  ollama: 'ok' | 'unreachable';
  version: string | null;
  models: { tag: string; size_gb: number | null; family?: string | null; parameter_size?: string | null; registered: boolean }[];
}

export interface KeyRow {
  key_id: number | string;
  key_kind: 'external' | 'service' | string;
  key_prefix: string;
  call_limit_per_hour: number | null;
  issued_at: string;
  status: 'active' | 'revoked' | string;
  application_no: string | null;
  application_purged: boolean | number;
}

export interface ApplicationRow {
  application_no: string;
  applicant_name_masked: string;
  affiliation: string | null;
  contact_email_masked: string;
  purpose: string | null;
  applied_at: string;
  delete_due_at: string | null;
  is_retained: boolean | number;
  key_prefix: string | null;
  key_status: string | null;
}

export interface IssuedServiceKey {
  api_key: string;
  key_prefix: string;
  key_id?: number | string;
  revoked_key_id?: number | string | null;
}

export interface LicenseState {
  confirmed: boolean;
  decided_by?: number | null;
  decided_by_masked?: string | null;
  decided_at?: string | null;
}

// ---- S7 계정·권한 (2026-09-29 RBAC 운영자 메뉴 — FR-069) ----
export interface AccountRow {
  account_id: number; login_id_masked: string; display_name: string; roles: string[];
  status: 'active' | 'locked' | 'disabled'; created_at: string; last_login_at: string | null;
  locked_until: string | null; disabled_at: string | null; failed_logins: number; requests_7d: number;
}
export interface AccountList { items: AccountRow[]; page: number; page_size: number; total: number }
export interface AccountDetail {
  account: AccountRow;
  requests: { request_no: string; status: string; route: string; received_at: string }[];
  keys: { key_prefix: string; status: string; issued_at: string }[];
  history: { changed_at: string; field_name: string; before_value: string | null; after_value: string | null; operator: string | null }[];
  events: { occurred_at: string; gate_code: string; reason_code: string }[];
}
export interface PermissionTable { table: Record<string, string[]>; public: string[]; editable: false; design_source: string; design_differs: string[] }
export interface AuthEvents {
  items: { event_id: number; occurred_at: string; gate_code: string; channel: string; subject_type: string; subject_ref: string | null; reason_code: string }[];
  summary: Record<string, number>; locked_accounts: number; hours: number;
}

/** S8 공유 악보 관리(2026-09-30 황송해, UC19) — 올린 사람 정보 없음 */
export interface SharedScoreAdminRow {
  share_no: string; title: string; score_type: 'staff' | 'jeongganbo'; shared_at: string; expires_at?: string; likes: number;
  status: 'visible' | 'taken_down' | 'unshared' | 'expired' | 'purged'; taken_down_at: string | null; take_down_reason: string | null;
}
