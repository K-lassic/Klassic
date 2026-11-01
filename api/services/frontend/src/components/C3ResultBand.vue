<script setup lang="ts">
// C3 결과 상태 띠 (SD_02 §3-4) — 막지 않는 안내. 완료 · 주의 · 대체(이유) · 직행.
// 대체는 파란 테두리 칩 ↺ — 갈색·빨강을 쓰지 않는다(대체는 실패가 아니라 결과 보장).
import { computed, ref } from 'vue';
import type { ResultBand } from '@/types/api';
import { fallbackReasonText, fallbackRetryHint, fallbackShortName } from '@/i18n/fallbackReasons';

const props = withDefaults(defineProps<{
  band: ResultBand;
  fallbackReason?: string | null;
  fallbackMessage?: string | null;
  retryHint?: string | null;
  engine?: { name: string; version: string } | null;
  fileKind?: 'image' | 'pdf' | 'midi' | 'musicxml';
  variant?: 'long' | 'short';
  /** [대체 템플릿 받기] 요청 중 */
  busy?: boolean;
  /** 짧은 띠에서 쓸 문장(예: "대체 결과 악보를 받아요") */
  shortText?: string | null;
}>(), { fallbackReason: null, fallbackMessage: null, retryHint: null, engine: null, fileKind: 'image', variant: 'long', busy: false, shortText: null });

const emit = defineEmits<{ requestFallback: []; reupload: []; listen: [] }>();
const closed = ref(false);

const noStructure = computed(() => props.fallbackReason === 'NO_SCORE_STRUCTURE');
const reasonTitle = computed(() => props.fallbackMessage || fallbackReasonText(props.fallbackReason));
const hint = computed(() => props.retryHint || fallbackRetryHint(props.fallbackReason));
const engineText = computed(() => (props.engine ? `엔진: ${props.engine.name} ${props.engine.version}` : null));
// (2026-09-30 황송해, SD_02 §3-4 · UC_02) 대체 안내 한 줄 + [대체 템플릿 받기] + "대체 템플릿이란?" 설명
const FALLBACK_LINE = '결과가 이상하면 대체 악보로 바꿀 수 있습니다.';
const FALLBACK_WHAT = '대체 템플릿이란? 악보를 읽지 못했거나 결과를 믿기 어려울 때 대신 드리는 기본 국악 장단 악보입니다. 기본 국악기 구성으로 들을 수 있습니다.';
</script>

<template>
  <!-- 짧은 띠(S2·S3 머리) -->
  <!-- 짧은 띠: 정상(완료 · 신뢰)이면 "완료 · 결과 악보입니다"를 보이지 않는다(2026-09-30 54번) -->
  <div v-if="variant === 'short' && band !== 'trust' && band !== 'direct'" class="band-short" role="status">
    <span v-if="band === 'fallback'" class="chip s-fallback">대체 결과 · {{ fallbackShortName(fallbackReason) }}</span>
    <span v-else-if="band === 'caution'" class="chip s-caution">주의</span>
    <!-- (2026-09-30 140번) "완료 · 바로 연주" 칩은 뺐다 -->
    <span class="body">{{ shortText ?? (band === 'fallback' ? reasonTitle : band === 'caution' ? '인식이 정확하지 않을 수 있습니다' : '') }}</span>
  </div>

  <template v-else-if="variant !== 'short' && !closed">
    <div v-if="band === 'fallback'" class="notice n-fallback" data-test="band-fallback">
      <span class="chip s-fallback">대체 결과 · {{ fallbackShortName(fallbackReason) }}</span>
      <span class="title">{{ reasonTitle }}</span>
      <p>기본 국악 장단 악보를 대신 드렸습니다. 실패가 아니라 들을 수 있는 결과입니다.<template v-if="hint"> {{ hint }}</template></p>
      <div class="row">
        <button v-if="noStructure" type="button" class="btn btn-primary" @click="emit('reupload')">악보 사진 다시 올리기</button>
        <button type="button" class="btn btn-secondary" @click="emit('listen')">대체 악보 듣기</button>
        <button type="button" class="btn-text" @click="closed = true">안내 닫기</button>
      </div>
    </div>

    <div v-else-if="band === 'caution'" class="notice n-caution" data-test="band-caution">
      <span class="chip s-caution">주의</span>
      <span class="title">인식이 정확하지 않을 수 있습니다</span>
      <p>틀린 음은 편집에서 고칠 수 있습니다.</p>
      <p v-if="engineText" class="small muted">{{ engineText }} · 등급 주의</p>
      <div class="row">
        <span class="body">{{ FALLBACK_LINE }}</span>
        <button type="button" class="btn btn-secondary" data-test="ask-fallback" :aria-busy="busy ? 'true' : undefined" :aria-disabled="busy ? 'true' : undefined" @click="!busy && emit('requestFallback')">대체 템플릿 받기</button>
        <button type="button" class="btn-text" @click="closed = true">안내 닫기</button>
      </div>
      <p class="small muted" data-test="fallback-what">{{ FALLBACK_WHAT }}</p>
    </div>

    <!-- (2026-09-30 149번) 직행 결과 안내("… 파일을 그대로 악보로 만들었습니다")와 그 [?](126번)는 뺐다 -->

    <!-- 완료 · 신뢰(정상 결과): 긴 띠 · 대체 안내 · [대체 템플릿 받기]를 보이지 않는다(2026-09-30 황송해, SD_02 §3-4 · UC_02). 엔진 · 등급은 결과 악보 아래 작은 글자 -->
  </template>
</template>

<style scoped>
.band-short { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-16); }
.btn-text { min-height: 44px; padding: 0 8px; background: none; border: 0; font: 450 var(--text-small)/20px var(--font-sans); color: var(--color-charcoal); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
</style>
