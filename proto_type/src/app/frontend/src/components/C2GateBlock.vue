<script setup lang="ts">
// C2 게이트 차단 블록 (SD_02 §3-3) — ① 사유 ② 해제 주체 ③ 다음 행동. 토스트 금지, role="alert".
// 변형 A(해제 주체 = 나): actionLabel 버튼. 변형 B(다른 사람): 버튼 없이 안내 글만.
import { computed, ref, watch } from 'vue';
import type { GateView } from '@/i18n/gateMessages';
import { formatClock, formatDuration } from '@/lib/time';
import { useNow } from '@/composables/useNow';

const props = defineProps<{ view: GateView }>();
const emit = defineEmits<{ action: []; retryReady: [] }>();
const now = useNow();

const leftSec = computed(() => (props.view.retryAt ? (props.view.retryAt.getTime() - now.value) / 1000 : null));
const fired = ref(false);
watch(() => props.view, () => { fired.value = false; });
watch(leftSec, (v) => { if (v !== null && v <= 0 && !fired.value) { fired.value = true; emit('retryReady'); } });

const retryText = computed(() => {
  if (!props.view.retryAt || leftSec.value === null) return null;
  if (leftSec.value <= 0) return '이제 다시 할 수 있습니다.';
  return `${formatClock(props.view.retryAt)} 뒤에 다시 할 수 있습니다 (${formatDuration(leftSec.value)} 남음).`;
});
const titleId = `gate-${Math.random().toString(36).slice(2, 8)}`;
</script>

<template>
  <div class="notice" :class="view.chipKind === 's-expired' ? 'n-expired' : 'n-rejected'" role="alert" :aria-labelledby="titleId">
    <span class="chip" :class="view.chipKind">{{ view.chip }}</span>
    <span :id="titleId" class="title">{{ view.title }}</span>
    <dl class="lines">
      <div><dt>사유</dt><dd>{{ view.reason }}</dd></div>
      <div><dt>해제 주체</dt><dd>{{ view.releaser }}</dd></div>
      <div>
        <dt>다음 행동</dt>
        <dd>{{ view.fix }}<template v-if="retryText"> <strong data-test="retry">{{ retryText }}</strong></template></dd>
      </div>
    </dl>
    <slot />
    <div v-if="view.actionLabel || $slots.actions" class="row">
      <button v-if="view.actionLabel" type="button" class="btn btn-primary" @click="emit('action')">{{ view.actionLabel }}</button>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.lines { display: grid; gap: var(--spacing-8); margin: 0; }
.lines div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: var(--spacing-16); }
.lines dt { font: 700 var(--text-small)/22.4px var(--font-sans); color: var(--color-ink-black); }
.lines dd { margin: 0; color: var(--color-charcoal); }
</style>
