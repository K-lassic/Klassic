// 대체 사유 → 화면 문구 (T075). 원본: app/shared/error-codes.json `fallback_reasons`
// DB 는 소문자 6종, 응답·화면은 대문자 코드(INTERFACES §1). NO_NOTES = recognition_failed + 마지막 시도 outcome 'no_notes'(D-4).
import errorCodes from '../../../shared/error-codes.json';

export type FallbackCode =
  | 'RECOGNITION_FAILED' | 'TIMEOUT' | 'ENGINE_DOWN' | 'NO_NOTES' | 'NO_SCORE_STRUCTURE' | 'UNTRUSTED_RESULT' | 'USER_REQUEST';

interface Entry { db: string; message: string; retry_hint?: string }
const REASONS = Object.fromEntries(
  Object.entries(errorCodes.fallback_reasons).filter(([k]) => !k.startsWith('$')),
) as Record<FallbackCode, Entry>;

/** 공유 원본에 retry_hint 가 없는 사유의 다시 해 볼 방법 — 쉬운 말 */
const HINTS: Record<FallbackCode, string | null> = {
  RECOGNITION_FAILED: '더 밝고 선명한 사진으로 다시 올려 보십시오.',
  TIMEOUT: '잠시 뒤 다시 올려 보십시오.',
  ENGINE_DOWN: '잠시 뒤 다시 올려 보십시오.',
  NO_NOTES: '음표가 잘 보이게 다시 찍어 올려 보십시오.',
  NO_SCORE_STRUCTURE: null, // 원본 retry_hint 사용
  UNTRUSTED_RESULT: '더 선명한 사진으로 다시 올려 보십시오.',
  USER_REQUEST: null,
};

/** 짧은 이유 이름 — C3 칩 옆 "(이유)" */
const SHORT: Record<FallbackCode, string> = {
  RECOGNITION_FAILED: '인식 실패',
  TIMEOUT: '시간 초과',
  ENGINE_DOWN: '엔진 중단',
  NO_NOTES: '음표 없음',
  NO_SCORE_STRUCTURE: '구조 없음',
  UNTRUSTED_RESULT: '결과 불신',
  USER_REQUEST: '사용자 요청',
};

export function isFallbackCode(code: string | null | undefined): code is FallbackCode {
  return !!code && code in REASONS;
}

/** DB 소문자 코드 → 화면 코드 */
export function toScreenCode(dbCode: string, lastOutcome?: string | null): FallbackCode | null {
  if (dbCode === 'recognition_failed' && lastOutcome === 'no_notes') return 'NO_NOTES';
  const hit = (Object.entries(REASONS) as [FallbackCode, Entry][]).find(([k, v]) => v.db === dbCode && k !== 'NO_NOTES');
  return hit ? hit[0] : null;
}

export function fallbackReasonText(code: string | null | undefined): string {
  if (isFallbackCode(code)) return REASONS[code].message;
  return '대체 악보를 드렸습니다.';
}

export function fallbackShortName(code: string | null | undefined): string {
  return isFallbackCode(code) ? SHORT[code] : '대체';
}

export function fallbackRetryHint(code: string | null | undefined): string | null {
  if (!isFallbackCode(code)) return null;
  return REASONS[code].retry_hint ?? HINTS[code];
}
