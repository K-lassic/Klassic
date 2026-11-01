// 나가기 경고 하나로 (SD_02 머리말 ⑮ · §4-4 · §5-3 · §6-3, 2026-09-30 황송해 결정)
// 결과가 나온 뒤(S1 결과 완료·대체, S2, S3) 같은 악보 흐름(결과 · 편집 · 내려받기) 밖으로 가는 모든 화면 이동에
// 확인 창을 한 번 띄운다. 새로 고침 · 탭 닫기는 브라우저 기본 경고(beforeunload, 문구는 브라우저가 정함).
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter, type RouteLocationNormalized } from 'vue-router';
import { getActivePinia } from 'pinia';
import { useEditorStore } from '@/stores/editor';
import { isWorkSaved } from '@/lib/workSaved';

export const LEAVE_TITLE = '아직 끝내지 않은 편집이 있습니다. 나가시겠습니까?';

// 로그인 만료(마지막 활동 뒤 2시간 무활동 → 401)로 로그인 화면에 보내는 이동은 묻지 않는다(SD_02 머리말 ⑲, 2026-09-30)
let sessionExpiredLeave = false;
export function allowLeaveForSessionExpiry(): void { sessionExpiredLeave = true; }
export function resetLeaveBypass(): void { sessionExpiredLeave = false; }
// 단계 [이전] 처럼 흐름 안에서 일부러 나가는 이동 한 번은 묻지 않는다(2026-09-30 63번 — 2단계 [이전] = 새 악보 올리기)
let skipOnce = false;
export function allowNextLeave(): void { skipOnce = true; }

/** 같은 악보 흐름 안의 이동인지 — 결과(home?r=) · 편집(listen) · 내려받기(download) 사이는 묻지 않는다 */
export function isSameFlow(to: RouteLocationNormalized, requestNo: string | null): boolean {
  if (!requestNo) return false;
  if (to.name === 'home') return to.query.r === requestNo;
  if (to.name === 'listen' || to.name === 'download') return to.params.requestNo === requestNo;
  return false;
}

export function useLeaveGuard(active: Ref<boolean>, requestNo: Ref<string | null>) {
  const open = ref(false);
  let resolver: ((ok: boolean) => void) | null = null;
  let pending: Promise<boolean> | null = null;
  // (2026-09-30 황송해 60번) [나가기]를 누른 뒤에는 이 이동이 끝날 때까지 다시 묻지 않는다.
  // 전역 가드가 다른 곳으로 돌려보내면(리다이렉트) 새 이동이 시작되고 이 가드가 또 불려 확인 창이 다시 떴다 — "나가기를 눌러도 안 나가짐".
  let leaving = false;
  const router = useRouter();
  // (2026-10-01 황송해 206번) [작업 저장하기]로 저장한 뒤 더 고친 것이 없으면 묻지 않는다(저장 안 했거나 더 고쳤으면 그대로).
  // 편집 기록 저장소(pinia)가 없는 곳(시험 등)에서는 저장한 적만 본다
  const ed = getActivePinia() ? useEditorStore() : null;
  const saved = () => isWorkSaved(requestNo.value, ed && ed.requestNo === requestNo.value ? ed.ops : null);
  const stopAfter = router.afterEach(() => { leaving = false; });

  function ask(): Promise<boolean> {
    // 창이 떠 있는 동안 같은 이동이 또 오면 창을 하나만 두고 같은 답을 쓴다
    if (pending) return pending;
    open.value = true;
    pending = new Promise((res) => { resolver = res; });
    return pending;
  }
  function answer(ok: boolean) {
    open.value = false;
    const r = resolver; resolver = null; pending = null;
    if (ok) leaving = true;
    r?.(ok);
  }
  const guard = (to: RouteLocationNormalized) => {
    if (skipOnce) { skipOnce = false; return true; }
    if (!active.value || leaving || sessionExpiredLeave || isSameFlow(to, requestNo.value) || saved()) return true;
    return ask();
  };
  onBeforeRouteLeave(guard);
  onBeforeRouteUpdate(guard);

  const onUnload = (e: BeforeUnloadEvent) => {
    if (!active.value || sessionExpiredLeave || saved()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  onMounted(() => window.addEventListener('beforeunload', onUnload));
  onBeforeUnmount(() => { window.removeEventListener('beforeunload', onUnload); stopAfter(); if (pending) answer(false); });

  return { open, confirm: () => answer(true), cancel: () => answer(false) };
}
