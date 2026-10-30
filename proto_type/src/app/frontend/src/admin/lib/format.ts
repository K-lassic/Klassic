// 화면 문구·값 표시 (쉬운 말). 상태는 늘 글자 + 기호가 있는 칩으로 보인다(SD_02 §13-1).

export type ChipClass = 's-done' | 's-progress' | 's-waiting' | 's-caution' | 's-fallback' | 's-rejected' | 's-expired' | '';

/** 대체 이유 — 응답은 대문자 코드, 혹시 DB 소문자가 오면 바꿔 읽는다 */
const REASON_LABEL: Record<string, string> = {
  RECOGNITION_FAILED: '인식 실패',
  TIMEOUT: '시간 초과',
  ENGINE_DOWN: '엔진 중단',
  NO_NOTES: '음표를 찾지 못함',
  NO_SCORE_STRUCTURE: '악보 구조를 찾지 못함',
  UNTRUSTED_RESULT: '인식 결과를 믿기 어려움',
  USER_REQUEST: '사용자 요청',
};
const DB_REASON: Record<string, string> = {
  recognition_failed: 'RECOGNITION_FAILED',
  timeout: 'TIMEOUT',
  engine_stopped: 'ENGINE_DOWN',
  user_request: 'USER_REQUEST',
  no_structure: 'NO_SCORE_STRUCTURE',
  distrust: 'UNTRUSTED_RESULT',
};
export const FALLBACK_REASON_CODES = Object.keys(REASON_LABEL);
export function reasonCode(r: string | null | undefined): string | null {
  if (!r) return null;
  return DB_REASON[r] ?? r.toUpperCase();
}
export function reasonLabel(r: string | null | undefined): string {
  const c = reasonCode(r);
  return c ? (REASON_LABEL[c] ?? c) : '—';
}

export const CHANNEL_LABEL: Record<string, string> = { web: '웹', api: 'API' };
export const ROUTE_LABEL: Record<string, string> = { recognize: '인식 변환', direct: '직행', fallback: '대체' };
export const FILE_KIND_LABEL: Record<string, string> = { image: '이미지', pdf: 'PDF', midi: 'MIDI', musicxml: 'MusicXML' };
export const SCORE_TYPE_LABEL: Record<string, string> = { staff: '오선보', jeongganbo: '정간보' };
export const GRADE_LABEL: Record<string, string> = { trust: '신뢰', caution: '주의', distrust: '불신' };
export const VERDICT_LABEL: Record<string, string> = { pass: '통과', ambiguous: '애매', fail: '불통과' };
export const STAGE_LABEL: Record<string, string> = {
  check: '파일 검사', queue: '대기', structure: '구조 확인', recognize: '인식', jg_convert: '정간보 변환',
  validity: '타당성 점검', recommend: '추천', render: '파일 만들기',
};
export const VALIDITY_ITEM_LABEL: Record<string, string> = {
  note_count: '음표 수', beat_sum: '박 합계', range_leap: '음역·도약', yulmyeong_ratio: '율명 비율', engine_confidence: '엔진 확신도',
};

/** 요청 한 줄의 상태 칩 — 완료(신뢰)/주의/대체/직행/서비스 중단/만료/진행 */
export function jobChip(row: { status: string; route: string; validity_grade?: string | null }): { cls: ChipClass; text: string } {
  if (row.status === 'expired') return { cls: 's-expired', text: '만료' };
  if (row.status === 'service_down') return { cls: 's-rejected', text: '서비스 중단' };
  if (row.route === 'fallback') return { cls: 's-fallback', text: '대체' };
  if (row.status === 'completed') {
    if (row.route === 'direct') return { cls: 's-done', text: '완료 · 직행' };
    if (row.validity_grade === 'caution') return { cls: 's-caution', text: '주의' };
    return { cls: 's-done', text: '완료 · 신뢰' };
  }
  if (row.status === 'received' || row.status === 'queued') return { cls: 's-waiting', text: row.status === 'queued' ? '대기' : '접수' };
  if (row.status === 'awaiting_type_answer') return { cls: 's-waiting', text: '종류 확인' };
  return { cls: 's-progress', text: row.status === 'rendering' ? '만드는 중' : '변환 중' };
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const n = v <= 1 ? v * 100 : v; // 0~1 비율과 0~100 퍼센트 모두 받는다
  return `${Math.round(n)}%`;
}
export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v < 1000) return `${Math.round(v)}ms`;
  return `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}초`;
}
export function secondsFromMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Math.round(v / 1000)}초`;
}
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function num(v: number | null | undefined, unit = ''): string {
  if (v === null || v === undefined) return '—';
  return `${v.toLocaleString('ko-KR')}${unit}`;
}

/** C7 "운영자 kim**" — 서버가 가린 값을 주지 않으면 앞 3글자 + ** */
export function maskLoginId(me: { login_id_masked?: string; login_id?: string } | null): string {
  if (!me) return '';
  if (me.login_id_masked) return me.login_id_masked;
  if (me.login_id) return `${me.login_id.slice(0, 3)}**`;
  return '운영자';
}

export const KIND_LABEL: Record<string, string> = { omr_staff: '오선보 인식', omr_jeongganbo: '정간보 인식', recommend: '추천' };
export const PROVIDER_LABEL: Record<string, string> = { venv: '가상환경', ollama: 'Ollama', builtin: '내장' };
export const ORDER_LABEL: Record<string, string> = { staff: '오선보', jeongganbo: '정간보', recommend: '추천' };

/** 'staff#1' → '오선보 순서 1번째' */
export function inUseLabel(tag: string): string {
  const [key, pos] = tag.split('#');
  return `${ORDER_LABEL[key] ?? key} 순서 ${pos ?? '?'}번째`;
}

export const AUDIT_TARGET_LABEL: Record<string, string> = {
  setting: '설정', access_key: '접근 키', key_application: '키 신청', license_policy: '라이선스', model: '모델',
};
export const AUDIT_FIELD_LABEL: Record<string, string> = {
  staff_engine_order: '오선보 엔진 순서', jeongganbo_engine_order: '정간보 엔진 순서', recommend_engine_order: '추천 모델 순서',
  timeout_seconds: '처리 시간 제한(초)', max_concurrency_recognize: '인식 동시 처리 상한', max_concurrency_render: '파일 만들기 동시 처리 상한',
  web_concurrency_share: '인식 상한 중 웹 몫', fallback_enabled: '대체 경로 사용', default_call_limit_per_hour: '새 키 기본 호출 한도(시간당)',
  apply_rate_limit_count: '신청 빈도 제한(건수)', apply_rate_window_minutes: '신청 빈도 제한(분)', structure_threshold: '구조 확인 기준값',
  grade_caution_boundary: '주의 경계', grade_distrust_boundary: '불신 경계', web_max_active_per_client: '웹 사용자 동시 요청 수',
  web_hourly_request_cap: '웹 사용자 시간당 접수 상한', score_file_max_bytes: 'MIDI·MusicXML 용량 상한(바이트)',
  recommend_timeout_ms: '추천 제한 시간(ms)', llm_recommend_timeout_ms: 'AI 추천 제한 시간(ms)',
  login_max_failures: '로그인 실패 허용 횟수', login_lock_minutes: '로그인 잠금 시간(분)',
  issued: '발급', status: '상태', call_limit_per_hour: '호출 한도(시간당)', retained: '보관 처리', confirmed: '라이선스 확인',
  registered: '등록', enabled: '켜기/끄기', provider_ref: '연결 정보', config: '어댑터 설정', load: '불러오기', unregistered: '등록 해제',
};
