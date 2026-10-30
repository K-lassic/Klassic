<script setup lang="ts">
// 대화상자·서랍 공통 — role="dialog" + aria-modal, 열리면 안으로 초점, Esc 로 닫기, Tab 이 안에서만 돈다, 닫히면 원래 자리로 초점.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { uid } from '../lib/uid';

const props = withDefaults(defineProps<{ title: string; variant?: 'dialog' | 'drawer'; size?: 'normal' | 'small'; closeLabel?: string }>(), {
  variant: 'dialog', size: 'normal', closeLabel: '닫기',
});
const emit = defineEmits<{ close: [] }>();
const box = ref<HTMLElement | null>(null);
const titleId = uid('dlg');
let returnTo: HTMLElement | null = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
  return box.value ? Array.from(box.value.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); emit('close'); return; }
  if (e.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

onMounted(() => {
  returnTo = document.activeElement as HTMLElement | null;
  const list = focusables();
  // 닫기 버튼보다 본문의 첫 칸에 먼저 가도록: 두 번째가 있으면 두 번째
  (list[1] ?? list[0] ?? box.value)?.focus();
});
onBeforeUnmount(() => { if (returnTo && document.contains(returnTo)) returnTo.focus(); });
defineExpose({ titleId, props });
</script>

<template>
  <div :class="['overlay', { right: variant === 'drawer' }]" @mousedown.self="emit('close')">
    <div
      ref="box"
      :class="[variant === 'drawer' ? 'drawer' : 'dialog', { small: size === 'small' }]"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      @keydown="onKey"
    >
      <div class="dialog-head">
        <h2 :id="titleId" class="h3">{{ title }}</h2>
        <button type="button" class="btn btn-secondary btn-sm" @click="emit('close')">{{ closeLabel }}</button>
      </div>
      <slot />
      <div v-if="$slots.foot" class="dialog-foot"><slot name="foot" /></div>
    </div>
  </div>
</template>
