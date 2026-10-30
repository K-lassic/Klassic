<script setup lang="ts">
// 되돌릴 수 없는 일은 한 번 묻는다(SD_02 §8-2 [키 폐기]).
import ModalDialog from './ModalDialog.vue';

defineProps<{ title: string; confirmLabel: string; busy?: boolean; error?: string | null }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <ModalDialog :title="title" size="small" close-label="취소" @close="emit('cancel')">
    <div class="stack-16"><slot /></div>
    <div v-if="error" class="notice n-rejected" role="alert"><p>{{ error }}</p></div>
    <template #foot>
      <button type="button" class="btn btn-secondary" @click="emit('cancel')">그만두기</button>
      <button type="button" class="btn btn-primary" :disabled="busy" @click="emit('confirm')">{{ busy ? '처리 중…' : confirmLabel }}</button>
    </template>
  </ModalDialog>
</template>
