// 웹 서비스 API 응답 모양 — app/docs/INTERFACES.md §4 (구속력 있음)
import type { ScoreDoc } from './score';

export type FileKind = 'image' | 'pdf' | 'midi' | 'musicxml';
export type ScoreType = 'staff' | 'jeongganbo';
export type RequestState =
  | 'received' | 'queued' | 'converting' | 'awaiting_type_answer' | 'completed' | 'service_down' | 'expired';
export type Route = 'recognize' | 'direct' | 'fallback';
export type ResultBand = 'trust' | 'caution' | 'fallback' | 'direct';

export interface ModelWait {
  model: string;
  display_name: string;
  state: 'cold' | 'loading';
  expected_seconds: number | null;
  elapsed_seconds: number | null;
}

export interface RequestStatus {
  id: string;
  file_kind: FileKind;
  score_type: ScoreType | null;
  status: RequestState;
  status_label: string;
  queue_position: number | null;
  route: Route;
  result_band: ResultBand | null;
  fallback: boolean;
  fallback_reason: string | null;
  fallback_message: string | null;
  retry_hint: string | null;
  type_mismatch: boolean;
  detected_type: ScoreType | null;
  validity_grade: 'trust' | 'caution' | 'distrust' | null;
  engine: { name: string; version: string } | null;
  received_at: string;
  expires_at: string;
  remaining_seconds: number;
  deadline_at: string;
  model_wait: ModelWait | null;
  has_original_instruments: boolean;
  /** PDF 면 전체 쪽수(2026-09-29 사진·PDF 입력) */
  pdf_page_count?: number | null;
  /** 지금 결과에 원본 MIDI 가 있는가(2026-09-30 황송해 74번). 결과 전이면 null, 옛 서버면 없음 */
  midi_available?: boolean | null;
  /** 공유 악보로 작업하기로 만든 요청(2026-09-30 황송해 109번) */
  from_shared?: boolean;
  /** 타당성 점검 항목 값(2026-09-30 130번) — 1단계 판별 사유 문장용 */
  validity_items?: { note_count?: number; beat_sum?: number; range_leap?: number; yulmyeong_ratio?: number; engine_confidence?: number } | null;
  /** 2026-09-29 여러 쪽: 쪽 수(PDF 쪽수 또는 사진 장수)와 쪽별 상태(request_page) */
  page_count?: number;
  pages?: PageStatus[];
  /** 일부 쪽만 못 읽었으면 "N쪽 중 M쪽 변환했어요 (못 읽은 쪽: 3·7쪽)" (status_codes PAGES_PARTIAL).
   *  ~~여러 쪽 PDF: "PDF 첫 쪽만 변환했어요"(PDF_FIRST_PAGE_ONLY)~~ — 2026-09-29 여러 쪽 결정으로 더 오지 않는다 */
  notice?: { code: string; message: string; pages: number; converted?: number; failed_pages?: number[] } | null;
}

/** 쪽별 상태 (2026-09-29 여러 쪽 — INTERFACES §4 PageStatus) */
export interface PageStatus {
  page_no: number;
  file_no: number;
  source: 'file' | 'pdf_page';
  outcome: 'pending' | 'converted' | 'failed';
  fallback_reason: string | null;
  fallback_message: string | null;
  validity_grade: 'trust' | 'caution' | 'distrust' | null;
  /** 사진 크기 · 작은 사진을 늘려 읽었으면 늘린 짧은 변(2026-09-30 황송해 119번) */
  short_edge_px?: number | null;
  upscaled_short_side_px?: number | null;
}

export interface ScoreResponse {
  scoredoc: ScoreDoc;
  musicxml: string;
  has_original_instruments: boolean;
  fallback: boolean;
  fallback_reason: string | null;
  fallback_message: string | null;
  retry_hint: string | null;
}

export interface RecommendationCombination { label: string; instruments: string[]; reason?: string }
export interface Recommendation {
  available: boolean;
  reason: string | null;
  pending: boolean;
  combinations: RecommendationCombination[];
  model: { name: string; version: string; provider: string } | null;
  features: { tempo: string; bpm: number | null; mode: string; range: string; density: number | null } | null;
}

export interface Instrument {
  id: string;
  name: string;
  group: 'gugak' | 'other' | 'original';
  gm_program: number | null;                    // GM 호환 번호(내려받는 MIDI·MusicXML)
  /** 서비스 음원 소리 번호(결정 C11): 일반 악기 bank 0 = GM, 국악기 bank 1 · program 0~5, 장구·북 128 · 1 */
  bank?: number | null;
  program?: number | null;
  percussion: boolean;
  range_low: number | null;
  range_high: number | null;
  soundfont: string | null;
}
export interface InstrumentCatalog {
  default_set: string[];
  gugak: Instrument[];
  others: Instrument[];
}

export type ExportFormat = 'mp3' | 'pdf' | 'midi' | 'musicxml';
export interface ExportTask {
  id: string;
  format: ExportFormat;
  basis: 'original' | 'edited';
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  queue_position: number | null;
  failure_reason: 'RENDER_FAILED' | 'RENDER_TIMEOUT' | 'RENDERER_MISSING' | 'ENGINE_DOWN' | null;
  notices: string[];
  download_url: string | null;
  renderer: string | null;
}

export type InstrumentMode = 'default' | 'recommend' | 'original' | 'custom';
export interface InstrumentChoiceBody {
  mode: InstrumentMode;
  recommendation_index?: number;
  tracks?: { part: number; instrument: string }[];
}

export interface ModelStatusPublic {
  checked_at: string;
  model_api: 'running' | 'stopped';
  models: {
    name: string; display_name: string; kind: 'omr_staff' | 'omr_jeongganbo' | 'recommend';
    provider: 'venv' | 'ollama' | 'builtin';
    state: 'ready' | 'cold' | 'loading' | 'failed' | 'unavailable'; expected_seconds: number | null;
  }[];
}

export interface ApiDocs {
  server_status: string;
  spec_source: string;             // 'live' | 'last_known' | …
  checked_at: string | null;
  endpoints: ApiEndpointDoc[];
  guideline: Record<string, unknown>;
  manual: Record<string, unknown>;
}
export interface ApiEndpointDoc {
  method?: string;
  path?: string;
  summary?: string;
  description?: string;
  input?: unknown;
  request?: unknown;
  response?: unknown;
  example?: string;
  [k: string]: unknown;
}

export interface KeyApplicationBody {
  name: string; organization: string; contact_email: string; purpose: string; consent: true;
}
export interface KeyApplicationResult {
  application_no: string; api_key: string; key_prefix: string; call_limit_per_hour: number;
}

// 공유 악보 · 좋아요 (2026-09-30 황송해, UC18 · INTERFACES §공유 악보)
export type ShareState = { shared: false } | { shared: true; share_no: string; title: string; shared_at: string; expires_at?: string; taken_down: boolean };
/** 내가 만든 악보 한 줄(2026-09-30 황송해 160번, GET /api/my-scores) */
export interface MyScoreItem {
  id: string; title: string; file_name: string | null; score_type: ScoreType | null; created_at: string; expires_at: string;
  remaining_seconds: number; edited: boolean; edit_ops: unknown[] | null; midi_available: boolean; fallback: boolean;
  /** 공유 악보로 만든 요청(2026-09-30 황송해 180번) — [제거] 없음 */
  from_shared?: boolean;
  /** 예시로 올린 요청(2026-09-30 황송해 192번) — title 은 예시 이름, 화면이 끝 괄호를 뗀다 */
  from_example?: boolean;
}
export interface SharedScoreItem { share_no: string; title: string; score_type: ScoreType; shared_at: string; expires_at?: string | null; /** 예시 공유 악보(2026-09-30 조성기, BR-SHR-08) */ example?: boolean; likes: number; liked_by_me: boolean }
export interface SharedScoreList { sort: 'likes' | 'recent'; items: SharedScoreItem[]; has_more: boolean }
export interface SharedScoreBody { share_no: string; title: string; score_type: ScoreType; musicxml: string }
