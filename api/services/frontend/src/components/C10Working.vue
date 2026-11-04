<script setup lang="ts">
// 처리 중 애니메이션 (2026-11-04 황송해) — 1단계에서 악보를 올리고 읽는 동안 화면이 멈춘 것처럼 보이지 않게,
// 오선 위로 음표가 차례로 떠오른다(아래 흐르는 막대는 2026-11-04 뺐다). S1Upload(올리는 중) · S1Result(접수 · 대기 · 변환 중)가 쓴다.
// 글자 안내는 부르는 쪽에 있으므로 그림은 화면 읽기 프로그램에 숨기고, label 한 줄만 role="status" 로 알린다.
// 운영체제 "애니메이션 효과 끄기"와 관계없이 늘 움직인다(S1Tour 210번과 같은 결정).
withDefaults(defineProps<{ label?: string }>(), { label: '' });
</script>

<template>
  <div class="working" role="status" data-test="working">
    <svg class="staff" viewBox="0 0 160 56" width="200" height="70" aria-hidden="true" focusable="false">
      <g stroke="currentColor" stroke-width="1" opacity=".35">
        <line v-for="i in 5" :key="i" x1="0" x2="160" :y1="8 + (i - 1) * 10" :y2="8 + (i - 1) * 10" />
      </g>
      <g fill="currentColor">
        <g v-for="(y, n) in [38, 28, 33, 18, 23]" :key="n" class="note" :style="{ animationDelay: `${n * 0.18}s` }">
          <ellipse :cx="22 + n * 28" :cy="y" rx="5.4" ry="3.9" :transform="`rotate(-20 ${22 + n * 28} ${y})`" />
          <rect :x="26.6 + n * 28" :y="y - 24" width="1.4" height="24" />
        </g>
      </g>
    </svg>
    <p v-if="label" class="small muted">{{ label }}</p>
  </div>
</template>

<style scoped>
.working { display: grid; justify-items: center; gap: var(--spacing-16); padding: var(--spacing-24) 0; color: var(--color-primary); }
.working p { margin: 0; }
.staff { display: block; max-width: 100%; height: auto; overflow: visible; }
.note { transform-box: fill-box; transform-origin: center bottom; animation: working-note 1.6s ease-in-out infinite; }
@keyframes working-note {
  0%, 60%, 100% { transform: translateY(0); opacity: .35; }
  25% { transform: translateY(-6px); opacity: 1; }
}
</style>
