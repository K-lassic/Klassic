// app/shared/*.json — 웹 서비스와 모델 API 서버가 같은 파일을 읽는다(research R8, SC-015).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { APP_ROOT } from './env.js';

function readJson<T>(name: string): { data: T; hash: string } {
  const text = readFileSync(resolve(APP_ROOT, 'shared', name), 'utf8');
  return { data: JSON.parse(text) as T, hash: createHash('sha256').update(text).digest('hex').slice(0, 12) };
}

/** web_fix: 웹 서비스(/api) 응답에서 fix 대신 쓰는 문구(있을 때만). 모델 API 는 fix 를 쓴다 */
export interface GateCode { http: number; /** 모델 API 상태가 웹과 다를 때(2026-09-30) */ api_http?: number; gate: string | null; message: string; fix: string; web_fix?: string }
export interface ErrorCodes {
  api_version: string;
  gate_codes: Record<string, GateCode>;
  fallback_reasons: Record<string, { db: string; message: string; retry_hint?: string }>;
  status_codes: Record<string, string>;
}
export interface UploadKindRule {
  extensions: string[];
  mime_types: string[];
  magic: { format: string; hex_prefix?: string; hex_at_8?: string; text_contains_any?: string[] }[];
  max_bytes: number;
  min_short_edge_px?: number;
  requires_score_type: boolean;
  structure?: { min_parts: number; min_measures: number; requires_note_or_rest: boolean };
  /** PDF: 쪽을 그릴 해상도(모델 API 가 변환, 2026-09-29 여러 쪽: 모든 쪽) · converted_page 는 예전 값(더 쓰지 않음) */
  render_dpi?: number;
  converted_page?: number;
}
export type UploadKind = 'image' | 'pdf' | 'midi' | 'musicxml';
export interface UploadRules {
  version: string; max_files: number;
  /** 한 요청 최대 쪽 수(사진 장수 또는 PDF 쪽수, 2026-09-29 여러 쪽) */
  max_pages?: number;
  /** 사용자가 올리는 파일로 받는 종류(사진·PDF, 2026-09-29 황송해 결정) — 웹·연주 API·/v1/omr 같다 */
  user_upload_kinds: UploadKind[];
  kinds: Record<UploadKind, UploadKindRule>;
}
export interface InstrumentDef {
  // gm_program = GM 호환 번호(내려받기). bank·program = 서비스 음원 소리 번호(결정 C11: 일반 0/GM, 국악기 1/0~5, 장구·북 128/1)
  code: string; name_ko: string; family: 'gugak' | 'other'; gm_program: number; bank: number; program: number; is_percussion: boolean;
  soundfont: string; default_role: 'melody' | 'percussion'; range_low: number | null; range_high: number | null;
}
export interface Instruments { default_ensemble: { part_role: string; instrument: string }[]; instruments: InstrumentDef[] }

const ec = readJson<ErrorCodes>('error-codes.json');
const ur = readJson<UploadRules>('upload-rules.json');
const ins = readJson<Instruments>('instruments.json');

export const errorCodes = ec.data;
export const uploadRules = ur.data;
export const uploadRulesHash = ur.hash;
export const instruments = ins.data;

/**
 * 사용자가 올리는 파일로 받는 종류 — 사진·PDF(2026-09-29 황송해 결정, 웹·API 같음). 원본은 upload-rules.json
 * user_upload_kinds 하나다(모델 API 도 같은 값을 읽는다). 여기 없는 종류(MIDI·MusicXML)는 G1 UPLOAD_UNSUPPORTED_TYPE.
 */
export const userUploadKinds: readonly UploadKind[] = uploadRules.user_upload_kinds;

/** DB 대체 이유(소문자) → 화면·API 코드(대문자). NO_NOTES 는 마지막 엔진 시도로 가른다(D-4) */
export function fallbackCode(dbReason: string | null, lastOutcome?: string | null): string | null {
  if (!dbReason) return null;
  if (dbReason === 'recognition_failed' && lastOutcome === 'no_notes') return 'NO_NOTES';
  const found = Object.entries(errorCodes.fallback_reasons).find(([code, v]) => v.db === dbReason && code !== 'NO_NOTES');
  return found ? found[0] : null;
}
