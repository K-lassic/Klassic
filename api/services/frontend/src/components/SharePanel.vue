<script setup lang="ts">
// 모두에게 공유 (2026-09-30 황송해, UC18 기본흐름 1 · A1 · A4 · SD_02 §4-6) — S3 내려받기(4단계) 받기 카드 아래(105번, 전: S1 결과)
// 기본은 공유 안 함. 제목(1~60자)을 적고 [모두에게 공유]. 결과 악보만 목록에 남고 올린 사진 · 이름은 보이지 않는다(BR-SHR-02·03).
import { onMounted, ref } from 'vue';
import { api } from '@/api/client';
import { gateFromError } from '@/i18n/gateMessages';
import type { ShareState } from '@/types/api';

const props = defineProps<{ requestNo: string; expired?: boolean; defaultTitle?: string }>();
const state = ref<ShareState>({ shared: false });
const title = ref(props.defaultTitle ?? '');
const busy = ref(false);
const error = ref<string | null>(null);
const base = () => `/api/requests/${encodeURIComponent(props.requestNo)}/share`;

onMounted(async () => {
  try { state.value = await api.get<ShareState>(base()); } catch { /* 공유 상태를 못 읽어도 결과 화면은 그대로 */ }
});

async function share() {
  const t = title.value.trim();
  if (!t) { error.value = '제목을 적어 주십시오.'; return; }
  if ([...t].length > 60) { error.value = '제목은 60자까지 적을 수 있습니다.'; return; }
  busy.value = true; error.value = null;
  try { state.value = await api.put<ShareState>(base(), { title: t }); }
  catch (e) { error.value = gateFromError(e).reason; }
  finally { busy.value = false; }
}
async function unshare() {
  busy.value = true; error.value = null;
  try { state.value = await api.del<ShareState>(base()); }
  catch (e) { error.value = gateFromError(e).reason; }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="share-wrap" aria-labelledby="share-h" data-test="share-panel">
    <!-- (2026-09-30 143 · 144번) 황송해 님 지정 문구 그대로(합쇼체 예외, 스타일가이드 §6-6) -->
    <!-- (2026-10-01 황송해 214번) 제목은 흰 카드 바깥 위 · 1단계 페이지 제목처럼 .h2 가운데 -->
    <h2 id="share-h" class="h2 center-h">제작한 악보를 다른 사람들에게 공유해보아요.</h2>
    <!-- (2026-10-01 황송해 215번) 안내 문장도 카드 바깥 · 제목 바로 아래 가운데(공유하기 전에만) -->
    <p v-if="!state.shared" class="small muted center-h" data-test="share-note">공유된 악보는 공유게시판에 3일간 저장됩니다. 올린 사람의 이름과 개인정보는 보이지 않으니 안심하세요.</p>
    <div class="share">
    <template v-if="state.shared">
      <p class="body" role="status" data-test="share-done">모두에게 공유했습니다: <b>{{ state.title }}</b></p>
      <p v-if="state.taken_down" class="small">운영자가 목록에서 내린 악보입니다.</p>
      <div class="row">
        <button type="button" class="btn btn-secondary" data-test="unshare" :aria-disabled="busy || expired ? 'true' : undefined" @click="!busy && !expired && unshare()">공유 거두기</button>
      </div>
    </template>
    <template v-else>
      <div class="row">
        <!-- (215번) 칸 이름 "제목"은 입력창 왼쪽 같은 줄 -->
        <label class="field grow inline-field">
          <span class="label">제목</span>
          <input v-model="title" class="input" type="text" maxlength="60" placeholder="예: 아리랑 (세마치)" :disabled="expired" data-test="share-title" />
        </label>
        <button type="button" class="btn btn-primary" data-test="share" :aria-disabled="busy || expired ? 'true' : undefined" @click="!busy && !expired && share()">공유하기</button><!-- (2026-09-30 155번) [모두에게 공유] → [공유하기] -->
      </div>
    </template>
    <p v-if="expired" class="small">사유: 보관 기간이 지나 공유할 수 없습니다.</p>
    <p v-if="error" class="field-error" role="status">{{ error }}</p>
    </div>
  </section>
</template>

<style scoped>
.share { display: grid; gap: var(--spacing-16); padding: var(--spacing-24); border-radius: var(--rounded-stadium); background: var(--color-white); }
.share > * { margin: 0; }
.share-wrap { display: grid; gap: var(--spacing-16); }
.share-wrap > p { margin: 0; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-16); }
.grow { flex: 1 1 240px; }
.inline-field { display: flex; align-items: center; gap: var(--spacing-8); }
.inline-field .label { flex: none; }
.inline-field .input { flex: 1 1 auto; min-width: 0; }
</style>
