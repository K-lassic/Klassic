<script setup lang="ts">
// 나가기 확인 창 (SD_02 §4-4 · §5-3 · §6-3, 2026-09-30 황송해 결정) — [새 악보 올리기]를 누르면 한 번 묻는다.
// (2026-09-30 황송해 176번) 확인 버튼 이름을 바꿔 "내가 만든 악보" [제거] 확인 창에도 쓴다(confirmLabel, 기본 [나가기]).
// role="dialog" + aria-modal, 열리면 [취소]에 초점, Esc 는 취소, Tab 은 창 안에서만 돈다, 닫히면 원래 자리로 초점.
import { onBeforeUnmount, onMounted, ref } from 'vue';

withDefaults(defineProps<{ title: string; lines: string[]; confirmLabel?: string }>(), { confirmLabel: '나가기' });
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const box = ref<HTMLElement | null>(null);
const cancelBtn = ref<HTMLButtonElement | null>(null);
let returnTo: HTMLElement | null = null;

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); emit('cancel'); return; }
  if (e.key !== 'Tab' || !box.value) return;
  const list = Array.from(box.value.querySelectorAll<HTMLElement>('button'));
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
onMounted(() => { returnTo = document.activeElement as HTMLElement | null; cancelBtn.value?.focus(); });
onBeforeUnmount(() => { if (returnTo && document.contains(returnTo)) returnTo.focus(); });
</script>

<template>
  <div class="overlay" data-test="leave-confirm" @mousedown.self="emit('cancel')">
    <div ref="box" class="dialog" role="dialog" aria-modal="true" aria-labelledby="leave-title" @keydown="onKey">
      <h2 id="leave-title" class="h3">{{ title }}</h2>
      <p v-for="l in lines" :key="l" class="body">{{ l }}</p>
      <div class="row">
        <button ref="cancelBtn" type="button" class="btn btn-secondary" data-test="leave-cancel" @click="emit('cancel')">취소</button>
        <button type="button" class="btn btn-primary" data-test="leave-ok" @click="emit('confirm')">{{ confirmLabel }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: var(--gutter, 16px); background: rgba(20, 20, 19, .4); }
.dialog {
  width: min(440px, 100%); display: grid; gap: var(--spacing-16); padding: var(--spacing-32);
  background: var(--color-white); color: var(--color-ink-black); border-radius: var(--rounded-stadium); box-shadow: var(--elevation-2);
}
.dialog p { margin: 0; }
.row { justify-content: flex-end; }
</style>
