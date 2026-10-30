<script setup lang="ts">
// 서버 상태 줄 (SD_02 §10-3): 모델 API 서버 상태 · 엔진 이름·버전 · 응답 없으면 "확인 불가". 지표·설정은 서버와 상관없이 계속.
import { computed, onMounted, ref } from 'vue';
import { adminApi } from '../api';
import { dateTime } from '../lib/format';
import type { ModelApiStatus } from '../types';

const status = ref<ModelApiStatus | null>(null);
const failed = ref(false);
const loading = ref(false);

async function refresh() {
  loading.value = true;
  try {
    status.value = await adminApi.modelApiStatus();
    failed.value = false;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

const running = computed(() => {
  const h = status.value?.health;
  return !!h && typeof h === 'object' && (h.status === undefined || h.status === 'ok');
});
const engines = computed(() => {
  const list = status.value?.versions?.engines ?? [];
  return list.map((e) => `${e.name} ${e.version ?? ''}`.trim()).join(' · ');
});
const readyText = computed(() => {
  const h = status.value?.health;
  if (h && typeof h === 'object' && typeof h.models_total === 'number') return `모델 준비 ${h.models_ready ?? 0}/${h.models_total}`;
  return '';
});
defineExpose({ refresh });
</script>

<template>
  <div class="status-line" aria-live="polite">
    <span v-if="loading && !status && !failed" class="chip s-waiting">확인 중</span>
    <span v-else-if="!failed && running" class="chip s-done">모델 API 서버: 동작 중</span>
    <span v-else class="chip s-expired">모델 API 서버: 확인 불가 (응답 없음)</span>
    <span class="sep" aria-hidden="true" />
    <span>엔진 버전: {{ engines || (failed || !running ? '마지막 확인 기록 없음' : '—') }}</span>
    <template v-if="readyText"><span class="sep" aria-hidden="true" /><span>{{ readyText }}</span></template>
    <span class="sep" aria-hidden="true" />
    <span class="muted">확인 {{ dateTime(status?.checked_at) }}</span>
    <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="refresh">다시 확인</button>
  </div>
</template>
