<script setup lang="ts">
// 막힌 버튼 — 비활성 이유를 버튼 바로 옆에 늘 글자로(SD_02 §12-2 ②: hover 없음).
// aria-disabled 로 두어 키보드로 닿을 수 있고, 이유는 aria-describedby 로 읽힌다.
import { computed } from 'vue';

let seq = 0;
const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary';
  reason?: string | null;
  type?: 'button' | 'submit';
  busy?: boolean;
  /** (2026-09-30 81번) 이유 글자를 화면에는 숨기고 읽기 이름(aria-describedby)으로만 */
  quietReason?: boolean;
}>(), { variant: 'secondary', reason: null, type: 'button', busy: false, quietReason: false });
const emit = defineEmits<{ click: [MouseEvent] }>();
const id = `why-${++seq}`;
const blocked = computed(() => !!props.reason || props.busy);
function onClick(e: MouseEvent) {
  if (blocked.value) { e.preventDefault(); return; }
  emit('click', e);
}
</script>

<template>
  <span class="guarded">
    <button
      :type="type"
      class="btn"
      :class="variant === 'primary' ? 'btn-primary' : 'btn-secondary'"
      :aria-disabled="blocked ? 'true' : undefined"
      :aria-busy="busy ? 'true' : undefined"
      :aria-describedby="reason ? id : undefined"
      @click="onClick"
    ><slot /></button>
    <span v-if="reason" :id="id" class="small why" :class="{ 'sr-only': quietReason }">사유: {{ reason }}</span>
  </span>
</template>

<style scoped>
.guarded { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-16); }
.why { color: var(--color-charcoal); }
</style>
