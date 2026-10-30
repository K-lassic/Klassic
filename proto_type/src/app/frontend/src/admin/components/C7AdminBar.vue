<script setup lang="ts">
// C7 관리자 머리띠 (SD_02 §3-8 · T101): 운영자(가림) · 내부망 접속 · 관리자 메뉴 · [로그아웃].
// 사용자 화면의 흰 알약 메뉴와 섞이지 않게 먹 띠로 그린다(BR-OPS-07).
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { maskLoginId } from '../lib/format';
import { S6_TABS } from '../router';

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const who = computed(() => maskLoginId(session.me));

const items = computed(() => [
  ...S6_TABS.map((t) => ({ to: `/ops/${t.id}`, label: t.label, current: route.name === 'ops' && route.params.tab === t.id, gate: t.id === 'settings' && session.settingsBlocked })),
  { to: '/keys', label: '키 관리', current: route.name === 'keys', gate: false },
  // 계정·권한(S7, 2026-09-29 RBAC 운영자 메뉴 — FR-069 · UC17)
  { to: '/accounts', label: '계정·권한', current: route.name === 'accounts', gate: false },
  // 공유 악보(S8, 2026-09-30 황송해 — UC19)
  { to: '/shared', label: '공유 악보', current: route.name === 'shared', gate: false },
]);

async function logout() {
  await session.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="admin-bar on-ink">
    <div class="bar-inner">
      <span class="brand">
        <!-- (2026-10-01 황송해 203번) 장구 허리 마크 — 어두운 머리띠라 글자색(currentColor) -->
        <svg width="27" height="28" viewBox="0 0 192 202" aria-hidden="true"><path fill="currentColor" d="M0 0A96 96 0 0 0 192 0H144A48 48 0 0 1 48 0ZM0 202A96 96 0 0 1 192 202H144A48 48 0 0 0 48 202Z" /></svg>
        Klassic 관리자
      </span>
      <span class="who">운영자 <b>{{ who }}</b> · 내부망 접속</span>
      <nav aria-label="관리자 메뉴">
        <ul>
          <li v-for="it in items" :key="it.to">
            <RouterLink :to="it.to" :aria-current="it.current ? 'page' : undefined">
              {{ it.label }}<span v-if="it.gate" class="gate-mark"> (G6 값 확인)</span>
            </RouterLink>
          </li>
        </ul>
      </nav>
      <span class="spacer" />
      <button type="button" class="copy-btn" @click="logout">로그아웃</button>
    </div>
  </header>
</template>
