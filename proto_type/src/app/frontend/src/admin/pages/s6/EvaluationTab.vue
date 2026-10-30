<script setup lang="ts">
// 평가셋 탭 (SD_02 §10-3 · 6.5): SC-012 정간보 정상 변환 비율 · SC-016 가짜 악보 차단 · SC-017 진짜 악보 오차단.
// 판정 기준값(설정 탭)을 조정할 근거를 설정 탭 옆에 둔다.
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { adminApi } from '../../api';
import { dateTime, num, pct } from '../../lib/format';
import type { EvaluationMetrics } from '../../types';

const data = ref<EvaluationMetrics | null>(null);
const error = ref('');
const running = ref(false);
const runMsg = ref('');
const runErr = ref('');

async function load() {
  error.value = '';
  try { data.value = await adminApi.evaluation(); } catch (e) { error.value = (e as Error).message || '평가셋 결과를 불러오지 못했습니다.'; }
}
onMounted(load);

async function run() {
  running.value = true;
  runMsg.value = '';
  runErr.value = '';
  try {
    await adminApi.runEvaluation();
    runMsg.value = '평가셋 실행을 시작했습니다. 몇 분 걸릴 수 있습니다. 끝나면 [새로 고침]으로 결과를 보십시오.';
  } catch (e) {
    runErr.value = (e as Error).message || '실행을 시작하지 못했습니다.';
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <section class="stack" aria-labelledby="eval-h">
    <h2 id="eval-h" class="sr-only">평가셋</h2>
    <div class="panel-head">
      <p class="small" style="margin: 0">진짜 악보·가짜 악보 평가셋을 돌려 판정 기준값이 알맞은지 봅니다. 목표값은 첫 측정 뒤 정합니다.</p>
      <div class="row">
        <button type="button" class="btn btn-secondary" @click="load">새로 고침</button>
        <button type="button" class="btn btn-secondary" :disabled="running" @click="run">{{ running ? '시작하는 중…' : '평가셋 실행' }}</button>
      </div>
    </div>
    <p v-if="runMsg" class="notice" role="status"><span class="chip s-progress">실행 중</span><span>{{ runMsg }}</span></p>
    <div v-if="runErr" class="notice n-rejected" role="alert"><span class="title">실행하지 못했습니다</span><p>{{ runErr }}</p></div>
    <div v-if="error" class="notice n-rejected" role="alert"><span class="title">결과를 불러오지 못했습니다</span><p>{{ error }}</p></div>

    <div v-if="data" class="panel">
      <div class="table-scroll">
        <table class="spec">
          <caption class="sr-only">평가셋 지표</caption>
          <thead><tr><th scope="col">지표</th><th scope="col" class="num-col">값</th><th scope="col">뜻</th></tr></thead>
          <tbody>
            <tr><th scope="row">정간보 정상 변환 비율 (SC-012)</th><td class="num-col">{{ pct(data.jeongganbo_normal_rate) }}</td><td class="desc">진짜 정간보 중 대체가 아닌 인식 결과로 나간 비율</td></tr>
            <tr><th scope="row">가짜 악보가 "신뢰"로 나간 건수 (SC-016)</th><td class="num-col">{{ num(data.fake_passed_as_trust, '건') }}</td><td class="desc">목표는 0건</td></tr>
            <tr><th scope="row">가짜 악보 구조 확인 차단 비율 (SC-016)</th><td class="num-col">{{ pct(data.fake_structure_filter_rate) }}</td><td class="desc">가짜 악보 중 구조 확인에서 걸러진 비율</td></tr>
            <tr><th scope="row">진짜 악보 오차단 비율 (SC-017)</th><td class="num-col">{{ pct(data.real_false_block_rate) }}</td><td class="desc">진짜 악보가 구조 없음·불신으로 잘못 막힌 비율</td></tr>
          </tbody>
        </table>
      </div>
      <p v-if="data.last_run" class="small muted" style="margin: 0">마지막 실행 {{ dateTime(data.last_run.started_at) }}<span v-if="data.last_run.status"> · {{ data.last_run.status }}</span></p>
      <p class="small" style="margin: 0">기준값을 바꾸려면 <RouterLink to="/ops/settings">설정 탭</RouterLink>의 "판정 기준"으로 가십시오.</p>
    </div>
  </section>
</template>
