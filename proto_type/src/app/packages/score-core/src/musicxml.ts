// MusicXML(partwise, .mxl 포함) ⇄ ScoreDoc (tasks T044·T123, research R6·R11).
import { XMLParser } from 'fast-xml-parser';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import {
  BUILTIN_INSTRUMENTS, PPQ, clamp, createScoreDoc, findInstrumentByName, measureTicks, noteId,
  normalizePpq, originalCode, resolveInstrument, sortNotes, utf8Decode,
  type InstrumentCatalog, type Note, type Part, type ScoreDoc, type SourceInstrument,
} from './scoredoc.js';

// ───────────────────────── XML 나무 ─────────────────────────

interface XEl { name: string; attrs: Record<string, string>; children: XEl[]; text: string }

type RawNode = Record<string, unknown>;

function toTree(nodes: RawNode[]): { els: XEl[]; text: string } {
  const els: XEl[] = [];
  let text = '';
  for (const node of nodes) {
    const key = Object.keys(node).find((k) => k !== ':@');
    if (key === undefined) continue;
    if (key === '#text') { text += String(node[key]); continue; }
    if (key.startsWith('?') || key.startsWith('!')) continue;
    const attrsRaw = (node[':@'] ?? {}) as Record<string, unknown>;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrsRaw)) attrs[k] = String(v);
    const inner = toTree((node[key] ?? []) as RawNode[]);
    els.push({ name: key, attrs, children: inner.els, text: inner.text });
  }
  return { els, text };
}

function parseXml(text: string): XEl[] {
  const parser = new XMLParser({
    preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
    parseAttributeValue: false, trimValues: true, ignoreDeclaration: true, ignorePiTags: true,
  });
  return toTree(parser.parse(text) as RawNode[]).els;
}

const child = (el: XEl | undefined, name: string): XEl | undefined => el?.children.find((c) => c.name === name);
const children = (el: XEl | undefined, name: string): XEl[] => el?.children.filter((c) => c.name === name) ?? [];
const childText = (el: XEl | undefined, name: string): string | undefined => child(el, name)?.text;
const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

// ───────────────────────── 음높이 ─────────────────────────

const STEP_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_SPELL: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SPELL: [string, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

function stepToMidi(step: string, alter: number, octave: number): number {
  return (octave + 1) * 12 + (STEP_SEMI[step.toUpperCase()] ?? 0) + Math.round(alter);
}

/** 조표에 맞춰 올림/내림 표기를 고른다(조옮김 표기, research R6) */
function spell(pitch: number, keyFifths: number): { step: string; alter: number; octave: number } {
  const pc = ((pitch % 12) + 12) % 12;
  const [step, alter] = (keyFifths < 0 ? FLAT_SPELL : SHARP_SPELL)[pc];
  const octave = Math.floor((pitch - alter) / 12) - 1;
  return { step, alter, octave };
}

/** 타악 음표를 오선 어디에 그릴지(GM 타악 번호 기준 대략 자리). 소리는 midi-unpitched 로 정해진다 */
function drumDisplay(pitch: number): { step: string; octave: number } {
  if (pitch <= 36) return { step: 'F', octave: 4 };                    // 큰북
  if (pitch <= 40 && pitch !== 39) return { step: 'C', octave: 5 };    // 작은북·림
  if ([42, 44, 46].includes(pitch)) return { step: 'G', octave: 5 };    // 하이햇
  if ([41, 43, 45].includes(pitch)) return { step: 'A', octave: 4 };    // 낮은 탐
  if ([47, 48, 50].includes(pitch)) return { step: 'D', octave: 5 };    // 높은 탐
  if (pitch >= 49) return { step: 'A', octave: 5 };                    // 심벌 등
  return { step: 'E', octave: 5 };
}

/** 조표가 붙이는 음(음이름 → 변화) */
function keyAlters(fifths: number): Record<string, number> {
  const out: Record<string, number> = {};
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  for (let i = 0; i < Math.min(7, Math.abs(fifths)); i++) {
    if (fifths > 0) out[sharps[i]] = 1; else out[flats[i]] = -1;
  }
  return out;
}

// ───────────────────────── 셈여림 ─────────────────────────

// MusicXML dynamics 는 "포르테(속도 90)의 몇 %" 로 적는다
const velocityToDynamics = (v: number): number => Math.round((v / 90) * 100 * 100) / 100;
const dynamicsToVelocity = (d: number): number => clamp(Math.round((d * 90) / 100), 1, 127);
const DYN_MARKS: [string, number][] = [['ppp', 30], ['pp', 40], ['p', 50], ['mp', 64], ['mf', 80], ['f', 96], ['ff', 112], ['fff', 124]];
function markFor(v: number): string {
  let best = DYN_MARKS[0];
  for (const m of DYN_MARKS) if (Math.abs(m[1] - v) < Math.abs(best[1] - v)) best = m;
  return best[0];
}
const DEFAULT_VELOCITY = 90;

// ───────────────────────── 읽기 ─────────────────────────

/** .mxl(zip) 이면 META-INF/container.xml 의 rootfile 을 꺼낸다 */
function unpackMusicXml(input: string | Uint8Array): string {
  if (typeof input === 'string') return input;
  const isZip = input.length > 4 && input[0] === 0x50 && input[1] === 0x4b && input[2] === 0x03 && input[3] === 0x04;
  if (!isZip) return utf8Decode(input).replace(/^\uFEFF/, '');
  const files = unzipSync(input);
  let rootPath: string | undefined;
  const container = files['META-INF/container.xml'];
  if (container) {
    const tree = parseXml(utf8Decode(container));
    const find = (els: XEl[]): string | undefined => {
      for (const e of els) {
        if (e.name === 'rootfile' && e.attrs['full-path']) return e.attrs['full-path'];
        const r = find(e.children);
        if (r) return r;
      }
      return undefined;
    };
    rootPath = find(tree);
  }
  if (!rootPath || !files[rootPath]) {
    rootPath = Object.keys(files).find((k) => !k.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(k));
  }
  if (!rootPath) throw new Error('MXL 안에서 악보 파일을 찾지 못했어요');
  return utf8Decode(files[rootPath]).replace(/^\uFEFF/, '');
}

interface PartMeta {
  name: string;
  instrumentName?: string;
  program: number | null;                       // 0부터
  channel?: number;
  volume?: number;                              // 0..127
  unpitched: Map<string, number>;               // score-instrument id → MIDI 음번호
  percussion: boolean;
  gugak?: { instrument?: string; origin?: Part['origin']; volume?: number; isPercussion?: boolean; sourceInstrument?: SourceInstrument | null; name?: string };
}

function metronomeToQuarterBpm(metro: XEl): number | undefined {
  const perMinute = num(childText(metro, 'per-minute'));
  const unit = childText(metro, 'beat-unit');
  if (perMinute === undefined || !unit) return undefined;
  const base: Record<string, number> = { breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
  let q = base[unit] ?? 1;
  const dots = children(metro, 'beat-unit-dot').length;
  let add = q / 2;
  for (let i = 0; i < dots; i++) { q += add; add /= 2; }
  return perMinute * q;
}

/** MusicXML(문자열·바이트·.mxl) → ScoreDoc */
export function parseMusicXml(input: string | Uint8Array, catalog: InstrumentCatalog = BUILTIN_INSTRUMENTS): ScoreDoc {
  const text = unpackMusicXml(input);
  const roots = parseXml(text);
  const root = roots.find((e) => e.name === 'score-partwise');
  if (!root) {
    if (roots.some((e) => e.name === 'score-timewise')) throw new Error('score-timewise 형식은 아직 읽지 못해요');
    throw new Error('MusicXML 악보(score-partwise)가 아니에요');
  }

  const doc = createScoreDoc({ ppq: PPQ });
  const title = childText(child(root, 'work'), 'work-title') ?? childText(root, 'movement-title');
  if (title) doc.title = title;

  // 우리 서비스가 적어 둔 파트 정보(원래 악기 보존, FR-056)
  const gugakMeta = new Map<string, PartMeta['gugak']>();
  for (const f of children(child(child(root, 'identification'), 'miscellaneous'), 'miscellaneous-field')) {
    const name = f.attrs.name ?? '';
    if (name.startsWith('gugak-part-')) {
      try { gugakMeta.set(name.slice('gugak-part-'.length), JSON.parse(f.text)); } catch { /* 깨진 값은 무시 */ }
    }
  }

  const metas = new Map<string, PartMeta>();
  for (const sp of children(child(root, 'part-list'), 'score-part')) {
    const id = sp.attrs.id;
    const meta: PartMeta = { name: childText(sp, 'part-name') ?? id, program: null, unpitched: new Map(), percussion: false, gugak: gugakMeta.get(id) };
    const si = children(sp, 'score-instrument');
    if (si.length) meta.instrumentName = childText(si[0], 'instrument-name');
    const mis = children(sp, 'midi-instrument');
    mis.forEach((mi, idx) => {
      const ch = num(childText(mi, 'midi-channel'));
      const prog = num(childText(mi, 'midi-program'));
      const unp = num(childText(mi, 'midi-unpitched'));
      const vol = num(childText(mi, 'volume'));
      if (idx === 0) {
        if (ch !== undefined) meta.channel = ch;
        if (prog !== undefined) meta.program = clamp(Math.round(prog) - 1, 0, 127);
        if (vol !== undefined) meta.volume = clamp(Math.round((vol / 100) * 127), 0, 127);
      }
      if (ch === 10) meta.percussion = true;
      if (unp !== undefined && mi.attrs.id) meta.unpitched.set(mi.attrs.id, clamp(Math.round(unp) - 1, 0, 127));
    });
    metas.set(id, meta);
  }

  let tempo: number | undefined;
  let time: ScoreDoc['timeSignature'] | undefined;
  let fifths: number | undefined;

  for (const pe of children(root, 'part')) {
    const id = pe.attrs.id;
    const meta = metas.get(id) ?? { name: id, program: null, unpitched: new Map(), percussion: false };
    let divisions = 1;
    let measureStart = 0;                        // divisions 가 바뀔 수 있어 틱으로 센다
    let velocityDefault = DEFAULT_VELOCITY;
    let sawUnpitched = false;
    let percClef = false;
    const notes: Note[] = [];
    const openTies = new Map<number, Note>();

    for (const m of children(pe, 'measure')) {
      let pos = 0;                               // 마디 안 위치(틱)
      let maxPos = 0;
      let lastStart = 0;
      const toTicks = (d: number) => Math.round((d * PPQ) / divisions);

      const readSound = (s: XEl | undefined) => {
        if (!s) return;
        const t = num(s.attrs.tempo);
        if (t !== undefined && t > 0 && tempo === undefined) tempo = t;
        const d = num(s.attrs.dynamics);
        if (d !== undefined) velocityDefault = dynamicsToVelocity(d);
      };

      for (const el of m.children) {
        switch (el.name) {
          case 'attributes': {
            const dv = num(childText(el, 'divisions'));
            if (dv && dv > 0) divisions = dv;
            const k = num(childText(child(el, 'key'), 'fifths'));
            if (k !== undefined && fifths === undefined) fifths = clamp(Math.round(k), -7, 7);
            const t = child(el, 'time');
            if (t && !time) {
              const beats = (childText(t, 'beats') ?? '').split('+').reduce((a, b) => a + (Number(b) || 0), 0);
              const beatType = num(childText(t, 'beat-type'));
              if (beats > 0 && beatType) time = { beats, beatType };
            }
            if (children(el, 'clef').some((c) => childText(c, 'sign') === 'percussion')) percClef = true;
            break;
          }
          case 'direction': {
            readSound(child(el, 'sound'));
            for (const dt of children(el, 'direction-type')) {
              const metro = child(dt, 'metronome');
              if (metro && tempo === undefined && !child(el, 'sound')?.attrs.tempo) {
                const q = metronomeToQuarterBpm(metro);
                if (q) tempo = q;
              }
              const dyn = child(dt, 'dynamics');
              if (dyn && child(el, 'sound')?.attrs.dynamics === undefined) {
                const mark = dyn.children[0]?.name;
                const found = DYN_MARKS.find((x) => x[0] === mark);
                if (found) velocityDefault = found[1];
              }
            }
            break;
          }
          case 'sound': readSound(el); break;
          case 'backup': pos -= toTicks(num(childText(el, 'duration')) ?? 0); if (pos < 0) pos = 0; break;
          case 'forward': pos += toTicks(num(childText(el, 'duration')) ?? 0); maxPos = Math.max(maxPos, pos); break;
          case 'note': {
            if (child(el, 'grace')) break;                   // 꾸밈음은 길이가 없어 뺀다
            const dur = toTicks(num(childText(el, 'duration')) ?? 0);
            const isChord = !!child(el, 'chord');
            const start = isChord ? lastStart : pos;
            if (!isChord) { lastStart = pos; pos += dur; maxPos = Math.max(maxPos, pos); }
            if (child(el, 'rest') || child(el, 'cue') || dur <= 0) break;

            let pitch: number | undefined;
            const p = child(el, 'pitch');
            const up = child(el, 'unpitched');
            if (p) {
              pitch = stepToMidi(childText(p, 'step') ?? 'C', num(childText(p, 'alter')) ?? 0, num(childText(p, 'octave')) ?? 4);
            } else if (up) {
              sawUnpitched = true;
              const instId = child(el, 'instrument')?.attrs.id;
              pitch = (instId !== undefined ? meta.unpitched.get(instId) : undefined)
                ?? stepToMidi(childText(up, 'display-step') ?? 'C', 0, num(childText(up, 'display-octave')) ?? 4);
            }
            if (pitch === undefined) break;
            pitch = clamp(pitch, 0, 127);

            const dynAttr = num(el.attrs.dynamics);
            const velocity = dynAttr !== undefined ? dynamicsToVelocity(dynAttr) : velocityDefault;
            const absStart = measureStart + start;
            const ties = [...children(el, 'tie'), ...children(child(el, 'notations'), 'tied')].map((t) => t.attrs.type);
            const tieStop = ties.includes('stop');
            const tieStart = ties.includes('start');

            const open = openTies.get(pitch);
            if (tieStop && open && Math.abs(open.startTick + open.durationTicks - absStart) <= 1) {
              open.durationTicks = absStart + dur - open.startTick;
              if (!tieStart) openTies.delete(pitch);
              break;
            }
            const n: Note = { id: '', startTick: absStart, durationTicks: dur, pitch, velocity };
            notes.push(n);
            if (tieStart) openTies.set(pitch, n); else openTies.delete(pitch);
            break;
          }
          default: break;
        }
      }
      // 빈 마디는 박자표 길이만큼 센다
      const len = maxPos > 0 ? maxPos : measureTicks({ ppq: PPQ, timeSignature: time ?? { beats: 4, beatType: 4 } });
      measureStart += len;
    }

    sortNotes(notes).forEach((n, i) => { n.id = noteId(id, i); });
    doc.parts.push(buildPart(id, meta, notes, meta.percussion || sawUnpitched || percClef, catalog));
  }

  doc.tempoBpm = Math.round((tempo ?? 120) * 100) / 100;
  doc.timeSignature = time ?? { beats: 4, beatType: 4 };
  doc.keyFifths = fifths ?? 0;
  return doc;
}

function buildPart(id: string, meta: PartMeta, notes: Note[], percussion: boolean, catalog: InstrumentCatalog): Part {
  const g = meta.gugak;
  const srcName = meta.instrumentName || meta.name;
  const sourceInstrument: SourceInstrument | null = g?.sourceInstrument !== undefined
    ? g.sourceInstrument
    : (srcName || meta.program !== null) ? { name: srcName ?? '', program: percussion ? null : meta.program } : null;
  const isPercussion = g?.isPercussion ?? percussion;
  // 악기 코드: 우리가 적어 둔 값 → 한글 이름 → 원래 GM 번호
  const byName = findInstrumentByName(meta.name, catalog) ?? findInstrumentByName(meta.instrumentName, catalog);
  const instrument = g?.instrument
    ?? (byName && byName.is_percussion === isPercussion ? byName.code : originalCode(isPercussion ? 0 : meta.program));
  return {
    id,
    name: g?.name ?? (byName?.name_ko ?? meta.name),
    instrument,
    sourceInstrument,
    isPercussion,
    volume: g?.volume ?? meta.volume ?? 100,
    origin: g?.origin ?? 'original',
    notes,
  };
}

// ───────────────────────── 쓰기 ─────────────────────────

const GRID = 10;                                 // 틱 격자(64분 셋잇단 = 20, 128분 셋잇단 = 10)

interface NoteValue { ticks: number; type: string; dots: number; triplet: boolean }

const NOTE_VALUES: NoteValue[] = (() => {
  const types: [string, number][] = [['whole', 1920], ['half', 960], ['quarter', 480], ['eighth', 240], ['16th', 120], ['32nd', 60], ['64th', 30], ['128th', 15]];
  const out: NoteValue[] = [];
  for (const [type, t] of types) {
    out.push({ ticks: t, type, dots: 0, triplet: false });
    out.push({ ticks: t * 1.5, type, dots: 1, triplet: false });
    out.push({ ticks: t * 1.75, type, dots: 2, triplet: false });
    out.push({ ticks: (t * 2) / 3, type, dots: 0, triplet: true });
  }
  return out.filter((v) => Number.isInteger(v.ticks) && v.ticks % GRID === 0).sort((a, b) => b.ticks - a.ticks);
})();

const decomposeCache = new Map<number, NoteValue[]>();

/** 길이(격자 배수)를 적을 수 있는 음표 값들로 나눈다 — 조각 수가 가장 적게, 셋잇단보다 보통 음표 우선 */
function decompose(len: number): NoteValue[] {
  const cached = decomposeCache.get(len);
  if (cached) return cached;
  const units = Math.round(len / GRID);
  const cost = new Array<number>(units + 1).fill(Infinity);
  const pick = new Array<NoteValue | null>(units + 1).fill(null);
  cost[0] = 0;
  for (let u = 1; u <= units; u++) {
    for (const v of NOTE_VALUES) {
      const vu = v.ticks / GRID;
      if (vu > u) continue;
      const c = cost[u - vu] + (v.triplet ? 1.5 : 1) + v.dots * 0.1;
      if (c < cost[u]) { cost[u] = c; pick[u] = v; }
    }
  }
  const out: NoteValue[] = [];
  for (let u = units; u > 0;) {
    const v = pick[u];
    if (!v) break;
    out.push(v);
    u -= v.ticks / GRID;
  }
  out.sort((a, b) => b.ticks - a.ticks);
  decomposeCache.set(len, out);
  return out;
}

const q = (t: number) => Math.round(t / GRID) * GRID;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Group { start: number; end: number; notes: Note[] }

/** 같은 시작·끝 음표를 화음으로 묶고, 겹치면 성부(voice)를 나눈다 */
function assignVoices(notes: Note[]): Group[][] {
  const byKey = new Map<string, Group[]>();
  const groups: Group[] = [];
  for (const n of notes) {
    const start = q(n.startTick);
    let end = q(n.startTick + n.durationTicks);
    if (end <= start) end = start + GRID;
    const key = `${start}:${end}`;
    const list = byKey.get(key) ?? [];
    let g = list.find((x) => !x.notes.some((o) => o.pitch === n.pitch));
    if (!g) { g = { start, end, notes: [] }; list.push(g); byKey.set(key, list); groups.push(g); }
    g.notes.push(n);
  }
  groups.sort((a, b) => a.start - b.start || Math.max(...b.notes.map((n) => n.pitch)) - Math.max(...a.notes.map((n) => n.pitch)));
  const voices: { end: number; groups: Group[] }[] = [];
  for (const g of groups) {
    g.notes.sort((a, b) => b.pitch - a.pitch);
    let v = voices.find((x) => x.end <= g.start);
    if (!v) { v = { end: 0, groups: [] }; voices.push(v); }
    v.groups.push(g);
    v.end = g.end;
  }
  return voices.map((v) => v.groups);
}

export interface ToMusicXmlOptions { catalog?: InstrumentCatalog }

/** ScoreDoc → MusicXML 4.0 partwise 문자열 (한글 악기 이름·셈여림·조표, BR-EDT-06) */
export function toMusicXml(input: ScoreDoc, opts: ToMusicXmlOptions = {}): string {
  const catalog = opts.catalog ?? BUILTIN_INSTRUMENTS;
  const doc = normalizePpq(input);
  const mTicks = measureTicks(doc);
  let lastEnd = 0;
  for (const p of doc.parts) for (const n of p.notes) lastEnd = Math.max(lastEnd, q(n.startTick + n.durationTicks), q(n.startTick) + GRID);
  const measureCount = Math.max(1, Math.ceil(lastEnd / mTicks));
  const kAlters = keyAlters(doc.keyFifths);
  const out: string[] = [];
  const w = (s: string) => out.push(s);

  w('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  w('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  w('<score-partwise version="4.0">');
  if (doc.title) w(`  <work><work-title>${esc(doc.title)}</work-title></work>`);
  w('  <identification>');
  w('    <encoding><software>gugak score-core</software><supports element="accidental" type="yes"/></encoding>');
  w('    <miscellaneous>');
  for (const p of doc.parts) {
    const meta = { instrument: p.instrument, origin: p.origin, volume: p.volume, isPercussion: p.isPercussion, sourceInstrument: p.sourceInstrument ?? null, name: p.name };
    w(`      <miscellaneous-field name="gugak-part-${esc(p.id)}">${esc(JSON.stringify(meta))}</miscellaneous-field>`);
  }
  w('    </miscellaneous>');
  w('  </identification>');

  // 파트 목록 — 한글 이름, GM 번호(1부터), 타악은 채널 10
  w('  <part-list>');
  let nextChannel = 1;
  const channels = doc.parts.map((p) => {
    if (resolveInstrument(p, catalog).isPercussion || p.isPercussion) return 10;
    const ch = nextChannel;
    nextChannel = nextChannel === 9 ? 11 : nextChannel >= 16 ? 1 : nextChannel + 1;
    return ch;
  });
  const percPitches = doc.parts.map((p) => [...new Set(p.notes.map((n) => n.pitch))].sort((a, b) => a - b));
  doc.parts.forEach((p, i) => {
    const r = resolveInstrument(p, catalog);
    const perc = channels[i] === 10;
    const vol = Math.round((p.volume / 127) * 100 * 100) / 100;
    w(`    <score-part id="${esc(p.id)}">`);
    w(`      <part-name>${esc(p.name || r.name)}</part-name>`);
    if (perc) {
      const pitches = percPitches[i].length ? percPitches[i] : [null];
      pitches.forEach((pt) => {
        const iid = `${p.id}-I${pt === null ? 1 : pt + 1}`;
        w(`      <score-instrument id="${esc(iid)}"><instrument-name>${esc(r.name)}</instrument-name></score-instrument>`);
      });
      pitches.forEach((pt) => {
        const iid = `${p.id}-I${pt === null ? 1 : pt + 1}`;
        w(`      <midi-instrument id="${esc(iid)}"><midi-channel>10</midi-channel><midi-program>${r.program + 1}</midi-program>${pt === null ? '' : `<midi-unpitched>${pt + 1}</midi-unpitched>`}<volume>${vol}</volume></midi-instrument>`);
      });
    } else {
      w(`      <score-instrument id="${esc(p.id)}-I1"><instrument-name>${esc(r.name)}</instrument-name></score-instrument>`);
      w(`      <midi-instrument id="${esc(p.id)}-I1"><midi-channel>${channels[i]}</midi-channel><midi-program>${r.program + 1}</midi-program><volume>${vol}</volume></midi-instrument>`);
    }
    w('    </score-part>');
  });
  w('  </part-list>');

  doc.parts.forEach((p, pi) => {
    const perc = channels[pi] === 10;
    const voices = assignVoices(p.notes);
    const avgVel = p.notes.length ? p.notes.reduce((a, n) => a + n.velocity, 0) / p.notes.length : DEFAULT_VELOCITY;
    const trackVel = clamp(Math.round((avgVel * p.volume) / 127), 1, 127);
    const pitchesSorted = p.notes.map((n) => n.pitch).sort((a, b) => a - b);
    const median = pitchesSorted.length ? pitchesSorted[Math.floor(pitchesSorted.length / 2)] : 67;

    w(`  <part id="${esc(p.id)}">`);
    for (let mi = 0; mi < measureCount; mi++) {
      const mStart = mi * mTicks;
      const mEnd = mStart + mTicks;
      w(`    <measure number="${mi + 1}">`);
      if (mi === 0) {
        w('      <attributes>');
        w(`        <divisions>${PPQ}</divisions>`);
        w(`        <key><fifths>${doc.keyFifths}</fifths><mode>major</mode></key>`);
        w(`        <time><beats>${doc.timeSignature.beats}</beats><beat-type>${doc.timeSignature.beatType}</beat-type></time>`);
        if (perc) w('        <clef><sign>percussion</sign></clef>');
        else if (median < 55) w('        <clef><sign>F</sign><line>4</line></clef>');
        else w('        <clef><sign>G</sign><line>2</line></clef>');
        w('      </attributes>');
        if (pi === 0) {
          const dotted = doc.timeSignature.beatType === 8 && doc.timeSignature.beats % 3 === 0;
          const perMinute = dotted ? Math.round((doc.tempoBpm / 1.5) * 100) / 100 : doc.tempoBpm;
          w('      <direction placement="above"><direction-type><metronome>'
            + `<beat-unit>quarter</beat-unit>${dotted ? '<beat-unit-dot/>' : ''}<per-minute>${perMinute}</per-minute>`
            + `</metronome></direction-type><sound tempo="${doc.tempoBpm}"/></direction>`);
        }
        w(`      <direction placement="below"><direction-type><dynamics><${markFor(trackVel)}/></dynamics></direction-type><sound dynamics="${velocityToDynamics(trackVel)}"/></direction>`);
      }

      const state = new Map<string, number>();            // 이 마디에서 바뀐 임시표
      let wroteAny = false;
      voices.forEach((groups, vi) => {
        const inMeasure = groups.filter((g) => g.start < mEnd && g.end > mStart);
        if (vi > 0 && inMeasure.length === 0) return;
        if (vi > 0) w(`      <backup><duration>${mTicks}</duration></backup>`);
        const voice = vi + 1;
        if (inMeasure.length === 0) {
          w(`      <note><rest measure="yes"/><duration>${mTicks}</duration><voice>${voice}</voice></note>`);
          wroteAny = true;
          return;
        }
        let cursor = mStart;
        const rest = (len: number) => {
          for (const v of decompose(len)) w(`      <note><rest/><duration>${v.ticks}</duration><voice>${voice}</voice>${typeXml(v)}</note>`);
        };
        for (const g of inMeasure) {
          const segStart = Math.max(g.start, mStart);
          const segEnd = Math.min(g.end, mEnd);
          if (segStart > cursor) rest(segStart - cursor);
          const pieces = decompose(segEnd - segStart);
          pieces.forEach((v, k) => {
            const tieStop = segStart > g.start || k > 0;
            const tieStart = segEnd < g.end || k < pieces.length - 1;
            g.notes.forEach((n, ci) => {
              const parts: string[] = [];
              if (ci > 0) parts.push('<chord/>');
              if (perc) {
                const sp = drumDisplay(n.pitch);
                parts.push(`<unpitched><display-step>${sp.step}</display-step><display-octave>${sp.octave}</display-octave></unpitched>`);
              } else {
                const sp = spell(n.pitch, doc.keyFifths);
                parts.push(`<pitch><step>${sp.step}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>`);
              }
              parts.push(`<duration>${v.ticks}</duration>`);
              if (tieStop) parts.push('<tie type="stop"/>');
              if (tieStart) parts.push('<tie type="start"/>');
              if (perc) parts.push(`<instrument id="${esc(p.id)}-I${n.pitch + 1}"/>`);
              parts.push(`<voice>${voice}</voice>`);
              parts.push(typeXml(v, perc ? undefined : accidentalFor(n.pitch, doc.keyFifths, kAlters, state, tieStop)));
              if (tieStop || tieStart) {
                parts.push(`<notations>${tieStop ? '<tied type="stop"/>' : ''}${tieStart ? '<tied type="start"/>' : ''}</notations>`);
              }
              w(`      <note dynamics="${velocityToDynamics(n.velocity)}">${parts.join('')}</note>`);
            });
          });
          cursor = segEnd;
        }
        if (cursor < mEnd) rest(mEnd - cursor);
        wroteAny = true;
      });
      if (!wroteAny) w(`      <note><rest measure="yes"/><duration>${mTicks}</duration><voice>1</voice></note>`);
      w('    </measure>');
    }
    w('  </part>');
  });
  w('</score-partwise>');
  return out.join('\n') + '\n';
}

/** type·점·임시표·셋잇단 (MusicXML 순서: type, dot, accidental, time-modification) */
function typeXml(v: NoteValue, accidental?: string): string {
  let s = `<type>${v.type}</type>` + '<dot/>'.repeat(v.dots);
  if (accidental) s += `<accidental>${accidental}</accidental>`;
  if (v.triplet) s += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
  return s;
}

const ACC_NAMES: Record<number, string> = { [-2]: 'flat-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };

/** 조표와 이 마디 앞 음표를 보고 임시표가 필요한지 정한다 */
function accidentalFor(pitch: number, fifths: number, kAlters: Record<string, number>, state: Map<string, number>, tieStop: boolean): string | undefined {
  const sp = spell(pitch, fifths);
  const key = `${sp.step}${sp.octave}`;
  const expected = state.get(key) ?? kAlters[sp.step] ?? 0;
  state.set(key, sp.alter);
  if (tieStop || expected === sp.alter) return undefined;
  return ACC_NAMES[sp.alter];
}

/** ScoreDoc → 압축 MusicXML(.mxl) */
export function toMxl(doc: ScoreDoc, opts: ToMusicXmlOptions = {}): Uint8Array {
  const container = '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>\n';
  return zipSync({
    mimetype: [strToU8('application/vnd.recordare.musicxml'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'score.musicxml': strToU8(toMusicXml(doc, opts)),
  });
}
