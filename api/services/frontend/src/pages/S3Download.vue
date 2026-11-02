<script setup lang="ts">
// S3 내려받기 (T127) — SD_02 §6. 네 형식은 서로 기다리지 않는 독립 행(U7).
// (2026-09-30 황송해) 진행 레일(C1)을 뺐다(SD_02 §6-2).
// 편집이 있으면 기기에 저장된 편집 연산을 함께 보내 편집 반영 파일을 만든다.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import C2GateBlock from '@/components/C2GateBlock.vue';
import C9StepBar from '@/components/C9StepBar.vue';
import C3ResultBand from '@/components/C3ResultBand.vue';
import C6DownloadCard from '@/components/C6DownloadCard.vue';
import SharePanel from '@/components/SharePanel.vue';
import StepNav from '@/components/StepNav.vue';
import { useRequestStore } from '@/stores/request';
import { useEditorStore } from '@/stores/editor';
import { useInstrumentStore } from '@/stores/instruments';
import { applyDefaultEnsemble, ensembleLabel } from '@/lib/ensemble';
import { applyOps } from '@/lib/scoreCore';
import type { InstrumentChoiceBody } from '@/types/api';
import type { EditOp, ScoreDoc } from '@/types/score';

const props = defineProps<{ requestNo: string }>();
const router = useRouter();
const req = useRequestStore();
const ed = useEditorStore();
const inst = useInstrumentStore();

const ops = ref<EditOp[]>([]);
const loading = ref(true);
onMounted(async () => {
  await Promise.all([req.load(props.requestNo), inst.load()]);
  ops.value = await ed.peek(props.requestNo);
  loading.value = false;
});

const s = computed(() => req.status);
const expired = computed(() => req.isExpired);
const edited = computed(() => ops.value.length > 0);
// ~~나가기 경고(SD_02 머리말 ⑮) — 같은 악보 흐름(결과 · 편집 · 내려받기) 밖으로 가면 한 번 묻는다~~
// (2026-10-01 황송해 211번) 4단계에서는 나가기 확인 창 · 브라우저 경고를 띄우지 않는다(편집은 3단계에서 끝남, 내려받기만)
async function startOver() {
  const failed = await router.push({ name: 'home' });
  if (!failed) req.reset();
}

// (2026-09-30 황송해 112번) 기준 악보 = 결과 악보 + 기본 국악기 구성(2 · 3단계와 같다) + 편집 기록(2단계 악기 바꾸기 포함).
// MP3 는 이 악보의 성부별 악기(custom)로 만든다
const doc = computed<ScoreDoc | null>(() => {
  const raw = req.score?.scoredoc;
  if (!raw) return null;
  let base = raw;
  try { base = applyDefaultEnsemble(raw, inst.catalog); } catch { /* 기본 구성을 못 얹으면 결과 그대로 */ }
  try { return edited.value ? applyOps(base, ops.value) : base; } catch { return base; }
});
const ensemble = computed(() => ensembleLabel(doc.value, inst.catalog));
const instruments = computed<InstrumentChoiceBody>(() => (doc.value ? { mode: 'custom', tracks: doc.value.parts.map((p, i) => ({ part: i, instrument: p.instrument })) } : { mode: 'default' }));
const band = computed(() => {
  const st = s.value;
  if (!st || st.status !== 'completed') return null;
  return st.fallback || st.route === 'fallback' ? ('fallback' as const) : (st.result_band ?? 'trust');
});
</script>

<template>
  <div class="page">
    <div class="wrap">
      <C9StepBar :current="4" />
      <C2GateBlock v-if="req.loadError" :view="{ ...req.loadError, actionLabel: '악보 다시 올리기' }" @action="router.push({ name: 'home' })" />
      <C2GateBlock v-if="expired && req.gate" :view="req.gate" @action="router.push({ name: 'home' })" />

      <!-- (2026-09-30 102번) 제목 · 안내 문장 · "받을 악보 · 연주 악기" 줄은 뺐다(단순하게). 제목은 읽기 전용으로만 남긴다 -->
      <div class="page-head">
        <h1 class="sr-only">내려받기</h1>
        <C3ResultBand v-if="band" variant="short" :band="band" :fallback-reason="s?.fallback_reason ?? null" :short-text="band === 'fallback' ? '대체 결과 악보를 받습니다' : null" />
      </div>

      <p v-if="loading" class="body" role="status">받을 파일을 준비하고 있습니다.</p>
      <!-- (2026-09-30 141 · 154번) 제목 "변환한 악보 저장하기" — (2026-10-01 황송해 214번) 받기 카드 바깥 위 · 1단계 페이지 제목처럼 .h2 가운데 -->
      <section v-else-if="s" class="save-wrap" aria-labelledby="save-h">
        <h2 id="save-h" class="h2 center-h" data-test="save-title">변환한 악보 저장하기</h2>
        <C6DownloadCard
          :request-no="requestNo" title=""
          :edit-ops="ops" :instruments="instruments" :expired="expired" :midi-available="s.midi_available"
          :notes="{
            mp3: [`연주 악기: ${ensemble || '기본 국악기 구성'}`],
            musicxml: ['추천 조합으로 늘어난 악기는 원래 선율을 복사한 성부로 적힙니다.'],
          }"
        />
      </section>

      <!-- 모두에게 공유(2026-09-30 105번: 2단계에서 옮김, UC18 · SD_02 §4-6) — 기본은 공유 안 함 -->
      <SharePanel v-if="s && s.status === 'completed'" :request-no="requestNo" :expired="expired" />

      <!-- (2026-09-30 황송해 164번) 내가 만든 악보 목록은 1단계(S1 올리기)로 옮겼다 -->

      <!-- 단계 이동(2026-09-30 63번): [이전] = 3단계 듣기와 편집 · 4단계라 [다음] 없음. (101번) [새 악보 올리기] → [메인으로 돌아가기](1단계, 나가기 확인 그대로) -->
      <StepNav prev :prev-to="expired ? { name: 'home', query: { r: requestNo } } : { name: 'listen', params: { requestNo } }" :prev-label="expired ? '결과 화면으로' : '이전'">
        <button type="button" class="btn btn-secondary" data-test="go-main" @click="startOver">메인으로 돌아가기</button>
      </StepNav>
    </div>
  </div>
</template>

<style scoped>
.save-wrap { display: grid; gap: var(--spacing-16); }
</style>
