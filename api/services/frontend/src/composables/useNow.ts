import { onBeforeUnmount, onMounted, ref } from 'vue';

/** 1초마다 바뀌는 지금 시각(ms) — 남은 시간·카운트다운 표시용 */
export function useNow(intervalMs = 1000) {
  const now = ref(Date.now());
  let t: ReturnType<typeof setInterval> | null = null;
  onMounted(() => { t = setInterval(() => { now.value = Date.now(); }, intervalMs); });
  onBeforeUnmount(() => { if (t) clearInterval(t); });
  return now;
}
