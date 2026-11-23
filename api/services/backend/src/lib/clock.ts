// #105 단조 시계 — 처리 마감 · 대기 상한은 벽시계(Date.now)가 아니라 이 시계로만 잰다.
//
//   구조에서의 위치: requestWorker.ts(대기 · 처리 감시 · 마감)가 쓰고, modelApiClient.ts 는 남은 시간만 받는다.
//     서버 PC(WSL2) 시계가 수 초 튀면 벽시계 기준 마감이 그만큼 당겨지거나 늦춰졌다 (#105).
//   방법: 마감은 전부 "프로세스 시작 뒤 흐른 시간"(performance.now, 단조) 값이다. 벽시계 값과 섞지 않는다.
//     DB 에 찍힌 시각(접수 · 처리 시작)은 벽시계라서, 프로세스가 그 요청을 처음 볼 때 DB 가 계산한
//     "경과 시간" 한 번만 읽어 단조 시계로 옮기고(requestWorker.phaseStart) 그 뒤로는 DB 시각을 다시 읽지 않는다.
//   한계: 요청을 처음 보는 순간(접수 · 재시작) 전에 벽시계가 튀었으면 그 경과 시간은 어긋날 수 있다.

/** 프로세스 시작 뒤 흐른 시간(ms, 정수). 벽시계가 튀어도 거꾸로 가거나 뛰지 않는다. 비교 · 남은 시간 계산에만 쓴다 */
// 정수 ms 로 돌려준다 — AbortSignal.timeout 은 소수 ms 를 받지 않는다 (#105 시험에서 확인)
export function monotonicNowMs(): number {
  return Math.round(performance.now());
}
