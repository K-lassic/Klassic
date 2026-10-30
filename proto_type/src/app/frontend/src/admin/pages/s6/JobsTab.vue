<script setup lang="ts">
// 요청 기록 탭 (SD_02 §10-3 · 6.4 · BR-OPS-03): 요청 하나의 판정을 끝까지 따라가 본다.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminApi } from '../../api';
import JobDrawer from './JobDrawer.vue';
import {
  CHANNEL_LABEL, FALLBACK_REASON_CODES, FILE_KIND_LABEL, GRADE_LABEL, ROUTE_LABEL, SCORE_TYPE_LABEL, dateTime, jobChip, reasonCode, reasonLabel,
} from '../../lib/format';
import type { JobRow } from '../../types';

const PAGE = 50;
const route = useRoute();
const router = useRouter();

const q = (k: string) => (typeof route.query[k] === 'string' ? (route.query[k] as string) : '');
const channel = ref(q('channel'));
const routeFilter = ref(q('route'));
const reason = ref(q('reason'));
const missing = ref(q('missing') === '1');
const offset = ref(Number(q('offset')) || 0);

const rows = ref<JobRow[]>([]);
const total = ref<number | null>(null);
const loading = ref(false);
const error = ref('');
const openNo = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const res = await adminApi.jobs({
      limit: PAGE, offset: offset.value, channel: channel.value || undefined, route: routeFilter.value || undefined,
      reason: reason.value || undefined, missing: missing.value ? '1' : undefined,
    });
    rows.value = res.items;
    total.value = res.total;
  } catch (e) {
    error.value = (e as Error).message || '요청 기록을 불러오지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

// 서버가 reason 거르기를 모를 수도 있어 화면에서 한 번 더 거른다
const shown = computed(() => (reason.value ? rows.value.filter((r) => reasonCode(r.fallback_reason) === reason.value) : rows.value));

function syncQuery() {
  const query: Record<string, string> = {};
  if (channel.value) query.channel = channel.value;
  if (routeFilter.value) query.route = routeFilter.value;
  if (reason.value) query.reason = reason.value;
  if (missing.value) query.missing = '1';
  if (offset.value) query.offset = String(offset.value);
  void router.replace({ path: '/ops/jobs', query });
}

watch([channel, routeFilter, reason, missing], ([, rt, rs], [, oldRt]) => {
  // 대체 이유를 고르면 경로는 '대체', 경로를 대체가 아닌 것으로 바꾸면 이유는 푼다
  if (rs && rt !== 'fallback') {
    if (rt !== oldRt) reason.value = '';
    else routeFilter.value = 'fallback';
    return; // 바뀐 값으로 한 번 더 불린다
  }
  offset.value = 0;
  syncQuery();
  void load();
});
onMounted(load);

function page(delta: number) {
  offset.value = Math.max(0, offset.value + delta * PAGE);
  syncQuery();
  void load();
}
const hasNext = computed(() => (total.value !== null ? offset.value + PAGE < total.value : rows.value.length === PAGE));
function clearFilters() { channel.value = ''; routeFilter.value = ''; reason.value = ''; missing.value = false; }
</script>

<template>
  <section class="stack" aria-labelledby="jobs-h">
    <h2 id="jobs-h" class="sr-only">요청 기록</h2>
    <form class="panel" aria-label="거르기" @submit.prevent="load">
      <div class="grid-4">
        <div class="field">
          <label for="f-channel">채널</label>
          <select id="f-channel" v-model="channel" class="input compact"><option value="">전체</option><option value="web">웹</option><option value="api">API</option></select>
        </div>
        <div class="field">
          <label for="f-route">적용 경로</label>
          <select id="f-route" v-model="routeFilter" class="input compact">
            <option value="">전체</option><option value="recognize">인식 변환</option><option value="direct">직행</option><option value="fallback">대체</option>
          </select>
        </div>
        <div class="field">
          <label for="f-reason">대체 이유</label>
          <select id="f-reason" v-model="reason" class="input compact">
            <option value="">전체</option>
            <option v-for="c in FALLBACK_REASON_CODES" :key="c" :value="c">{{ reasonLabel(c) }}</option>
          </select>
        </div>
        <div class="field">
          <span class="label">기록</span>
          <label class="row small" style="gap: 8px; min-height: 44px"><input v-model="missing" type="checkbox" /> 기록이 빠진 요청만</label>
        </div>
      </div>
      <div class="row">
        <button type="submit" class="btn btn-secondary" :disabled="loading">{{ loading ? '불러오는 중…' : '새로 고침' }}</button>
        <button type="button" class="btn btn-secondary" @click="clearFilters">거르기 풀기</button>
        <span class="small muted" aria-live="polite">{{ loading ? '' : `${shown.length}건 보는 중${total !== null ? ` · 모두 ${total}건` : ''}` }}</span>
      </div>
    </form>

    <div v-if="error" class="notice n-rejected" role="alert"><span class="title">요청 기록을 불러오지 못했습니다</span><p>{{ error }}</p></div>

    <div class="table-scroll">
      <table class="spec">
        <caption class="sr-only">요청 기록. [자세히]를 누르면 단계 시간·엔진 시도·점검 항목을 봅니다</caption>
        <thead>
          <tr>
            <th scope="col">요청 번호</th><th scope="col">받은 시각</th><th scope="col">채널</th><th scope="col">파일 · 종류</th>
            <th scope="col">경로</th><th scope="col">엔진</th><th scope="col">등급</th><th scope="col">대체 이유</th><th scope="col">상태</th><th scope="col"><span class="sr-only">행동</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && !shown.length"><td colspan="10" class="muted">조건에 맞는 요청이 없습니다.</td></tr>
          <tr v-for="r in shown" :key="r.request_no" :class="{ 'is-selected': openNo === r.request_no }">
            <th scope="row"><code>{{ r.request_no }}</code></th>
            <td class="nowrap">{{ dateTime(r.received_at) }}</td>
            <td>{{ CHANNEL_LABEL[r.channel] ?? r.channel }}</td>
            <td>{{ FILE_KIND_LABEL[r.file_kind] ?? r.file_kind }}<span v-if="r.chosen_score_type" class="muted"> · {{ SCORE_TYPE_LABEL[r.chosen_score_type] ?? r.chosen_score_type }}</span></td>
            <td>{{ ROUTE_LABEL[r.route] ?? r.route }}</td>
            <td>{{ r.engine_name ? `${r.engine_name} ${r.engine_version ?? ''}` : '—' }}</td>
            <td>{{ r.validity_grade ? GRADE_LABEL[r.validity_grade] : '—' }}</td>
            <td>{{ r.fallback_reason ? reasonLabel(r.fallback_reason) : '—' }}</td>
            <td><span :class="['chip', jobChip(r).cls]">{{ jobChip(r).text }}</span></td>
            <td><button type="button" class="btn btn-secondary btn-sm" :aria-label="`${r.request_no} 자세히`" @click="openNo = r.request_no">자세히</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="row">
      <button type="button" class="btn btn-secondary btn-sm" :disabled="offset === 0 || loading" @click="page(-1)">이전 {{ PAGE }}건</button>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="!hasNext || loading" @click="page(1)">다음 {{ PAGE }}건</button>
    </div>

    <JobDrawer v-if="openNo" :request-no="openNo" @close="openNo = null" />
  </section>
</template>
