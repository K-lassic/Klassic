<script setup lang="ts">
// C9 단계 표시 (SD_02 §3-10, 2026-09-30 황송해 결정) — "1단계 - 2단계 - 3단계 - 4단계" + 작은 이름.
// 지금 단계까지 켜짐(갈색 채움, 지나온 연결선도 갈색), 지금 단계는 가장 크고 굵게 + 금색 바깥 테(2026-09-30 85번) + aria-current="step".
// (2026-09-30 84번) 연결선 양 끝을 지금 단계 상자(96px + 테 6px) 밖으로 띄워 글자와 겹치지 않게.
// 아직 안 간 단계는 흰 바탕 · slate-gray 글자(한지 위 4.84:1). 요청 번호 · 시간은 넣지 않는다(C1 과 다름).
defineProps<{ current: 1 | 2 | 3 | 4 }>();
// (2026-09-30 황송해 110번) 단계 이름
const STEPS = ['악보 올리기', '다른 악기로 변환하기', '악보 음계 변환하기', '저장하기'] as const;
</script>

<template>
  <nav class="stepbar" aria-label="진행 단계">
    <ol>
      <li
        v-for="(name, i) in STEPS"
        :key="name"
        :class="{ on: i + 1 <= current, now: i + 1 === current }"
        :aria-current="i + 1 === current ? 'step' : undefined"
        :data-test="`step-${i + 1}`"
      >
        <span class="num">{{ i + 1 }}단계</span>
        <span class="name">{{ name }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.stepbar ol { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: start; }
.stepbar li { position: relative; display: grid; justify-items: center; gap: 8px; text-align: center; min-width: 0; }
/* 단계 사이 "-" 연결선 — 지나온 구간(이 단계가 켜짐)은 먹, 안 간 구간은 dust-taupe */
.stepbar li + li::before {
  content: ""; position: absolute; top: 22px; right: calc(50% + 62px); left: calc(-50% + 62px);
  height: 3px; border-radius: 2px; background: var(--color-dust-taupe);
}
.stepbar li.on + li.on::before { background: var(--color-primary); }
.num {
  display: inline-flex; align-items: center; justify-content: center; min-width: 80px; height: 44px; padding: 0 14px;
  border-radius: var(--rounded-pill); border: 1.5px solid var(--color-dust-taupe); background: var(--color-white);
  font: 600 16px/1 var(--font-sans); color: var(--color-slate-gray); white-space: nowrap;
}
.name { font: 500 var(--text-small)/1.3 var(--font-sans); color: var(--color-slate-gray); overflow-wrap: anywhere; }
.on .num { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-canvas-cream); }   /* 2026-09-30 61번: 먹 → 갈색 */
.on .name { color: var(--color-ink-black); }
.now .num {
  height: 52px; min-width: 96px; font-size: 20px; font-weight: 800; margin-top: -4px;
  box-shadow: 0 0 0 4px var(--color-canvas-cream), 0 0 0 6px var(--color-gold);   /* 2026-09-30 85번: 주황 → 금색 */
}
.now .name { font-weight: 800; font-size: 16px; }
@media (max-width: 640px) {
  .num { min-width: 0; height: 36px; padding: 0 8px; font-size: var(--text-caption); }
  .now .num { height: 42px; min-width: 0; font-size: 15px; margin-top: -3px; }
  .stepbar li + li::before { top: 17px; right: calc(50% + 42px); left: calc(-50% + 42px); }
  .name { font-size: var(--text-micro); }
  .now .name { font-size: var(--text-caption); }
}
</style>
