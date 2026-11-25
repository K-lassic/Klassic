// #210 미리보기 조회 간격 — 여러 쪽 요청에서 먼저 변환된 쪽을 model-api 에 묻는 간격을 정한다.
//
//   구조에서의 위치: services/requestWorker.ts watchPreview() → 이 파일(간격만 계산) → model-api GET /v1/internal/omr/preview/{no}.
//     묻는 때마다 model-api api_call_log 에 한 줄 남는다. 첫 쪽은 보통 8~31초에 끝나므로 처음 30초는 3초마다 묻고,
//     그 뒤에도 없으면(대기열 429 · 느린 쪽) 10초마다로 늦춘다 — 화면은 늦어도 10초 안에 미리보기를 받는다.
//     저장하는 것은 없다(시계 · DB 를 쓰지 않는 계산만).

/** 처음 묻는 간격 */
export const PREVIEW_POLL_MS = 3000;
/** 이 횟수만큼 물어도 없으면 간격을 늦춘다 (3초 × 10 = 30초) */
export const PREVIEW_FAST_ASKS = 10;
/** 늦춘 간격 */
export const PREVIEW_SLOW_POLL_MS = 10_000;

/** asked = 지금까지 물은 횟수(처음 묻기 전은 0). 다음에 물을 때까지 기다릴 시간(ms) */
export function previewPollDelay(asked: number): number {
  return asked < PREVIEW_FAST_ASKS ? PREVIEW_POLL_MS : PREVIEW_SLOW_POLL_MS;
}
