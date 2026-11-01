<script setup lang="ts">
// 악보 표시 — OpenSheetMusicDisplay(MusicXML → SVG) (research R19). 그리기에 실패해도 연주·내려받기는 그대로.
// (2026-09-30 황송해, SD_02 §5) doc 을 주면 악보에서 음표를 눌러 고를 수 있다 — 누른 음표를 ScoreDoc 음표 id 로 바꿔
// select 로 알리고, 고른 음표(selectedNoteId)는 파란색(link-blue)으로 칠한다.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ScoreDoc } from '@/types/score';
import { chordHeadIds, matchScoreNote, osmdHalfToneToMidi } from '@/lib/noteMatch';
import { precheck } from '@/lib/scoreCheck';

const props = withDefaults(defineProps<{
  musicxml: string | null; label?: string; caption?: string | null;
  doc?: ScoreDoc | null; selectedNoteId?: string | null;
  /** 악보 파일을 받지 못한 이유(2026-09-30 75번) — 있으면 "받지 못해 그리지 못했습니다" */
  fetchError?: string | null;
  /** 성부 이름을 그릴지 — 2단계 결과 악보는 인식 결과가 적은 이름("Voice" 등)을 그리지 않는다(2026-09-30 117번, 화면 그리기만) */
  partNames?: boolean;
  /** 악보 크게 · 작게 [−] 배율 [+] (2026-09-30 129번, 2 · 3단계) */
  zoomable?: boolean;
  /** 악기 음역을 벗어난 음표 id — 음표 머리를 빨간색(range-red)으로 칠한다(2026-09-30 박예은, BR-EDT-03). doc 이 있어야 칠한다 */
  outOfRange?: string[] | null;
  /** 악보 위 작은 이름을 화면에서 뺄지 — 2단계 "결과 악보"(2026-10-01 황송해 214번). 화면 읽기 이름(aria-label)은 남긴다 */
  hideLabel?: boolean;
}>(), { label: '결과 악보', caption: null, doc: null, selectedNoteId: null, fetchError: null, partNames: true, zoomable: false, outOfRange: null, hideLabel: false });
const emit = defineEmits<{ select: [noteId: string]; pickPart: [part: number] }>();
const host = ref<HTMLDivElement | null>(null);
const state = ref<'idle' | 'drawing' | 'ok' | 'error'>('idle');

interface OsmdNoteLike {
  sourceNote: { isRest(): boolean; Pitch?: { getHalfTone(): number } | null; getAbsoluteTimestamp(): { RealValue: number }; ParentStaff: { ParentInstrument: unknown } };
  getSVGGElement?(): SVGGElement | null;
}
interface OsmdMeasureLike {
  staffEntries: { graphicalVoiceEntries: { notes: OsmdNoteLike[] }[] }[];
  beginInstructionsWidth?: number;
  ParentStaff?: { ParentInstrument: unknown };
  PositionAndShape?: { AbsolutePosition: { x: number; y: number } };
}
interface OsmdLike {
  load(x: string): Promise<unknown>; render(): void; clear?(): void;
  autoResize?: boolean;
  Zoom?: number;
  Sheet?: { Instruments: unknown[] };
  GraphicSheet?: { MeasureList: (OsmdMeasureLike | undefined)[][] };
}
/** OSMD 단위 → 화면 px (VexFlowMusicSheetDrawer.unitInPixels) */
const UNIT_PX = 10;
// OSMD 는 크므로 필요할 때 불러온다
let osmd: OsmdLike | null = null;
let seq = 0;
/** 그려진 음표 g 요소 ↔ ScoreDoc 음표 id */
let elToId = new Map<Element, string>();
let idToEl = new Map<string, Element>();
/** 보표 앞머리(음자리표 · 조표 · 박자표) 자리 — 누르면 그 트랙을 고른다(2026-09-30, SD_02 ㉕). OSMD 단위 */
let clefZones: { x0: number; x1: number; y0: number; y1: number; part: number }[] = [];

function buildNoteMap() {
  elToId = new Map(); idToEl = new Map(); clefZones = [];
  const doc = props.doc;
  if (!doc || !osmd?.GraphicSheet || !osmd.Sheet) return;
  const instruments = osmd.Sheet.Instruments;
  // (2026-09-30 131번) 화음은 VexFlow 음표 g 하나에 머리가 여럿 — g 마다 음들을 모았다가 머리 하나하나에 음을 잇는다
  const byG = new Map<Element, { id: string; midi: number | null }[]>();
  for (const measure of osmd.GraphicSheet.MeasureList) {
    for (const gm of measure) {
      try {
        const w = gm?.beginInstructionsWidth ?? 0;
        const pos = gm?.PositionAndShape?.AbsolutePosition;
        const part = gm?.ParentStaff ? instruments.indexOf(gm.ParentStaff.ParentInstrument) : -1;
        if (w > 0 && pos && part >= 0) clefZones.push({ x0: pos.x - 1, x1: pos.x + w, y0: pos.y - 1.5, y1: pos.y + 5.5, part });
      } catch { /* 이 보표는 음자리표로 고를 수 없게 둔다 */ }
      for (const se of gm?.staffEntries ?? []) {
        for (const gve of se.graphicalVoiceEntries) {
          for (const gn of gve.notes) {
            try {
              const sn = gn.sourceNote;
              if (sn.isRest()) continue;
              const el = gn.getSVGGElement?.();
              if (!el) continue;
              const part = instruments.indexOf(sn.ParentStaff.ParentInstrument);
              const midi = sn.Pitch ? osmdHalfToneToMidi(sn.Pitch.getHalfTone()) : null;
              const id = matchScoreNote(doc, part, sn.getAbsoluteTimestamp().RealValue, midi);
              if (!id) continue;
              const list = byG.get(el) ?? [];
              if (!list.some((x) => x.id === id)) list.push({ id, midi });
              byG.set(el, list);
            } catch { /* 이 음표는 고를 수 없게 둔다 */ }
          }
        }
      }
    }
  }
  for (const [g, list] of byG) {
    const heads = Array.from(g.querySelectorAll('.vf-notehead'));
    const ids = chordHeadIds(list, heads.length);
    if (ids) {
      ids.forEach((id, i) => { elToId.set(heads[i], id); idToEl.set(id, heads[i]); heads[i].classList.add('note-pick'); });
    } else {
      elToId.set(g, list[0].id);
      for (const x of list) if (!idToEl.has(x.id)) idToEl.set(x.id, g);
      g.classList.add('note-pick');
    }
  }
  paintSelected();
}

function paintSelected() {
  host.value?.querySelectorAll('.note-out').forEach((e) => e.classList.remove('note-out'));
  for (const id of props.outOfRange ?? []) idToEl.get(id)?.classList.add('note-out');
  host.value?.querySelectorAll('.note-sel').forEach((e) => e.classList.remove('note-sel'));
  const el = props.selectedNoteId ? idToEl.get(props.selectedNoteId) : null;
  el?.classList.add('note-sel');
}

function onClick(e: MouseEvent) {
  if (!props.doc) return;
  let t = e.target as Element | null;
  while (t && t !== host.value) {
    const id = elToId.get(t);
    if (id) { emit('select', id); return; }
    t = t.parentElement;
  }
  // 음표가 아니면 보표 앞머리(음자리표)를 눌렀는지 본다
  const svg = host.value?.querySelector('svg');
  if (!svg || !clefZones.length) return;
  const r = svg.getBoundingClientRect();
  const k = UNIT_PX * (osmd?.Zoom ?? 1);
  const ux = (e.clientX - r.left) / k;
  const uy = (e.clientY - r.top) / k;
  const z = clefZones.find((c) => ux >= c.x0 && ux <= c.x1 && uy >= c.y0 && uy <= c.y1);
  if (z) emit('pickPart', z.part);
}

// ---------- 악보 크기(2026-09-30 황송해 129번) — OSMD zoom 50~200%, 10% 단계, 브라우저에 기억 ----------
const ZOOM_KEY = 'gugak.score.zoom';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
function loadZoom(): number {
  try {
    const v = Number(window.localStorage.getItem(ZOOM_KEY));
    if (Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX) return v;
  } catch { /* 기억만 못 한다 */ }
  return 1;
}
const zoom = ref(props.zoomable ? loadZoom() : 1);
const zoomText = computed(() => `${Math.round(zoom.value * 100)}%`);
function setZoom(z: number) {
  const next = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
  if (next === zoom.value) return;
  zoom.value = next;
  try { window.localStorage.setItem(ZOOM_KEY, String(next)); } catch { /* 기억만 못 한다 */ }
  if (!osmd || state.value !== 'ok') return;
  // 다시 그린 뒤 음표 연결을 다시 만든다(T318 방식) — 확대해도 음표를 눌러 고를 수 있게
  const keep = holdScroll();
  try { osmd.Zoom = next; osmd.render(); buildNoteMap(); keep(); } catch (e) {
    keep();
    failReason.value = `악보를 화면에 그리는 중 문제가 생겼습니다${detail(e)}.`;
    state.value = 'error';
  }
}

/** 그리지 못한 이유(2026-09-30 64 · 75번) — 실제 실패 원인에서 고른 문장 */
const failReason = ref<string | null>(null);
/** 한 번 그리기의 시간 제한(75번) — 넘으면 "시간 안에 그리지 못했습니다" */
const DRAW_TIMEOUT_MS = 20_000;
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { drawTimeout: true })), DRAW_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const detail = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return m ? ` (자세히: ${m.slice(0, 80)})` : '';
};
async function draw() {
  const xml = props.musicxml;
  if (!host.value || xml === null || xml === undefined) return;
  const my = ++seq;
  failReason.value = null;
  const pre = precheck(xml);
  if (pre) { failReason.value = pre; state.value = 'error'; return; }
  state.value = 'drawing';
  let stage: 'load' | 'render' = 'load';
  // (2026-09-30 132번) 다시 그리는 동안 악보 칸이 비면 문서 높이가 줄어 페이지가 맨 위로 튀었다 —
  // 칸 높이를 그대로 붙잡아 두고, 그린 뒤 창 · 악보 칸의 스크롤 위치를 되살린다
  const keep = holdScroll();
  try {
    if (!osmd) {
      const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
      // (2026-09-30 100번) OSMD 가 창 크기 변화로 스스로 다시 그리면(autoResize) 음표 연결(note-pick)이 사라져
      // 음표를 눌러도 고르지 못했다. 스스로 다시 그리기는 끄고, 칸 폭이 바뀌면 아래 ResizeObserver 가 다시 그린 뒤 연결을 새로 만든다.
      osmd = new OpenSheetMusicDisplay(host.value, { autoResize: false, backend: 'svg', drawTitle: true, drawPartNames: props.partNames, drawingParameters: 'compacttight' }) as unknown as OsmdLike;
    }
    await withTimeout(osmd!.load(xml));
    if (my !== seq) return;
    stage = 'render';
    osmd!.Zoom = zoom.value;
    osmd!.render();
    lastWidth = host.value?.clientWidth ?? 0;
    if (!osmd!.GraphicSheet?.MeasureList?.length) {
      failReason.value = '악보를 그렸지만 마디를 하나도 찾지 못했습니다.';
      state.value = 'error';
      return;
    }
    state.value = 'ok';
    buildNoteMap();
  } catch (e) {
    if (my !== seq) return;
    failReason.value = (e as { drawTimeout?: boolean })?.drawTimeout
      ? `악보가 커서 제한 시간(${DRAW_TIMEOUT_MS / 1000}초) 안에 그리지 못했습니다.`
      : stage === 'load'
        ? `악보 파일을 읽는 중 문제가 생겨 그리지 못했습니다${detail(e)}.`
        : `악보를 화면에 그리는 중 문제가 생겼습니다${detail(e)}.`;
    state.value = 'error';
  } finally {
    keep();
  }
}

/** 지금 높이 · 스크롤 위치를 붙잡고, 되살리는 함수를 돌려준다 */
function holdScroll(): () => void {
  const el = host.value;
  if (!el) return () => {};
  const h = el.offsetHeight;
  if (h > 0) el.style.minHeight = `${h}px`;
  const box = el.closest('.score-col') as HTMLElement | null;
  const wy = typeof window !== 'undefined' ? window.scrollY : 0;
  const by = box?.scrollTop ?? 0;
  return () => {
    el.style.minHeight = '';
    if (typeof window !== 'undefined' && Math.abs(window.scrollY - wy) > 1) window.scrollTo({ top: wy });
    if (box && Math.abs(box.scrollTop - by) > 1) box.scrollTop = by;
  };
}

let t: ReturnType<typeof setTimeout> | null = null;
watch(() => props.musicxml, () => { if (t) clearTimeout(t); t = setTimeout(draw, 250); });
watch(() => props.selectedNoteId, paintSelected);
watch(() => props.outOfRange, paintSelected);
// 칸 폭이 바뀌면 다시 그리고 음표 연결을 새로 만든다(100번)
let lastWidth = 0;
let ro: ResizeObserver | null = null;
let rt: ReturnType<typeof setTimeout> | null = null;
function redrawForWidth() {
  const w = host.value?.clientWidth ?? 0;
  if (!osmd || state.value !== 'ok' || Math.abs(w - lastWidth) < 4) return;
  lastWidth = w;
  try { osmd.render(); buildNoteMap(); } catch (e) {
    failReason.value = `악보를 화면에 그리는 중 문제가 생겼습니다${detail(e)}.`;
    state.value = 'error';
  }
}
onMounted(() => {
  void draw();
  if (typeof ResizeObserver !== 'undefined' && host.value) {
    ro = new ResizeObserver(() => { if (rt) clearTimeout(rt); rt = setTimeout(redrawForWidth, 200); });
    ro.observe(host.value);
  }
});
// 악보(MusicXML)는 같고 ScoreDoc 만 바뀌면(편집 기록 복원 등) 음표 연결만 새로 만든다
watch(() => props.doc, () => { if (state.value === 'ok') buildNoteMap(); });
onBeforeUnmount(() => { if (t) clearTimeout(t); if (rt) clearTimeout(rt); ro?.disconnect(); osmd?.clear?.(); osmd = null; });
</script>

<template>
  <figure class="score" :aria-label="label" :aria-busy="state === 'drawing' ? 'true' : undefined">
    <figcaption class="cap">
      <span v-if="!hideLabel" class="h4">{{ label }}</span>
      <span class="cap-tools">
        <span v-if="zoomable" class="zoom" role="group" aria-label="악보 크기" data-test="zoom">
          <button type="button" class="btn-icon zb" aria-label="악보 작게" :disabled="zoom <= ZOOM_MIN" data-test="zoom-out" @click="setZoom(zoom - ZOOM_STEP)">−</button>
          <output class="small zoom-val" aria-live="polite" data-test="zoom-text">{{ zoomText }}</output>
          <button type="button" class="btn-icon zb" aria-label="악보 크게" :disabled="zoom >= ZOOM_MAX" data-test="zoom-in" @click="setZoom(zoom + ZOOM_STEP)">+</button>
        </span>
        <slot name="help" />
      </span>
    </figcaption>
    <p v-if="musicxml === null && !fetchError" class="small muted">악보를 불러오는 중입니다.</p>
    <p v-if="musicxml === null && fetchError" class="small draw-fail" role="status" data-test="draw-fail">악보 파일을 받지 못해 그리지 못했습니다 ({{ fetchError }}). 새로 고침하면 다시 받습니다.</p>
    <p v-if="state === 'error'" class="small draw-fail" role="status" data-test="draw-fail">{{ failReason ?? '악보를 그리지 못했습니다.' }} 연주와 내려받기는 그대로 쓸 수 있습니다.</p>
    <!-- 음표 고르기는 마우스·터치 보조 수단. 키보드는 오른쪽 "고른 음표" 패널의 이전/다음 음표로 한다 -->
    <div ref="host" class="osmd" :class="{ pickable: !!doc }" @click="onClick" />
    <p v-if="caption" class="small muted">{{ caption }}</p>
  </figure>
</template>

<style scoped>
.score { margin: 0; display: grid; gap: var(--spacing-16); padding: var(--spacing-32) 40px; border-radius: var(--rounded-stadium); background: var(--color-white); min-width: 0; }
.score > p { margin: 0; }
.cap-tools { margin-left: auto; display: inline-flex; align-items: center; gap: var(--spacing-8); }
.zoom { display: inline-flex; align-items: center; gap: 4px; }
.zb { width: 44px; height: 44px; font-size: 18px; }
.zb:disabled { color: var(--color-slate-gray); border-color: var(--color-dust-taupe); cursor: not-allowed; }
.zoom-val { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
.cap { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-8); min-height: 44px; }
.osmd { width: 100%; min-height: 160px; overflow-x: auto; }
.osmd.pickable :deep(g.note-pick) { cursor: pointer; }
.osmd.pickable :deep(g.note-pick:hover path) { fill: var(--color-link-blue); stroke: var(--color-link-blue); }
.osmd :deep(g.vf-notehead.note-out path), .osmd :deep(g.note-out .vf-notehead path) { fill: var(--color-range-red); stroke: var(--color-range-red); }
.osmd :deep(g.note-sel path) { fill: var(--color-link-blue); stroke: var(--color-link-blue); }
@media (max-width: 767px) { .score { padding: var(--spacing-24); } }
</style>
