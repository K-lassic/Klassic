<script setup lang="ts">
// SA 관리자 로그인 (SD_02 §9 · T102). G5: 내부망 밖 403 · 실패 401 · 잠김 423(다시 시도까지 초 세기).
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { GateError } from '@/api/client';
import GateBlock from '../components/GateBlock.vue';
import { useSessionStore } from '../stores/session';
import { formatRemaining, remainingSeconds, retryAtFromError } from '../lib/lockout';

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const loginId = ref('');
const password = ref('');
const busy = ref(false);
const failure = ref<null | 'wrong' | 'network'>(null);
const lockedUntil = ref<Date | null>(null);
const now = ref(Date.now());
const pwInput = ref<HTMLInputElement | null>(null);
const idInput = ref<HTMLInputElement | null>(null);
let tick: ReturnType<typeof setInterval> | null = null;

const blocked = computed(() => session.state === 'blocked');
const remaining = computed(() => remainingSeconds(lockedUntil.value, now.value));
const locked = computed(() => lockedUntil.value !== null && remaining.value > 0);
/** 잠김이 풀린 직후 한 번 알려 준다 */
const unlockedNotice = ref(false);

const disabledReason = computed(() => {
  if (blocked.value) return '내부망에서만 로그인할 수 있습니다';
  if (locked.value) return `잠겼습니다. ${formatRemaining(remaining.value)} 뒤에 다시 시도할 수 있습니다`;
  if (!loginId.value.trim() || !password.value) return '아이디와 비밀번호를 넣어 주십시오';
  return '';
});
const canSubmit = computed(() => !busy.value && !disabledReason.value);

function startCountdown(until: Date) {
  lockedUntil.value = until;
  now.value = Date.now();
  unlockedNotice.value = false;
  if (tick) clearInterval(tick);
  tick = setInterval(() => {
    now.value = Date.now();
    if (remainingSeconds(lockedUntil.value, now.value) <= 0) {
      if (tick) clearInterval(tick);
      tick = null;
      lockedUntil.value = null;
      unlockedNotice.value = true;
    }
  }, 1000);
}
onBeforeUnmount(() => { if (tick) clearInterval(tick); });

async function submit() {
  if (!canSubmit.value) return;
  busy.value = true;
  failure.value = null;
  unlockedNotice.value = false;
  try {
    await session.login(loginId.value.trim(), password.value);
    password.value = '';
    const to = typeof route.query.redirect === 'string' ? route.query.redirect : '/ops/metrics';
    await router.replace(to);
  } catch (e) {
    password.value = '';
    if (e instanceof GateError) {
      if (e.status === 403) session.state = 'blocked';
      else if (e.status === 423) {
        // 시각을 모르면 1분 뒤로 잡는다(서버가 retry_after 를 주는 것이 원칙)
        startCountdown(retryAtFromError(e) ?? new Date(Date.now() + 60_000));
      } else if (e.status === 0) failure.value = 'network';
      else failure.value = 'wrong';
    } else failure.value = 'network';
    await nextTick();
    (failure.value === 'wrong' ? pwInput.value : idInput.value)?.focus();
  } finally {
    busy.value = false;
  }
}

async function recheck() {
  await session.check();
  if (session.state === 'authed') await router.replace('/ops/metrics');
}
defineExpose({ startCountdown });
</script>

<template>
  <main id="admin-main" class="admin-main" style="max-width: 760px">
    <header>
      <span class="eyebrow">관리자 화면</span>
      <h1 class="h2">운영자 로그인</h1>
      <ol class="steps" style="grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 24px" aria-label="진행">
        <li class="current" aria-current="step">
          <span class="mark">1</span><span class="name">로그인</span>
          <span class="state">{{ blocked ? 'G5 내부망 밖' : locked ? 'G5 잠김' : failure === 'wrong' ? 'G5 로그인 실패' : '지금 단계' }}</span>
        </li>
        <li class="todo"><span class="mark">2</span><span class="name">관리자 메뉴</span><span class="state">남은 단계</span></li>
      </ol>
    </header>

    <div v-if="session.expired && !blocked" class="notice n-expired">
      <span class="chip s-expired">로그인 풀림</span>
      <span class="title">로그인이 풀렸습니다</span>
      <p>오래 쓰지 않았거나 다른 곳에서 로그아웃했습니다. 다시 로그인하면 보던 화면으로 돌아갑니다.</p>
    </div>

    <GateBlock
      v-if="blocked"
      gate="G5 관리자 접근"
      title="관리자 화면을 열 수 없습니다"
      reason="팀 서버 내부망 밖에서 접속했습니다. 관리자 화면은 내부망에서만 열립니다."
      owner="운영자(나)가 팀 서버 내부망에서 다시 접속합니다"
      next="내부망에 연결한 뒤 이 주소를 다시 여십시오."
    >
      <div class="row"><button type="button" class="btn btn-secondary" @click="recheck">접속 위치 다시 확인</button></div>
    </GateBlock>
    <GateBlock
      v-else-if="locked"
      gate="G5 관리자 접근"
      title="로그인 실패가 많아 잠시 잠겼습니다"
      :reason="`비밀번호를 여러 번 틀려 이 계정의 로그인을 잠시 막았습니다. 남은 시간 ${formatRemaining(remaining)}.`"
      owner="운영자(나). 시간이 지나면 자동으로 풀립니다"
      next="시간이 지난 뒤 다시 로그인해 주십시오. 비밀번호를 잊었다면 팀장에게 요청하십시오."
    />
    <GateBlock
      v-else-if="failure === 'wrong'"
      gate="G5 관리자 접근"
      title="로그인하지 못했습니다"
      reason="아이디나 비밀번호가 맞지 않습니다."
      owner="운영자(나)"
      next="다시 입력해 주십시오. 여러 번 틀리면 잠시 잠깁니다."
    />
    <div v-else-if="failure === 'network' || session.state === 'offline'" class="notice n-rejected" role="alert">
      <span class="chip s-rejected">연결 안 됨</span>
      <span class="title">관리자 서버에 연결할 수 없습니다</span>
      <p>잠시 뒤 다시 시도해 주십시오.</p>
      <div class="row"><button type="button" class="btn btn-secondary" @click="recheck">다시 연결</button></div>
    </div>
    <p v-if="unlockedNotice" class="small" role="status">잠김이 풀렸습니다. 이제 다시 로그인할 수 있습니다.</p>

    <form class="form-band" aria-labelledby="login-title" @submit.prevent="submit">
      <h2 id="login-title" class="h3">운영자 계정</h2>
      <div class="stack">
        <div class="field">
          <label for="login-id">아이디</label>
          <input id="login-id" ref="idInput" v-model="loginId" class="input" autocomplete="username" :disabled="blocked" />
        </div>
        <div class="field">
          <label for="login-pw">비밀번호</label>
          <input
            id="login-pw" ref="pwInput" v-model="password" class="input" type="password" autocomplete="current-password" :disabled="blocked"
            :aria-invalid="failure === 'wrong' ? 'true' : undefined" :aria-describedby="failure === 'wrong' ? 'login-pw-err' : undefined"
          />
          <span v-if="failure === 'wrong'" id="login-pw-err" class="field-error">아이디나 비밀번호가 맞지 않습니다</span>
        </div>
      </div>
      <div class="row">
        <button type="submit" class="btn btn-primary" :aria-disabled="!canSubmit ? 'true' : undefined" :disabled="busy || blocked || locked" aria-describedby="login-reason">
          {{ busy ? '확인 중…' : '로그인' }}
        </button>
        <span id="login-reason" class="disabled-reason" aria-live="polite">{{ disabledReason }}</span>
      </div>
    </form>

    <p class="small muted">계정이 없습니까? 팀장에게 운영자 계정을 만들어 달라고 요청하십시오. 공용 계정은 없습니다.</p>
  </main>
</template>
