<script setup lang="ts">
// S1 올리기 (T067 · T081) — 악보 종류 고르기(늘 필수) · 사진 또는 PDF 1개 · G1/G12 반려는 C2 로
// 2026-09-29 황송해 결정(SD_02 §4-3 · §4-4, 사진·PDF 입력): PNG · JPG(JPEG) · WEBP 사진 또는 PDF 한 개(웹·API 같음).
// ~~여러 쪽 PDF 는 첫 쪽만 변환한다~~ (2026-09-29 여러 쪽 결정) PDF 는 모든 쪽(최대 10쪽)을 변환해 이어 붙인다 — 일부 쪽을
// 못 읽으면 결과 화면에 안내. MIDI · MusicXML 은 바로 형식 반려(서버도 반려).
// (2026-09-30 T188 여러 쪽, SD_02 S1 올리기 도면) 사진 여러 장을 한 번에 끌어 놓거나 나눠 더한다 — 쪽 목록(올린 순서 · 파일 ·
// 사진 크기 · [빼기])에 보이고, 그 순서대로 한 곡으로 이어 붙인다. 최대 10쪽. PDF 는 한 개만, 사진과 섞으면 G1 UPLOAD_TOO_MANY_FILES.
// 악보 종류 옆 예시 그림에 마우스를 올리거나 초점·터치가 가면 설명 말풍선(JEONGGANBO_NOTE · STAFF_NOTE)이 뜨고, 그림을 누르면 그 종류가 골라진다.
// (2026-09-30 황송해, SD_02 S1) 진행 레일(C1) · 오른쪽 숫자 칸(사진 용량 · 사진 크기 · 결과 보관) · 정간보 지원 범위 안내를 뺐다.
// 마우스를 올리면 말풍선이 바로 뜨고 그림이 갈색(clay-brown)으로 바뀐다. 전에는 알약 안의 투명 radio(.segmented input,
// position:absolute; inset:0)가 알약이 아니라 .type-opt 전체를 덮어 그림의 mouseenter 가 오지 않았다 — 알약을 기준 상자로 고쳤다.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import C2GateBlock from '@/components/C2GateBlock.vue';
import C9StepBar from '@/components/C9StepBar.vue';
import SharedScoreList from '@/components/SharedScoreList.vue';
import MyScoresList from '@/components/MyScoresList.vue';
import StepNav from '@/components/StepNav.vue';
import { useRequestStore } from '@/stores/request';
import { useAuthStore } from '@/stores/auth';
import { gateMessage, statusText } from '@/i18n/gateMessages';
import { ACCEPT, ACCEPT_LABEL, LIMITS, addFiles, formatSize, guessKind, kindLabel, readShortEdge } from '@/lib/uploadKind';
import { api } from '@/api/client';
import { listExamples, exampleThumbUrl, exampleDisplayTitle, groupExamples, type ExampleScore } from '@/lib/examples';
import type { ModelStatusPublic, ScoreType } from '@/types/api';

const req = useRequestStore();
// (2026-09-30 황송해 164번) 내가 만든 악보는 로그인했을 때만 그린다(목록도 부르지 않음)
const auth = useAuthStore();
/** 올릴 파일 — 올린 순서(1쪽 · 2쪽 …). 사진 여러 장 또는 PDF 한 개 */
const files = ref<File[]>([]);
/** 사진마다 짧은 변(px) — undefined 는 재는 중, null 은 잴 수 없음 */
const edges = ref(new Map<File, number | null>());
const scoreType = ref<ScoreType | null>(null);
const dragging = ref(false);
const input = ref<HTMLInputElement | null>(null);
const typeGroup = ref<HTMLElement | null>(null);
const retryOpen = ref(false);

/** 악보 종류 — SD_02 S1 도면 순서(오선보 · 정간보). note = 말풍선 문구(error-codes.json status_codes) */
const TYPE_OPTIONS: { value: ScoreType; label: string; note: string }[] = [
  // (2026-09-30 68번) 이름 뒤 * 는 뺐다
  { value: 'staff', label: '오선보', note: 'STAFF_NOTE' },
  { value: 'jeongganbo', label: '정간보', note: 'JEONGGANBO_NOTE' },
];
/** 지금 말풍선이 열린 종류(마우스 올림 · 키보드 초점 · 터치) */
const tip = ref<ScoreType | null>(null);
function openTip(v: ScoreType) { tip.value = v; }
function closeTip(v?: ScoreType) { if (!v || tip.value === v) tip.value = null; }
/** 그림 누르기(마우스 · 터치) — 그 종류를 고르고 설명도 연다 */
function choosePic(v: ScoreType) {
  scoreType.value = v;
  openTip(v);
  document.getElementById(`score-type-${v}`)?.focus();
}
// 터치에서는 마우스가 "떠나지" 않으므로, 고르기 칸 밖을 누르면 닫는다
function onOutside(e: PointerEvent) {
  if (tip.value && typeGroup.value && !typeGroup.value.contains(e.target as Node)) tip.value = null;
}
function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') tip.value = null; }

/** 첫 파일 — PDF 한 개일 때 보이는 칩·이름 */
const file = computed<File | null>(() => files.value[0] ?? null);
const kind = computed(() => (file.value ? guessKind(file.value.name) : null));
const isPhotos = computed(() => kind.value === 'image');

const models = ref<ModelStatusPublic | null>(null);
onMounted(async () => {
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('keydown', onEsc);
  try { models.value = await api.get<ModelStatusPublic>('/api/models/status'); } catch { /* 안내만 빠진다 */ }
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside);
  document.removeEventListener('keydown', onEsc);
});
const coldHint = computed(() => {
  if (!models.value || !scoreType.value || !file.value) return null;
  const kindName = scoreType.value === 'staff' ? 'omr_staff' : 'omr_jeongganbo';
  const m = models.value.models.find((x) => x.kind === kindName && (x.state === 'cold' || x.state === 'loading'));
  if (!m) return null;
  return m.expected_seconds
    ? `지금 인식 모델(${m.display_name})이 쉬고 있습니다. 첫 변환은 약 ${Math.round(m.expected_seconds)}초 더 걸릴 수 있습니다.`
    : `지금 인식 모델(${m.display_name})이 쉬고 있습니다. 첫 변환은 시간이 더 걸릴 수 있습니다.`;
});

const blockReason = computed(() => {
  if (req.uploading) return null;
  if (req.gate && req.gate.gate === 'G12' && !retryOpen.value) return req.gate.retryAt ? '안내된 시각 뒤에 다시 올릴 수 있습니다' : '앞 악보의 결과가 나온 뒤에 다시 올릴 수 있습니다';
  if (req.gate && req.gate.gate === 'G1') return '파일 검사를 통과하지 못했습니다';
  if (files.value.length === 0 && !chosenExample.value) return '올릴 파일을 먼저 골라 주십시오';
  if (!scoreType.value) return '악보 종류(정간보/오선보)를 골라 주십시오';
  return null;
});

/** 파일을 더한다(끌어 놓기 · 파일 고르기). 목록에 올린 순서대로 이어 붙인다 — 쪽 수·형식·섞기는 여기서 바로 반려 안내(서버도 같은 코드) */
function pick(list: FileList | File[] | null, replace = false) {
  const incoming = list ? Array.from(list) : [];
  if (incoming.length === 0) return;
  const r = addFiles(replace ? [] : files.value, incoming);
  if (r.files === null) {
    // 이미 고른 목록은 그대로 둔다 — [빼기]나 [다시 올리기]로 고칠 수 있다
    req.gate = gateMessage(r.code);
    return;
  }
  req.gate = null;
  chosenExample.value = null;
  files.value = r.files;
  for (const f of incoming) {
    if (guessKind(f.name) !== 'image' || edges.value.has(f)) continue;
    void readShortEdge(f).then((edge) => { edges.value = new Map(edges.value).set(f, edge); });
  }
}
/** 쪽 목록의 [빼기] — 그 사진을 빼고 나머지 쪽 번호를 다시 매긴다(SD_02 §4-4) */
function removePage(i: number) {
  files.value = files.value.filter((_, n) => n !== i);
  // 뺀 뒤에는 서버 반려(예: 2쪽 사진 크기)가 더는 맞지 않으므로 지운다
  if (req.gate?.gate === 'G1') req.gate = null;
}
function edgeText(f: File): string {
  if (!edges.value.has(f)) return '재는 중';
  const e = edges.value.get(f);
  return e == null ? '알 수 없음' : `${e}px`;
}
/** 짧은 변이 경고 기준(500px)보다 작은가 — 반려 기준(300px) 미만은 서버가 반려하므로 경고 대상 아님 */
function lowEdge(f: File): boolean {
  const e = edges.value.get(f);
  return typeof e === 'number' && e >= LIMITS.minEdge && e < LIMITS.warnEdge;
}
function onDrop(e: DragEvent) {
  dragging.value = false;
  pick(e.dataTransfer?.files ?? null);
}
/** 파일 고르기 창 — replace 면 고른 파일로 목록을 바꾼다(다른 파일 고르기). 창을 닫기만 하면 목록은 그대로 */
const replaceNext = ref(false);
function openPicker(replace = false) {
  replaceNext.value = replace;
  if (input.value) input.value.value = '';
  input.value?.click();
}

// [예시 파일 고르기] (2026-09-30 황송해, SD_02 ㊹ · 70~73) — 서버가 준비한 예시 악보. 원본 파일은 서버 전용 폴더에 있어
// 브라우저로 받지 않는다. 목록 · 작은 미리보기만 받고, 고르면 "예시: 이름" 한 줄이 보이며 [다음]에서 예시 id 로 접수한다
const examplesOpen = ref(false);
const exampleError = ref<string | null>(null);
const examples = ref<ExampleScore[] | null>(null);
const chosenExample = ref<ExampleScore | null>(null);
async function toggleExamples() {
  examplesOpen.value = !examplesOpen.value;
  if (!examplesOpen.value || examples.value) return;
  exampleError.value = null;
  try {
    examples.value = await listExamples();
  } catch {
    exampleError.value = '예시 목록을 받지 못했습니다. 잠시 뒤 다시 해 주십시오.';
  }
}
function chooseExample(ex: ExampleScore) {
  chosenExample.value = ex;
  scoreType.value = ex.score_type;
  files.value = [];
  req.gate = null;
  examplesOpen.value = false;
}
/** 고른 파일 · 예시를 모두 뺀다(악보 종류는 그대로) — [돌아가기](goBack)가 쓴다 (2026-09-30 107번) */
function removeAll() {
  files.value = [];
  chosenExample.value = null;
  if (req.gate?.gate === 'G1') req.gate = null;
}
/** [돌아가기] — 처음 모습으로(고른 파일 · 예시 · 악보 종류 · 예시 목록 펼침 모두 비움) */
function goBack() {
  removeAll();
  scoreType.value = null;
  examplesOpen.value = false;
  req.gate = null;
}

async function start() {
  if (files.value.length === 0 && !chosenExample.value) return;
  if (!scoreType.value) {
    req.gate = gateMessage('UPLOAD_SCORE_TYPE_REQUIRED');
    return;
  }
  retryOpen.value = false;
  if (chosenExample.value) {
    await req.uploadExample(chosenExample.value.id, scoreType.value);
    return;
  }
  await req.upload(files.value.length === 1 ? files.value[0] : [...files.value], scoreType.value);
}

/** C2 [다시 올리기] — 올리기 영역을 비우고 파일 고르기 창을 연다 */
async function onGateAction() {
  const code = req.gate?.code;
  if (code === 'UPLOAD_SCORE_TYPE_REQUIRED') {
    req.gate = null;
    await nextTick();
    typeGroup.value?.querySelector('input')?.focus();
    return;
  }
  req.gate = null;
  files.value = [];
  chosenExample.value = null;
  await nextTick();
  openPicker();
}
</script>

<template>
  <div class="page">
    <div class="wrap">
      <C9StepBar :current="1" />
      <div class="page-head center-h">
        <h1 class="h2">국악보 사진이나 파일을 올리십시오</h1>
        <p>악보 종류를 먼저 고른 뒤 사진 여러 장이나 PDF 한 개를 올리십시오 (한 곡, 최대 {{ LIMITS.maxPages }}쪽)</p>
        <!-- (2026-09-30 황송해 183번) [체험하기]는 1단계에서 뺐다 — 로그인 화면에만(/tour 주소는 그대로) -->
      </div>

      <div class="stack">
        <div ref="typeGroup" class="field">
          <!-- (2026-09-30 69번) "악보 종류" 제목은 뺐다 — 읽기 이름은 aria-label 로 남긴다 -->
          <div class="type-row" role="radiogroup" aria-label="악보 종류" aria-required="true" data-test="score-type">
            <div
              v-for="o in TYPE_OPTIONS"
              :key="o.value"
              class="type-opt"
              :data-test="`type-${o.value}`"
              @mouseenter="openTip(o.value)"
              @mouseleave="closeTip(o.value)"
            >
              <label class="segmented type-pill">
                <input
                  :id="`score-type-${o.value}`"
                  v-model="scoreType"
                  type="radio"
                  name="score-type"
                  :value="o.value"
                  :aria-describedby="`tip-${o.value}`"
                  @focus="openTip(o.value)"
                  @blur="closeTip(o.value)"
                /><span>{{ o.label }}</span>
              </label>
              <!-- 예시 그림 — 누르면 그 종류가 골라진다(같은 radio 를 가리키는 두 번째 label). 설명은 말풍선으로 -->
              <label
                class="type-pic"
                :class="{ on: scoreType === o.value }"
                :for="`score-type-${o.value}`"
                :data-test="`pic-${o.value}`"
                @mouseenter="openTip(o.value)"
                @click.prevent="choosePic(o.value)"
              >
                <svg v-if="o.value === 'staff'" viewBox="0 0 112 76" width="168" height="114" aria-hidden="true" focusable="false">
                  <g stroke="currentColor" stroke-width="1.2" fill="none">
                    <line v-for="i in 5" :key="i" x1="4" x2="108" :y1="18 + (i - 1) * 9" :y2="18 + (i - 1) * 9" />
                    <!-- 높은음자리표 비슷한 표시 -->
                    <path stroke-width="1.8" stroke-linecap="round" d="M22 70 C16 70 16 62 21 62 C25 62 25 68 22 70 L19 8 C19 3 26 3 25 11 C24 20 11 26 11 40 C11 52 29 52 28 42 C27 34 17 34 18 42" />
                  </g>
                  <g fill="currentColor" stroke="currentColor" stroke-width="1.4">
                    <ellipse cx="46" cy="53" rx="5" ry="3.6" transform="rotate(-20 46 53)" />
                    <line x1="50.6" y1="52" x2="50.6" y2="26" />
                    <ellipse cx="64" cy="44.5" rx="5" ry="3.6" transform="rotate(-20 64 44.5)" />
                    <line x1="68.6" y1="43.5" x2="68.6" y2="17" />
                    <ellipse cx="82" cy="40" rx="5" ry="3.6" transform="rotate(-20 82 40)" />
                    <line x1="86.6" y1="39" x2="86.6" y2="13" />
                    <ellipse cx="98" cy="31" rx="5" ry="3.6" transform="rotate(-20 98 31)" />
                    <line x1="93.4" y1="32" x2="93.4" y2="58" />
                  </g>
                </svg>
                <svg v-else viewBox="0 0 96 88" width="140" height="128" aria-hidden="true" focusable="false">
                  <g stroke="currentColor" fill="none">
                    <!-- 세로 줄(행) 셋, 줄마다 네모 칸(정간) 넷 — 오른쪽 줄부터 위에서 아래로 읽는다 -->
                    <rect v-for="c in 3" :key="`col${c}`" :x="6 + (c - 1) * 30" y="4" width="24" height="80" stroke-width="1.6" />
                    <template v-for="c in 3" :key="`rows${c}`">
                      <line v-for="r in 3" :key="r" :x1="6 + (c - 1) * 30" :x2="30 + (c - 1) * 30" :y1="4 + r * 20" :y2="4 + r * 20" stroke-width="0.9" />
                    </template>
                  </g>
                  <g fill="currentColor" font-size="14" text-anchor="middle" dominant-baseline="central" font-family="'Noto Serif KR', 'Apple SD Gothic Neo', serif">
                    <text x="78" y="14">黃</text><text x="78" y="34">太</text><text x="78" y="54">仲</text><text x="78" y="74">林</text>
                    <text x="48" y="14">林</text><text x="48" y="34">仲</text><text x="48" y="74">黃</text>
                    <text x="18" y="14">太</text><text x="18" y="54">黃</text>
                  </g>
                </svg>
              </label>
              <p :id="`tip-${o.value}`" role="tooltip" class="type-tip small" :class="{ open: tip === o.value }" :data-test="`tip-${o.value}`">
                {{ statusText(o.note) }}
                <span v-if="o.value === 'jeongganbo'" class="tip-sub" data-test="jeongganbo-scope">{{ statusText('JEONGGANBO_SCOPE') }}</span>
              </p>
            </div>
          </div>
          <!-- (2026-09-30 122번) "그림에 마우스를 올리면 설명이 나옵니다" 문구는 뺐다 -->
        </div>

        <div
          class="dropzone"
          :class="{ over: dragging }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <p class="body lead">파일을 여기에 끌어 놓거나 골라 주십시오</p>
          <!-- (2026-09-30 120번) "사진 크기 650px 이상" 조건은 뺐다 — 650px 보다 작은 사진은 서버가 키워 읽는다(300px 미만만 반려) -->
          <!-- (2026-09-30 139번) "사진 1장 20MB 이하 · PDF는 파일 20MB"(숫자는 규칙 파일) --><p class="small muted" data-test="limits">사진 1장 {{ LIMITS.imageMb }}MB 이하 · PDF는 파일 {{ LIMITS.pdfMb }}MB</p>

          <input ref="input" class="sr-only" type="file" multiple :accept="ACCEPT" tabindex="-1" aria-hidden="true" @change="pick(($event.target as HTMLInputElement).files, replaceNext)" />

          <!-- 고른 예시(72번) — 파일은 서버에 있어 미리보기 · 이름만 보인다.
               (2026-10-01 황송해 217번) 다른 카드는 사라지고 고른 예시 그림 카드 하나만 가운데. 하나만 고르므로 [-](빼기)는 없다 — 다시 고르려면 [돌아가기] -->
          <figure v-if="chosenExample" class="example-chosen" :aria-label="`고른 예시 ${exampleDisplayTitle(chosenExample.title)}`" data-test="example-picked">
            <img :src="exampleThumbUrl(chosenExample)" alt="" width="100" height="100" />
            <figcaption class="small">{{ exampleDisplayTitle(chosenExample.title) }}</figcaption>
          </figure>

          <!-- PDF 한 개 — 쪽수·쪽마다 사진 크기는 서버(모델 API 검사기)가 본다 -->
          <div v-if="file && !isPhotos" class="picked">
            <span class="chip on-white" data-test="kind-chip">{{ kindLabel(kind) }}</span>
            <span class="body"><b>{{ file.name }}</b> <span class="muted">({{ formatSize(file.size) }})</span></span>
          </div>

          <!-- 사진 — 쪽 목록(올린 순서 · 파일 · 사진 크기 · [빼기], SD_02 S1 올리기 도면) -->
          <div v-if="isPhotos" class="table-scroll" data-test="page-list">
            <table class="spec plain">
              <caption class="small muted">쪽 목록: 올린 순서대로 이어 붙여 한 곡으로 바꿉니다 ({{ files.length }}/{{ LIMITS.maxPages }}쪽)</caption>
              <thead><tr><th scope="col">순서</th><th scope="col">파일</th><th scope="col">사진 크기</th><th scope="col" class="remove-col">빼기</th></tr></thead>
              <tbody>
                <tr v-for="(f, i) in files" :key="`${i}-${f.name}-${f.size}`" data-test="page-row">
                  <th scope="row" class="page-num">{{ i + 1 }}쪽</th>
                  <td class="file-name">{{ f.name }} <span class="muted small">({{ formatSize(f.size) }})</span></td>
                  <td class="edge">
                    {{ edgeText(f) }}
                    <!-- (2026-09-30 125번) 300~499px 은 반려하지 않고 경고만 -->
                    <span v-if="lowEdge(f)" class="edge-warn small" data-test="edge-warn">{{ LIMITS.warnEdge }}px 미만 사진은 부정확한 결과가 나올 수 있습니다.</span>
                  </td>
                  <td class="remove-col"><button type="button" class="btn btn-secondary btn-sm btn-remove" :aria-label="`${i + 1}쪽 ${f.name} 빼기`" data-test="remove-page" @click="removePage(i)">-</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="row">
            <!-- (2026-09-30 77번) 누른(펼친) 쪽만 갈색, 다른 쪽은 흰색 -->
            <template v-if="!file && !chosenExample">
              <button type="button" class="btn" :class="examplesOpen ? 'btn-secondary' : 'btn-primary'" data-test="pick-files" @click="examplesOpen = false; openPicker()">파일 고르기</button>
              <button type="button" class="btn" :class="examplesOpen ? 'btn-primary' : 'btn-secondary'" data-test="examples-toggle" :aria-expanded="examplesOpen ? 'true' : 'false'" aria-controls="example-list" @click="toggleExamples">예시 파일 고르기</button>
            </template>
            <!-- (2026-09-30 78 · 79 · 107번) [돌아가기] = 처음 모습으로(고른 파일 · 예시 · 종류 모두 비움, 전 [제거하기]와 합침) · [파일 추가] (전 [악보 추가]) -->
            <template v-else>
              <button type="button" class="btn btn-secondary" data-test="go-back" @click="goBack">돌아가기</button>
              <button v-if="isPhotos && files.length < LIMITS.maxPages" type="button" class="btn btn-secondary" data-test="add-photos" @click="openPicker()">파일 추가</button>
            </template>
          </div>
          <!-- (2026-09-30 121번) 받는 형식 안내는 [파일 고르기] · [예시 파일 고르기] 줄 바로 아래 -->
          <p class="small" data-test="accepted-formats">변환 가능한 파일 형식 : {{ ACCEPT_LABEL }} · PDF</p>
          <div v-if="examplesOpen && !file && !chosenExample" id="example-list" class="examples" role="group" aria-label="예시 악보" data-test="example-list">
            <p class="small muted">악보가 없으면 서비스가 준비한 예시 악보로 해 보십시오.</p>
            <p v-if="!examples && !exampleError" class="small muted" role="status">예시 목록을 불러오는 중입니다.</p>
            <!-- (2026-09-30 황송해 189번) 오선보 · 정간보 묶음, 묶음 아래에 이름표. 카드 이름은 화면에서만 괄호 부분을 뗀다 -->
            <div v-if="examples" class="example-groups">
              <div v-for="g in groupExamples(examples)" :key="g.type" class="example-group" role="group" :aria-label="g.label" :data-test="`example-group-${g.type}`">
                <div class="example-grid">
                  <button v-for="ex in g.items" :key="ex.id" type="button" class="example-card" :aria-label="`${g.label} 예시 ${exampleDisplayTitle(ex.title)}`" :data-test="`example-${ex.id}`" @click="chooseExample(ex)">
                    <img :src="exampleThumbUrl(ex)" alt="" loading="lazy" width="100" height="100" />
                    <span class="small">{{ exampleDisplayTitle(ex.title) }}</span>
                  </button>
                </div>
                <p class="example-group-label" aria-hidden="true">{{ g.label }}</p>
              </div>
            </div>
          </div>
          <p v-if="exampleError" class="field-error" role="status">{{ exampleError }}</p>
          <p v-if="coldHint" class="small" role="status">{{ coldHint }}</p>
        </div>
      </div>

      <C2GateBlock v-if="req.gate" :view="req.gate" @action="onGateAction" @retry-ready="retryOpen = true" />

      <!-- 단계 이동(2026-09-30 63번): 1단계라 [이전] 없음. [다음]이 변환 시작 역할(파일 · 종류를 고르기 전엔 막히고 이유를 보인다) -->
      <!-- (2026-09-30 81 · 82번) "다음 (변환 시작)" → "다음", 파일을 고르기 전 사유 글자는 화면에 보이지 않는다(읽기 이름만) -->
      <StepNav next :next-label="req.uploading ? '올리는 중…' : '다음'" :next-reason="blockReason" :quiet-reason="files.length === 0 && !chosenExample" :next-busy="req.uploading" @next="start" />

      <!-- 내가 만든 악보(2026-09-30 황송해 164번 — 4단계에서 옮김, SD_02 §4-3 · UC_07 A9): [다음] 줄 아래 · 악보 공유하기 위, 로그인했을 때만 -->
      <MyScoresList v-if="auth.loggedIn" />

      <!-- 공유 악보 목록(2026-09-30 황송해, UC18 · SD_02 §4-6) — 같은 곡을 다시 변환하지 않게 먼저 들어 본다 -->
      <SharedScoreList />
    </div>
  </div>
</template>

<style scoped>
.dropzone.over { border-color: var(--color-primary); background: var(--color-white); }
/* (2026-09-30 황송해) 올리기 영역 안 내용은 가운데 — 문구 · 파일 표시 · 버튼 줄. 쪽 목록은 표만 가운데 두고 칸 안은 그대로 */
.dropzone { justify-items: center; text-align: center; }
.dropzone .row, .picked { justify-content: center; }
.table-scroll { justify-self: stretch; }
.table-scroll table { width: auto; margin: 0 auto; text-align: left; }
.table-scroll th, .table-scroll td { text-align: left; }
.table-scroll caption { text-align: center; }
.table-scroll thead th { text-align: center; } /* (2026-09-30 황송해 191번) 1단계 표 열 머리는 가운데 */
.page-num, .edge { white-space: nowrap; }
.remove-col { text-align: center !important; }
.btn-sm.btn-remove { min-width: 44px; padding: 6px 14px; font-size: 20px; line-height: 1; }
.lead { font-size: 18px; line-height: 1.4; }
.picked { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
/* 쪽 목록 — 좁은 화면에서도 가로로 밀리지 않게(table.plain) · 긴 파일 이름은 줄바꿈 */
.table-scroll caption { caption-side: top; padding-bottom: 8px; }
.file-name { overflow-wrap: anywhere; }
.btn-sm { padding: 6px 16px; }

/* 악보 종류 — 알약(.segmented) 한 칸 + 예시 그림. 새 색 없이 토큰만 쓴다 */
/* (2026-09-30 황송해, SD_02 ㉘) 가운데 · 그림 크게 · 그림 아래에 고르기 알약 */
.type-row { display: flex; flex-wrap: wrap; gap: var(--spacing-24) var(--spacing-48); align-items: flex-start; justify-content: center; }
.type-opt { position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.type-opt .type-pic { order: 0; }
.type-opt .type-pill { order: 1; }
.type-pill { flex: none; position: relative; } /* 투명 radio(inset:0)가 이 알약만 덮게 — 없으면 그림까지 덮어 hover 가 막힘 */
.type-pic {
  /* (2026-09-30 SD_02 ㊺) 두 그림 상자를 같은 크기로 — 그림 아래선 · 알약 줄이 맞는다(테두리 굵기가 바뀌어도 크기 그대로) */
  box-sizing: border-box; width: 196px; height: 148px; align-items: center; justify-content: center;
  display: inline-flex; padding: 6px; cursor: pointer; line-height: 0;
  color: var(--color-ink-black); background: var(--color-white);
  border: 1.5px solid var(--color-hairline); border-radius: var(--rounded-sm);
  transition: transform 0.2s ease;
}
/* (2026-10-01 황송해 216번) 예시 악보에 마우스를 올리면 살짝 커지고, 빼면 원래 크기로 */
.type-pic:hover, .example-card:hover { transform: scale(1.05); }
/* 고른 종류는 그림 · 테두리가 갈색으로 남는다(알약은 .segmented 고른 색 = 갈색) */
.type-pic.on { color: var(--color-clay-brown); border-color: var(--color-clay-brown); border-width: 2px; }
/* 마우스를 올리거나 키보드 초점이 가면 갈색(스타일가이드 clay-brown) — 그림은 currentColor 로 그려져 함께 바뀐다 */
.type-pic:hover,
.type-opt:has(input:focus-visible) .type-pic { color: var(--color-clay-brown); border-color: var(--color-clay-brown); }
.type-pic svg { display: block; }
.center-text { text-align: center; }
.edge-warn { display: block; color: var(--color-clay-deep); }
.examples { display: grid; gap: var(--spacing-8); justify-items: center; }
.example-groups { display: flex; flex-wrap: wrap; gap: var(--spacing-24) var(--spacing-48); justify-content: center; align-items: flex-start; }
.example-group { display: grid; gap: var(--spacing-8); justify-items: center; }
.example-group-label { margin: 0; justify-self: stretch; padding-top: var(--spacing-8); border-top: 1.5px solid var(--color-primary); min-width: 96px; text-align: center; font: 700 var(--text-small)/1.2 var(--font-sans); color: var(--color-primary); }
.example-grid { display: flex; flex-wrap: wrap; gap: var(--spacing-8); justify-content: center; }
.example-card { display: grid; justify-items: center; gap: 4px; width: 128px; padding: var(--spacing-8); background: var(--color-white); border: 1px solid var(--color-input-border); border-radius: 8px; cursor: pointer; color: inherit; font: inherit; transition: transform 0.2s ease; }
.example-card:hover, .example-card:focus-visible { border-color: var(--color-primary); }
/* (217번) 고른 예시 — 예시 카드와 같은 모양, 누를 수 없어 마우스 효과 없음 · 올리기 영역 가운데 */
.example-chosen { margin: 0; justify-self: center; display: grid; justify-items: center; gap: 4px; width: 128px; padding: var(--spacing-8); background: var(--color-white); border: 1.5px solid var(--color-primary); border-radius: 8px; }
.example-chosen img { width: 100px; height: 100px; object-fit: cover; object-position: top; border-radius: 4px; background: var(--color-white); }
.example-card img { width: 100px; height: 100px; object-fit: cover; object-position: top; border-radius: 4px; background: var(--color-white); }
/* 말풍선 — 그림 아래에 떠서(겹쳐) 뒤 내용을 밀지 않는다. 화면 폭을 넘지 않게 폭을 제한한다 */
.type-tip {
  display: none; position: absolute; z-index: 20; top: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  width: min(320px, calc(100vw - 2 * var(--gutter) - 16px)); margin: 0; padding: var(--spacing-16);
  background: var(--color-white); color: var(--color-ink-black);
  border: 1px solid var(--color-hairline); border-radius: var(--rounded-sm); box-shadow: var(--elevation-2);
}
.type-tip.open { display: block; }
@media (max-width: 767px) {
  .type-row { gap: var(--spacing-24); }
}
/* (2026-09-30 박예은) 정간보 지원 범위 보조 안내 — 본문보다 한 단계 작게 */
.tip-sub { display: block; margin-top: 4px; font-size: var(--text-caption); color: var(--color-slate-gray); }
</style>
