<script setup lang="ts">
// 불러오는 중 — 경과 / 예상 초 + 진행 막대(INTERFACES §7). 예상을 모르면 움직이는 막대 + 안내 글.
import { computed } from 'vue';
import { computeLoadProgress } from '../lib/models';

const props = defineProps<{ elapsed: number; expected: number | null; label: string }>();
const p = computed(() => computeLoadProgress(props.elapsed, props.expected));
</script>

<template>
  <div class="progress">
    <div
      class="track"
      role="progressbar"
      :aria-label="`${label} 불러오기 진행`"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="p.percent ?? undefined"
      :aria-valuetext="p.text"
    >
      <div :class="['fill', { indeterminate: p.percent === null }]" :style="p.percent === null ? undefined : { width: `${p.percent}%` }" />
    </div>
    <span class="text">{{ p.text }}</span>
  </div>
</template>
