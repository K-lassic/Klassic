<script setup lang="ts">
// S1 악보 올리기와 결과 — 한 화면이 올리기 → 처리 중 → 결과로 바뀐다(SD_02 §4). 요청 번호는 주소 ?r= 에 둬서 새로 고쳐도 이어 본다.
import { onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useRequestStore } from '@/stores/request';
import S1Upload from './S1Upload.vue';
import S1Result from './S1Result.vue';

const route = useRoute();
const router = useRouter();
const req = useRequestStore();

watch(() => route.query.r, (r) => {
  const no = typeof r === 'string' ? r : null;
  if (no && req.status?.id !== no) void req.load(no);
  if (!no && req.status) req.reset();
}, { immediate: true });

// 접수되면 주소에 요청 번호를 적는다
watch(() => req.status?.id, (id) => {
  if (id && route.query.r !== id) void router.replace({ name: 'home', query: { r: id } });
});

onBeforeUnmount(() => req.stopPolling());

// (2026-09-30) 결과가 나온 뒤에는 S1 결과의 나가기 경고가 먼저 묻는다. 이동이 끝나면 위 watch(r 없음)가 요청을 비운다.
async function startOver() {
  const failed = await router.push({ name: 'home' });
  if (!failed && req.status) req.reset();
}
</script>

<template>
  <S1Result v-if="req.status || req.loadError" @start-over="startOver" />
  <S1Upload v-else />
</template>
