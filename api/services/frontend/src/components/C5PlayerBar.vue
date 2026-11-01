<script setup lang="ts">
// C5 연주 막대 (SD_02 §3-6) — [재생]/[정지] · 지금 연주 악기 구성 · 편집본 표시.
// G4 만료일 때만 [재생]을 막는다(U2). 음원을 못 불러와도 다른 화면 기능은 그대로.
// 재생 빠르기(곡 전체 배율, FR-065): 듣기만 바꾼다. 재생 중에도 바로 바뀌고 화면을 옮겨도 유지된다.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import HelpTip from '@/components/HelpTip.vue';
import type { ScoreDoc } from '@/types/score';
import { player, type PlayerState } from '@/player/player';
import { PLAYBACK_BASE_BPM } from '@/player/tempo';


const props = withDefaults(defineProps<{
  doc: ScoreDoc | null;
  label: string;
  edited?: boolean;
  expired?: boolean;
  /** [악기 바꾸기] 를 보일지 */
  canChange?: boolean;
  /** 재생 빠르기 막대를 보일지 — 2단계(S1 결과)는 재생만(2026-09-30, SD_02 ㊳) */
  showRate?: boolean;
  /** "지금 연주 …" 줄을 보일지 — 3단계는 뺀다(2026-09-30 91번) */
  showNow?: boolean;
  /** 화면 맨 아래 고정 막대(2026-09-30 111번, 2 · 3단계) — 떠 있는 동안 body 아래 여백으로 본문 · 바닥글을 가리지 않는다 */
  dock?: boolean;
  /** 이 악보의 재생 빠르기 배율(편집 기록의 set_tempo ÷ 100, 없으면 1) — 2026-09-30 161번. 주면 막대가 이 값을 따른다 */
  tempoRate?: number | null;
  /** (2026-10-01 황송해 204번) 화면이 열리면 음원을 미리 받아 싣는다 — 2 · 3단계만(1단계 공유 듣기는 누를 때) */
  preload?: boolean;
}>(), { edited: false, expired: false, canChange: true, showRate: true, showNow: true, dock: false, tempoRate: null, preload: false });
const emit = defineEmits<{ played: []; openPicker: []; rateChange: [rate: number] }>();

const state = ref<PlayerState>(player.state === 'playing' || player.state === 'paused' ? 'ready' : player.state);
const message = ref<string | null>(null);
const base = ref(player.base);
// 진행 막대(2026-09-30 88번) — 지금 자리 · 곡 길이(초)를 0.25초마다 읽는다(재생 중에만)
const pos = ref(0);
const dur = ref(0);
let tick: ReturnType<typeof setInterval> | null = null;
function readPos() { pos.value = player.position; dur.value = player.duration || dur.value; }
function startTick() { if (!tick) tick = setInterval(readPos, 250); }
function stopTick() { if (tick) { clearInterval(tick); tick = null; } readPos(); }
/** 이 막대가 연주를 시작한 악보 — 멈춘 뒤 악보가 바뀌면 이어서가 아니라 처음부터 */
let mine: ScoreDoc | null = null;
const off = player.on((s, detail) => {
  state.value = s;
  base.value = player.base;
  if (s === 'playing') startTick(); else stopTick();
  if (s === 'ready' || s === 'idle') { pos.value = 0; }
  if (s === 'error') message.value = detail ?? '소리를 낼 수 없습니다.';
});
onMounted(() => {
  if (props.dock) document.body.classList.add('has-dock');
  if (props.preload && !props.expired) player.preload();
});
onBeforeUnmount(() => { off(); stopTick(); player.stop(); if (props.dock) document.body.classList.remove('has-dock'); });
watch(() => props.doc, (d) => {
  if (state.value === 'paused') { player.stop(); mine = null; return; }
  // (2026-10-01 황송해 208번) 이 막대가 연주 중이면 바뀐 악보(악기 바꾸기 · 편집)로 그 자리에서 이어서
  if (state.value === 'playing' && mine && d && player.switchDoc(d)) mine = d;
});

async function toggle() {
  if (props.expired || !props.doc) return;
  if (state.value === 'playing') { player.pause(); return; }
  message.value = null;
  if (state.value === 'paused' && mine === props.doc) { await player.resume(); return; }
  mine = props.doc;
  const ok = await player.play(props.doc);
  if (ok) { emit('played'); dur.value = 0; readPos(); }
}
async function play() {
  if (state.value === 'playing' || state.value === 'paused') player.stop();
  await toggle();
}
function onSeek(e: Event) {
  const t = Number((e.target as HTMLInputElement).value);
  player.seek(t);
  pos.value = t;
}
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const posText = computed(() => `${clock(pos.value)} / ${dur.value ? clock(dur.value) : '--:--'}`);
const canSeek = computed(() => !props.expired && !!props.doc && (state.value === 'playing' || state.value === 'paused') && dur.value > 0);
// 소리 크기(2026-09-30 황송해 118번) — 0~100%, [음소거]. 연주기 하나라 1단계 공유 듣기에도 같다. 브라우저에 기억
const vol = ref(Math.round(player.volume * 100));
const muted = ref(player.muted);
function onVolume(e: Event) {
  player.setVolume(Number((e.target as HTMLInputElement).value) / 100);
  vol.value = Math.round(player.volume * 100);
  muted.value = player.muted;
}
function toggleMute() {
  player.setMuted(!muted.value);
  muted.value = player.muted;
}
const volText = computed(() => (muted.value ? `음량 ${vol.value}% (음소거)` : `음량 ${vol.value}%`));
const HELP = '이 브라우저 안에서 SpessaSynth(소프트웨어 신시사이저)가 악보를 MIDI 로 바꿔 소리를 냅니다. 국악기는 국립국악원 「국악기 디지털 음원」으로 만든 gugak.sf2, 그 밖의 악기는 FluidR3_GM.sf2 음원을 씁니다. 소리는 서버로 보내지 않습니다.';
const rate = ref(player.rate);
function onRate(e: Event) {
  const r = Number((e.target as HTMLInputElement).value);
  player.setRate(r);
  rate.value = player.rate;
}
// (2026-09-30 황송해 161번) 막대를 놓으면 편집 기록(set_tempo)에 남긴다 — 받기 파일도 이 빠르기로
function onRateCommit() { emit('rateChange', rate.value); }
watch(() => props.tempoRate, (v) => {
  if (v == null) return;
  player.setRate(v);
  rate.value = player.rate;
}, { immediate: true });
// (2026-09-30 황송해, SD_02 ㉝) 기준은 곡과 관계없이 4분음표 100 BPM — "1.0배 · 100 bpm", "1.5배 · 150 bpm"
const rateLabel = (r: number) => `${r.toFixed(Math.round(r * 100) % 10 === 0 ? 1 : 2)}배 · ${Math.round(PLAYBACK_BASE_BPM * r)} bpm`;
// (2026-09-30 황송해, SD_02 ㊲) 목록 대신 가로 막대 0.5~2.0배(0.05 단위) + 옆에 "1.0배 · 100 bpm" 실시간 표시
const rateText = computed(() => rateLabel(rate.value));
defineExpose({ play, stop: () => player.stop() });
</script>

<template>
  <div class="player" :class="{ dock }" role="group" aria-label="연주" data-test="player">
    <!-- (2026-09-30 88 · 89번) 위: 진행 막대(누르거나 끌면 그 자리로) + [?] 소리 내는 방법. 아래: [재생]/[멈춤] -->
    <div class="seek-row">
      <input
        class="seek" type="range" min="0" :max="dur || 1" step="0.1" :value="Math.min(pos, dur || 1)" :disabled="!canSeek"
        aria-label="연주 위치" :aria-valuetext="posText" data-test="seek" @input="onSeek"
      />
      <output class="small seek-val" aria-hidden="true" data-test="seek-text">{{ posText }}</output>
      <HelpTip label="소리 내는 방법" :text="HELP" />
    </div>
    <button
      type="button"
      class="btn btn-primary play"
      :aria-disabled="expired || !doc || state === 'loading' ? 'true' : undefined"
      :aria-label="expired ? '재생 (보관 기간이 지나 재생할 수 없습니다)' : undefined"
      data-test="play"
      @click="toggle"
    >
      <span aria-hidden="true">{{ state === 'playing' ? '❚❚' : '▶' }}</span>
      {{ state === 'playing' ? '멈춤' : '재생' }}
    </button>
    <div v-if="showNow" class="now">
      <span class="small muted">지금 연주</span>
      <span class="body"><b>{{ label || '기본 국악기 구성' }}</b><template v-if="edited"> · <span class="chip on-white tag">편집본</span></template></span>
    </div>
    <label v-if="showRate" class="rate small">
      <span class="muted">재생 빠르기</span>
      <input
        class="rate-range" type="range" min="0.5" max="2" step="0.05" :value="rate" :disabled="expired || !doc"
        aria-label="재생 빠르기 (듣기만 바뀌고 내려받는 파일은 그대로)" :aria-valuetext="rateText" data-test="rate"
        @input="onRate" @change="onRateCommit"
      />
      <output class="rate-val" data-test="rate-text" aria-hidden="true">{{ rateText }}</output>
    </label>
    <div class="vol" role="group" aria-label="소리 크기">
      <button type="button" class="btn-icon mute" :aria-pressed="muted ? 'true' : 'false'" :aria-label="muted ? '소리 켜기' : '음소거'" data-test="mute" @click="toggleMute">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3 7.5h3.2L10.5 4v12L6.2 12.5H3z" fill="currentColor" />
          <path v-if="!(muted || vol === 0)" d="M13 7a4 4 0 0 1 0 6M15.2 5a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path v-else d="M13 7.5l5 5M18 7.5l-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
      <input
        class="vol-range" type="range" min="0" max="100" step="5" :value="vol" aria-label="음량" :aria-valuetext="volText" data-test="volume"
        @input="onVolume"
      />
      <output class="small vol-val" aria-hidden="true" data-test="volume-text">{{ muted ? '음소거' : `${vol}%` }}</output>
    </div>
    <button v-if="canChange" type="button" class="btn btn-secondary" :aria-disabled="expired ? 'true' : undefined" @click="!expired && emit('openPicker')">악기 바꾸기</button>
    <!-- (2026-09-30 55번) 상태 글 줄(.status.small)은 뺐다 — 보관 만료는 [재생]이 막히고 aria-label 로 알린다 -->
  </div>
</template>

<style scoped>
/* (2026-09-30 황송해, SD_02 §3-6) 한 줄: [재생] · 지금 연주(남는 폭) · 재생 빠르기(이름 + 고르기) · [악기 바꾸기]. 좁으면 줄바꿈, 글자 겹침 없음.
   재생 빠르기 고르기와 [악기 바꾸기]는 높이 44px 로 같다. 상태 글은 맨 아래 한 줄 */
.player { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-16) var(--spacing-24); padding: var(--spacing-24) var(--spacing-32); border-radius: var(--rounded-stadium); background: var(--color-white); }
.play { min-width: 120px; flex: none; }
.seek-row { flex: 1 0 100%; display: flex; align-items: center; gap: var(--spacing-8); min-width: 0; }
.seek { flex: 1; min-width: 0; height: 44px; accent-color: var(--color-primary); cursor: pointer; }
.seek:disabled { cursor: default; }
.seek-val { min-width: 96px; text-align: right; font-variant-numeric: tabular-nums; color: var(--color-charcoal); }
.now { display: grid; gap: 4px; flex: 1 1 220px; min-width: 0; }
.now .body { overflow-wrap: anywhere; }
.rate { display: inline-flex; align-items: center; gap: var(--spacing-8); flex: none; white-space: nowrap; }
.rate-range { width: 160px; height: 44px; accent-color: var(--color-primary); cursor: pointer; }
.rate-val { min-width: 118px; font-variant-numeric: tabular-nums; color: var(--color-ink-black); }
.player > .btn-secondary { height: 44px; min-height: 44px; flex: none; }
.tag { padding: 4px 12px; font-size: var(--text-caption); }
.status { flex: 1 0 100%; margin: 0; color: var(--color-charcoal); overflow-wrap: anywhere; }
/* (2026-09-30 111번) 아래 고정 막대 — 한 줄: [재생] · 진행 막대 · [?] · (지금 연주) · (재생 빠르기) */
.player.dock {
  position: fixed; z-index: 30; left: 50%; bottom: 16px; transform: translateX(-50%);
  width: min(var(--content-width), calc(100vw - 2 * var(--gutter))); padding: 12px var(--spacing-24);
  border-radius: var(--rounded-pill); box-shadow: var(--shadow-bar-up); gap: var(--spacing-8) var(--spacing-16);   /* 2026-09-30 124번 위쪽 그림자 */
}
.player.dock .seek-row { order: 1; flex: 1 1 260px; }
.player.dock .play { order: 0; }
.player.dock .now { order: 2; flex: 0 1 auto; }
.player.dock .rate { order: 3; }
.player.dock .vol { order: 4; }
.vol { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.vol-range { width: 110px; height: 44px; accent-color: var(--color-primary); cursor: pointer; }
.vol-val { min-width: 52px; font-variant-numeric: tabular-nums; color: var(--color-charcoal); }
.mute { width: 44px; height: 44px; font-size: 18px; }
.player.dock .now .small { display: none; }
@media (max-width: 720px) {
  .player.dock { width: calc(100vw - 16px); bottom: 8px; border-radius: 24px; padding: 8px 12px; }
  .player { padding: var(--spacing-16); }
  .rate { flex: 1 1 100%; }
  .rate-range { flex: 1; min-width: 0; width: auto; }
  .player > .btn-secondary { flex: 1 1 100%; }
}
</style>
