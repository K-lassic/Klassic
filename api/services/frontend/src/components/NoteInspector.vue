<script setup lang="ts">
// 악보 음표 수정(2026-09-30 이름 바꿈, 전 "고른 음표" · "악장 음표 수정") (SD_02 §5 오른쪽 패널, 2026-09-30 황송해 결정 — "음표 고치기" 표 대신) FR-025·026 · UC6 기본흐름 4·5
// 악보에서 누른 음표의 음 높이(반음 ▲▼)를 고친다. 음역을 벗어나도 막지도 경고하지도 않는다(2026-09-30 BR-EDT-03).
// (2026-09-30 황송해, SD_02 ㉕) 트랙은 [1트랙][2트랙]… 토글(또는 악보의 음자리표)로 바꾸고, 바꾸면 그 트랙 첫 음표를 고른다.
// [◀ 이전 음표]/[다음 음표 ▶] 버튼과 음표 음량은 뺐다 — 음량은 트랙 표의 트랙 음량. 키보드 ←/→(음표 옮기기) · ↑/↓ · +/−(반음)는 그대로.
import { computed } from 'vue';
import HelpTip from '@/components/HelpTip.vue';
import type { ScoreDoc } from '@/types/score';
import { pitchName } from '@/lib/time';
import { orderedNoteIds, partOfNote } from '@/lib/noteMatch';

const props = defineProps<{ doc: ScoreDoc; noteId: string | null; part: number; disabled?: boolean; partLabel: (i: number) => string;
  /** 트랙 버튼 이름 — 그 트랙 악기 이름(같은 악기는 뒤에 번호). 없으면 "N트랙" (2026-09-30, SD_02 ㉞) */
  trackNames?: string[] }>();
const emit = defineEmits<{ select: [noteId: string]; part: [part: number]; pitch: [noteId: string, midi: number] }>();

const note = computed(() => {
  if (!props.noteId) return null;
  for (const p of props.doc.parts) { const n = p.notes.find((x) => x.id === props.noteId); if (n) return n; }
  return null;
});
const notePart = computed(() => (props.noteId ? partOfNote(props.doc, props.noteId) : props.part));
const order = computed(() => orderedNoteIds(props.doc, notePart.value < 0 ? props.part : notePart.value));
const idx = computed(() => (props.noteId ? order.value.indexOf(props.noteId) : -1));

/** (2026-09-30 131번) 고른 음과 같은 자리에서 시작하는 음들(화음) — 낮은 음부터 */
const chord = computed(() => {
  const n = note.value;
  if (!n) return [] as string[];
  const p = props.doc.parts[notePart.value];
  return (p?.notes ?? []).filter((x) => x.startTick === n.startTick).sort((a, b) => a.pitch - b.pitch).map((x) => x.id);
});

const tpm = computed(() => props.doc.ppq * 4 * props.doc.timeSignature.beats / props.doc.timeSignature.beatType);
const beatTicks = computed(() => props.doc.ppq * 4 / props.doc.timeSignature.beatType);
const where = (start: number) => `${Math.floor(start / tpm.value) + 1}마디 ${Math.floor((start % tpm.value) / beatTicks.value) + 1}박`;


// (2026-09-30 116번) 쓰는 도구: 악보 그리기 OpenSheetMusicDisplay(ScoreView) · 음표 고치기 · 편집 기록 우리 모듈 score-core(@gugak/score-core) · 소리 SpessaSynth(player)
const KEYS_HELP = '악보에서 음표나 음자리표를 눌러 고릅니다. 이 칸에서 ← → 로 음표를 옮기고, ↑ ↓ 또는 + − 로 반음씩 고칩니다. 악보는 OpenSheetMusicDisplay 로 그리고, 음표 고치기와 편집 기록은 우리 팀 모듈 score-core 가, 소리는 SpessaSynth 가 냅니다.';

function move(step: number) {
  const list = order.value;
  if (!list.length) return;
  const i = idx.value < 0 ? (step > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, idx.value + step));
  emit('select', list[i]);
}
function shift(semi: number) {
  const n = note.value;
  if (!n || props.disabled) return;
  emit('pitch', n.id, Math.max(0, Math.min(127, n.pitch + semi)));
}
function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
  else if (e.key === 'ArrowUp' || e.key === '+' || e.key === '=') { e.preventDefault(); shift(1); }
  else if (e.key === 'ArrowDown' || e.key === '-' || e.key === '_') { e.preventDefault(); shift(-1); }
}
</script>

<template>
  <section class="inspector" aria-labelledby="note-h" tabindex="0" data-test="note-inspector" @keydown="onKey">
    <!-- (2026-09-30 99번) 사용법 문장은 제목 오른쪽 위 [?] 로 옮겼다(패널 안 같은 문장은 뺌) -->
    <div class="head"><h2 id="note-h" class="h3 center-h">악보 음표 수정</h2><HelpTip label="악보 음표 수정" :text="KEYS_HELP" /></div>

    <!-- (2026-09-30 133번) 악기(1 · 2 · 3) 고르기 버튼 줄은 뺐다 — 음표는 악보에서 누르고, 음자리표를 누르면 그 악기 첫 음표 -->

    <p v-if="!order.length" class="small">이 악기에는 음표가 없습니다.</p>
    <p v-else-if="!note" class="body center-h" data-test="note-empty">악보에서 음표를 눌러 고르십시오.</p>
    <template v-else>
      <p class="body" aria-live="polite" data-test="note-where">
        {{ partLabel(notePart) }} · {{ where(note.startTick) }} · <b>{{ pitchName(note.pitch) }}</b> <span class="token">({{ note.pitch }})</span>
        <span v-if="chord.length > 1" class="small" data-test="note-chord"> · 화음 {{ chord.indexOf(note.id) + 1 }}/{{ chord.length }}</span>
        <span class="small muted"> ({{ idx + 1 }}/{{ order.length }})</span>
      </p>
      <!-- (2026-09-30 황송해 196번) "음 높이" 한 줄, 그 아래 두 버튼을 같은 폭 두 칸으로(글자 줄바꿈 없음). 좁으면 한 칸씩 -->
      <span class="label">음 높이</span>
      <div class="pitch-btns" role="group" aria-label="음 높이">
        <button type="button" class="btn btn-secondary btn-sm" data-test="note-up" :aria-disabled="disabled ? 'true' : undefined" @click="shift(1)">▲ 반음 올리기</button>
        <button type="button" class="btn btn-secondary btn-sm" data-test="note-down" :aria-disabled="disabled ? 'true' : undefined" @click="shift(-1)">▼ 반음 내리기</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.inspector { display: grid; gap: var(--spacing-16); padding: var(--spacing-24); border-radius: var(--rounded-stadium); background: var(--color-white); }
.inspector:focus-visible { outline: 2px solid var(--color-primary-strong); outline-offset: 2px; }
.inspector > p, .inspector h2 { margin: 0; }
/* (2026-10-01 황송해 213번) 제목은 가운데, [?] 는 오른쪽 끝 — 왼쪽 빈 칸과 [?] 칸을 같은 폭(1fr)으로 */
.head { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--spacing-8); }
.head::before { content: ""; }
.head > :last-child { justify-self: end; }
.pitch-btns { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--spacing-8); }
.btn-sm { padding: 8px 12px; min-height: 44px; }
.pitch-btns .btn-sm { white-space: nowrap; justify-content: center; }
.label { font: 700 var(--text-small)/18.2px var(--font-sans); }
</style>
