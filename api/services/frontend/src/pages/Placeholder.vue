<script setup lang="ts">
// 골격(#21)용 빈 화면 — 지금 열린 경로를 보여 줘서 새로고침해도 라우팅이 유지되는지 확인한다. 화면 이슈에서 실제 화면으로 바뀐다.
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<template>
  <section data-test="placeholder">
    <h1>{{ route.meta.title ?? 'Klassic' }}</h1>
    <p>준비 중인 화면입니다. <code data-test="placeholder-path">{{ route.fullPath }}</code></p>
  </section>
</template>
