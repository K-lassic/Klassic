<script setup lang="ts">
// 지표 탭 (SD_02 §10-1 · FR-036 · SC-007~011). "주의"는 성공에 섞지 않고 따로 센다.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { adminApi } from '../../api';
import { FALLBACK_REASON_CODES, ms, num, pct, reasonCode, reasonLabel } from '../../lib/format';
import type { MetricScope, Metrics } from '../../types';

type ScopeKey = 'all' | 'web' | 'api';
const SCOPES: { id: ScopeKey; label: string }[] = [{ id: 'all', label: '전체' }, { id: 'web', label: '웹' }, { id: 'api', label: 'API' }];

const router = useRouter();
const data = ref<Metrics | null>(null);
const error = ref('');
const loading = ref(false);
const scope = ref<ScopeKey>('all');

async function load() {
  loading.value = true;
  error.value = '';
  try { data.value = await adminApi.metrics(); } catch (e) { error.value = (e as Error).message || '지표를 불러오지 못했습니다.'; } finally { loading.value = false; }
}
onMounted(load);

const cur = computed<MetricScope | null>(() => data.value?.scopes?.[scope.value] ?? null);
const empty = computed(() => !!cur.value && !cur.value.image_requests && !cur.value.max_wait_ms && !cur.value.service_down_count);

const ROWS: { label: string; get: (s: MetricScope) => string; apiNA?: boolean }[] = [
  { label: '이미지 요청 수', get: (s) => num(s.image_requests, '건') },
  { label: '한 번에 완성률 (신뢰만)', get: (s) => pct(s.first_pass_rate) },
  { label: '주의 등급 (따로 셈)', get: (s) => num(s.caution_count, '건') },
  { label: '대체 경로 비율', get: (s) => pct(s.fallback_rate) },
  { label: '편집 기능 사용 비율', get: (s) => pct(s.edit_usage_rate), apiNA: true },
  { label: '최장 대기 시간', get: (s) => ms(s.max_wait_ms) },
  { label: '서비스 중단 횟수', get: (s) => num(s.service_down_count, '회') },
];

function drumValue(v: string): { n: string; u: string } {
  const m = /^([\d.,—-]+)(.*)$/.exec(v);
  return m ? { n: m[1], u: m[2] } : { n: v, u: '' };
}
const drums = computed(() => {
  const s = cur.value;
  if (!s) return [];
  return [
    { label: '한 번에 완성률 (신뢰만)', ...drumValue(pct(s.first_pass_rate)), ink: true },
    { label: '대체 경로 비율', ...drumValue(pct(s.fallback_rate)), ink: false },
    { label: '편집 기능 사용 비율', ...drumValue(scope.value === 'api' ? '—' : pct(s.edit_usage_rate)), ink: false },
    { label: '최장 대기 시간', ...drumValue(ms(s.max_wait_ms)), ink: false },
    { label: '서비스 중단 횟수', ...drumValue(num(s.service_down_count, '회')), ink: false },
  ];
});

const reasons = computed(() => {
  const list = data.value?.fallback_by_reason ?? [];
  const counts = new Map<string, number>();
  for (const code of FALLBACK_REASON_CODES) counts.set(code, 0);
  for (const r of list) {
    if (scope.value !== 'all' && r.channel !== scope.value) continue;
    const c = reasonCode(r.reason) ?? r.reason;
    counts.set(c, (counts.get(c) ?? 0) + (r.count ?? 0));
  }
  return [...counts.entries()].map(([code, count]) => ({ code, count }));
});

function openReason(code: string) {
  void router.push({ path: '/ops/jobs', query: { route: 'fallback', reason: code, ...(scope.value !== 'all' ? { channel: scope.value } : {}) } });
}
function openMissing() {
  void router.push({ path: '/ops/jobs', query: { missing: '1' } });
}
</script>

<template>
  <section class="stack" aria-labelledby="metrics-h">
    <h2 id="metrics-h" class="sr-only">지표</h2>
    <div class="panel-head">
      <div class="field">
        <span id="scope-l" class="label">보기 범위</span>
        <div class="segmented" role="radiogroup" aria-labelledby="scope-l">
          <label v-for="s in SCOPES" :key="s.id"><input v-model="scope" type="radio" name="metric-scope" :value="s.id" /><span>{{ s.label }}</span></label>
        </div>
      </div>
      <p class="small muted" style="margin: 0">값은 기준선입니다. 목표값은 첫 측정 뒤 정합니다.</p>
      <button type="button" class="btn btn-secondary" :disabled="loading" @click="load">{{ loading ? '불러오는 중…' : '새로 고침' }}</button>
    </div>

    <div v-if="error" class="notice n-rejected" role="alert">
      <span class="chip s-rejected">불러오기 실패</span><span class="title">지표를 불러오지 못했습니다</span><p>{{ error }}</p>
      <div class="row"><button type="button" class="btn btn-secondary" @click="load">다시 시도</button></div>
    </div>

    <template v-if="data && cur">
      <p v-if="empty" class="notice n-expired"><span class="title">아직 처리된 요청이 없습니다</span><span>요청이 들어오면 여기에 기준선 값이 생깁니다.</span></p>

      <div class="keynums" role="list" aria-label="다섯 가지 지표">
        <div v-for="d in drums" :key="d.label" class="num-cell" role="listitem">
          <div :class="['drum', { ink: d.ink }]"><span class="n">{{ d.n }}</span><span class="u">{{ d.u }}</span></div>
          <span class="h4">{{ d.label }}</span>
        </div>
      </div>

      <div class="grid-2">
        <div class="panel">
          <h3 class="h3">지표: 전체 · 웹 · API</h3>
          <div class="table-scroll">
            <table class="spec">
              <caption class="sr-only">채널별 지표</caption>
              <thead><tr><th scope="col">지표</th><th v-for="s in SCOPES" :key="s.id" scope="col" class="num-col">{{ s.label }}</th></tr></thead>
              <tbody>
                <tr v-for="r in ROWS" :key="r.label">
                  <th scope="row">{{ r.label }}</th>
                  <td v-for="s in SCOPES" :key="s.id" class="num-col">{{ r.apiNA && s.id === 'api' ? '—' : r.get(data.scopes[s.id]) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="small muted" style="margin: 0">편집 기능은 웹에만 있어서 API 칸은 비웁니다.</p>
        </div>

        <div class="panel">
          <h3 class="h3">대체 이유별 ({{ SCOPES.find((s) => s.id === scope)?.label }})</h3>
          <div class="table-scroll">
            <table class="spec">
              <caption class="sr-only">대체 이유별 건수. 이유를 누르면 그 요청 기록을 봅니다</caption>
              <thead><tr><th scope="col">이유</th><th scope="col" class="num-col">건수</th></tr></thead>
              <tbody>
                <tr v-for="r in reasons" :key="r.code">
                  <th scope="row"><button type="button" class="link-btn" @click="openReason(r.code)">{{ reasonLabel(r.code) }}</button></th>
                  <td class="num-col">{{ r.count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="row">
            <span :class="['chip', data.missing_log_count ? 's-caution' : 's-done']">기록이 빠진 요청 {{ data.missing_log_count }}건</span>
            <span v-if="data.missing_log_count" class="small">SC-004 확인이 필요합니다</span>
            <button v-if="data.missing_log_count" type="button" class="btn btn-secondary btn-sm" @click="openMissing">요청 기록에서 보기</button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
