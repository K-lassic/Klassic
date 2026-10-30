<script setup lang="ts">
// S1 처리 중 · 결과 (T068 · T076 · T085 · T084 · T091) — SD_02 §4-2 · §4-3 · §4-4
// (2026-09-30 황송해) 진행 레일(C1)을 뺐다 — 처리 단계 바뀜은 화면 읽기 프로그램용 한 줄(aria-live)로만 알린다(SD_02 §13-2).
import { computed, ref, watch } from 'vue';
import C2GateBlock from '@/components/C2GateBlock.vue';
import C9StepBar from '@/components/C9StepBar.vue';
import C3ResultBand from '@/components/C3ResultBand.vue';
import C5PlayerBar from '@/components/C5PlayerBar.vue';
import C4InstrumentPicker from '@/components/C4InstrumentPicker.vue';
import HelpTip from '@/components/HelpTip.vue';
import LeaveConfirm from '@/components/LeaveConfirm.vue';
import { LEAVE_TITLE, allowNextLeave, useLeaveGuard } from '@/composables/useLeaveGuard';
import StepNav from '@/components/StepNav.vue';
import SaveWorkButton from '@/components/SaveWorkButton.vue';
import ScoreView from '@/components/ScoreView.vue';
import { statusSentence, useRequestStore } from '@/stores/request';
import { useInstrumentStore } from '@/stores/instruments';
import { statusText } from '@/i18n/gateMessages';
import { applyDefaultEnsemble, ensembleLabel, type InstrumentChoice } from '@/lib/ensemble';
import { DEFAULT_MELODY, DEFAULT_PERCUSSION, instrumentName } from '@/lib/instruments';
import { applyOps } from '@/lib/scoreCore';
import { LIMITS } from '@/lib/uploadKind';
import { judgmentReasons, loadAccepted, measureCount, needsJudgment, saveAccepted } from '@/lib/judgment';
import { useEditorStore } from '@/stores/editor';
import type { EditOp } from '@/types/score';
import type { ScoreType } from '@/types/api';
import type { ScoreDoc } from '@/types/score';

const emit = defineEmits<{ startOver: [] }>();
const req = useRequestStore();
const inst = useInstrumentStore();
void inst.load();

const s = computed(() => req.status);
const expired = computed(() => req.isExpired);
const TYPE_NAME: Record<ScoreType, string> = { staff: '오선보', jeongganbo: '정간보' };

// ---------- 결과 띠 ----------
const band = computed(() => {
  if (!s.value || s.value.status !== 'completed') return null;
  if (s.value.fallback || s.value.route === 'fallback') return 'fallback' as const;
  return s.value.result_band ?? (s.value.route === 'direct' ? 'direct' : 'trust');
});
const fallbackBusy = ref(false);

// 결과가 나온 뒤(완료 · 대체, 보관 기간 안) 다른 화면으로 가면 한 번 묻는다(SD_02 머리말 ⑮)
// ---------- 결과 판별(2026-09-30 황송해 130번) ----------
// 신뢰 · 직행이면 바로 2단계. 주의 · 대체이면 1단계에 머물며 이유와 [다른 파일 올리기] · [그래도 계속] · [대체 템플릿 받기].
// [그래도 계속]은 이 브라우저에 기억해 새로 고쳐도 2단계로 이어진다
const accepted = ref(false);
watch(() => s.value?.id, (id) => { accepted.value = id ? loadAccepted(id) : false; }, { immediate: true });
const judging = computed(() => !expired.value && needsJudgment(s.value) && !accepted.value);
const reasons = computed(() => (s.value && judging.value ? judgmentReasons(s.value, measureCount(req.score?.musicxml)) : []));
/** 단계 표시 — 처리 중 · 판별 중에는 1단계 */
const stepNow = computed<1 | 2>(() => (req.isProcessing || judging.value || s.value?.status === 'service_down' ? 1 : 2));
function acceptResult() {
  const id = s.value?.id;
  if (!id) return;
  saveAccepted(id);
  accepted.value = true;
}
async function takeFallback() {
  await askFallback();
  acceptResult();
}
function otherFile() {
  // 판별 화면에서는 아직 결과를 쓰지 않았으므로 나가기 확인 없이 1단계 처음으로
  allowNextLeave();
  emit('startOver');
}
const leave = useLeaveGuard(computed(() => s.value?.status === 'completed' && !expired.value && !judging.value), computed(() => s.value?.id ?? null));

// 처리 중 제목 — (2026-09-30 65번) 정확도가 떨어지는 "예상 완료 시간 : n분"은 뺐다
const procTitle = computed(() => {
  const st = s.value;
  if (!st) return '';
  if (st.status === 'awaiting_type_answer') return '악보 종류를 확인해 주십시오';
  return st.status === 'queued' ? '차례를 기다리고 있습니다.' : st.status === 'received' ? '접수했습니다.' : '악보를 읽고 있습니다.';
});
// 2단계 [이전] = 새 악보 올리기(1단계) — 같은 흐름 안 이동이라 나가기 확인 없이(2026-09-30 63번)
function goPrev() {
  if (s.value?.status === 'completed' && !expired.value) allowNextLeave();
  emit('startOver');
}
async function askFallback() {
  fallbackBusy.value = true;
  try { await req.requestFallback(); } finally { fallbackBusy.value = false; }
}

// 직행인데 음표가 없음 — 대체 없이 결과는 그대로(SD_03 §18 #8)
const noNotes = computed(() => !!req.score && s.value?.route === 'direct' && req.score.scoredoc.parts.every((p) => p.notes.length === 0));

// ---------- 연주 · 악기 바꾸기 ----------
// (2026-09-30 황송해 112번, SD_02 머리말) 악기 바꾸기([악기 선택] · 확인/취소)와 재생 빠르기를 2단계로 옮겼다.
// 기준 악보 = 결과 악보 + 기본 국악기 구성. 바꾼 악기는 편집 기록(change_instrument, 기기 자동 저장)으로 남아
// 3단계(S2) · 4단계(S3, MP3 · 편집 반영 파일)에 그대로 이어진다.
const ed = useEditorStore();
watch(() => [s.value?.status, s.value?.id] as const, async ([st, id]) => {
  if (st !== 'completed' || !id || expired.value) return;
  await ed.open(id);
  // 같은 흐름 안이므로 지난 자동 저장본은 묻지 않고 이어서 쓴다(3단계를 바로 열면 S2 가 복원을 묻는다, UC6 A2)
  if (ed.pendingRestore) ed.restore();
}, { immediate: true });
const baseDoc = computed<ScoreDoc | null>(() => {
  const base = req.score?.scoredoc;
  if (!base) return null;
  try { return applyDefaultEnsemble(base, inst.catalog); } catch { return base; }
});
const playDoc = computed<ScoreDoc | null>(() => {
  if (!baseDoc.value) return null;
  if (ed.requestNo !== s.value?.id || !ed.ops.length) return baseDoc.value;
  try { return applyOps(baseDoc.value, ed.ops); } catch { return baseDoc.value; }
});

// (2026-09-30 황송해 161번) 재생 빠르기 = 편집 기록의 곡 전체 빠르기(set_tempo). 1.0배면 연산을 두지 않는다 — 받기 파일도 이 빠르기로
const tempoRate = computed<number | null>(() => (ed.requestNo === s.value?.id ? (ed.tempoBpm ?? 100) / 100 : null));
async function onRateChange(r: number) {
  if (expired.value || ed.requestNo !== s.value?.id) return;
  await ed.setTempo(Math.abs(r - 1) < 0.001 ? null : Math.round(r * 100));
}
const trackPicker = ref<number | null>(null);
const trackChoice = computed<InstrumentChoice>(() => {
  const p = playDoc.value?.parts[trackPicker.value ?? 0];
  return p ? { kind: 'instrument', code: p.instrument } : { kind: 'default' };
});
const partName = (i: number) => {
  const p = playDoc.value?.parts[i];
  return p ? instrumentName(inst.catalog, p.instrument) : '';
};
async function onTrackChoice(c: InstrumentChoice) {
  const i = trackPicker.value;
  const p = i === null ? null : playDoc.value?.parts[i];
  if (i === null || !p || expired.value) return;
  const code = c.kind === 'instrument' ? c.code : p.isPercussion ? DEFAULT_PERCUSSION : DEFAULT_MELODY;
  const ops: EditOp[] = p.instrument !== code ? [{ op: 'change_instrument', part: i, instrument: code }] : [];
  if (ops.length) await ed.pushMany(ops);
  // (2026-09-30 128 · 147번) 고르면 바로 적용하고 선택 패널을 닫는다([닫기]를 누른 것처럼)
  trackPicker.value = null;
}
// (2026-09-30 125번) 서버가 잰 쪽 크기(PDF 쪽 포함)가 경고 기준(500px)보다 작으면 결과 화면에서 알린다(반려 아님)
const lowPages = computed(() => (s.value?.pages ?? []).filter((p) => p.short_edge_px != null && p.short_edge_px < LIMITS.warnEdge));
const lowPagesText = computed(() => {
  const list = lowPages.value;
  if (!list.length) return null;
  const where = (s.value?.pages?.length ?? 0) > 1 ? `${list.map((p) => p.page_no).join(' · ')}쪽: ` : '';
  return `${where}${LIMITS.warnEdge}px 미만 사진은 부정확한 결과가 나올 수 있습니다.`;
});
const playLabel = computed(() => (ed.ops.some((o) => o.op === 'change_instrument') ? ensembleLabel(playDoc.value, inst.catalog) : `기본 국악기 구성 (${ensembleLabel(playDoc.value, inst.catalog)})`));
const player = ref<InstanceType<typeof C5PlayerBar> | null>(null);
const playerBox = ref<HTMLElement | null>(null);
function listenFallback() {
  playerBox.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  void player.value?.play();
}

// 결과 표시 이벤트 — 결과 악보가 보이면 한 번
watch(() => req.score, (sc) => { if (sc && s.value?.status === 'completed') void req.sendEvent('result_shown'); }, { immediate: true });

// ---------- 종류 확인 질문 ----------
const typeBusy = ref(false);
async function answerType(changeTo: ScoreType | null) {
  typeBusy.value = true;
  try { await req.confirmType(changeTo); } finally { typeBusy.value = false; }
}

// (2026-09-30 87번) 결과 악보 [?] — 이 요청에 실제로 쓴 인식 엔진 · 버전 · 등급(대체면 대체 사유)
const ENGINE_NOTE: Record<string, string> = {
  homr: '오선보 사진을 읽는 공개 인식 엔진(딥러닝 모델)',
  audiveris: '오선보를 읽는 공개 인식 엔진(Audiveris)',
  jeongganbo: '정간보 사진을 읽는 공개 연구 모델(jeongganbo-omr)',
};
const GRADE: Record<string, string> = { trust: '신뢰(음표 양 · 마디 박자 · 음역이 자연스러움)', caution: '주의(틀린 음이 있을 수 있음)', distrust: '불신' };
const engineHelp = computed(() => {
  const st = s.value;
  if (!st) return '';
  if (st.fallback || st.route === 'fallback') return `인식 결과 대신 서비스가 준비한 대체 악보입니다${st.fallback_message ? ` (${st.fallback_message})` : ''}.`;
  if (st.route === 'direct') return '올린 파일을 인식 없이 바로 악보로 바꿨습니다.';
  const bits: string[] = [];
  if (st.engine) bits.push(`인식 엔진: ${st.engine.name} ${st.engine.version}${ENGINE_NOTE[st.engine.name] ? ` (${ENGINE_NOTE[st.engine.name]})` : ''}`);
  else bits.push('인식 엔진 정보가 없습니다');
  if (st.score_type) bits.push(`악보 종류: ${TYPE_NAME[st.score_type]}`);
  if (st.validity_grade) bits.push(`결과 등급: ${GRADE[st.validity_grade] ?? st.validity_grade}`);
  // (2026-09-30 119번) 작은 사진을 키워 읽었으면 알린다
  const up = (st.pages ?? []).filter((p) => p.upscaled_short_side_px);
  const upText = up.length
    ? ` 작은 사진(${up.map((p) => `${st.pages!.length > 1 ? `${p.page_no}쪽 ` : ''}짧은 변 ${p.short_edge_px ?? '?'}px`).join(' · ')})을 ${up[0].upscaled_short_side_px}px 로 키워 읽었습니다.`
    : '';
  return `${bits.join(' · ')}. 사진은 모델 API 서버에서 읽었고, 화면 악보는 OpenSheetMusicDisplay 로 그립니다.${upText}`;
});
</script>

<template>
  <div class="page">
    <div class="wrap">
      <C9StepBar v-if="s" :current="stepNow" />
      <p class="sr-only" aria-live="polite">{{ s ? statusSentence(s) : '' }}</p>

      <!-- 요청을 못 찾음 -->
      <C2GateBlock v-if="req.loadError" :view="{ ...req.loadError, actionLabel: '악보 다시 올리기' }" @action="emit('startOver')" />

      <!-- G4 만료 -->
      <C2GateBlock v-if="expired && req.gate" :view="req.gate" @action="emit('startOver')" />

      <!-- 처리 중 -->
      <section v-if="req.isProcessing && s" class="section" aria-labelledby="proc-h">
        <div class="page-head center-h">
          <span class="eyebrow">처리 중</span>
          <h1 id="proc-h" class="h2" data-test="proc-title">{{ procTitle }}</h1>
          <p>결과가 나오면 이 화면에 바로 보여 드립니다.</p>
        </div>

        <div v-if="s.status === 'awaiting_type_answer' && s.detected_type" class="notice" data-test="type-question">
          <span class="chip s-waiting">종류 확인</span>
          <span class="title">{{ TYPE_NAME[s.detected_type] }}처럼 보입니다. 바꾸시겠습니까?</span>
          <p>고르신 종류는 {{ s.score_type ? TYPE_NAME[s.score_type] : '없음' }}입니다. 그대로 진행하면 고르신 대로 읽습니다.</p>
          <p v-if="s.detected_type === 'jeongganbo' || s.score_type === 'jeongganbo'" class="small muted">{{ statusText('JEONGGANBO_NOTE') }}<span class="tip-sub">{{ statusText('JEONGGANBO_SCOPE') }}</span></p>
          <div class="row">
            <button type="button" class="btn btn-primary" :aria-disabled="typeBusy ? 'true' : undefined" autofocus @click="!typeBusy && answerType(null)">그대로 진행</button>
            <button type="button" class="btn btn-secondary" :aria-disabled="typeBusy ? 'true' : undefined" @click="!typeBusy && answerType(s.detected_type)">{{ TYPE_NAME[s.detected_type] }}로 바꾸기</button>
          </div>
        </div>
      </section>

      <!-- 서비스 중단 (SD_02 §14 #3 미정 — 결과를 드리지 못했음을 알리고 다시 올리기만) -->
      <div v-if="s?.status === 'service_down'" class="notice n-rejected" role="alert">
        <span class="chip s-rejected">서비스 중단</span>
        <span class="title">지금은 결과를 드릴 수 없습니다</span>
        <p>대체 악보마저 불러오지 못했습니다. 잠시 뒤 다시 올려 주십시오.</p>
        <div class="row"><button type="button" class="btn btn-primary" @click="emit('startOver')">다시 올리기</button></div>
      </div>

      <!-- 결과 -->
      <!-- (2026-09-30 130번) 1단계 판별 화면 — 주의 · 대체이면 2단계로 넘기기 전에 이유와 고를 버튼 -->
      <section v-if="judging && s" class="section judge" aria-labelledby="judge-h" data-test="judgment">
        <div class="notice" :class="band === 'fallback' ? 'n-fallback' : 'n-caution'">
          <span class="chip" :class="band === 'fallback' ? 's-fallback' : 's-caution'">{{ band === 'fallback' ? '대체 결과' : '주의' }}</span>
          <h1 id="judge-h" class="title">{{ band === 'fallback' ? '인식 결과를 믿기 어려워 대체 악보를 준비했습니다' : '인식 결과를 믿기 어렵습니다' }}</h1>
          <ul class="reasons" data-test="judgment-reasons">
            <li v-for="r in reasons" :key="r">{{ r }}</li>
          </ul>
          <div class="row">
            <button type="button" class="btn btn-secondary" data-test="judge-other" @click="otherFile">다른 파일 올리기</button>
            <button type="button" class="btn btn-primary" data-test="judge-continue" @click="acceptResult">그래도 계속</button>
            <button v-if="band === 'caution'" type="button" class="btn btn-secondary" data-test="judge-fallback" :aria-busy="fallbackBusy ? 'true' : undefined" @click="!fallbackBusy && takeFallback()">대체 템플릿 받기</button>
          </div>
        </div>
      </section>

      <template v-if="s?.status === 'completed' && band && !judging">
        <div class="page-head center-h">
          <h1 class="h2">{{ band === 'fallback' ? '대체 악보를 드렸습니다' : '결과 악보' }}</h1>
        </div>

        <!-- 여러 쪽 PDF — 첫 쪽만 변환했음을 막지 않고 알린다(SD_02 4-2 · UC3 A7, 2026-09-29) -->
        <div v-if="s.notice" class="notice" role="status" data-test="pdf-notice">
          <span class="chip on-white">PDF</span>
          <span class="title">{{ s.notice.message }}</span>
        </div>

        <!-- (2026-09-30 130번) 주의 · 대체는 1단계에서 판별했으므로 2단계에서는 짧은 띠만 -->
        <C3ResultBand
          :band="band"
          :variant="band === 'caution' || band === 'fallback' ? 'short' : undefined"
          :fallback-reason="s.fallback_reason ?? req.score?.fallback_reason ?? null"
          :fallback-message="s.fallback_message ?? req.score?.fallback_message ?? null"
          :retry-hint="s.retry_hint ?? req.score?.retry_hint ?? null"
          :engine="s.engine"
          :file-kind="s.file_kind"
          :busy="fallbackBusy"
          @request-fallback="askFallback"
          @reupload="emit('startOver')"
          @listen="listenFallback"
        />

        <div v-if="noNotes" class="notice n-caution" data-test="no-notes">
          <span class="chip s-caution">음표 없음</span>
          <span class="title">올린 파일에 음표가 없습니다</span>
          <p>파일은 그대로 결과로 두었습니다(바로 연주 파일은 대체 악보로 바꾸지 않습니다). 음표가 들어 있는 다른 파일을 올려 보십시오.</p>
          <div class="row"><button type="button" class="btn btn-secondary" @click="emit('startOver')">다른 파일 올리기</button></div>
        </div>

        <ScoreView :musicxml="req.score?.musicxml ?? null" :label="'결과 악보'" hide-label :part-names="false" zoomable :fetch-error="!req.score && req.loadError ? req.loadError.reason : null">
          <template #help><HelpTip label="인식 엔진" :text="engineHelp" /></template>
        </ScoreView>

        <!-- (2026-09-30 112번) 악기 바꾸기 — 3단계에서 옮김. 바꾼 악기는 3 · 4단계에도 이어진다 -->
        <p v-if="lowPagesText" class="small low-pages" role="status" data-test="low-pages">{{ lowPagesText }}</p>

        <!-- (2026-09-30 127 · 128번) 악기 목록은 표 오른쪽 패널(좁은 화면은 아래) · 고르면 바로 적용([확인] · [취소] 없음) -->
        <section v-if="playDoc" class="section track-card" aria-labelledby="tracks2-h" data-test="step2-tracks">
          <!-- (2026-09-30 150번) 제목 "악기 변경하기" -->
          <h2 id="tracks2-h" class="h3 center-h">악기 변경하기</h2>
          <div class="track-layout" :class="{ split: trackPicker !== null }">
            <div class="table-scroll">
              <table class="spec plain">
                <thead><tr><th scope="col">현재 악기</th><th scope="col">변경할 악기</th></tr></thead>
                <tbody>
                  <tr v-for="(p, i) in playDoc.parts" :key="p.id" :class="{ on: trackPicker === i }">
                    <th scope="row">{{ partName(i) }}</th>
                    <td>
                      <button type="button" class="btn btn-secondary btn-sm" :aria-disabled="expired ? 'true' : undefined" data-test="pick-instrument" @click="!expired && (trackPicker = trackPicker === i ? null : i)">
                        {{ trackPicker === i ? '닫기' : '악기 선택' }}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <C4InstrumentPicker
              v-if="trackPicker !== null && playDoc.parts[trackPicker]"
              class="track-panel"
              scope="track"
              :legend="`${partName(trackPicker)} 악기 선택`"
              :model-value="trackChoice"
              :catalog="inst.catalog"
              :percussion-track="playDoc.parts[trackPicker].isPercussion"
              :disabled-reason="expired ? '보관 기간이 지나 바꿀 수 없습니다' : null"
              @update:model-value="onTrackChoice"
            />
          </div>
        </section>

        <!-- (2026-09-30 111번) 연주 막대는 화면 맨 아래 고정 · (112번) 재생 빠르기도 2단계에 · (113번) 다운받기 카드는 4단계에만 -->
        <div ref="playerBox">
          <C5PlayerBar
            ref="player"
            preload
            dock
            :show-now="false"
            :doc="playDoc"
            :label="playLabel"
            :expired="expired"
            :can-change="false"
            :tempo-rate="tempoRate"
            @rate-change="onRateChange"
            @played="req.sendEvent('first_played')"
          />
        </div>

        <!-- 모두에게 공유는 2026-09-30 105번으로 4단계(S3 내려받기)로 옮겼다(UC18) -->

        <!-- (2026-09-30 SD_02 ㊷) [파일로 받기] · [새 악보 올리기] 삭제, [편집하기] → [다음](오른쪽 끝) -->
        <!-- 단계 이동(2026-09-30 63번): [이전] = 새 악보 올리기(1단계, 확인 창 없음) · [다음] = 3단계 듣기와 편집 -->
        <StepNav prev next :next-to="{ name: 'listen', params: { requestNo: s.id } }" :next-reason="expired ? '보관 기간이 지나 편집할 수 없습니다' : null" @prev="goPrev">
          <!-- (2026-10-01 황송해 202번) [작업 저장하기] — 지금 작업(악기 바꾸기 · 빠르기)을 서버에 저장 -->
          <SaveWorkButton :request-no="s.id" :reason="expired ? '보관 기간이 지나 저장할 수 없습니다' : null" />
        </StepNav>
      </template>

      <!-- 나가기 경고(2026-09-30, SD_02 머리말 ⑮) — [새 악보 올리기] · 머리 메뉴 등 모든 화면 이동에 한 번만 -->
      <LeaveConfirm v-if="leave.open.value" :title="LEAVE_TITLE" :lines="[]" @cancel="leave.cancel" @confirm="leave.confirm" />
    </div>
  </div>
</template>

<style scoped>
.track-card { display: grid; gap: var(--spacing-16); padding: var(--spacing-24); border-radius: var(--rounded-stadium); background: var(--color-white); }
.track-card h2 { margin: 0; }
.track-card table.spec th, .track-card table.spec td { text-align: center; }
/* (2026-09-30 156번) 악기 변경하기 카드 제목 · 내용 가운데 */
.track-card > h2 { text-align: center; }
.track-card .table-scroll { justify-self: center; width: 100%; }
.track-card tr.on th, .track-card tr.on td { background: var(--color-lifted-cream); }
.track-layout { display: grid; gap: var(--spacing-24); align-items: start; }
/* 선택 패널이 열렸을 때만 두 칸(156번: 닫혀 있으면 표가 카드 가운데) */
@media (min-width: 901px) { .track-layout.split { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); } }
.track-panel { position: sticky; top: 120px; max-height: 70vh; overflow-y: auto; }
.low-pages { margin: 0; color: var(--color-clay-deep); }
.judge .reasons { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
.judge h1.title { margin: 0; font: inherit; font-weight: 700; }
.btn-sm { padding: 8px 16px; min-height: 44px; }
.tip-sub { display: block; margin-top: 2px; font-size: var(--text-caption); }
</style>
