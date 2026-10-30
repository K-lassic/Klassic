<script setup lang="ts">
// C10 도움말 [?] (2026-09-30 황송해 75~105, SD_02 §3-11) — 영역 오른쪽 위 작은 [?].
// 마우스 올림 · 키보드 초점 · 누름(터치)에서 말풍선이 열리고, 떠나거나 초점이 빠지거나 Esc 로 닫힌다.
// 버튼은 aria-describedby 로 말풍선 글을 가리킨다(화면 읽기 프로그램은 초점만 줘도 설명을 읽는다).
import { onBeforeUnmount, ref, useId } from 'vue';

withDefaults(defineProps<{ label: string; text?: string; align?: 'right' | 'left' }>(), { text: '', align: 'right' });
const id = `help-${useId()}`;
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onDoc(e: Event) { if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false; }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open.value = false; }
document.addEventListener('pointerdown', onDoc);
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDoc));

</script>

<template>
  <span ref="root" class="help" :class="align" @mouseenter="open = true" @mouseleave="open = false">
    <button
      type="button" class="help-btn" :aria-label="`도움말: ${label}`" :aria-describedby="id" :aria-expanded="open ? 'true' : 'false'"
      data-test="help" @focus="open = true" @blur="open = false" @click="open = true" @keydown="onKey"
    >?</button>
    <span :id="id" role="tooltip" class="help-tip small" :class="{ open }" data-test="help-tip"><slot>{{ text }}</slot></span>
  </span>
</template>

<style scoped>
.help { position: relative; display: inline-flex; flex: none; }
.help-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0;
  background: none; border: 0; cursor: help; color: var(--color-primary); font: 700 var(--text-small)/1 var(--font-sans);
}
.help-btn::before {
  content: ""; position: absolute; left: 8px; top: 8px; width: 28px; height: 28px; border-radius: 50%;
  border: 1.5px solid var(--color-primary); background: var(--color-white);
}
.help-btn { position: relative; z-index: 0; }
.help-btn::before { z-index: -1; }
.help-btn:hover::before, .help-btn:focus-visible::before { background: var(--color-primary); }
.help-btn:hover, .help-btn:focus-visible { color: var(--color-on-primary); }
.help-tip {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 40; width: max-content; max-width: min(340px, 80vw);
  padding: 12px 16px; border-radius: 12px; background: var(--color-ink-black); color: var(--color-canvas-cream);
  box-shadow: var(--elevation-2); text-align: left; white-space: normal; visibility: hidden; opacity: 0; transition: opacity .12s;
}
.help.left .help-tip { right: auto; left: 0; }
.help-tip.open { visibility: visible; opacity: 1; }
</style>
