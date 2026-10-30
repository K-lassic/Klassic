<script setup lang="ts">
// 앱 틀 (T046) — 떠 있는 알약 메뉴(악보 올리기 · API활용) + 먹 하단. 관리자 링크는 두지 않는다(BR-OPS-07).
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { computed, onMounted, watch } from 'vue';
import { useAuthStore } from './stores/auth';

const route = useRoute();
const router = useRouter();
// 2026-09-29 RBAC: 머리 줄에 로그인 상태(SD_02 §9B) — "○○ 님 · [로그아웃]" / [로그인]
const auth = useAuthStore();
// (2026-10-01 황송해 209번) 알림(예: "이미 로그인되어 있습니다.")은 6초 뒤 사라진다 — [닫기]로 바로 닫을 수도 있다
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => auth.notice, (n) => {
  if (noticeTimer) clearTimeout(noticeTimer);
  if (n) noticeTimer = setTimeout(() => { auth.notice = null; }, 6000);
});
onMounted(() => { void auth.fetchMe(); });
async function logout() { await auth.logout(); await router.push({ name: 'login' }); }
const onUpload = computed(() => route.name === 'home' || route.name === 'listen' || route.name === 'download');
</script>

<template>
  <a class="btn btn-primary skip-link" href="#main">본문으로 건너뛰기</a>
  <header class="site-nav">
    <div class="nav-pill">
      <RouterLink class="brand" :to="{ name: 'home' }" aria-label="Klassic 처음으로">
        <!-- (2026-10-01 황송해 203번) 장구 허리 마크(쪽빛) + "Klassic"(Nanum Myeongjo, 먹) — 스타일가이드 §5 -->
        <svg class="brand-mark" width="27" height="28" viewBox="0 0 192 202" aria-hidden="true"><path fill="currentColor" d="M0 0A96 96 0 0 0 192 0H144A48 48 0 0 1 48 0ZM0 202A96 96 0 0 1 192 202H144A48 48 0 0 0 48 202Z" /></svg>
        <span class="brand-name">Klassic</span>
      </RouterLink>
      <nav class="nav-links" aria-label="주 메뉴">
        <RouterLink class="nav-link" :to="{ name: 'home' }" :aria-current="onUpload ? 'page' : undefined">악보 올리기</RouterLink>
        <RouterLink class="nav-link" :to="{ name: 'api-guide' }" :aria-current="route.name === 'api-guide' ? 'page' : undefined">API활용</RouterLink>
      </nav>
      <span class="spacer" />
      <div class="who">
        <template v-if="auth.loggedIn">
          <span class="small">{{ auth.account?.display_name }} 님</span>
          <button type="button" class="btn btn-secondary" @click="logout">로그아웃</button>
        </template>
        <RouterLink v-else-if="route.name !== 'login'" class="btn btn-secondary" :to="{ name: 'login', query: { next: route.fullPath } }">로그인</RouterLink>
      </div>
    </div>
  </header>

  <main id="main" tabindex="-1">
    <p v-if="auth.notice" class="notice site-notice" role="status" data-test="site-notice">
      <span class="title">{{ auth.notice }}</span>
      <button type="button" class="btn btn-secondary btn-sm" @click="auth.notice = null">닫기</button>
    </p>
    <RouterView />
  </main>

  <!-- 바닥글(2026-09-30 황송해, SD_02 ㉙): 두 줄로 줄였다 — 서비스 이름 한 줄, 음원 출처 한 줄(공공누리 출처 표시)
       (175번) "악보 올리기" · "API활용" 링크, 24시간 문장, "3팀"은 뺐다. "Klassic" · 음원 출처(MIT 표시 포함)는 그대로(황송해 결정) -->
  <footer class="footer footer-slim on-ink">
    <div class="wrap">
      <p class="slim-line" data-test="footer-brand"><span class="slim-brand">Klassic</span></p>
      <p class="slim-legal">국악기 음색: 국립국악원 「국악기 디지털 음원」(https://www.gugak.go.kr/digitaleum, 공공누리 제1유형: 출처 표시) · 그 밖의 악기 음원: FluidR3_GM (Frank Wen, MIT 라이선스)</p>
    </div>
  </footer>
</template>

<style scoped>
/* (2026-10-01 황송해 209번) 머리 아래 알림 */
.site-notice { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-16); max-width: 960px; margin: var(--spacing-16) auto 0; }
.site-notice .btn-sm { min-height: 44px; padding: 6px 16px; }
/* (2026-10-01 황송해 203번) 로고 — 장구 허리 마크 쪽빛 · 글자 Nanum Myeongjo 먹(금색 K 는 뺌) · 로고 글자 22px */
.brand { font-size: 22px; }
.brand svg { width: 27px; height: 28px; }
.brand-mark { color: var(--color-logo-indigo); }
.brand-name { font-family: 'KlassicWordmark', var(--font-sans); font-weight: 400; color: var(--color-logo-ink); }
.nav-link[aria-current='page'] { text-decoration: underline; text-underline-offset: 6px; text-decoration-thickness: 2px; }
.foot-title { margin: 0 0 var(--spacing-16); font: 700 var(--text-micro)/14px var(--font-sans); letter-spacing: 0.56px; color: var(--color-dust-taupe); }
.foot-text { display: block; padding: 8px 0; font: 450 var(--text-small)/20px var(--font-sans); color: var(--color-white); }
.footer .h2 { max-width: 760px; }
.who { display: flex; align-items: center; gap: var(--spacing-8); white-space: nowrap; }
</style>
