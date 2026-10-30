<script setup lang="ts">
// 관리자 앱 틀 — 관리자 메뉴(C7AdminBar) · 세션 처리는 관리자 화면 이슈에서 v0.1.1 AdminApp.vue 를 옮긴다
import { RouterView } from 'vue-router';
</script>

<template>
  <main id="admin-main">
    <RouterView />
  </main>
</template>
