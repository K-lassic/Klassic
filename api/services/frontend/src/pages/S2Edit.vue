<script setup lang="ts">
// S2 듣기와 편집 (T120 · T119 · T084 · T091) — SD_02 §5
// (내 음원 .sf2 올리기·지정(T130, US8)은 2026-09-29 삭제 — 연주 음원은 기본 gugak.sf2 · FluidR3_GM.sf2 만)
// (2026-09-30 황송해) 진행 레일(C1)을 뺐다(SD_02 §5-2).
// 원본(서버 ScoreDoc)은 그대로 두고 편집 연산 목록만 쌓는다(U6). 연산은 기기(IndexedDB)에 자동 저장.
import { computed, onMounted, ref } from 'vue';
import { RouterLink, onBeforeRouteLeave, useRouter } from 'vue-router';
import C2GateBlock from '@/components/C2GateBlock.vue';
import C9StepBar from '@/components/C9StepBar.vue';
import C3ResultBand from '@/components/C3ResultBand.vue';
import C5PlayerBar from '@/components/C5PlayerBar.vue';
import GuardedButton from '@/components/GuardedButton.vue';
import LeaveConfirm from '@/components/LeaveConfirm.vue';
import StepNav from '@/components/StepNav.vue';
import SaveWorkButton from '@/components/SaveWorkButton.vue';
import { LEAVE_TITLE, useLeaveGuard } from '@/composables/useLeaveGuard';
import NoteInspector from '@/components/NoteInspector.vue';
import { orderedNoteIds } from '@/lib/noteMatch';
import ScoreView from '@/components/ScoreView.vue';
import { useRequestStore } from '@/stores/request';
import { useEditorStore } from '@/stores/editor';
import { useInstrumentStore } from '@/stores/instruments';
import { applyDefaultEnsemble, ensembleLabel } from '@/lib/ensemble';
import { instrumentName } from '@/lib/instruments';
import { applyOps, fitToRangeOps, rangeWarnings, summarizeOps, toMusicXml, withOriginalInstruments } from '@/lib/scoreCore';
import { formatClock } from '@/lib/time';
import { api } from '@/api/client';
import type { EditOp, ScoreDoc } from '@/types/score';

const props = defineProps<{ requestNo: string }>();
const router = useRouter();
const req = useRequestStore();
const ed = useEditorStore();
const inst = useInstrumentStore();

const loading = ref(true);
onMounted(async () => {
  await Promise.all([req.load(props.requestNo), inst.load(true)]);
  await ed.open(props.requestNo);
  loading.value = false;
});

const s = computed(() => req.status);
const expired = computed(() => req.isExpired);
const lockReason = computed(() => (expired.value ? '보관 기간이 지나 편집할 수 없습니다' : null));

// ---------- 원본 · 편집본 ----------
// (2026-09-30 황송해 112 · 114번) 기준 악보 = 결과 악보 + 기본 국악기 구성(2단계와 같다). 전에는 인식 결과의 성부 악기
// ("목소리(Voice Oohs)" 등)가 그대로 보이고 들렸다. 2단계에서 바꾼 악기는 편집 기록으로 이 위에 얹힌다.
const original = computed<ScoreDoc | null>(() => {
  const base = req.score?.scoredoc;
  if (!base) return null;
  try { return applyDefaultEnsemble(base, inst.catalog); } catch { return base; }
});
// 연산을 적용하지 못하면 원본을 보이고 오류를 알린다(계산 안에서 상태를 바꾸지 않는다)
const applied = computed<{ doc: ScoreDoc | null; error: boolean }>(() => {
  if (!original.value) return { doc: null, error: false };
  try { return { doc: applyOps(original.value, ed.ops), error: false }; }
  catch { return { doc: original.value, error: true }; }
});
const edited = computed<ScoreDoc | null>(() => applied.value.doc);
const applyError = computed(() => applied.value.error);
const playDoc = computed<ScoreDoc | null>(() => {
  if (!edited.value) return null;
  if (ed.listenMode === 'original') { try { return withOriginalInstruments(edited.value); } catch { return edited.value; } }
  return edited.value;
});
// 화면 악보도 기준 악보에서 만든다(114번) — 성부 이름이 악기 이름으로 나오고, 음표 고르기 연결도 같은 악보를 본다
const editedXml = computed(() => {
  if (!edited.value) return null;
  try { return toMusicXml(edited.value); } catch { return req.score?.musicxml ?? null; }
});
// (2026-09-30 박예은 BR-EDT-03) 음역 경고 글은 없고, 벗어난 음표 머리를 악보에서 빨간색으로 칠한다. 연주는 그대로.
const outOfRange = computed(() => {
  if (!edited.value) return [] as string[];
  try { return rangeWarnings(edited.value).map((w) => w.noteId); } catch { return []; }
});
/** [음역에 맞게 옥타브 옮기기] — 누를 때만 벗어난 음을 가장 가까운 옥타브로(편집 기록 · 되돌리기 가능) */
async function fitRange() {
  if (!edited.value || expired.value) return;
  let ops: EditOp[] = [];
  try { ops = fitToRangeOps(edited.value); } catch { ops = []; }
  if (ops.length) await push(ops);
}

const playLabel = computed(() => {
  const names = ensembleLabel(playDoc.value, inst.catalog, { original: ed.listenMode === 'original' });
  return ed.listenMode === 'original' ? `원래 악기 (${names})` : names;
});

// ---------- 자동 저장 · 복원 ----------
const saveLine = computed(() => {
  if (ed.saveState === 'failed') return '기기에 저장하지 못했습니다. 이 창을 닫으면 편집이 사라질 수 있습니다';
  if (!ed.isEdited && ed.listenMode === 'edit') return '원본과 같습니다';
  return ed.savedAt ? `편집본 · 기기에 자동 저장됨 (${formatClock(ed.savedAt)})` : '편집본';
});
async function push(op: EditOp | EditOp[]) {
  if (expired.value) return;
  if (Array.isArray(op)) await ed.pushMany(op); else await ed.push(op);
}
const confirmRevert = ref(false);
async function revert() {
  await ed.revertAll();
  confirmRevert.value = false;
}

// (2026-09-30 93번) 전체 구성 · 추천 조합 고르기(C4 연주 악기 고르기)는 화면에서 뺐다 — 악기 표의 [악기 선택]만 남는다.
// 추천 API 는 서버에 그대로 있지만 이 화면에서는 부르지 않는다(UC_05 머리말).

// ---------- 트랙 ----------
const selectedPart = ref(0);
// (2026-09-30 황송해, SD_02 §5) 악보에서 누른 음표 — 오른쪽 "고른 음표"에서 고친다
const selectedNote = ref<string | null>(null);
function onSelectNote(id: string) {
  selectedNote.value = id;
  const p = edited.value?.parts.findIndex((x) => x.notes.some((n) => n.id === id)) ?? -1;
  if (p >= 0) selectedPart.value = p;
}
// 트랙을 바꾸면(버튼 · 악보 음자리표) 그 트랙 첫 음표를 고른다(2026-09-30, SD_02 ㉕)
function onPickPart(p: number) {
  selectedPart.value = p;
  selectedNote.value = edited.value ? orderedNoteIds(edited.value, p)[0] ?? null : null;
}

// (2026-09-30 황송해 161번) 재생 빠르기 = 편집 기록의 곡 전체 빠르기(set_tempo). 1.0배면 연산을 두지 않는다 — 받기 파일도 이 빠르기로
const tempoRate = computed<number | null>(() => (ed.requestNo === props.requestNo ? (ed.tempoBpm ?? 100) / 100 : null));
async function onRateChange(r: number) {
  if (expired.value || ed.requestNo !== props.requestNo) return;
  await ed.setTempo(Math.abs(r - 1) < 0.001 ? null : Math.round(r * 100));
}
// (2026-09-30 115번) 악기 바꾸기는 2단계로 옮겼다 — 3단계 악기 표는 현재 악기 · 음량만
// (2026-09-30 SD_02 ㊶) 악기 추가 · [빼기]는 화면에서 뺐다 — 편집 연산 add_instrument · remove_track 은 score-core 에 호환용으로 남는다


// ---------- 편집 마치기 · 기록 ----------
const finishing = ref(false);
const finished = ref(false);
async function sendEdits(): Promise<boolean> {
  try {
    await api.put(`/api/requests/${encodeURIComponent(props.requestNo)}/edits`, { summary: summarizeOps(ed.ops), ops: ed.ops });
    return true;
  } catch { return false; }
}
async function finish() {
  finishing.value = true;
  await sendEdits();
  finished.value = true;
  finishing.value = false;
  await router.push({ name: 'download', params: { requestNo: props.requestNo } });
}
// 나가기 경고(SD_02 머리말 ⑮ · §5-3) — 같은 악보 흐름(결과 · 편집 · 내려받기) 밖으로 가면 한 번 묻는다.
// 편집 기록 보내기(아래 onBeforeRouteLeave)보다 먼저 등록해, [취소]면 기록도 보내지 않는다.
const leave = useLeaveGuard(computed(() => !loading.value && s.value?.status === 'completed' && !expired.value), computed(() => props.requestNo));
const leaveLines = computed(() => (ed.isEdited && !finished.value && ed.saveState === 'failed' ? ['고친 내용을 이 기기에 저장하지 못했습니다. 나가면 편집이 사라질 수 있습니다.'] : []));
onBeforeRouteLeave(() => { if (!finished.value && ed.isEdited && !expired.value) void sendEdits(); });

const band = computed(() => {
  const st = s.value;
  if (!st || st.status !== 'completed') return null;
  if (st.fallback || st.route === 'fallback') return 'fallback' as const;
  return st.result_band ?? 'trust';
});
// (2026-09-30 황송해, SD_02 ㊵) 화면에 "트랙"이라는 말을 쓰지 않고 악기 이름(같은 악기는 번호)으로 부른다
const partLabel = (i: number) => trackButtonNames.value[i] ?? '';
/** 악보 음표 수정의 악기 버튼 이름 — 그 트랙 악기 이름, 같은 악기가 둘 이상이면 뒤에 번호(피아노1 · 피아노2) (2026-09-30, SD_02 ㉞) */
const trackButtonNames = computed(() => {
  const names = (edited.value?.parts ?? []).map((_p, i) => trackInstrumentName(i));
  const count = new Map<string, number>();
  names.forEach((n) => count.set(n, (count.get(n) ?? 0) + 1));
  const seen = new Map<string, number>();
  return names.map((n) => {
    if ((count.get(n) ?? 0) < 2) return n;
    const k = (seen.get(n) ?? 0) + 1; seen.set(n, k);
    return `${n}${k}`;
  });
});
const trackInstrumentName = (i: number) => {
  const p = edited.value?.parts[i];
  if (!p) return '';
  if (ed.listenMode === 'original' && p.sourceInstrument) return `${p.sourceInstrument.name} (원래 악기)`;
  return instrumentName(inst.catalog, p.instrument);
};
</script>

<template>
  <div class="page">
    <div class="wrap">
      <C9StepBar :current="3" />
      <C2GateBlock v-if="req.loadError" :view="{ ...req.loadError, actionLabel: '악보 다시 올리기' }" @action="router.push({ name: 'home' })" />
      <C2GateBlock v-if="expired && req.gate" :view="req.gate" @action="router.push({ name: 'home' })" />

      <p v-if="loading" class="body" role="status">편집할 악보를 불러오고 있습니다.</p>
      <div v-else-if="s && s.status !== 'completed' && !expired" class="notice">
        <span class="chip s-progress">처리 중</span>
        <span class="title">아직 결과가 나오지 않았습니다</span>
        <p>결과가 나오면 편집할 수 있습니다.</p>
        <div class="row"><RouterLink class="btn btn-secondary" :to="{ name: 'home', query: { r: requestNo } }">결과 화면으로 가기</RouterLink></div>
      </div>

      <template v-if="edited && !loading">
        <div class="page-head">
          <!-- (2026-09-30 137번) 제목을 안내 문장으로 바꾸고 같은 뜻 문장은 한 번만 -->
          <!-- (2026-09-30 157번) 가운데 정렬 -->
          <h1 class="h2 center-h" data-test="s2-lede">악기를 바꾸고, 음을 고쳐 우리나라의 전통 악기를 즐겨보십시오.</h1>
          <C3ResultBand v-if="band" variant="short" :band="band" :fallback-reason="s?.fallback_reason ?? null" :fallback-message="s?.fallback_message ?? null" />
        </div>

        <!-- 복원 질문 (UC6 A2) — 열 때 한 번만 -->
        <div v-if="ed.pendingRestore" class="notice n-caution" role="alertdialog" aria-labelledby="restore-t" data-test="restore">
          <span class="chip s-caution">이어서 하기</span>
          <span id="restore-t" class="title">지난번 편집이 남아 있습니다. 이어서 하시겠습니까?</span>
          <p>{{ formatClock(new Date(ed.pendingRestore.saved_at)) }}에 기기에 저장한 편집 {{ ed.pendingRestore.ops.length }}건이 있습니다.</p>
          <div class="row">
            <button type="button" class="btn btn-primary" autofocus @click="ed.restore()">이어서</button>
            <button type="button" class="btn btn-secondary" @click="ed.discard()">처음부터</button>
          </div>
        </div>

        <p v-if="applyError" class="small" role="status">편집 일부를 적용하지 못했습니다. 원본으로 되돌린 뒤 다시 해 보십시오.</p>

        <!-- 두 단(2026-09-30, SD_02 §5): 왼쪽 악보(따라옴) · 오른쪽 편집 패널. 좁은 화면은 위아래 -->
        <div class="edit-layout">
          <div class="score-col">
            <ScoreView
              :musicxml="editedXml" zoomable :label="ed.isEdited ? '악보 (편집본)' : '악보 (원본)'"
              :doc="edited" :out-of-range="outOfRange" :selected-note-id="selectedNote" :fetch-error="!req.score && req.loadError ? req.loadError.reason : null" @select="onSelectNote" @pick-part="onPickPart"
            />
            <p v-if="outOfRange.length" class="range-fit small">
              <span>빨간 음표 {{ outOfRange.length }}개는 악기 음역을 벗어난 음입니다. 그대로 연주하며, 원하시면 옥타브를 옮길 수 있습니다.</span>
              <button type="button" class="btn btn-secondary btn-sm" data-test="fit-range" :aria-disabled="expired ? 'true' : undefined" @click="fitRange">음역에 맞게 옥타브 옮기기</button>
            </p>
          </div>

          <div class="panel-col">
            <C5PlayerBar preload :doc="playDoc" :label="playLabel" :edited="ed.isEdited" :expired="expired" :can-change="false" :show-now="false" :tempo-rate="tempoRate" dock @rate-change="onRateChange" />

            <NoteInspector
              :doc="edited" :note-id="selectedNote" :part="selectedPart" :disabled="expired" :part-label="partLabel" :track-names="trackButtonNames"
              @select="onSelectNote" @part="onPickPart"
              @pitch="(id, midi) => push({ op: 'set_note_pitch', note_id: id, midi_pitch: midi })"
            />

            <!-- (2026-09-30 56 · 98번) "전체 음 반음씩 옮기기" 흰 카드 — "악보 음표 수정" 바로 아래 -->
            <!-- (2026-09-30 황송해 194 · 195번) 제목은 "악기 음량 조절하기"와 같은 h3, 그 아래 줄에 [−] 값 [+](줄바꿈 없음).
                 전에는 제목 · 버튼 · 값이 한 줄(flex-wrap)이라 좁은 패널에서 [+]만 다음 줄로 떨어졌다. 아이콘은 글꼴 글자 대신 SVG 선으로 그려 가운데에 둔다 -->
            <div class="transpose-card" role="group" aria-labelledby="tr-l" data-test="transpose">
              <h2 id="tr-l" class="h3 center-h">전체 음 반음씩 옮기기</h2>
              <div class="tr-stepper" data-test="tr-stepper">
                <button type="button" class="btn-icon" aria-label="반음 내리기" :disabled="expired" @click="push({ op: 'transpose', semitones: -1 })">
                  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                </button>
                <output class="h3 tr-val" aria-live="polite">{{ ed.transposeTotal > 0 ? `+${ed.transposeTotal}` : ed.transposeTotal }}</output>
                <button type="button" class="btn-icon" aria-label="반음 올리기" :disabled="expired" @click="push({ op: 'transpose', semitones: 1 })">
                  <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 10h12M10 4v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
                </button>
              </div>
            </div>

            <!-- 트랙 표 -->
            <!-- (2026-09-30 94~97번) 흰 카드 · 칸 이름 "현재 악기 · 음량 · 변경할 악기" · 음량은 막대만 · 칸 가운데 -->
            <section class="section track-card" aria-labelledby="tracks-h">
              <!-- (2026-09-30 136번) 제목 "악기 음량 조절하기", 칸 이름 "악기" -->
              <h2 id="tracks-h" class="h3 center-h">악기 음량 조절하기</h2>
              <div class="table-scroll">
                <table class="spec plain">
                  <thead><tr><th scope="col">악기</th><th scope="col">음량</th></tr></thead>
                  <tbody>
                    <tr v-for="(p, i) in edited.parts" :key="p.id">
                      <th scope="row" class="inst-name">{{ partLabel(i) }}</th>
                      <td>
                        <label class="vol">
                          <span class="sr-only">{{ partLabel(i) }} 음량</span>
                          <input
                            type="range" min="0" max="127" step="1" :value="p.volume" :disabled="expired"
                            :aria-valuetext="`${p.volume}`"
                            @change="push({ op: 'set_track_volume', part: i, velocity: Number(($event.target as HTMLInputElement).value) })"
                          />
                        </label>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- (2026-09-30 93번) 전체 구성 고르기(C4 "연주 악기 고르기" — 기본 · 추천 조합 · 원래 악기)는 뺐다. 악기 표의 [악기 선택](그 악기 하나)만 남는다 -->
          </div>

          <!-- 편집 상태 줄 — 원본과 같으면 숨긴다(53번). (2026-09-30 151번) 두 단 배치 안 맨 아래, 오른쪽 정렬 -->
          <div v-if="ed.isEdited || ed.listenMode !== 'edit' || ed.saveState === 'failed'" class="status-line status-end layout-row" data-test="edit-status">
            <span class="chip" :class="ed.saveState === 'failed' ? 's-caution' : ed.isEdited ? 's-done' : 'on-white'" role="status">{{ saveLine }}</span>
          </div>
        </div>

        <!-- 단계 이동(2026-09-30 63번): [이전] = 2단계 결과 · [다음] = 편집 마치고 4단계 내려받기.
             (2026-09-30 152번) [원본으로 되돌리기](확인 질문 포함)는 [이전] · [다음] 사이 가운데 -->
        <StepNav
          prev :prev-to="{ name: 'home', query: { r: requestNo } }"
          next :next-reason="lockReason" :next-busy="finishing" @next="finish"
        >
          <template v-if="ed.isEdited || ed.listenMode !== 'edit'">
            <GuardedButton v-if="!confirmRevert" :reason="lockReason" data-test="revert" @click="confirmRevert = true">원본으로 되돌리기</GuardedButton>
            <span v-else class="confirm" role="group" aria-label="원본으로 되돌리기 확인">
              <span class="body">편집한 내용을 모두 지우고 원본으로 돌아가시겠습니까?</span>
              <button type="button" class="btn btn-secondary" @click="revert">되돌리기</button>
              <button type="button" class="btn btn-secondary" @click="confirmRevert = false">그만두기</button>
            </span>
          </template>
          <!-- (2026-10-01 황송해 202번) [작업 저장하기] — 서버에 저장, [원본으로 되돌리기] 오른쪽 -->
          <SaveWorkButton :request-no="requestNo" :reason="lockReason" />
        </StepNav>
      </template>

      <LeaveConfirm v-if="leave.open.value" :title="LEAVE_TITLE" :lines="leaveLines" @cancel="leave.cancel" @confirm="leave.confirm" />
    </div>
  </div>
</template>

<style scoped>
.status-line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-16); }
.status-end { justify-content: flex-end; }
.layout-row { grid-column: 1 / -1; }
.confirm { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-16); }
.vol { display: flex; align-items: center; gap: 12px; }
.vol input { accent-color: var(--color-primary); width: 120px; min-height: 44px; }
.acts { white-space: nowrap; width: 1%; }
.acts-in { display: flex; flex-wrap: wrap; gap: var(--spacing-8); }
.inst-name { overflow-wrap: anywhere; }
@media (max-width: 480px) { .acts { white-space: normal; width: auto; } .vol input { width: 88px; } }
.tools { align-items: flex-end; }
.add .input { min-width: 200px; }
.tr-val { min-width: 48px; text-align: center; }
.btn-icon:disabled { color: var(--color-slate-gray); border-color: var(--color-dust-taupe); cursor: not-allowed; }
.lede-line { margin: 0; color: var(--color-charcoal); }
.track-card { padding: var(--spacing-24); border-radius: var(--rounded-stadium); background: var(--color-white); }
.track-card table.spec th, .track-card table.spec td { text-align: center; }
.track-card .vol { justify-content: center; }
.track-card .acts-in { justify-content: center; }
.transpose-card { display: grid; gap: var(--spacing-16); padding: var(--spacing-24); border-radius: var(--rounded-stadium); background: var(--color-white); }
.transpose-card > h2 { margin: 0; }
/* (195번) [−] 값 [+] 한 줄 · 줄바꿈 없음 · 가운데 */
.tr-stepper { display: flex; flex-wrap: nowrap; align-items: center; justify-content: center; gap: var(--spacing-16); }
.tr-stepper .btn-icon svg { display: block; }
/* 두 단 배치(2026-09-30, SD_02 §5-2): 넓은 화면은 왼쪽 악보 · 오른쪽 패널, 악보는 스크롤해도 따라온다 */
.edit-layout { display: grid; gap: var(--spacing-32); align-items: start; }
.panel-col { display: grid; gap: var(--spacing-32); min-width: 0; }
.score-col { min-width: 0; }
@media (min-width: 1024px) {
  /* (2026-09-30 158번) 악보 쪽을 넓힘: 3 : 2 → 7 : 3(악보 약 +10%p), 패널 최소 320px */
  /* (2026-09-30 황송해 196번) 패널 최소 320 → 360px — 음표 수정 두 버튼 · [−] 값 [+] 가 한 줄에 들어가게(넓은 화면은 7 : 3 그대로) */
  .edit-layout { grid-template-columns: minmax(0, 7fr) minmax(360px, 3fr); }
  .score-col { position: sticky; top: var(--spacing-24); max-height: calc(100vh - 48px); overflow-y: auto; }
}
.range-fit { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 8px 0 0; }
</style>
