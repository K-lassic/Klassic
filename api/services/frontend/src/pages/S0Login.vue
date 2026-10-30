<script setup lang="ts">
// S0 로그인·가입 (2026-09-29 RBAC — design/SD_02 §9B, UC_16, FR-066·067).
// 로그인 안 한 채 S1~S3·[키 신청]에 오면 여기로 오고(?next=), 로그인·가입하면 그 주소로 돌아간다(UC16 A2).
// (2026-09-30 황송해 169~172번, SD_02 §9B) 제목 문구 · 로그인/가입하기 탭을 뺐다. 가입 화면은 "가입하기" 링크(주소 ?tab=signup · /signup)로,
// 로그인으로는 가입 화면의 "로그인" 링크로 오간다. 링크는 주소를 바꿔 뒤로 가기가 되고 next 는 이어진다.
import { computed, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import C2GateBlock from '@/components/C2GateBlock.vue';
import { gateFromError, type GateView } from '@/i18n/gateMessages';
import { useAuthStore } from '@/stores/auth';

type Tab = 'login' | 'signup';
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const tabOf = (q: unknown): Tab => (q === 'signup' ? 'signup' : 'login');
const tab = ref<Tab>(tabOf(route.query.tab));
/** 다른 화면(로그인 ↔ 가입)으로 가는 주소 — next 는 그대로 둔다 */
const otherTo = computed(() => ({ name: 'login', query: { ...route.query, tab: tab.value === 'login' ? 'signup' : undefined } }));
const form = reactive({ email: '', password: '', name: '' });
const busy = ref(false);
const gate = ref<GateView | null>(null);
const locked = ref(false);

const nextPath = computed(() => {
  const n = typeof route.query.next === 'string' ? route.query.next : '';
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') ? n : '/';
});

function switchTab(t: Tab) { tab.value = t; gate.value = null; locked.value = false; }
watch(() => route.query.tab, (q) => { if (tabOf(q) !== tab.value) switchTab(tabOf(q)); });

const submitReason = computed(() => {
  if (locked.value) return '잠금이 풀린 뒤 누를 수 있습니다';
  if (!form.email || !form.password) return '이메일과 비밀번호를 넣어 주십시오';
  if (tab.value === 'signup' && (form.password.length < 8 || !form.name.trim())) return '비밀번호 8자 이상과 이름을 넣어 주십시오';
  return null;
});

async function submit() {
  if (submitReason.value || busy.value) return;
  busy.value = true;
  gate.value = null;
  try {
    if (tab.value === 'login') await auth.login(form.email, form.password);
    else await auth.signup(form.email, form.password, form.name.trim());
    await router.replace(nextPath.value);
  } catch (e) {
    gate.value = gateFromError(e);
    locked.value = gate.value.code === 'LOGIN_LOCKED';
    form.password = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="wrap narrow">
      <div class="page-head">
        <!-- (169번) 로그인 화면의 제목 문구는 뺐다. (174번) 큰 눈썹 제목 — 로그인 화면은 이것이 h1, 가입 화면은 눈썹 "가입하기" + h1 -->
        <h1 v-if="tab === 'login'" class="eyebrow eyebrow-title">로그인</h1>
        <template v-else>
          <span class="eyebrow eyebrow-title">가입하기</span>
          <h1 class="h2">이메일로 바로 가입합니다</h1>
        </template>
        <p>악보 올리기 · 듣기 · 편집 · 내려받기와 API 접근 키 신청은 로그인해야 쓸 수 있습니다. API활용 안내는 로그인 없이 볼 수 있습니다.</p>
        <!-- (2026-09-30 황송해 165번, SD_02 §4-7) 처음 온 사람은 로그인 전에 [체험하기]로 1~4단계를 본다 -->
        <p class="tour-cta"><span>처음 오셨습니까?</span> <RouterLink class="btn btn-secondary" :to="{ name: 'tour' }" data-test="tour-open">체험하기</RouterLink></p>
      </div>

      <!-- (170번) 로그인 · 가입하기 탭은 뺐다 -->
      <section id="panel-auth" class="section" :aria-label="tab === 'login' ? '로그인' : '가입하기'">
        <form class="form-band" novalidate @submit.prevent="submit">
          <!-- (181번) 입력칸은 세로로 한 줄씩 — "레이블 : 입력칸"(가입 화면도 같은 배치) -->
          <div class="fields rows">
            <div class="field">
              <label for="auth-email">이메일</label>
              <input id="auth-email" v-model="form.email" class="input" type="email" autocomplete="username" required />
            </div>
            <div class="field">
              <label for="auth-pw">{{ tab === 'signup' ? '비밀번호 (8자 이상)' : '비밀번호' }}</label>
              <input id="auth-pw" v-model="form.password" class="input" type="password" :autocomplete="tab === 'signup' ? 'new-password' : 'current-password'" required />
            </div>
            <div v-if="tab === 'signup'" class="field">
              <label for="auth-name">이름</label>
              <input id="auth-name" v-model="form.name" class="input" type="text" autocomplete="name" required />
            </div>
          </div>
          <!-- (171번) 버튼은 입력 띠 안 가운데, 막힌 이유는 그 아래 -->
          <div class="submit-row" data-test="submit-row">
            <button type="submit" class="btn btn-primary" :aria-disabled="submitReason ? 'true' : undefined" :aria-describedby="submitReason ? 'auth-why' : undefined">
              {{ busy ? '확인하는 중…' : tab === 'login' ? '로그인' : '가입하기' }}
            </button>
            <span v-if="submitReason" id="auth-why" class="small muted">사유: {{ submitReason }}</span>
          </div>
          <template v-if="tab === 'signup'">
            <p class="small muted">가입하면 '사용자' 권한으로 바로 로그인됩니다. 이메일 인증은 하지 않습니다.</p>
            <p class="small muted" data-test="to-login">이미 계정이 있으십니까? <RouterLink class="link" :to="otherTo">로그인</RouterLink></p>
          </template>
          <!-- (172번) 안내 문구 · "가입하기"는 가입 화면 링크 -->
          <p v-else class="small muted" data-test="to-signup">처음이십니까? <RouterLink class="link" :to="otherTo">가입하기</RouterLink>에서 이메일로 바로 가입할 수 있습니다.</p>
        </form>
        <C2GateBlock v-if="gate" :view="gate" @retry-ready="locked = false" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.narrow { max-width: 640px; }
.submit-row { display: flex; flex-direction: column; align-items: center; gap: var(--spacing-8); text-align: center; }
/* (2026-09-30 황송해 181번) 이메일 · 비밀번호(가입은 이름까지) 한 줄씩 위아래, 줄마다 레이블 왼쪽 · 입력칸 오른쪽. 좁은 화면은 레이블이 위로 */
.form-band .fields.rows { grid-template-columns: 1fr; gap: var(--spacing-16); max-width: 520px; width: 100%; justify-self: center; }
.rows .field { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center; gap: var(--spacing-16); }
@media (max-width: 560px) { .rows .field { grid-template-columns: 1fr; gap: var(--spacing-8); } }
.link { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-decoration: underline; cursor: pointer; }
.tour-cta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-8); }
</style>
