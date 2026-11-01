<script setup lang="ts">
// [작업 저장하기] (2026-10-01 황송해 202번, SD_02 · UC6 A9) — 2 · 3단계 [이전] · [다음] 가운데.
// 지금 편집 기록을 서버에 저장한다(finished:false — 편집 마침으로 치지 않음). 기기 자동 저장은 그대로이고,
// 중간에 나가도 1단계 "내가 만든 악보" [편집하기]로 같은 계정 어느 기기에서나 이어 한다.
import { ref } from 'vue';
import GuardedButton from '@/components/GuardedButton.vue';
import { useEditorStore } from '@/stores/editor';
import { summarizeOps } from '@/lib/scoreCore';
import { formatClock } from '@/lib/time';
import { api } from '@/api/client';
import { markWorkSaved } from '@/lib/workSaved';

const props = withDefaults(defineProps<{ requestNo: string; reason?: string | null }>(), { reason: null });
const ed = useEditorStore();
const busy = ref(false);
const status = ref<string | null>(null);
const failed = ref(false);

async function save() {
  busy.value = true;
  const ops = ed.requestNo === props.requestNo ? ed.ops : [];
  try {
    await api.put(`/api/requests/${encodeURIComponent(props.requestNo)}/edits`, { summary: summarizeOps(ops), ops, finished: false });
    failed.value = false;
    markWorkSaved(props.requestNo, ops);   // (206번) 저장한 뒤 더 고치지 않았으면 나가기 경고 없음
    // (2026-10-01 황송해 205번) 성공 문구는 화면에 보이지 않게 — 화면 읽기 프로그램에만 알린다
    status.value = `저장했습니다 (${formatClock(new Date())})`;
  } catch {
    failed.value = true;
    status.value = '저장하지 못했습니다. 다시 눌러 주십시오.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <span class="save-work">
    <GuardedButton :reason="reason" :busy="busy" data-test="save-work" @click="save">작업 저장하기</GuardedButton>
    <span v-if="status" class="small" :class="failed ? 'field-error' : 'sr-only'" role="status" data-test="save-work-status">{{ status }}</span>
  </span>
</template>

<style scoped>
.save-work { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--spacing-8); }
</style>
