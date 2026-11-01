// [작업 저장하기]로 서버에 저장한 편집 기록 표시 (2026-10-01 황송해 206번, SD_02 머리말)
// 저장한 뒤 더 고친 것이 없으면(지금 편집 기록 = 저장한 편집 기록) 2 · 3 · 4단계 나가기 경고를 띄우지 않는다.
// 표시는 이 브라우저 탭에만 둔다(sessionStorage — 새로 고쳐도 남고 탭을 닫으면 사라짐). 저장소를 못 쓰면 메모리로만.
const KEY = (no: string) => `klassic.saved-work.${no}`;
const mem = new Map<string, string>();

export function markWorkSaved(requestNo: string, ops: unknown[]): void {
  const v = JSON.stringify(ops);
  mem.set(requestNo, v);
  try { sessionStorage.setItem(KEY(requestNo), v); } catch { /* 저장소를 못 쓰면 메모리만 */ }
}

function savedOps(requestNo: string): string | null {
  if (mem.has(requestNo)) return mem.get(requestNo)!;
  try { return sessionStorage.getItem(KEY(requestNo)); } catch { return null; }
}

/** 저장한 뒤 더 고친 것이 없는지. currentOps 를 모르면(null — 편집 기록을 아직 안 열었음) 저장한 적만 보면 된다 */
export function isWorkSaved(requestNo: string | null, currentOps: unknown[] | null): boolean {
  if (!requestNo) return false;
  const saved = savedOps(requestNo);
  if (saved === null) return false;
  return currentOps === null || JSON.stringify(currentOps) === saved;
}

/** 시험용 */
export function clearWorkSaved(): void {
  mem.clear();
}
