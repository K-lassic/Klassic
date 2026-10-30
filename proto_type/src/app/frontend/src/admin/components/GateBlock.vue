<script setup lang="ts">
// C2 게이트 차단 블록 (SD_02 §3-3): ① 사유 ② 해제 주체 ③ 다음 행동. role="alert" 로 한 번 알리고 남는다(토스트 금지).
defineProps<{ gate: string; title: string; reason: string; owner: string; next?: string; actionLabel?: string; id?: string }>();
const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div :id="id" class="notice n-rejected" role="alert">
    <span class="chip s-rejected">반려 · {{ gate }}</span>
    <span class="title">{{ title }} <span class="small muted">({{ gate }})</span></span>
    <p><b>사유</b> · {{ reason }}</p>
    <p><b>해제 주체</b> · {{ owner }}</p>
    <p v-if="next"><b>다음 행동</b> · {{ next }}</p>
    <slot />
    <div v-if="actionLabel" class="row">
      <button type="button" class="btn btn-primary" @click="emit('action')">{{ actionLabel }}</button>
    </div>
  </div>
</template>
