// MIDI ⇄ ScoreDoc (@tonejs/midi, tasks T044·T123, research R11).
import * as tonejsNs from '@tonejs/midi';
import {
  BUILTIN_INSTRUMENTS, PPQ, clamp, createScoreDoc, findInstrumentByName, noteId, normalizePpq,
  originalCode, resolveInstrument, serviceSound, sortNotes, utf8Encode,
  type InstrumentCatalog, type Note, type Part, type ScoreDoc, type SourceInstrument,
} from './scoredoc.js';

// @tonejs/midi 는 CommonJS 라 Node ESM 에서는 default 안에 들어 있다
type MidiCtor = typeof import('@tonejs/midi').Midi;
const ns = tonejsNs as unknown as { Midi?: MidiCtor; default?: { Midi: MidiCtor } };
const Midi: MidiCtor = (ns.Midi ?? ns.default?.Midi) as MidiCtor;

const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const META_PREFIX = 'gugak-part:';

// midi-file 은 글자 하나를 바이트 하나로 쓰고 읽는다 → 한글은 UTF-8 바이트 문자열로 바꿔 넘긴다
function toByteString(s: string): string {
  return Array.from(utf8Encode(s), (b) => String.fromCharCode(b)).join('');
}
function fromByteString(s: string): string {
  if (!s) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 255) return s;                       // 이미 풀린 글자
    bytes[i] = c;
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return s; }
}

interface PartMetaJson {
  track: number;
  id: string;
  name: string;
  instrument: string;
  origin: Part['origin'];
  isPercussion: boolean;
  volume: number;
  sourceInstrument: SourceInstrument | null;
}

/** MIDI 바이트 → ScoreDoc (틱은 480 기준으로 바꾼다) */
export function parseMidi(bytes: Uint8Array, catalog: InstrumentCatalog = BUILTIN_INSTRUMENTS): ScoreDoc {
  const midi = new Midi(bytes);
  const f = PPQ / (midi.header.ppq || PPQ);
  const doc = createScoreDoc({ ppq: PPQ });
  const title = fromByteString(midi.header.name ?? '').trim();
  if (title) doc.title = title;
  const tempo = midi.header.tempos[0]?.bpm;
  doc.tempoBpm = tempo ? Math.round(tempo * 100) / 100 : 120;
  const ts = midi.header.timeSignatures[0]?.timeSignature;
  if (ts && ts[0] > 0 && ts[1] > 0) doc.timeSignature = { beats: ts[0], beatType: ts[1] };
  const ks = midi.header.keySignatures[0];
  if (ks) {
    const idx = KEY_NAMES.indexOf(ks.key);
    if (idx >= 0) doc.keyFifths = idx - 7;
  }

  // 우리 서비스가 적어 둔 트랙 정보(원래 악기 보존, FR-056)
  const metas = new Map<number, PartMetaJson>();
  for (const m of midi.header.meta) {
    const text = fromByteString(m.text);
    if (!text.startsWith(META_PREFIX)) continue;
    try {
      const j = JSON.parse(text.slice(META_PREFIX.length)) as PartMetaJson;
      metas.set(j.track, j);
    } catch { /* 깨진 값은 무시 */ }
  }

  // 우리 파일이면 트랙 수와 정보 수가 같다(머리 트랙은 @tonejs/midi 가 뺀다) → 순서대로 짝짓는다
  const useMeta = metas.size > 0 && metas.size === midi.tracks.length;
  let seq = 0;
  midi.tracks.forEach((track, ti) => {
    const meta = useMeta ? metas.get(ti) : undefined;
    if (!meta && track.notes.length === 0) return;
    seq += 1;
    const id = meta?.id ?? `P${seq}`;
    const percussion = meta?.isPercussion ?? track.channel === 9;
    const trackName = fromByteString(track.name ?? '').trim();
    const program = percussion ? null : track.instrument.number;
    const srcName = trackName || (percussion ? 'Drums' : track.instrument.name) || '';
    const cc7 = track.controlChanges[7]?.[0];
    const notes: Note[] = track.notes.map((n) => {
      const start = Math.round(n.ticks * f);
      const end = Math.round((n.ticks + n.durationTicks) * f);
      return { id: '', startTick: start, durationTicks: Math.max(1, end - start), pitch: n.midi, velocity: clamp(Math.round(n.velocity * 127), 1, 127) };
    });
    sortNotes(notes).forEach((n, i) => { n.id = noteId(id, i); });
    const byName = findInstrumentByName(trackName, catalog);
    doc.parts.push({
      id,
      name: meta?.name ?? (byName?.name_ko ?? srcName),
      instrument: meta?.instrument ?? (byName && byName.is_percussion === percussion ? byName.code : originalCode(percussion ? 0 : program)),
      sourceInstrument: meta ? meta.sourceInstrument : { name: srcName, program },
      isPercussion: percussion,
      volume: meta?.volume ?? (cc7 ? clamp(Math.round(cc7.value * 127), 0, 127) : 100),
      origin: meta?.origin ?? 'original',
      notes,
    });
  });
  return doc;
}

export interface ToMidiOptions {
  catalog?: InstrumentCatalog;
  /**
   * 소리 번호 (결정 C11).
   * - 'gm'(기본): GM 호환 번호(gm_program, bank select 없음) — 내려받는 MIDI 처럼 다른 프로그램이 읽을 파일
   * - 'service': 서비스 음원 번호(serviceSound) — 화면 연주용. 국악기 트랙 맨 앞에 bank select(CC0 = 1, CC32 = 0)를 적고
   *   program 0~5, 장구·북은 타악 채널 program 1(국악 타악 세트). 일반 악기·원래 악기는 GM 번호 그대로(bank 0).
   */
  soundNumbers?: 'gm' | 'service';
  /**
   * 국악기(서비스 bank 1)·국악 타악 세트(bank 128 program 1) 성부에 넣을 잔향 보내기 CC91 값(0..127).
   * 화면 연주용(2026-09-30 박예은 팀장 결정, 잔향 "약하게" = 60 — UC_07 BR-RND-05). 내려받는 MIDI 에는 넣지 않는다.
   */
  gugakReverbSend?: number;
}

/** 서비스 음원에서 국악기 소리인가(국악기 bank 1 · 국악 타악 세트 128/1) */
export function isGugakSound(part: Part, catalog: InstrumentCatalog = BUILTIN_INSTRUMENTS): boolean {
  const s = serviceSound(part, catalog);
  return s.bank === 1 || (s.bank === 128 && s.program === 1);
}

/** ScoreDoc → MIDI 바이트: 파트마다 트랙 하나, 한글 트랙 이름, GM 번호(또는 서비스 음원 번호), 타악은 채널 10, 트랙 음량은 CC7 */
export function toMidi(input: ScoreDoc, opts: ToMidiOptions = {}): Uint8Array {
  const catalog = opts.catalog ?? BUILTIN_INSTRUMENTS;
  const service = opts.soundNumbers === 'service';
  const banks: (BankSelect | null)[] = [];
  const doc = normalizePpq(input);
  const midi = new Midi();
  if (doc.title) midi.header.name = toByteString(doc.title);
  midi.header.setTempo(doc.tempoBpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [doc.timeSignature.beats, doc.timeSignature.beatType] });

  let nextChannel = 0;
  doc.parts.forEach((p, i) => {
    const r = resolveInstrument(p, catalog);
    const perc = r.isPercussion || p.isPercussion;
    const track = midi.addTrack();
    track.name = toByteString(p.name || r.name);
    if (perc) {
      track.channel = 9;
    } else {
      track.channel = nextChannel;
      nextChannel = nextChannel === 8 ? 10 : nextChannel >= 15 ? 0 : nextChannel + 1;
    }
    if (service) {
      const s = serviceSound(p, catalog);
      track.instrument.number = s.program;
      // 타악 채널은 bank select 없이 program 으로 세트를 고른다. 선율 bank 0 도 적어 둔다(앞 곡의 bank 가 남지 않게)
      banks.push(perc ? null : { channel: track.channel, bank: s.bank, program: s.program });
    } else {
      track.instrument.number = perc ? 0 : r.program;
      banks.push(null);
    }
    // CC 값은 0..1 로 넘기고 midi 쓰기에서 floor(v*127) 하므로 0.5 를 더해 정확히 맞춘다
    track.addCC({ number: 7, value: Math.min(1, (clamp(p.volume, 0, 127) + 0.5) / 127), ticks: 0 });
    if (opts.gugakReverbSend != null && isGugakSound(p, catalog)) {
      track.addCC({ number: 91, value: Math.min(1, (clamp(Math.round(opts.gugakReverbSend), 0, 127) + 0.5) / 127), ticks: 0 });
    }
    for (const n of p.notes) {
      track.addNote({
        midi: clamp(n.pitch, 0, 127),
        ticks: n.startTick,
        durationTicks: Math.max(1, n.durationTicks),
        velocity: Math.min(1, (clamp(n.velocity, 1, 127) + 0.5) / 127),
      });
    }
    const meta: PartMetaJson = {
      track: i,                                  // 파트 순서 = 음표 트랙 순서
      id: p.id, name: p.name, instrument: p.instrument, origin: p.origin, isPercussion: perc,
      volume: p.volume, sourceInstrument: p.sourceInstrument ?? null,
    };
    midi.header.meta.push({ ticks: 0, type: 'text', text: toByteString(META_PREFIX + JSON.stringify(meta)) });
  });
  midi.header.update();
  const bytes = insertKeySignature(midi.toArray(), clamp(Math.round(doc.keyFifths), -7, 7));
  return service ? insertBankSelects(bytes, banks) : bytes;
}

interface BankSelect { channel: number; bank: number; program: number }

/**
 * 음표 트랙(머리 트랙 다음, 파트 순서) 맨 앞에 program change · bank select(CC0 = bank, CC32 = 0)를 넣는다.
 * 그 뒤에 @tonejs/midi 가 쓴 program change 가 오므로 bank 가 걸린 채로 소리를 고른다(bank → program 순서).
 * @tonejs/midi 는 program change 를 CC 보다 먼저 쓰므로(같은 틱이면 bank 가 늦게 걸림) 바이트로 직접 넣는다.
 * 맨 앞 program change 는 @tonejs/midi 로 다시 읽을 때 트랙이 (program, 채널)별로 쪼개지지 않게 하려는 것이다.
 */
function insertBankSelects(bytes: Uint8Array, banks: (BankSelect | null)[]): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [bytes.subarray(0, 14)];
  let pos = 14;
  let track = 0;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos + 4);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    const b = track >= 1 ? banks[track - 1] : null;
    if (b) {
      const st = 0xb0 | (b.channel & 0x0f);
      const pc = 0xc0 | (b.channel & 0x0f);
      const ev = new Uint8Array([0x00, pc, b.program & 0x7f, 0x00, st, 0x00, b.bank & 0x7f, 0x00, st, 0x20, 0x00]);
      const head = new Uint8Array(8);
      head.set(bytes.subarray(pos, pos + 4), 0);
      new DataView(head.buffer).setUint32(4, len + ev.length);
      chunks.push(head, ev, body);
    } else {
      chunks.push(bytes.subarray(pos, pos + 8 + len));
    }
    pos += 8 + len;
    track += 1;
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/**
 * 첫 트랙(머리 정보) 맨 앞에 조표 메타 이벤트(FF 59 02 sf mi)를 넣는다.
 * @tonejs/midi 2.0.28 은 조표를 쓸 때 번호를 잘못 계산해서(+7 을 한 번 더 더함) 직접 넣는다.
 */
function insertKeySignature(bytes: Uint8Array, fifths: number): Uint8Array {
  const trackStart = 14;                         // MThd(4) + 길이(4) + 본문(6)
  const tag = String.fromCharCode(...bytes.subarray(trackStart, trackStart + 4));
  if (tag !== 'MTrk') return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(trackStart + 4);
  const ev = new Uint8Array([0x00, 0xff, 0x59, 0x02, fifths & 0xff, 0x00]);
  const out = new Uint8Array(bytes.length + ev.length);
  out.set(bytes.subarray(0, trackStart + 8), 0);
  out.set(ev, trackStart + 8);
  out.set(bytes.subarray(trackStart + 8), trackStart + 8 + ev.length);
  new DataView(out.buffer).setUint32(trackStart + 4, len + ev.length);
  return out;
}
