<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import C7AdminBar from './components/C7AdminBar.vue';
import { setSessionLostHandler } from './api';
import { useSessionStore } from './stores/session';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

// 쓰는 도중 로그인이 풀리면(401 ADMIN_LOGIN_REQUIRED) 로그인 화면으로 — 돌아올 자리를 기억한다
setSessionLostHandler(() => {
  if (session.state !== 'authed') return;
  session.markExpired();
  void router.push({ name: 'login', query: { redirect: route.fullPath } });
});
onBeforeUnmount(() => setSessionLostHandler(null));

// 해시 라우터라 #admin-main 으로 주소를 바꾸면 안 된다 — 초점만 옮긴다
function skipToMain() {
  const main = document.getElementById('admin-main');
  if (!main) return;
  main.setAttribute('tabindex', '-1');
  main.focus();
}
</script>

<template>
  <a class="skip-link" href="#admin-main" @click.prevent="skipToMain">본문으로 건너뛰기</a>
  <C7AdminBar v-if="session.state === 'authed' && route.name !== 'login'" />
  <RouterView />
</template>
