<script setup lang="ts">
// C8 가린 키 표시 (SD_02 §3-9 · T113) — 변형 A: 발급 직후 원문 한 번 + [복사] + 경고 / 변형 B: 앞자리만
import { computed, ref } from 'vue';

const props = withDefaults(defineProps<{
  mode: 'once' | 'masked';
  value?: string | null;
  prefix?: string | null;
}>(), { value: null, prefix: null });

const copied = ref('');
const masked = computed(() => `${(props.prefix ?? props.value ?? '').slice(0, 8)}…`);

async function copy() {
  if (!props.value) return;
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = '키를 복사했습니다.';
  } catch {
    copied.value = '복사하지 못했습니다. 키를 직접 골라 복사해 주십시오.';
  }
}
</script>

<template>
  <div v-if="mode === 'once'" class="c8">
    <div class="code on-ink">
      <pre aria-label="접근 키 원문" data-test="raw-key">{{ value }}</pre>
      <button type="button" class="copy-btn" @click="copy">복사</button>
    </div>
    <p class="warn body"><span class="chip s-caution">한 번만</span> 이 화면을 닫으면 다시 볼 수 없습니다. 지금 복사해 안전한 곳에 보관해 주십시오.</p>
    <p class="sr-only" role="status" aria-live="polite">{{ copied }}</p>
    <p v-if="copied" class="small" aria-hidden="true">{{ copied }}</p>
  </div>
  <code v-else class="inline" :aria-label="`키 앞자리 ${masked}`">{{ masked }}</code>
</template>

<style scoped>
.c8 { display: grid; gap: var(--spacing-16); }
.warn { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0; }
.c8 > p { margin: 0; }
</style>
