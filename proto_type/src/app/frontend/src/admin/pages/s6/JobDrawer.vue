<script setup lang="ts">
// 요청 하나의 판정 기록 (UC9 기본흐름 4 · 6.4): 요청·적용 경로, 엔진 시도, 구조 판정, 종류 불일치, 등급과 항목별 값, 단계별 소요 시간.
import { computed, onMounted, ref } from 'vue';
import { adminApi } from '../../api';
import ModalDialog from '../../components/ModalDialog.vue';
import {
  CHANNEL_LABEL, FILE_KIND_LABEL, GRADE_LABEL, ROUTE_LABEL, SCORE_TYPE_LABEL, STAGE_LABEL, VALIDITY_ITEM_LABEL, VERDICT_LABEL,
  dateTime, jobChip, ms, reasonLabel,
} from '../../lib/format';
import type { JobDetail } from '../../types';

const props = defineProps<{ requestNo: string }>();
const emit = defineEmits<{ close: [] }>();
const job = ref<JobDetail | null>(null);
const error = ref('');

onMounted(async () => {
  try { job.value = await adminApi.job(props.requestNo); } catch (e) { error.value = (e as Error).message || '기록을 불러오지 못했습니다.'; }
});

/** stage_timings 가 없으면 v_request_log 의 *_ms 칸으로 만든다 */
const stages = computed(() => {
  const j = job.value;
  if (!j) return [];
  if (j.stage_timings?.length) return j.stage_timings.map((s) => ({ code: s.stage_code, ms: s.duration_ms }));
  const keys = ['check', 'queue', 'structure', 'recognize', 'jg_convert', 'validity', 'recommend', 'render'] as const;
  return keys.map((k) => ({ code: k, ms: (j as unknown as Record<string, number | null>)[`${k}_ms`] ?? null }));
});
const maxStage = computed(() => Math.max(1, ...stages.value.map((s) => s.ms ?? 0)));

function outcomeChip(o: string) {
  if (o === 'ok' || o === 'success') return { cls: 's-done', text: '성공' };
  if (o === 'timeout') return { cls: 's-rejected', text: '시간 초과' };
  if (o === 'no_notes') return { cls: 's-rejected', text: '음표 없음' };
  if (o === 'skipped') return { cls: 's-expired', text: '건너뜀' };
  return { cls: 's-rejected', text: o === 'failed' ? '실패' : o };
}
function itemVerdict(i: { verdict?: string | null; passed?: boolean | null }) {
  const v = i.verdict ?? (i.passed === true ? 'pass' : i.passed === false ? 'fail' : null);
  if (v === 'pass' || v === 'trust') return { cls: 's-done', text: '통과' };
  if (v === 'caution') return { cls: 's-caution', text: '주의' };
  if (v === 'fail' || v === 'distrust') return { cls: 's-rejected', text: '불통과' };
  return { cls: 's-waiting', text: '값만 기록' };
}
</script>

<template>
  <ModalDialog :title="`요청 ${requestNo}`" variant="drawer" @close="emit('close')">
    <div v-if="error" class="notice n-rejected" role="alert"><p>{{ error }}</p></div>
    <p v-else-if="!job" class="muted" aria-live="polite">불러오는 중…</p>
    <template v-else>
      <div class="row"><span :class="['chip', jobChip(job).cls]">{{ jobChip(job).text }}</span><span v-if="job.fallback_reason" class="small">대체 이유: {{ reasonLabel(job.fallback_reason) }}</span></div>
      <dl class="kv">
        <dt>채널</dt><dd>{{ CHANNEL_LABEL[job.channel] ?? job.channel }}</dd>
        <dt>파일</dt><dd>{{ FILE_KIND_LABEL[job.file_kind] ?? job.file_kind }}</dd>
        <dt>고른 종류 → 확정 종류</dt>
        <dd>{{ job.chosen_score_type ? SCORE_TYPE_LABEL[job.chosen_score_type] : '—' }} → {{ job.confirmed_score_type ? SCORE_TYPE_LABEL[job.confirmed_score_type] : '—' }}</dd>
        <dt>종류 불일치</dt><dd>{{ job.type_mismatch ? `있음${job.type_answer ? ` (답: ${job.type_answer})` : ''}` : '없음' }}</dd>
        <dt>적용 경로</dt><dd>{{ ROUTE_LABEL[job.route] ?? job.route }}</dd>
        <dt>구조 판정</dt><dd>{{ job.structure_verdict ? VERDICT_LABEL[job.structure_verdict] : '—' }}</dd>
        <dt>타당성 등급</dt><dd>{{ job.validity_grade ? GRADE_LABEL[job.validity_grade] : '—' }}</dd>
        <dt>엔진</dt><dd>{{ job.engine_name ? `${job.engine_name} ${job.engine_version ?? ''}` : '—' }}</dd>
        <dt>받은 시각 · 끝난 시각</dt><dd>{{ dateTime(job.received_at) }} · {{ dateTime(job.completed_at) }}</dd>
      </dl>

      <h3 class="h4">단계별 소요 시간</h3>
      <div class="table-scroll">
        <table class="spec">
          <caption class="sr-only">단계별 소요 시간</caption>
          <thead><tr><th scope="col">단계</th><th scope="col" class="num-col">시간</th><th scope="col"><span class="sr-only">비율 막대</span></th></tr></thead>
          <tbody>
            <tr v-for="s in stages" :key="s.code">
              <th scope="row">{{ STAGE_LABEL[s.code] ?? s.code }}</th>
              <td class="num-col">{{ ms(s.ms) }}</td>
              <td style="width: 40%"><div class="progress" aria-hidden="true"><div class="track"><div class="fill" :style="{ width: `${Math.round(((s.ms ?? 0) / maxStage) * 100)}%` }" /></div></div></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="h4">엔진 시도</h3>
      <p v-if="!job.attempts?.length" class="small muted">엔진 시도 기록이 없습니다 (직행·접수 전 대체이거나 기록 누락).</p>
      <div v-else class="table-scroll">
        <table class="spec">
          <caption class="sr-only">엔진 시도 순서</caption>
          <thead><tr><th scope="col">순서</th><th scope="col">엔진</th><th scope="col">결과</th><th scope="col">실패 코드</th><th scope="col" class="num-col">시간</th></tr></thead>
          <tbody>
            <tr v-for="(a, i) in job.attempts" :key="i">
              <td>{{ a.attempt_seq ?? i + 1 }}</td>
              <th scope="row">{{ a.engine_name }} <span class="muted">{{ a.engine_version ?? '' }}</span></th>
              <td><span :class="['chip', outcomeChip(a.outcome).cls]">{{ outcomeChip(a.outcome).text }}</span></td>
              <td><code v-if="a.failure_code">{{ a.failure_code }}</code><span v-else>—</span></td>
              <td class="num-col">{{ ms(a.duration_ms) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="h4">타당성 점검 항목</h3>
      <p v-if="!job.validity_items?.length" class="small muted">점검 항목 기록이 없습니다.</p>
      <div v-else class="table-scroll">
        <table class="spec">
          <caption class="sr-only">타당성 점검 항목별 값</caption>
          <thead><tr><th scope="col">항목</th><th scope="col">값</th><th scope="col">판정</th></tr></thead>
          <tbody>
            <tr v-for="it in job.validity_items" :key="it.item_code">
              <th scope="row">{{ VALIDITY_ITEM_LABEL[it.item_code] ?? it.item_code }}</th>
              <td>{{ it.value ?? '—' }}</td>
              <td><span :class="['chip', itemVerdict(it).cls]">{{ itemVerdict(it).text }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </ModalDialog>
</template>
