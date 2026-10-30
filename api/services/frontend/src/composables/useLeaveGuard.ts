// 나가기 경고 하나로 (SD_02 머리말 ⑮ · §4-4 · §5-3 · §6-3, 2026-09-30 황송해 결정)
// 결과가 나온 뒤(S1 결과 완료·대체, S2, S3) 같은 악보 흐름(결과 · 편집 · 내려받기) 밖으로 가는 모든 화면 이동에
// 확인 창을 한 번 띄운다. 새로 고침 · 탭 닫기는 브라우저 기본 경고(beforeunload, 문구는 브라우저가 정함).
// #38: API 클라이언트가 쓰는 부분(만료 이동 · 한 번 건너뛰기 · 같은 흐름 판정)만 먼저 옮겼다.
//      useLeaveGuard() 는 편집 기록 저장소(stores/editor)와 함께 #40 · #41 에서 v0.1.1 그대로 이 파일에 더한다.
import type { RouteLocationNormalized } from 'vue-router';

export const LEAVE_TITLE = '아직 끝내지 않은 편집이 있습니다. 나가시겠습니까?';

// 로그인 만료(마지막 활동 뒤 2시간 무활동 → 401)로 로그인 화면에 보내는 이동은 묻지 않는다(SD_02 머리말 ⑲, 2026-09-30)
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useLeaveGuard() 가 #40 · #41 에서 옮겨 오면 읽는다
let sessionExpiredLeave = false;
export function allowLeaveForSessionExpiry(): void { sessionExpiredLeave = true; }
export function resetLeaveBypass(): void { sessionExpiredLeave = false; }
// 단계 [이전] 처럼 흐름 안에서 일부러 나가는 이동 한 번은 묻지 않는다(2026-09-30 63번 — 2단계 [이전] = 새 악보 올리기)
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- useLeaveGuard() 가 #40 · #41 에서 옮겨 오면 읽는다
let skipOnce = false;
export function allowNextLeave(): void { skipOnce = true; }

/** 같은 악보 흐름 안의 이동인지 — 결과(home?r=) · 편집(listen) · 내려받기(download) 사이는 묻지 않는다 */
export function isSameFlow(to: RouteLocationNormalized, requestNo: string | null): boolean {
  if (!requestNo) return false;
  if (to.name === 'home') return to.query.r === requestNo;
  if (to.name === 'listen' || to.name === 'download') return to.params.requestNo === requestNo;
  return false;
}
