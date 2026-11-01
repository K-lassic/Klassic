<script setup lang="ts">
// C4 악기 고르기 목록 (SD_02 §3-5 · T091 · T084 · T130)
// 순서: ① 기본 국악기 구성 ② 추천 조합 ③ 국악기 ④ 다른 악기 (⑤ 원래 악기로 듣기는 2026-09-29 뺐다 — 입력이 사진·PDF뿐)
// (⑥ 내 음원(.sf2)은 2026-09-29 US8 삭제로 뺐다 — 음원은 기본 gugak.sf2 · FluidR3_GM.sf2 만)
import { computed, ref, watch } from 'vue';
import type { InstrumentCatalog, Recommendation } from '@/types/api';
import { choiceFromKey, choiceKey, type InstrumentChoice } from '@/lib/ensemble';
import { instrumentName } from '@/lib/instruments';

const props = withDefaults(defineProps<{
  catalog: InstrumentCatalog;
  modelValue: InstrumentChoice;
  /** ensemble: 곡 전체(S1·S2 연주 구성) · track: 트랙 하나 */
  scope?: 'ensemble' | 'track';
  legend?: string;
  recommendation?: Recommendation | null;
  recommendationLoading?: boolean;
  hasOriginal?: boolean;
  originalNames?: string[];
  /** 트랙이 타악이면 타악기만 */
  percussionTrack?: boolean;
  /** G4 만료 — 고르기 막힘 */
  disabledReason?: string | null;
  /** (2026-09-30 황송해, SD_02 ㊱) 고르기만 하면 바로 바꾸지 않고 [확인]을 눌러야 적용, [취소]로 그만둔다 */
  confirm?: boolean;
  /** 제목(legend)을 크게 — S2 연주 악기 구성(2026-09-30 57번) */
  bigLegend?: boolean;
}>(), {
  scope: 'ensemble', legend: '연주 악기 고르기', recommendation: null, recommendationLoading: false,
  hasOriginal: false, originalNames: () => [], percussionTrack: false, disabledReason: null, confirm: false, bigLegend: false,
});
const emit = defineEmits<{ 'update:modelValue': [InstrumentChoice]; retryRecommend: []; reset: []; cancel: [] }>();

const name = `c4-${Math.random().toString(36).slice(2, 8)}`;
// [확인] 모드에서는 고른 값(draft)을 따로 두었다가 [확인] 때 알린다
const draft = ref(choiceKey(props.modelValue));
watch(() => choiceKey(props.modelValue), (k) => { draft.value = k; });
const selected = computed({
  get: () => (props.confirm ? draft.value : choiceKey(props.modelValue)),
  set: (k: string) => { if (props.confirm) draft.value = k; else emit('update:modelValue', choiceFromKey(k)); },
});
const dirty = computed(() => props.confirm && draft.value !== choiceKey(props.modelValue));
function onConfirm() { if (dirty.value && !disabled.value) emit('update:modelValue', choiceFromKey(draft.value)); }
function onCancel() { draft.value = choiceKey(props.modelValue); emit('cancel'); }
const disabled = computed(() => !!props.disabledReason);

const defaultLabel = computed(() => props.catalog.default_set.map((c) => instrumentName(props.catalog, c)).join(' · '));
// (2026-09-30 145번) 타악 성부에는 타악기만, 선율 성부에는 선율 악기만(BR-PLY-01) — 전에는 선율 성부에도 장구 · 북을 보여, 고르면 성부가 타악으로 바뀌었다
const gugakList = computed(() => props.catalog.gugak.filter((i) => (props.percussionTrack ? i.percussion : !i.percussion)));
const otherList = computed(() => (props.percussionTrack ? [] : props.catalog.others));
const combos = computed(() => (props.recommendation?.available ? props.recommendation.combinations : []));
const showRecommend = computed(() => props.scope === 'ensemble');
</script>

<template>
  <fieldset class="c4" :disabled="disabled" :aria-describedby="disabledReason ? `${name}-why` : undefined">
    <legend :class="bigLegend ? 'h3 big' : 'h4'">{{ legend }}</legend>
    <p v-if="disabledReason" :id="`${name}-why`" class="small">사유: {{ disabledReason }}</p>

    <!-- (2026-09-30 146번) 악기 하나 고르기(scope=track)에서는 "기본 국악기 구성" 항목을 보이지 않는다 -->
    <div v-if="scope !== 'track'" class="group">
      <label class="opt">
        <input v-model="selected" type="radio" :name="name" value="default" />
        <span><b>기본 국악기 구성</b>: {{ defaultLabel }} <span class="muted">(기본값)</span></span>
      </label>
    </div>

    <div v-if="showRecommend" class="group" aria-live="polite">
      <span class="group-name">추천 조합</span>
      <p v-if="recommendationLoading" class="small muted">추천을 받는 중입니다. 그동안에도 기본 국악기로 들을 수 있습니다.</p>
      <template v-else-if="recommendation">
        <label v-for="(c, i) in combos" :key="`rec-${i}`" class="opt">
          <input v-model="selected" type="radio" :name="name" :value="`rec:${i}`" />
          <span>
            <b>{{ c.label }}</b>: {{ c.instruments.map((x) => instrumentName(catalog, x)).join(' · ') }}
            <span v-if="c.reason" class="small reason">{{ c.reason }}</span>
          </span>
        </label>
        <p v-if="!recommendation.available" class="small">추천을 받지 못했습니다. 기본 국악기로 들을 수 있습니다.</p>
        <!-- (2026-09-30 58번) "준비 중 · AI 추천 모델을 준비 중…" 안내와 [다시 추천받기]는 뺐다 -->
        <p v-if="recommendation.model && !recommendation.pending" class="small muted">추천: {{ recommendation.model.name }} {{ recommendation.model.version }}</p>
      </template>
    </div>

    <div class="group">
      <span class="group-name">국악기</span>
      <div class="opts">
        <label v-for="i in gugakList" :key="i.id" class="opt compact">
          <input v-model="selected" type="radio" :name="name" :value="`ins:${i.id}`" />
          <span>{{ i.name }}</span>
        </label>
      </div>
    </div>

    <div v-if="otherList.length" class="group">
      <span class="group-name">서양악기</span>
      <div class="opts">
        <label v-for="i in otherList" :key="i.id" class="opt compact">
          <input v-model="selected" type="radio" :name="name" :value="`ins:${i.id}`" />
          <span>{{ i.name }}</span>
        </label>
      </div>
    </div>

    <!-- ⑤ 원래 악기로 듣기는 2026-09-29 사진·PDF 입력 결정으로 뺐다(SD_02 C4 — 입력에 원래 악기 정보가 없음, BR-PLY-04 사용 안 함).
         hasOriginal · originalNames 속성은 부르는 쪽(S1Result · S2Edit)과의 호환을 위해 남겨 두지만 쓰지 않는다 -->

    <div v-if="confirm" class="row">
      <!-- (2026-09-30 59번) [기본으로 되돌리기]는 뺐다 — 기본 국악기 구성은 목록 맨 위에서 고른다 -->
      <template v-if="confirm">
        <button type="button" class="btn btn-primary" data-test="c4-confirm" :aria-disabled="!dirty || disabled ? 'true' : undefined" @click="onConfirm">확인</button>
        <button type="button" class="btn btn-secondary" data-test="c4-cancel" @click="onCancel">취소</button>
      </template>
    </div>
  </fieldset>
</template>

<style scoped>
.c4 { display: grid; gap: var(--spacing-24); margin: 0; padding: var(--spacing-32); border: 0; border-radius: var(--rounded-stadium); background: var(--color-white); min-width: 0; }
.c4 legend { float: left; margin-bottom: var(--spacing-8); }
.c4 legend.big { font-size: 24px; line-height: 1.3; font-weight: 700; }
.c4 legend + * { clear: both; }
.c4 > p { margin: 0; }
.group { display: grid; gap: var(--spacing-8); }
.group-name { font: 700 var(--text-small)/18.2px var(--font-sans); color: var(--color-granite); }
.opts { display: flex; flex-wrap: wrap; gap: var(--spacing-8); }
.opt { display: flex; align-items: flex-start; gap: 12px; padding: 12px 20px; min-height: 44px; border: 1px solid var(--color-hairline); border-radius: var(--rounded-button); background: var(--color-white); cursor: pointer; }
.opt.compact { border-radius: var(--rounded-pill); align-items: center; }
.opt input { margin: 3px 0 0; width: 18px; height: 18px; accent-color: var(--color-primary); flex: none; }
.opt.compact input { margin: 0; }
.opt:has(input:checked) { border: 1.5px solid var(--color-primary); }
.opt:has(input:focus-visible) { outline: 2px solid var(--color-primary-strong); outline-offset: 2px; }
.reason { display: block; color: var(--color-charcoal); margin-top: 4px; }
.c4[disabled] .opt { cursor: not-allowed; color: var(--color-slate-gray); }
</style>
