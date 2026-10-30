<script setup lang="ts">
// 쪽 넘기기 (2026-09-30 황송해 178 · 179번 — SD_02 §4-3 · §4-6) — [이전] · 쪽 번호 · [다음].
// 지금 쪽은 aria-current="page". pages = 지금까지 아는 쪽 수(전체를 모르면 알게 된 쪽까지), hasNext = 다음 쪽이 있는가.
const props = defineProps<{ page: number; pages: number; hasNext: boolean; label: string }>();
const emit = defineEmits<{ go: [page: number] }>();
const go = (n: number) => { if (n >= 1 && n !== props.page) emit('go', n); };
</script>

<template>
  <nav class="page-nav" :aria-label="label" data-test="page-nav">
    <button type="button" class="btn btn-secondary btn-sm" :disabled="page <= 1" data-test="page-prev" @click="go(page - 1)">← 이전</button>
    <button
      v-for="n in pages" :key="n" type="button" class="btn btn-sm num" :class="n === page ? 'btn-primary' : 'btn-secondary'"
      :aria-current="n === page ? 'page' : undefined" :aria-label="`${n}쪽`" :data-test="`page-${n}`" @click="go(n)"
    >
      {{ n }}
    </button>
    <button type="button" class="btn btn-secondary btn-sm" :disabled="!hasNext" data-test="page-next" @click="go(page + 1)">다음 →</button>
  </nav>
</template>

<style scoped>
.page-nav { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: var(--spacing-8); }
.btn-sm { padding: 6px 16px; min-height: 44px; }
.num { min-width: 44px; padding: 6px 12px; }
.btn[disabled] { opacity: .45; cursor: default; }
</style>
