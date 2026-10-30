<script setup lang="ts">
// 키보드로 오가는 탭 (WAI-ARIA tabs): ←/→ · Home/End 로 옮기고 바로 고른다. 탭 패널 id = `${idPrefix}-panel-${id}`
import { nextTick } from 'vue';

const props = defineProps<{ tabs: { id: string; label: string }[]; modelValue: string; idPrefix: string; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [id: string] }>();

function onKey(e: KeyboardEvent, i: number) {
  const n = props.tabs.length;
  let j = -1;
  if (e.key === 'ArrowRight') j = (i + 1) % n;
  else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = n - 1;
  if (j < 0) return;
  e.preventDefault();
  emit('update:modelValue', props.tabs[j].id);
  void nextTick(() => document.getElementById(`${props.idPrefix}-tab-${props.tabs[j].id}`)?.focus());
}
</script>

<template>
  <div class="tab-list" role="tablist" :aria-label="label">
    <button
      v-for="(t, i) in tabs"
      :id="`${idPrefix}-tab-${t.id}`"
      :key="t.id"
      type="button"
      role="tab"
      :aria-selected="modelValue === t.id ? 'true' : 'false'"
      :aria-controls="`${idPrefix}-panel-${t.id}`"
      :tabindex="modelValue === t.id ? 0 : -1"
      @click="emit('update:modelValue', t.id)"
      @keydown="onKey($event, i)"
    >
      {{ t.label }}
    </button>
  </div>
</template>
