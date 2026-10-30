<script setup lang="ts">
// 앱 틀 — 머리 메뉴 · 바닥글은 #39(머리 메뉴) · #38(공통 컴포넌트)에서 v0.1.1 App.vue 를 옮긴다. 관리자 링크는 두지 않는다(BR-OPS-07).
import { RouterView } from 'vue-router';
</script>

<template>
  <main id="main" tabindex="-1">
    <RouterView />
  </main>
</template>
