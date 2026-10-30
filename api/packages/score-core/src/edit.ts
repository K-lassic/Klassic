// 편집 연산 — 원본 ScoreDoc 은 건드리지 않고 사본에 연산 목록을 차례로 적용한다 (tasks T117, BR-EDT-01·04·06·07).
import {
  BUILTIN_DEFAULT_ENSEMBLE, BUILTIN_INSTRUMENTS, clamp, cloneDoc, findInstrument, findInstrumentByName,
  instrumentDisplayName, nextPartId, noteId, originalCode, parseOriginalCode,
  type EditOp, type EditSummary, type EnsembleEntry, type InstrumentCatalog, type Part, type ScoreDoc,
} from './scoredoc.js';

export interface ApplyOptions { catalog?: InstrumentCatalog }

/** 파트 악기를 바꾼다(음표는 그대로). 목록에 있는 악기면 타악 여부도 따른다 */
/** 빠르기 범위(4분음표 BPM) — 재생 빠르기 0.5~2배(100 BPM 기준)를 넉넉히 담는다 */
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 300;

function setInstrument(part: Part, code: string, catalog: InstrumentCatalog): void {
  const info = findInstrument(code, catalog);
  // (2026-09-30 황송해 145번) 타악기는 타악 성부에만, 선율 악기는 선율 성부에만(BR-PLY-01). 성부가 타악인지는 악보가
  // 정하고 악기로 바뀌지 않는다 — 전에는 선율 성부에 "북"을 놓으면 그 성부가 타악이 되어 다시는 선율 악기를 고를 수 없었다.
  if (info && info.is_percussion !== part.isPercussion) return;
  part.instrument = code;
  part.name = instrumentDisplayName(code, part, catalog);
}

function findNote(doc: ScoreDoc, id: string) {
  for (const p of doc.parts) {
    const n = p.notes.find((x) => x.id === id);
    if (n) return { part: p, note: n };
  }
  return undefined;
}

/** 5도권 조표 이동: 반음 1개 = 5도 7칸. -6..6 안(6/-6 은 원래 방향)으로 맞춘다 */
export function transposeFifths(fifths: number, semitones: number): number {
  if (semitones % 12 === 0) return fifths;
  let f = (((fifths + 7 * semitones) % 12) + 12) % 12;
  if (f > 6) f -= 12;
  if (f === 6 && fifths < 0) f = -6;
  if (f === -6 && fifths > 0) f = 6;
  return f;
}

/** 연산 하나 적용(doc 는 이미 사본) */
function applyOne(doc: ScoreDoc, op: EditOp, catalog: InstrumentCatalog): void {
  switch (op.op) {
    case 'add_instrument': {
      // 원래 선율(첫 성부)을 복사한 새 트랙 (FR-023, BR-EDT-07)
      const src = doc.parts[0];
      if (!src) return;
      const id = nextPartId(doc);
      const info = findInstrument(op.instrument, catalog);
      const part: Part = {
        id,
        name: instrumentDisplayName(op.instrument, null, catalog),
        instrument: op.instrument,
        sourceInstrument: null,
        isPercussion: info ? info.is_percussion : src.isPercussion,
        volume: 100,
        origin: 'melody_copy',
        notes: src.notes.map((n, i) => ({ ...n, id: noteId(id, i) })),
      };
      doc.parts.push(part);
      return;
    }
    case 'remove_track': {
      // 추가한 트랙(선율 복사)만 지운다. 원래 악보 트랙은 원본 보존(BR-EDT-04)이라 건너뛴다 (UC_06 BR-EDT-08, 2026-09-30)
      const part = doc.parts[op.part];
      if (part && part.origin === 'melody_copy') doc.parts.splice(op.part, 1);
      return;
    }
    case 'change_instrument': {
      const part = doc.parts[op.part];
      if (part) setInstrument(part, op.instrument, catalog);
      return;
    }
    case 'transpose': {
      const s = Math.round(op.semitones);
      if (!s) return;
      for (const p of doc.parts) {
        if (p.isPercussion) continue;            // 타악은 음높이가 없다
        for (const n of p.notes) n.pitch = clamp(n.pitch + s, 0, 127);
      }
      doc.keyFifths = transposeFifths(doc.keyFifths, s);
      return;
    }
    case 'set_track_volume': {
      const part = doc.parts[op.part];
      if (part) part.volume = clamp(Math.round(op.velocity), 0, 127);
      return;
    }
    case 'set_note_volume': {
      const hit = findNote(doc, op.note_id);
      if (hit) hit.note.velocity = clamp(Math.round(op.velocity), 1, 127);
      return;
    }
    case 'set_tempo': {
      // (2026-09-30 황송해 161번) 곡 전체 빠르기 — MIDI 템포 메타 · MusicXML <sound tempo> · 메트로놈 표시가 이 값을 쓴다
      const bpm = Number(op.bpm);
      if (Number.isFinite(bpm)) doc.tempoBpm = Math.round(clamp(bpm, TEMPO_MIN, TEMPO_MAX) * 100) / 100;
      return;
    }
    case 'set_note_pitch': {
      const hit = findNote(doc, op.note_id);
      if (hit) hit.note.pitch = clamp(Math.round(op.midi_pitch), 0, 127);
      return;
    }
    default:
      // 모르는 연산(예: 삭제된 사용자 음원 지정 'assign_sf2' — 2026-09-29 US8 삭제 전 기기에 남은 편집)은 건너뛴다
      return;
  }
}

/** 원본 + 연산 목록 → 편집본. 빈 목록 = 원본 사본(되돌리기) */
export function applyOps(doc: ScoreDoc, ops: readonly EditOp[], opts: ApplyOptions = {}): ScoreDoc {
  const catalog = opts.catalog ?? BUILTIN_INSTRUMENTS;
  const out = cloneDoc(doc);
  for (const op of ops) applyOne(out, op, catalog);
  return out;
}

/** 연산 목록 검사 — 없는 파트·음표를 가리키면 이유를 돌려준다(적용할 때는 조용히 건너뛴다) */
export function validateOps(doc: ScoreDoc, ops: readonly EditOp[], opts: ApplyOptions = {}): string[] {
  const catalog = opts.catalog ?? BUILTIN_INSTRUMENTS;
  const errors: string[] = [];
  const cur = cloneDoc(doc);
  const knownInstrument = (c: string) => !!findInstrument(c, catalog) || parseOriginalCode(c) !== null;
  ops.forEach((op, i) => {
    const partOk = (p: number) => Number.isInteger(p) && p >= 0 && p < cur.parts.length;
    const noteOk = (id: string) => !!findNote(cur, id);
    switch (op.op) {
      case 'add_instrument': if (!knownInstrument(op.instrument)) errors.push(`${i}: 모르는 악기 ${op.instrument}`); break;
      case 'remove_track':
        if (!partOk(op.part)) errors.push(`${i}: 없는 트랙 ${op.part}`);
        else if (cur.parts[op.part].origin !== 'melody_copy') errors.push(`${i}: 원래 악보 트랙은 지울 수 없음 ${op.part}`);
        break;
      case 'change_instrument':
        if (!partOk(op.part)) errors.push(`${i}: 없는 트랙 ${op.part}`);
        if (!knownInstrument(op.instrument)) errors.push(`${i}: 모르는 악기 ${op.instrument}`);
        else if (partOk(op.part)) {
          const info = findInstrument(op.instrument, catalog);
          if (info && info.is_percussion !== cur.parts[op.part].isPercussion) {
            errors.push(`${i}: ${info.is_percussion ? '타악기는 타악 성부에만' : '선율 악기는 선율 성부에만'} 놓을 수 있음 ${op.part}`);
          }
        }
        break;
      case 'transpose': if (!Number.isInteger(op.semitones)) errors.push(`${i}: 조옮김은 반음 정수`); break;
      case 'set_track_volume': if (!partOk(op.part)) errors.push(`${i}: 없는 트랙 ${op.part}`); break;
      case 'set_note_volume': case 'set_note_pitch': if (!noteOk(op.note_id)) errors.push(`${i}: 없는 음표 ${op.note_id}`); break;
      case 'set_tempo': if (!Number.isFinite(Number(op.bpm)) || op.bpm < TEMPO_MIN || op.bpm > TEMPO_MAX) errors.push(`${i}: 빠르기는 ${TEMPO_MIN}~${TEMPO_MAX} BPM`); break;
      default: errors.push(`${i}: 모르는 연산 ${(op as { op: string }).op}`);
    }
    applyOne(cur, op, catalog);
  });
  return errors;
}

export type InstrumentMode = 'default' | 'original' | 'custom';
export interface InstrumentModeOptions {
  defaultEnsemble?: EnsembleEntry[];            // shared/instruments.json default_ensemble
  tracks?: { part: number; instrument: string }[];
  catalog?: InstrumentCatalog;
}

/** 연주 악기 구성 적용 (FR-021·FR-056): default = 기본 국악기, original = 원래 악기, custom = 트랙별 지정 */
export function applyInstrumentMode(doc: ScoreDoc, mode: InstrumentMode, opts: InstrumentModeOptions = {}): ScoreDoc {
  const catalog = opts.catalog ?? BUILTIN_INSTRUMENTS;
  const out = cloneDoc(doc);
  if (mode === 'default') {
    const ens = opts.defaultEnsemble ?? BUILTIN_DEFAULT_ENSEMBLE;
    const melody = ens.find((e) => e.part_role === 'melody')?.instrument;
    const perc = ens.find((e) => e.part_role === 'percussion')?.instrument;
    // 선율 성부 → 가야금, 타악 성부 → 장구. 타악 성부가 없으면 새로 만들지 않는다
    for (const p of out.parts) {
      const code = p.isPercussion ? perc : melody;
      if (code) setInstrument(p, code, catalog);
    }
  } else if (mode === 'original') {
    for (const p of out.parts) {
      const src = p.sourceInstrument;
      if (!src) continue;
      const known = findInstrumentByName(src.name, catalog);
      if (known && known.is_percussion === p.isPercussion) {
        setInstrument(p, known.code, catalog);
      } else {
        p.instrument = originalCode(p.isPercussion ? 0 : src.program);
        p.name = src.name || p.name;
      }
    }
  } else {
    for (const t of opts.tracks ?? []) {
      const p = out.parts[t.part];
      if (p) setInstrument(p, t.instrument, catalog);
    }
  }
  return out;
}

export interface RangeInfo { code: string; range_low?: number | null; range_high?: number | null }

/** 악기 음역을 벗어난 음표 (경고만, 막지 않음 — BR-EDT-03) */
/**
 * [음역에 맞게 옥타브 옮기기] (2026-09-30 박예은 팀장 결정, UC_06 BR-EDT-03) — 음역을 벗어난 음을 가장 가까운 옥타브(±12반음씩)로
 * 옮기는 편집 명령(set_note_pitch)을 만든다. 사용자가 누를 때만 쓰고(강제 아님), 옮겨도 음역에 들어가지 않는 음은 그대로 둔다.
 */
export function fitToRangeOps(doc: ScoreDoc, instruments: readonly RangeInfo[] = BUILTIN_INSTRUMENTS): EditOp[] {
  const ops: EditOp[] = [];
  const byId = new Map(doc.parts.flatMap((p) => p.notes.map((n) => [n.id, n] as const)));
  for (const w of rangeWarnings(doc, instruments)) {
    const part = doc.parts[w.part];
    const info = instruments.find((i) => i.code === part.instrument);
    const n = byId.get(w.noteId);
    if (!info || !n) continue;
    const lo = info.range_low ?? -Infinity;
    const hi = info.range_high ?? Infinity;
    let p = n.pitch;
    while (p < lo && p + 12 <= 127) p += 12;
    while (p > hi && p - 12 >= 0) p -= 12;
    if (p !== n.pitch && p >= lo && p <= hi) ops.push({ op: 'set_note_pitch', note_id: n.id, midi_pitch: p });
  }
  return ops;
}

export function rangeWarnings(doc: ScoreDoc, instruments: readonly RangeInfo[] = BUILTIN_INSTRUMENTS): { part: number; noteId: string }[] {
  const out: { part: number; noteId: string }[] = [];
  doc.parts.forEach((p, pi) => {
    if (p.isPercussion) return;
    const info = instruments.find((i) => i.code === p.instrument);
    if (!info) return;
    const lo = info.range_low ?? null;
    const hi = info.range_high ?? null;
    if (lo === null && hi === null) return;
    for (const n of p.notes) {
      if ((lo !== null && n.pitch < lo) || (hi !== null && n.pitch > hi)) out.push({ part: pi, noteId: n.id });
    }
  });
  return out;
}

/** 편집 기록용 요약 (BR-EDT-05, PUT /api/requests/:no/edits) */
export function summarizeOps(ops: readonly EditOp[]): EditSummary {
  const s: EditSummary = { edited: ops.length > 0, instrument_changes: [], transpose_semitones: 0, volume_changes: { tracks: {}, notes: 0 }, pitch_fixes: 0 };
  const noteVol = new Set<string>();
  const notePitch = new Set<string>();
  for (const op of ops) {
    switch (op.op) {
      case 'add_instrument': s.instrument_changes.push({ kind: 'add', instrument: op.instrument }); break;
      case 'remove_track': s.instrument_changes.push({ kind: 'remove', part: op.part }); break;
      case 'change_instrument': s.instrument_changes.push({ kind: 'change', part: op.part, instrument: op.instrument }); break;
      case 'transpose': s.transpose_semitones += Math.round(op.semitones); break;
      case 'set_track_volume': s.volume_changes.tracks[String(op.part)] = clamp(Math.round(op.velocity), 0, 127); break;
      case 'set_note_volume': noteVol.add(op.note_id); break;
      case 'set_note_pitch': notePitch.add(op.note_id); break;
      case 'set_tempo': s.tempo_bpm = Math.round(op.bpm * 100) / 100; break;
      default: break;
    }
  }
  s.volume_changes.notes = noteVol.size;
  s.pitch_fixes = notePitch.size;
  return s;
}
