<script setup lang="ts">
// 코드 상자 + [복사] (스타일가이드 .code · .copy-btn). 복사 알림은 aria-live="polite".
import { ref } from 'vue';

const props = defineProps<{ text: string; label?: string }>();
const copied = ref('');

async function copy() {
  try {
    await navigator.clipboard.writeText(props.text);
    copied.value = '복사했습니다';
  } catch {
    copied.value = '복사하지 못했습니다. 글자를 직접 골라 복사해 주십시오';
  }
  setTimeout(() => (copied.value = ''), 3000);
}
</script>

<template>
  <div class="stack-8">
    <div class="code">
      <pre :aria-label="label">{{ text }}</pre>
      <button type="button" class="copy-btn" @click="copy">복사</button>
    </div>
    <span class="small muted" aria-live="polite">{{ copied }}</span>
  </div>
</template>
