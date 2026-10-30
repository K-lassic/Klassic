<script setup lang="ts">
// 단계 이동 [이전] [다음] (2026-09-30 황송해 결정 63번, SD_02 머리말) — 1~4단계 화면 맨 아래.
// 1단계는 [이전] 없음, 4단계는 [다음] 없음. 같은 악보 흐름 안의 이동이라 나가기 확인은 뜨지 않는다(부르는 쪽이 정함).
// to 를 주면 링크, 아니면 prev/next 이벤트. nextReason 이 있으면 [다음]은 막히고 이유를 옆에 글자로 보인다(GuardedButton).
import { RouterLink, type RouteLocationRaw } from 'vue-router';
import GuardedButton from '@/components/GuardedButton.vue';

withDefaults(defineProps<{
  prev?: boolean; prevTo?: RouteLocationRaw | null; prevLabel?: string;
  next?: boolean; nextTo?: RouteLocationRaw | null; nextLabel?: string; nextReason?: string | null; nextBusy?: boolean;
  /** 막힌 이유를 화면 글자 대신 읽기 이름으로만(2026-09-30 81번) */
  quietReason?: boolean;
}>(), { quietReason: false, prev: false, prevTo: null, prevLabel: '이전', next: false, nextTo: null, nextLabel: '다음', nextReason: null, nextBusy: false });
const emit = defineEmits<{ prev: []; next: [] }>();
</script>

<template>
  <nav class="step-nav" aria-label="단계 이동" data-test="step-nav">
    <div class="side">
      <template v-if="prev">
        <RouterLink v-if="prevTo" class="btn btn-secondary" :to="prevTo" data-test="step-prev">← {{ prevLabel }}</RouterLink>
        <button v-else type="button" class="btn btn-secondary" data-test="step-prev" @click="emit('prev')">← {{ prevLabel }}</button>
      </template>
    </div>
    <div class="mid"><slot /></div>
    <div class="side end">
      <template v-if="next">
        <RouterLink v-if="nextTo && !nextReason" class="btn btn-primary" :to="nextTo" data-test="step-next">{{ nextLabel }} →</RouterLink>
        <GuardedButton v-else variant="primary" :reason="nextReason" :busy="nextBusy" :quiet-reason="quietReason" data-test="step-next" @click="emit('next')">{{ nextLabel }} →</GuardedButton>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.step-nav { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--spacing-16); padding-top: var(--spacing-24); border-top: 1px solid var(--color-hairline); }
.side { display: flex; }
.end { justify-content: flex-end; }
.mid { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--spacing-8); }
@media (max-width: 560px) {
  .step-nav { grid-template-columns: 1fr 1fr; }
  .mid { grid-column: 1 / -1; order: 3; }
}
</style>
