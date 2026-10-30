// S6 설정 탭 — 칸 정의와 G6 운영 값 검증(화면에서 먼저 막고, 서버 422 도 같은 칸에 붙인다).
// 범위 근거: db/migrations 001·002·003 의 chk_g6_* 제약.
import type { EngineOrder, EngineOrderKey, NumericSettingKey, SettingsPatch, SettingsSnapshot } from '../types';

export interface FieldDef {
  key: NumericSettingKey;
  label: string;
  unit?: string;
  type: 'int' | 'ratio';
  min?: number;
  max?: number;
  hint?: string;
}

export interface FieldGroup {
  title: string;
  fields: FieldDef[];
}

export const SETTING_GROUPS: FieldGroup[] = [
  {
    title: '처리',
    fields: [
      { key: 'timeout_seconds', label: '처리 시간 제한', unit: '초', type: 'int', min: 1, hint: '넘으면 대체 결과를 드립니다(결과 보장).' },
      { key: 'max_concurrency_recognize', label: '인식 동시 처리 상한', unit: '건', type: 'int', min: 1 },
      { key: 'web_concurrency_share', label: '인식 상한 중 웹 몫', unit: '건', type: 'int', min: 1, hint: '인식 동시 처리 상한보다 클 수 없습니다.' },
      { key: 'max_concurrency_render', label: '파일 만들기(MP3·PDF) 동시 처리 상한', unit: '건', type: 'int', min: 1 },
    ],
  },
  {
    title: '판정 기준',
    fields: [
      { key: 'structure_threshold', label: '구조 확인 기준값', type: 'ratio', min: 0, max: 1, hint: '0~1. 비워 두면 미정입니다.' },
      { key: 'grade_caution_boundary', label: '타당성: 주의 경계', type: 'ratio', min: 0, max: 1, hint: '이 값 미만이면 주의. 불신 경계보다 커야 합니다.' },
      { key: 'grade_distrust_boundary', label: '타당성: 불신 경계', type: 'ratio', min: 0, max: 1, hint: '이 값 미만이면 불신. 두 경계는 함께 정하거나 함께 비웁니다.' },
    ],
  },
  {
    title: '웹 사용자 한도 (FR-062)',
    fields: [
      { key: 'web_max_active_per_client', label: '처리 중·대기 중 요청 수', unit: '건', type: 'int', min: 1 },
      { key: 'web_hourly_request_cap', label: '시간당 접수 상한', unit: '건', type: 'int', min: 1 },
      { key: 'score_file_max_bytes', label: 'MIDI·MusicXML 용량 상한', unit: '바이트', type: 'int', min: 1, hint: '5MB = 5242880' },
    ],
  },
  {
    title: 'API 키',
    fields: [
      { key: 'default_call_limit_per_hour', label: '새 키 기본 호출 한도', unit: '회/시간', type: 'int', min: 1 },
      { key: 'apply_rate_limit_count', label: '신청 빈도 제한: 허용 건수', unit: '건', type: 'int', min: 1 },
      { key: 'apply_rate_window_minutes', label: '신청 빈도 제한: 기간', unit: '분', type: 'int', min: 1, max: 10080, hint: '신청 내용은 7일 뒤 지워져서 7일(10080분)이 최대입니다.' },
    ],
  },
  {
    title: '추천',
    fields: [
      { key: 'recommend_timeout_ms', label: '추천 제한 시간', unit: 'ms', type: 'int', min: 1 },
      { key: 'llm_recommend_timeout_ms', label: 'AI(LLM) 추천 제한 시간', unit: 'ms', type: 'int', min: 1, hint: '공유 Ollama 서버에서 줄을 설 수 있어 따로 둡니다.' },
    ],
  },
  {
    title: '관리자 로그인 잠금',
    fields: [
      { key: 'login_max_failures', label: '실패 허용 횟수', unit: '회', type: 'int', min: 1 },
      { key: 'login_lock_minutes', label: '잠금 시간', unit: '분', type: 'int', min: 1 },
    ],
  },
];

export const ALL_FIELDS: FieldDef[] = SETTING_GROUPS.flatMap((g) => g.fields);
export const FIELD_BY_KEY = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f])) as Record<NumericSettingKey, FieldDef>;

export const ORDER_KEYS: EngineOrderKey[] = ['staff', 'jeongganbo', 'recommend'];
export const ORDER_KIND: Record<EngineOrderKey, 'omr_staff' | 'omr_jeongganbo' | 'recommend'> = {
  staff: 'omr_staff', jeongganbo: 'omr_jeongganbo', recommend: 'recommend',
};

export interface SettingsForm {
  values: Record<NumericSettingKey, string>;
  fallback_enabled: boolean;
  engine_order: EngineOrder;
}

export function formFromSnapshot(s: SettingsSnapshot): SettingsForm {
  const values = {} as Record<NumericSettingKey, string>;
  for (const f of ALL_FIELDS) {
    const v = s[f.key];
    values[f.key] = v === null || v === undefined ? '' : String(v);
  }
  return {
    values,
    fallback_enabled: s.fallback_enabled,
    engine_order: { staff: [...s.engine_order.staff], jeongganbo: [...s.engine_order.jeongganbo], recommend: [...s.engine_order.recommend] },
  };
}

/** 문자열 → 숫자. 빈칸은 null, 숫자가 아니면 NaN */
export function parseValue(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  return Number(t);
}

export type SettingsErrors = Partial<Record<string, string>>;

/**
 * G6 운영 값 검증. 키 = 칸 이름(숫자 칸) 또는 'engine_order.staff' 같은 순서 칸.
 * @param allowedEngines 순서마다 넣을 수 있는(등록·켜짐) 모델 이름. 모르면 생략 — 서버가 SETTINGS_UNKNOWN_ENGINE 으로 막는다.
 */
export function validateSettings(
  form: SettingsForm,
  original: SettingsSnapshot | null,
  allowedEngines?: Partial<Record<EngineOrderKey, string[]>>,
): SettingsErrors {
  const e: SettingsErrors = {};
  const val: Partial<Record<NumericSettingKey, number | null>> = {};

  for (const f of ALL_FIELDS) {
    const raw = form.values[f.key] ?? '';
    const v = parseValue(raw);
    val[f.key] = v;
    if (v === null) {
      if (original && original[f.key] !== null && original[f.key] !== undefined) e[f.key] = '비워 둘 수 없습니다. 값을 넣어 주십시오.';
      continue;
    }
    if (Number.isNaN(v)) { e[f.key] = '숫자만 넣어 주십시오.'; continue; }
    if (f.type === 'int') {
      if (!Number.isInteger(v)) { e[f.key] = '소수가 아닌 정수로 넣어 주십시오.'; continue; }
      if (v < (f.min ?? 1)) { e[f.key] = `${f.min ?? 1} 이상이어야 합니다 (${v}은(는) 쓸 수 없습니다).`; continue; }
      if (f.max !== undefined && v > f.max) { e[f.key] = `${f.max} 이하여야 합니다.`; continue; }
    } else if (v < (f.min ?? 0) || v > (f.max ?? 1)) {
      e[f.key] = `${f.min ?? 0}~${f.max ?? 1} 사이 값이어야 합니다.`;
    }
  }

  // 웹 몫 ≤ 인식 상한
  const share = val.web_concurrency_share, rec = val.max_concurrency_recognize;
  if (!e.web_concurrency_share && !e.max_concurrency_recognize && typeof share === 'number' && typeof rec === 'number' && share > rec) {
    e.web_concurrency_share = `인식 동시 처리 상한(${rec})보다 클 수 없습니다.`;
  }

  // 등급 경계: 둘 다 있거나 둘 다 없음, 주의 > 불신
  const c = val.grade_caution_boundary, d = val.grade_distrust_boundary;
  if (!e.grade_caution_boundary && !e.grade_distrust_boundary) {
    if ((c === null) !== (d === null)) {
      e[c === null ? 'grade_caution_boundary' : 'grade_distrust_boundary'] = '주의·불신 경계는 함께 정하거나 함께 비워 주십시오.';
    } else if (typeof c === 'number' && typeof d === 'number' && !(c > d)) {
      e.grade_caution_boundary = `주의 경계(${c})는 불신 경계(${d})보다 커야 합니다.`;
    }
  }

  // 엔진 순서
  for (const k of ORDER_KEYS) {
    const list = form.engine_order[k];
    const field = `engine_order.${k}`;
    if (k !== 'recommend' && list.length === 0) { e[field] = '엔진을 하나 이상 넣어 주십시오.'; continue; }
    if (new Set(list).size !== list.length) { e[field] = '같은 모델을 두 번 넣을 수 없습니다.'; continue; }
    const allowed = allowedEngines?.[k];
    if (allowed) {
      const bad = list.filter((n) => !allowed.includes(n));
      if (bad.length) e[field] = `등록되지 않았거나 꺼진 모델입니다: ${bad.join(', ')}`;
    }
  }
  return e;
}

/** 바뀐 값만 (PUT /admin/settings 는 바뀐 값만 받는다 — Q4) */
export function diffSettings(form: SettingsForm, original: SettingsSnapshot): SettingsPatch {
  const patch: SettingsPatch = {};
  for (const f of ALL_FIELDS) {
    const v = parseValue(form.values[f.key] ?? '');
    const o = original[f.key] ?? null;
    if (v !== o && !(v !== null && o !== null && Number(o) === v)) (patch as Record<string, unknown>)[f.key] = v;
  }
  if (form.fallback_enabled !== original.fallback_enabled) patch.fallback_enabled = form.fallback_enabled;
  const orders: Partial<EngineOrder> = {};
  for (const k of ORDER_KEYS) {
    if (form.engine_order[k].join('>') !== original.engine_order[k].join('>')) orders[k] = [...form.engine_order[k]];
  }
  if (Object.keys(orders).length) patch.engine_order = orders;
  return patch;
}

/** 서버 422 details.field → 화면 칸 이름 ('staff_engine_order' 나 'engine_order' 도 받아 준다) */
export function fieldFromServer(field: unknown, engineKey?: unknown): string | null {
  if (typeof field !== 'string' || !field) {
    return typeof engineKey === 'string' && ORDER_KEYS.includes(engineKey as EngineOrderKey) ? `engine_order.${engineKey}` : null;
  }
  const m = /^(staff|jeongganbo|recommend)_engine_order$/.exec(field);
  if (m) return `engine_order.${m[1]}`;
  if (field === 'engine_order' && typeof engineKey === 'string') return `engine_order.${engineKey}`;
  if (field.startsWith('engine_order[')) return `engine_order.${field.slice(13, -1)}`;
  return field;
}

export function fieldLabel(field: string): string {
  if (field.startsWith('engine_order.')) {
    const k = field.slice(13);
    return `${k === 'staff' ? '오선보' : k === 'jeongganbo' ? '정간보' : '추천'} ${k === 'recommend' ? '모델' : '엔진'} 순서`;
  }
  return FIELD_BY_KEY[field as NumericSettingKey]?.label ?? field;
}

/** 칸의 DOM id */
export function fieldId(field: string): string {
  return `set-${field.replace(/\./g, '-')}`;
}
