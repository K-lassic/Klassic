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
        <!-- (2026-11-04 황송해 #165) K 마크(갈색) + "Klassic"(Nanum Myeongjo, 먹) — 장구 허리 마크를 바꿈 -->
        <svg class="brand-mark" width="30" height="28" viewBox="0 0 88 81" aria-hidden="true"><path fill="currentColor" d="M16 80.5C10.9 79.7 8.2 78.2 5.6 74.5C4.5 73 4.3 72.4 4 70.8C3.9 70.1 3.7 69.3 3.6 68.9C3.3 67.5 3.9 63.8 4.8 62C6.2 58.8 10.2 55.6 13.7 54.7C18.9 53.4 23.5 54.1 27.4 56.7C28.8 57.6 29 57.3 29.1 54.7L29.2 52.9L30.2 50.1C31.3 46.7 31.9 45.6 33.8 43.1C37.1 38.6 43.3 34.6 49 33.2C49.7 33.1 50.7 32.8 51.4 32.5C52 32.2 53 32 53.4 31.9C53.9 31.8 54.8 31.6 55.4 31.5C56 31.3 56.9 31.1 57.4 31C58 30.9 58.9 30.7 59.6 30.5C60.2 30.3 61.2 30.1 61.8 29.9C63.6 29.6 68.3 28.2 70.3 27.3C70.9 27 71.7 26.7 72.2 26.5C73.4 25.9 76.2 24.1 78.3 22.5C79.7 21.5 80.1 21.3 80.5 21.8C80.8 22.3 80.8 24.3 80.4 26C80.3 26.7 80.1 27.7 80 28.2C79.8 29.5 78.3 32.6 77.1 34.3C75.3 36.8 72.2 39.2 69.2 40.5C68.5 40.9 67.6 41.3 67.2 41.5C66.9 41.7 66.1 42 65.5 42.1C65 42.3 64.4 42.4 64.2 42.5C64 42.6 63.3 42.8 62.7 42.9C60.4 43.6 60.4 44.2 63.2 47C63.8 47.5 64.6 48.4 65.1 48.9C67 51 72.6 56.9 74.3 58.6C75.2 59.5 76.1 60.5 76.4 60.8C76.6 61.1 78.1 62.7 79.8 64.5C81.5 66.3 83.2 68.1 83.6 68.6C84 69 85 70.1 85.8 71C87.7 73 87.9 73.5 86.9 73.9C86.2 74.1 75.3 74 73.6 73.7C72.3 73.5 70.2 72.9 68.4 72.2C63.9 70.6 59.8 67 55.2 60.9C54.4 59.7 52.4 57.1 51.4 55.8C50.8 55.1 50.1 54.1 49.8 53.8C47.9 50.7 45.4 48.9 42.8 48.6C42 48.5 39.5 49.1 38.5 49.6C36.6 50.6 34.6 53.1 34.1 55.1C33.9 55.5 33.6 56.3 33.4 56.9L32.9 58.1L32.9 62.8C32.9 67.7 32.9 67.6 32.3 69.8C31.2 73.6 27.3 77.8 23.4 79.3C20.7 80.4 17.9 80.8 16 80.5ZM1.2 58C1 57.8 0.9 27.7 1.1 25.4C1.2 24.1 1.5 23.1 2.4 20.2C3.6 16.4 6.8 12.3 10.4 9.9C12.3 8.6 15.1 7.3 16.4 6.9C17.1 6.8 18 6.5 18.6 6.3C19.9 6 21.5 5.8 23.3 5.8C24.8 5.7 25.3 5.9 25.5 6.5C25.6 6.7 25.6 12.9 25.5 28.6L25.4 50.4L25.2 50.7C24.8 51.2 23.4 51.2 20.9 50.6C18.8 50.1 17.4 50.1 15.5 50.5C14.8 50.6 13.9 50.8 13.6 50.8C12 51 11.5 51.2 9.6 52.2C6.2 53.9 4.5 55.2 2.4 57.7C1.9 58.3 1.5 58.4 1.2 58ZM30.3 39.7C30.1 39.4 30.1 39 30.1 37.4C30.1 35.5 30.1 35.4 30.6 33.4C31.1 31.5 31.3 30.9 32.7 27.9C34.2 24.6 39.2 19.5 43 17.5C43.5 17.2 44.2 16.8 44.6 16.6C45 16.3 46.1 15.9 47 15.5C47.9 15.2 49 14.7 49.4 14.6C49.8 14.4 50.7 14.1 51.4 14C52.1 13.8 52.9 13.6 53.1 13.5C53.7 13.2 57.1 12.4 58.5 12.1C59.2 12 60.1 11.7 60.5 11.6C61 11.4 62.4 11 63.6 10.6C65 10.2 66.4 9.8 67.1 9.4C67.8 9.1 68.4 8.9 68.4 8.9C68.6 8.9 70.6 7.9 71.7 7.3C74.9 5.5 76.5 4.3 79.1 1.6C80.6 0.1 80.9 0.2 81.1 2.3C81.5 4.9 80.8 10 79.8 12.4C79.2 13.8 76.8 16.9 75.2 18.3C73.4 19.8 69.6 22 67.1 22.9C66.5 23.1 65.8 23.4 65.5 23.5C64.9 23.8 62.3 24.5 60.5 24.9C59.8 25 58.7 25.3 58.2 25.5C57.6 25.7 56.5 26 55.8 26.1C54.4 26.3 51.5 27 49.8 27.6C49.2 27.8 48 28.2 47.2 28.4C44.3 29.4 41.2 30.9 38.9 32.6C38.5 32.9 37.7 33.4 37.2 33.8C36.3 34.3 34.6 36 32.1 38.6C31.4 39.4 30.7 40 30.7 40C30.6 40 30.4 39.8 30.3 39.7Z" /></svg>
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
/* (2026-10-01 황송해 203번) 로고 글자 Nanum Myeongjo 먹 · 22px — (#165) 마크는 갈색 K 마크로 바꿈 */
.brand { font-size: 22px; }
.brand svg { width: 30px; height: 28px; }
.brand-mark { color: var(--color-logo-brown); }
.brand-name { font-family: 'KlassicWordmark', var(--font-sans); font-weight: 400; color: var(--color-logo-ink); }
.nav-link[aria-current='page'] { text-decoration: underline; text-underline-offset: 6px; text-decoration-thickness: 2px; }
.foot-title { margin: 0 0 var(--spacing-16); font: 700 var(--text-micro)/14px var(--font-sans); letter-spacing: 0.56px; color: var(--color-dust-taupe); }
.foot-text { display: block; padding: 8px 0; font: 450 var(--text-small)/20px var(--font-sans); color: var(--color-white); }
.footer .h2 { max-width: 760px; }
.who { display: flex; align-items: center; gap: var(--spacing-8); white-space: nowrap; }
</style>
