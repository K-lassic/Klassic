<script setup lang="ts">
// C6 내려받기 카드 (SD_02 §3-7, 2026-09-30 황송해 결정 — 형식별 창 네 개를 카드 하나로 합침. 이전 C6DownloadRow)
// 형식 토글(MP3 · PDF · MIDI · MusicXML)로 여러 개를 골라 [고른 파일 받기] 한 번. 서버 ZIP 없이 기존 내려받기 API 를
// 형식마다 따로 부른다. 형식끼리 서로 기다리지 않는다(U7): MIDI·MusicXML 은 바로, MP3·PDF 는 다 만들어지면 저절로 받는다.
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { api } from '@/api/client';
import GuardedButton from '@/components/GuardedButton.vue';
import HelpTip from '@/components/HelpTip.vue';
import type { ExportFormat, ExportTask, InstrumentChoiceBody } from '@/types/api';
import type { EditOp } from '@/types/score';
import { gateFromError, statusText } from '@/i18n/gateMessages';

const props = withDefaults(defineProps<{
  requestNo: string;
  title?: string;
  desc?: string;
  editOps?: EditOp[];
  /** MP3 연주 악기 구성 */
  instruments?: InstrumentChoiceBody | null;
  expired?: boolean;
  /** 형식별로 늘 붙는 짧은 안내(연주 악기 · 라이선스 등) */
  notes?: Partial<Record<ExportFormat, string[]>>;
  /** (2026-09-30 황송해 74번) false 면 결과에 MIDI 가 없어 MIDI 칸을 막고 사유를 보인다 */
  midiAvailable?: boolean | null;
}>(), { title: '파일 받기', desc: '', editOps: () => [], instruments: null, expired: false, notes: () => ({}), midiAvailable: null });

const MIDI_OFF = '이 악보는 MIDI 를 만들지 못했습니다.';
const off = (f: ExportFormat) => f === 'midi' && props.midiAvailable === false;

const ORDER: ExportFormat[] = ['mp3', 'pdf', 'midi', 'musicxml'];
const NAME: Record<ExportFormat, string> = { mp3: 'MP3', pdf: 'PDF', midi: 'MIDI', musicxml: 'MusicXML' };
const isInstant = (f: ExportFormat) => f === 'midi' || f === 'musicxml';

type Phase = 'starting' | 'queued' | 'rendering' | 'done' | 'failed';
interface Row { phase: Phase; task: ExportTask | null; failText: string | null }

const picked = ref<ExportFormat[]>([]);
const rows = reactive<Partial<Record<ExportFormat, Row>>>({});
const timers = new Map<ExportFormat, ReturnType<typeof setTimeout>>();
let downloadChain: Promise<void> = Promise.resolve();
let alive = true;
onBeforeUnmount(() => { alive = false; timers.forEach((t) => clearTimeout(t)); });

const base = computed(() => `/api/requests/${encodeURIComponent(props.requestNo)}`);

/** 파일 하나를 브라우저로 받는다. 여러 개를 한꺼번에 받을 때 브라우저가 놓치지 않게 조금씩 띄운다 */
function saveFile(url: string) {
  downloadChain = downloadChain.then(() => new Promise<void>((done) => {
    if (!alive) { done(); return; }
    const a = document.createElement('a');
    a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(done, 400);
  }));
}

function setRow(f: ExportFormat, r: Partial<Row>) {
  rows[f] = { phase: 'starting', task: null, failText: null, ...rows[f], ...r };
}
function fail(f: ExportFormat, text: string) { setRow(f, { phase: 'failed', failText: text }); }

function applyTask(f: ExportFormat, t: ExportTask) {
  if (t.status === 'failed') { setRow(f, { task: t }); fail(f, statusText(t.failure_reason ?? 'RENDER_FAILED')); return; }
  if (t.status === 'ready') {
    setRow(f, { task: t, phase: 'done' });
    saveFile(t.download_url ?? `${base.value}/exports/${encodeURIComponent(t.id)}/file`);
    return;
  }
  setRow(f, { task: t, phase: t.status });
  timers.set(f, setTimeout(() => void poll(f), 1000));
}

async function poll(f: ExportFormat) {
  const t = rows[f]?.task;
  if (!t || !alive) return;
  try { applyTask(f, await api.get<ExportTask>(`${base.value}/exports/${encodeURIComponent(t.id)}`)); }
  catch (e) { fail(f, gateFromError(e).reason); }
}

async function startOne(f: ExportFormat) {
  const cur = rows[f]?.phase;
  if (cur === 'starting' || cur === 'queued' || cur === 'rendering') return;
  // MIDI · MusicXML 은 편집이 없으면 원본 파일을 바로 받는다
  if (isInstant(f) && props.editOps.length === 0) {
    setRow(f, { phase: 'done', task: null, failText: null });
    saveFile(`${base.value}/original/${f}`);
    return;
  }
  setRow(f, { phase: 'starting', task: null, failText: null });
  try {
    const body: Record<string, unknown> = { format: f, edit_ops: props.editOps };
    if (f === 'mp3' && props.instruments) body.instruments = props.instruments;
    applyTask(f, await api.post<ExportTask>(`${base.value}/exports`, body));
  } catch (e) {
    fail(f, gateFromError(e).reason);
  }
}

function startPicked() {
  if (reason.value || picked.value.length === 0 || busy.value) return;
  for (const f of ORDER) if (picked.value.includes(f) && !off(f)) void startOne(f);
}

// 막힘 사유 글자는 보관 기간이 지났을 때만(2026-09-30: 형식을 안 골랐을 때는 버튼만 비활성, SD_02 §3-7)
const reason = computed(() => (props.expired ? '보관 기간이 지나 받을 수 없습니다.' : null));
// MP3 라이선스 안내 — 카드 안 MP3 근처에 한 번만(서버가 같은 안내를 보내도 겹치지 않게, SD_02 §3-7)
const LICENSE = statusText('LICENSE_UNCONFIRMED');
const busy = computed(() => picked.value.some((f) => ['starting', 'queued', 'rendering'].includes(rows[f]?.phase ?? '')));
// (2026-09-30 황송해, SD_02 ㊸) "고른 파일 받기" → "다운받기"
// (2026-09-30 142번) "다운받기" → "악보 다운받기"
const buttonText = computed(() => (picked.value.length ? `악보 다운받기 (${picked.value.length}개)` : '악보 다운받기'));

function stateText(f: ExportFormat, r: Row): string {
  switch (r.phase) {
    case 'starting': return '준비하고 있습니다';
    case 'queued': return r.task?.queue_position ? `차례를 기다립니다 (앞에 ${r.task.queue_position}건)` : '차례를 기다립니다';
    case 'rendering': return '만드는 중입니다. 다른 형식은 그동안에도 받을 수 있습니다.';
    case 'done': return '받았습니다';
    case 'failed': return `만들지 못했습니다. ${r.failText ?? ''}`.trim();
  }
  return NAME[f];
}
const CHIP: Record<Phase, string> = { starting: 's-waiting', queued: 's-waiting', rendering: 's-progress', done: 's-done', failed: 's-rejected' };
const shownRows = computed(() => ORDER.flatMap((f) => (rows[f] ? [{ f, r: rows[f] as Row }] : [])));
const shownNotes = computed(() => {
  const out: string[] = [];
  for (const f of ORDER) {
    const own = [...(picked.value.includes(f) ? props.notes[f] ?? [] : []), ...(f === 'mp3' && picked.value.includes('mp3') ? [LICENSE] : [])];
    const server = (rows[f]?.task?.notices ?? []).map((n) => statusText(n)).filter((n) => !own.includes(n) && !(f === 'mp3' && n === LICENSE && picked.value.includes('mp3')));
    for (const n of [...own, ...server]) {
      const line = `${NAME[f]}: ${n}`;
      if (!out.includes(line)) out.push(line);
    }
  }
  return out;
});
</script>

<template>
  <section class="file-card c6" aria-label="파일 받기" data-test="download-card">
    <h2 v-if="title" class="h3 card-title center-h" data-test="save-title">{{ title }}</h2>
    <span v-if="desc" class="small desc">{{ desc }}</span>

    <!-- (2026-09-30 104번) 형식 설명은 형식 고르기 오른쪽 위 [?] 로 -->
    <div class="formats-row">
      <div class="segmented formats" role="group" aria-label="받을 형식 (여러 개 고를 수 있습니다)" :class="{ off: expired }">
        <label v-for="f in ORDER" :key="f" :class="{ off: off(f) }">
          <input v-model="picked" type="checkbox" :value="f" :disabled="expired || off(f)" :aria-describedby="off(f) ? 'c6-midi-off' : undefined" :data-test="`pick-${f}`" /><span>{{ NAME[f] }}</span>
        </label>
      </div>
      <HelpTip label="파일 형식" text="MP3는 연주 음원, PDF는 인쇄용 악보, MIDI는 다른 음악 프로그램용, MusicXML은 악보 프로그램용입니다." />
    </div>
    <p v-if="midiAvailable === false && !expired" id="c6-midi-off" class="small center midi-off" data-test="midi-off">{{ MIDI_OFF }}</p>

    <ul v-if="shownNotes.length" class="notes small">
      <li v-for="n in shownNotes" :key="n">{{ n }}</li>
    </ul>

    <GuardedButton v-if="reason" class="center" variant="primary" :reason="reason" data-test="download-picked">{{ buttonText }}</GuardedButton>
    <span v-else class="center" data-test="download-picked">
      <button
        type="button" class="btn btn-primary"
        :aria-disabled="picked.length === 0 || busy ? 'true' : undefined" :aria-busy="busy ? 'true' : undefined"
        @click="startPicked"
      >{{ buttonText }}</button>
    </span>

    <ul v-if="shownRows.length" class="states" aria-live="polite" data-test="download-states">
      <li v-for="{ f, r } in shownRows" :key="f" :data-format="f">
        <span class="chip on-white" :class="CHIP[r.phase]">{{ NAME[f] }}</span>
        <span class="small" :class="{ 'fail-text': r.phase === 'failed' }">{{ stateText(f, r) }}</span>
        <button v-if="r.phase === 'failed'" type="button" class="btn btn-secondary btn-sm" :aria-disabled="expired ? 'true' : undefined" @click="!expired && startOne(f)">다시 시도</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.c6 { min-width: 0; }
.card-title { margin: 0; }
.desc { color: var(--color-slate-gray); }
.formats-row { display: flex; align-items: center; justify-content: center; gap: var(--spacing-8); justify-self: center; }
.formats { flex-wrap: wrap; justify-self: center; justify-content: center; }
.center { justify-self: center; }
/* (2026-10-01 황송해 216번) 마우스를 올리면 연한 갈색 바탕 — 고른 칸(갈색 채움) · 막힌 칸은 그대로 */
.formats span { transition: background-color 0.15s ease; }
.formats label:hover input:not(:checked):not(:disabled) + span { background: var(--color-clay-light); }
.formats.off span { color: var(--color-slate-gray); }
.formats input:disabled { cursor: not-allowed; }
.formats label.off span { color: var(--color-slate-gray); text-decoration: line-through; }
.midi-off { margin: 0; color: var(--color-slate-gray); }
.notes { margin: 0; padding-left: 18px; color: var(--color-charcoal); display: grid; gap: 4px; }
.states { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.states li { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.states .small { color: var(--color-charcoal); }
.fail-text { color: var(--status-rejected) !important; }
.btn-sm { padding: 6px 16px; margin-top: 0 !important; }
</style>
