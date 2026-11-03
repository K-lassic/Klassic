// #23 공용 설정 읽기 — api/shared 의 오류 코드 · 업로드 규칙 · 악기 목록 (#19).
//
//   구조에서의 위치: backend · model-api · frontend 가 같은 파일을 읽는다. 이미지에는 /app/shared 로 구워 넣는다
//     (services/backend/compose.yaml additional_contexts → Dockerfile COPY --from=shared).
//   오류 코드는 영역별 세 파일(errors/common · web · model)을 합쳐서 쓴다 — api/shared/README.md 「오류 파일 읽는 규칙」.
//     같은 코드가 두 파일에 있으면 시작하지 않는다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { env } from './env.js';

export interface GateCode { http: number; api_http?: number; gate: string | null; message: string; fix: string; web_fix?: string }
export interface FallbackReason { db: string; message: string; retry_hint?: string }
export interface ErrorCodes {
  api_version: string;
  gate_codes: Record<string, GateCode>;
  fallback_reasons: Record<string, FallbackReason>;
  status_codes: Record<string, string>;
}
export interface UploadMagic { hex_prefix?: string; hex_at_8?: string; text_contains_any?: string[] }
export interface UploadKindRule {
  extensions: string[]; magic: UploadMagic[]; max_bytes: number; min_short_edge_px?: number;
  max_pixels?: number; max_edge_px?: number;
  upscale_below_short_edge_px?: number; upscale_to_short_edge_px?: number;
}
export interface UploadRules { version: string; max_files: number; max_pages?: number; user_upload_kinds: string[]; score_types: string[]; kinds: Record<string, UploadKindRule> }
export interface InstrumentDef { code: string; is_percussion?: boolean; bank?: number; program?: number }
export interface Instruments { default_ensemble: { part_role: string; instrument: string }[]; instruments: InstrumentDef[] }

const SECTIONS = ['gate_codes', 'fallback_reasons', 'status_codes'] as const;
const ERROR_FILES = ['common', 'web', 'model'] as const;

function readText(dir: string, name: string): string {
  return readFileSync(join(dir, name), 'utf8');
}

/** 세 오류 파일을 합친다. $ 로 시작하는 키(설명)는 건너뛰고, 같은 코드가 두 번 나오면 오류 */
export function mergeErrorCodes(parts: Record<string, Record<string, unknown>>): ErrorCodes {
  const merged = { api_version: String(parts.common?.api_version ?? 'v1'), gate_codes: {}, fallback_reasons: {}, status_codes: {} } as ErrorCodes;
  const owner = new Map<string, string>();
  for (const [file, data] of Object.entries(parts)) {
    for (const sec of SECTIONS) {
      for (const [code, value] of Object.entries((data[sec] ?? {}) as Record<string, unknown>)) {
        if (code.startsWith('$')) continue;
        const key = `${sec}.${code}`;
        if (owner.has(key)) throw new Error(`오류 코드 중복: ${key} 가 errors/${owner.get(key)}.json 과 errors/${file}.json 에 모두 있다`);
        owner.set(key, file);
        (merged[sec] as Record<string, unknown>)[code] = value;
      }
    }
  }
  return merged;
}

export interface Shared { errorCodes: ErrorCodes; uploadRules: UploadRules; uploadRulesHash: string; instruments: Instruments }

export function loadShared(dir = env().SHARED_DIR): Shared {
  const parts = Object.fromEntries(ERROR_FILES.map((f) => [f, JSON.parse(readText(join(dir, 'errors'), `${f}.json`))]));
  const rulesText = readText(dir, 'upload-rules.json');
  return {
    errorCodes: mergeErrorCodes(parts),
    uploadRules: JSON.parse(rulesText) as UploadRules,
    uploadRulesHash: createHash('sha256').update(rulesText).digest('hex').slice(0, 12),
    instruments: JSON.parse(readText(dir, 'instruments.json')) as Instruments,
  };
}

let cached: Shared | null = null;

/** 프로세스 전체에서 한 번 읽은 공용 설정 */
export function shared(): Shared {
  cached ??= loadShared();
  return cached;
}

/** DB 대체 이유(소문자) → 화면 · API 코드(대문자). NO_NOTES 는 마지막 엔진 시도로 가른다 (#34 · v0.1.1 config/shared.ts) */
export function fallbackCode(dbReason: string | null, lastOutcome?: string | null): string | null {
  if (!dbReason) return null;
  if (dbReason === 'recognition_failed' && lastOutcome === 'no_notes') return 'NO_NOTES';
  const found = Object.entries(shared().errorCodes.fallback_reasons).find(([code, v]) => v.db === dbReason && code !== 'NO_NOTES');
  return found ? found[0] : null;
}
