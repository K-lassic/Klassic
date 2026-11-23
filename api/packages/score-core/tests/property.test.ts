// 성질 시험 — 손으로 고른 예시가 아니라 무작위로 만든 악보 수백 개로 "언제나 참이어야 하는 것"을 확인한다.
//
//   구조에서의 위치: score-core 만 본다. backend(내려받기 · 편집 저장)와 frontend(편집 · 연주)가 함께 쓰는 변환이라
//     여기서 한 음이라도 달라지면 "화면에서 들은 것"과 "내려받은 파일"이 달라진다.
//   왜 따로 두나: roundtrip.test · edit.test 는 줄 단위 97% 를 지나가지만 전부 사람이 고른 악보다.
//     겹치는 성부 · 마디를 넘는 붙임줄 · 셋잇단 길이 · 양 끝 음높이 같은 조합은 사람이 다 떠올리지 못한다.
//   무작위지만 되풀이된다: 씨앗(seed)을 고정한 난수를 쓴다. 실패하면 메시지에 씨앗이 찍히고, 그 씨앗으로 다시 만들면 같은 악보가 나온다.
//     새 의존성(fast-check 등)은 넣지 않았다 — package-lock 을 건드리지 않으려고.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_INSTRUMENTS, PPQ, applyOps, cloneDoc, createScoreDoc, exportScore, fitToRangeOps, measureTicks, normalizePpq,
  noteId, parseMidi, parseMusicXml, rangeWarnings, sortNotes, summarizeOps, toMidi, toMusicXml, toMxl, transposeFifths, validateOps,
  type EditOp, type Note, type Part, type ScoreDoc,
} from '../src/index.js';

// ───────────────────────── 씨앗 난수 ─────────────────────────

/** mulberry32 — 씨앗이 같으면 같은 수열 */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
type Rng = ReturnType<typeof rng>;

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);

// ───────────────────────── 악보 만들기 ─────────────────────────

const TIMES = [{ beats: 4, beatType: 4 }, { beats: 3, beatType: 4 }, { beats: 2, beatType: 4 }, { beats: 6, beatType: 8 }, { beats: 12, beatType: 8 }, { beats: 5, beatType: 8 }, { beats: 2, beatType: 2 }];
// 악보에 적을 수 있는 길이(틱) — 4분 = 480. 점음표 · 셋잇단 · 여러 조각으로 나뉘는 길이를 섞는다
const LENGTHS = [60, 80, 120, 160, 180, 240, 320, 360, 480, 600, 720, 840, 960, 1200, 1440, 1920, 2400, 2880, 3840];
const NAMES = ['가야금', '대금 & 해금', '피리 <2>', '"따옴표" 성부', "작은따옴표 ' 성부", 'Violin I', '  ', ''];

interface GenOpts {
  /** 한 성부 안에서 같은 음높이가 시간상 겹치는 것을 허용할까 (악보로는 드물지만 MIDI 에는 흔하다) */
  samePitchOverlap?: boolean;
  /** 틱을 10 의 배수로만 (MusicXML 은 10틱 격자로 적는다) */
  grid?: number;
}

function genNotes(r: Rng, partId: string, percussion: boolean, total: number, o: GenOpts): Note[] {
  const grid = o.grid ?? 10;
  const notes: Note[] = [];
  const count = r.int(0, 28);
  const busy: { pitch: number; start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    const len = r.pick(LENGTHS);
    const start = Math.floor(r.int(0, Math.max(0, total - len)) / grid) * grid;
    const chord = r.chance(0.25) ? r.int(2, 4) : 1;
    for (let c = 0; c < chord; c++) {
      const pitch = percussion ? r.pick([35, 36, 38, 40, 42, 46, 49, 51, 60]) : (r.chance(0.08) ? r.pick([0, 1, 11, 12, 126, 127]) : r.int(36, 96));
      const end = start + len;
      const clash = busy.some((b) => b.pitch === pitch && b.start < end && b.end > start);
      // 같은 음이 같은 시각에 두 번 시작하는 것은 어느 형식으로도 구별해 적을 수 없다 — 만들지 않는다
      const sameStart = busy.some((b) => b.pitch === pitch && b.start === start);
      if (sameStart || (clash && !o.samePitchOverlap)) continue;
      busy.push({ pitch, start, end });
      notes.push({ id: '', startTick: start, durationTicks: len, pitch, velocity: r.int(1, 127) });
    }
  }
  sortNotes(notes).forEach((n, i) => { n.id = noteId(partId, i); });
  return notes;
}

function genDoc(seed: number, o: GenOpts = {}): ScoreDoc {
  const r = rng(seed);
  const timeSignature = { ...r.pick(TIMES) };
  const doc = createScoreDoc({
    ppq: PPQ, timeSignature, keyFifths: r.int(-7, 7),
    tempoBpm: r.chance(0.3) ? Math.round(r.int(2000, 30000)) / 100 : r.int(30, 240),
  });
  if (r.chance(0.7)) doc.title = r.pick(['아리랑', 'Minuet in G', '도라지 타령 & <변주>', '"새야 새야"', '한 곡']);
  const total = measureTicks(doc) * r.int(1, 6);
  const partCount = r.int(1, 4);
  const melodic = BUILTIN_INSTRUMENTS.filter((i) => !i.is_percussion);
  for (let i = 0; i < partCount; i++) {
    const id = `P${i + 1}`;
    const percussion = i > 0 && r.chance(0.25);
    const useOriginal = r.chance(0.4);
    const program = r.int(0, 127);
    const percCode = r.pick(['janggu', 'buk']);
    const info = percussion ? BUILTIN_INSTRUMENTS.find((x) => x.code === percCode)! : r.pick(melodic);
    const part: Part = {
      id,
      name: useOriginal ? (r.pick(NAMES).trim() || `Part ${i + 1}`) : info.name_ko,
      instrument: useOriginal ? `original:${percussion ? 0 : program}` : info.code,
      sourceInstrument: r.chance(0.2) ? null : { name: r.pick(['Piano', 'Flute', '가야금', 'Drums']), program: percussion ? null : program },
      isPercussion: percussion,
      volume: r.int(0, 127),
      origin: i > 0 && r.chance(0.3) ? 'melody_copy' : 'original',
      notes: genNotes(r, id, percussion, total, o),
    };
    doc.parts.push(part);
  }
  return doc;
}

/** 실패했을 때 어떤 악보였는지 알 수 있게 씨앗을 메시지에 붙인다 */
function forSeeds(seeds: number[], fn: (seed: number) => void) {
  for (const seed of seeds) {
    try { fn(seed); } catch (e) {
      (e as Error).message = `[seed ${seed}] ${(e as Error).message}`;
      throw e;
    }
  }
}

const noteKey = (n: Note) => `${n.startTick}:${n.durationTicks}:${n.pitch}:${n.velocity}`;
const shape = (doc: ScoreDoc) => doc.parts.map((p) => sortNotes(p.notes.map((n) => ({ ...n }))).map(noteKey));

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

// ───────────────────────── MusicXML 왕복 ─────────────────────────

describe('성질: MusicXML 로 적었다가 다시 읽으면 같은 악보다', () => {
  it('음표(시작 · 길이 · 음높이 · 세기)가 성부마다 그대로 돌아온다', () => {
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed);
      const back = parseMusicXml(toMusicXml(doc));
      expect(shape(back)).toEqual(shape(doc));
    });
  });

  it('곡 정보 · 성부 정보(이름 · 악기 · 원래 악기 · 음량 · 타악 여부)도 그대로다', () => {
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed);
      const back = parseMusicXml(toMusicXml(doc));
      expect(back).toEqual(doc);
    });
  });

  it('두 번 왕복해도 첫 번째와 글자 하나 다르지 않다 (적는 방식이 한 가지로 정해진다)', () => {
    forSeeds(SEEDS.slice(0, 60), (seed) => {
      const once = toMusicXml(genDoc(seed));
      expect(toMusicXml(parseMusicXml(once))).toBe(once);
    });
  });

  it('.mxl(압축)로 싸도 같은 악보가 나온다', () => {
    forSeeds(SEEDS.slice(0, 30), (seed) => {
      const doc = genDoc(seed);
      expect(parseMusicXml(toMxl(doc))).toEqual(doc);
    });
  });

  it('마디마다 모든 성부의 길이 합이 박자표와 같다 (다른 프로그램이 읽다 박자가 밀리지 않게)', () => {
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed);
      const xml = toMusicXml(doc);
      const mTicks = measureTicks(doc);
      for (const measure of xml.split('<measure ').slice(1)) {
        // 성부는 <backup> 으로 나뉜다. 화음의 둘째 음부터는 시간을 차지하지 않는다
        for (const voice of measure.split('<backup>')) {
          const body = voice.replace(/^<duration>\d+<\/duration><\/backup>/, '');
          let sum = 0;
          for (const note of body.split('<note').slice(1)) {
            if (note.includes('<chord/>')) continue;
            sum += Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1] ?? 0);
          }
          expect(sum).toBe(mTicks);
        }
      }
    });
  });

  it('1~127 의 모든 세기가 dynamics 로 적혔다가 같은 값으로 돌아온다', () => {
    const doc = createScoreDoc();
    const notes: Note[] = Array.from({ length: 127 }, (_, i) => ({ id: noteId('P1', i), startTick: i * 480, durationTicks: 480, pitch: 60, velocity: i + 1 }));
    doc.parts.push({ id: 'P1', name: '가야금', instrument: 'gayageum', sourceInstrument: null, isPercussion: false, volume: 100, origin: 'original', notes });
    expect(parseMusicXml(toMusicXml(doc)).parts[0].notes.map((n) => n.velocity)).toEqual(notes.map((n) => n.velocity));
  });

  it('0~127 의 모든 음높이가 15가지 조표 어디서든 같은 음으로 돌아온다', () => {
    for (let fifths = -7; fifths <= 7; fifths++) {
      const doc = createScoreDoc({ keyFifths: fifths });
      const notes: Note[] = Array.from({ length: 128 }, (_, i) => ({ id: noteId('P1', i), startTick: i * 240, durationTicks: 240, pitch: i, velocity: 80 }));
      doc.parts.push({ id: 'P1', name: '피아노', instrument: 'piano', sourceInstrument: null, isPercussion: false, volume: 100, origin: 'original', notes });
      const back = parseMusicXml(toMusicXml(doc));
      expect(back.parts[0].notes.map((n) => n.pitch), `조표 ${fifths}`).toEqual(notes.map((n) => n.pitch));
      expect(back.keyFifths).toBe(fifths);
    }
  });

  it('같은 음이 한 성부 안에서 겹쳐도 음표 수와 음높이는 지켜진다', () => {
    // 피아노 악보의 두 성부가 같은 건반을 겹쳐 누르는 경우. 길이가 조금 달라질 수는 있어도 음이 사라지거나 늘면 안 된다
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed, { samePitchOverlap: true });
      const back = parseMusicXml(toMusicXml(doc));
      back.parts.forEach((p, i) => {
        expect(p.notes.map((n) => `${n.startTick}:${n.pitch}`).sort()).toEqual(doc.parts[i].notes.map((n) => `${n.startTick}:${n.pitch}`).sort());
      });
    });
  });

  it('같은 음이 겹쳐도 길이까지 그대로 돌아온다', () => {
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed, { samePitchOverlap: true });
      expect(shape(parseMusicXml(toMusicXml(doc)))).toEqual(shape(doc));
    });
  });
});

// ───────────────────────── MIDI 왕복 ─────────────────────────

describe('성질: MIDI 로 적었다가 다시 읽으면 같은 악보다', () => {
  it('음표 · 곡 정보 · 성부 정보가 그대로 돌아온다 (격자에 안 맞는 틱도)', () => {
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed, { grid: 1 });
      const back = parseMidi(toMidi(doc));
      expect(back).toEqual(doc);
    });
  });

  it('서비스 음원 번호(bank select)를 넣어도 음표는 같다', () => {
    forSeeds(SEEDS.slice(0, 60), (seed) => {
      const doc = genDoc(seed, { grid: 1 });
      const back = parseMidi(toMidi(doc, { soundNumbers: 'service', gugakReverbSend: 60 }));
      expect(shape(back)).toEqual(shape(doc));
      expect(back.parts.map((p) => p.instrument)).toEqual(doc.parts.map((p) => p.instrument));
    });
  });

  it('MusicXML 을 거친 것과 MIDI 를 거친 것이 같은 음표다 (두 내려받기가 서로 다른 곡이 되지 않는다)', () => {
    forSeeds(SEEDS.slice(0, 60), (seed) => {
      const doc = genDoc(seed);
      expect(shape(parseMidi(toMidi(doc)))).toEqual(shape(parseMusicXml(toMusicXml(doc))));
    });
  });

  it('ppq 가 다른 악보도 480 기준으로 같은 박자에 놓인다', () => {
    forSeeds(SEEDS.slice(0, 40), (seed) => {
      const doc = genDoc(seed);
      const doubled = cloneDoc(doc);
      doubled.ppq = 960;
      for (const p of doubled.parts) for (const n of p.notes) { n.startTick *= 2; n.durationTicks *= 2; }
      expect(normalizePpq(doubled)).toEqual(doc);
      expect(shape(parseMidi(toMidi(doubled)))).toEqual(shape(doc));
      expect(normalizePpq(normalizePpq(doubled))).toEqual(normalizePpq(doubled));
    });
  });
});

// ───────────────────────── 편집 연산 ─────────────────────────

function genOps(r: Rng, doc: ScoreDoc): EditOp[] {
  const ops: EditOp[] = [];
  const cur = cloneDoc(doc);
  const codes = BUILTIN_INSTRUMENTS.map((i) => i.code);
  const n = r.int(0, 12);
  for (let i = 0; i < n; i++) {
    const partIdx = r.int(0, cur.parts.length - 1);
    const part = cur.parts[partIdx];
    const kind = r.int(0, 7);
    let op: EditOp | null = null;
    if (kind === 0 && cur.parts.length < 6) op = { op: 'add_instrument', instrument: r.pick(codes.filter((c) => BUILTIN_INSTRUMENTS.find((x) => x.code === c)!.is_percussion === cur.parts[0].isPercussion)) };
    else if (kind === 1 && part.origin === 'melody_copy') op = { op: 'remove_track', part: partIdx };
    else if (kind === 2) op = { op: 'change_instrument', part: partIdx, instrument: r.pick(codes.filter((c) => BUILTIN_INSTRUMENTS.find((x) => x.code === c)!.is_percussion === part.isPercussion)) };
    else if (kind === 3) op = { op: 'transpose', semitones: r.int(-12, 12) };
    else if (kind === 4) op = { op: 'set_track_volume', part: partIdx, velocity: r.int(0, 127) };
    else if (kind === 5 && part.notes.length) op = { op: 'set_note_volume', note_id: r.pick(part.notes).id, velocity: r.int(1, 127) };
    else if (kind === 6 && part.notes.length) op = { op: 'set_note_pitch', note_id: r.pick(part.notes).id, midi_pitch: r.int(0, 127) };
    else if (kind === 7) op = { op: 'set_tempo', bpm: r.int(20, 300) };
    if (!op) continue;
    ops.push(op);
    const next = applyOps(cur, [op]);
    cur.parts = next.parts; cur.keyFifths = next.keyFifths; cur.tempoBpm = next.tempoBpm;
  }
  return ops;
}

describe('성질: 편집 연산', () => {
  it('원본은 절대 바뀌지 않는다 (얼려 둔 원본에 적용해도 오류가 없다 · BR-EDT-04)', () => {
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed);
      const before = JSON.stringify(doc);
      const ops = genOps(rng(seed + 1000), doc);
      applyOps(deepFreeze(doc), ops);
      expect(JSON.stringify(doc)).toBe(before);
    });
  });

  it('빈 연산 목록은 원본과 같은 사본을 준다 (되돌리기)', () => {
    forSeeds(SEEDS.slice(0, 40), (seed) => {
      const doc = genDoc(seed);
      const out = applyOps(doc, []);
      expect(out).toEqual(doc);
      expect(out).not.toBe(doc);
      expect(out.parts[0]).not.toBe(doc.parts[0]);
    });
  });

  it('올바르게 만든 연산은 검사를 통과하고, 적용 결과는 언제나 쓸 수 있는 악보다', () => {
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed);
      const ops = genOps(rng(seed + 2000), doc);
      expect(validateOps(doc, ops)).toEqual([]);
      const out = applyOps(doc, ops);
      for (const p of out.parts) {
        expect(p.volume).toBeGreaterThanOrEqual(0);
        expect(p.volume).toBeLessThanOrEqual(127);
        expect(new Set(p.notes.map((n) => n.id)).size).toBe(p.notes.length);
        for (const n of p.notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(0);
          expect(n.pitch).toBeLessThanOrEqual(127);
          expect(n.velocity).toBeGreaterThanOrEqual(1);
          expect(n.velocity).toBeLessThanOrEqual(127);
        }
      }
      expect(new Set(out.parts.map((p) => p.id)).size).toBe(out.parts.length);
      // 원래 악보의 성부는 지워지지 않는다
      const originals = doc.parts.filter((p) => p.origin === 'original').map((p) => p.id);
      expect(out.parts.map((p) => p.id)).toEqual(expect.arrayContaining(originals));
      // 편집본도 MusicXML 로 적었다가 읽으면 같은 음표다
      expect(shape(parseMusicXml(toMusicXml(out)))).toEqual(shape(out));
      // MIDI 는 음높이를 고친 뒤 같은 음이 겹칠 수 있다. MIDI 에는 "어느 누름이 어느 뗌과 짝인가" 가 없어서
      // 겹친 같은 음의 길이는 서로 바뀔 수 있다 (형식의 한계). 시작 자리 · 음높이 · 음마다의 길이 합은 지켜져야 한다.
      const starts = (d: ScoreDoc) => d.parts.map((p) => p.notes.map((n) => `${n.startTick}:${n.pitch}`).sort());
      const total = (d: ScoreDoc) => d.parts.map((p) => {
        const by: Record<number, number> = {};
        for (const n of p.notes) by[n.pitch] = (by[n.pitch] ?? 0) + n.durationTicks;
        return by;
      });
      const viaMidi = parseMidi(toMidi(out));
      expect(starts(viaMidi)).toEqual(starts(out));
      expect(total(viaMidi)).toEqual(total(out));
    });
  });

  it('엉뚱한 연산(없는 성부 · 없는 음표 · 모르는 악기 · 숫자 아닌 값)은 오류 없이 건너뛴다', () => {
    forSeeds(SEEDS.slice(0, 60), (seed) => {
      const doc = genDoc(seed);
      const bad = [
        { op: 'remove_track', part: 99 }, { op: 'remove_track', part: -1 }, { op: 'remove_track', part: 0 },
        { op: 'change_instrument', part: 99, instrument: 'gayageum' }, { op: 'change_instrument', part: 0, instrument: 'no_such' },
        { op: 'set_track_volume', part: 7, velocity: 50 }, { op: 'set_note_volume', note_id: 'nope', velocity: 50 },
        { op: 'set_note_pitch', note_id: 'P9-n1', midi_pitch: 60 }, { op: 'set_tempo', bpm: Number.NaN },
        { op: 'transpose', semitones: Number.NaN }, { op: 'assign_sf2', part: 0 }, { op: 'add_instrument', instrument: 'no_such' },
      ] as unknown as EditOp[];
      const out = applyOps(doc, bad);
      // 모르는 악기로 add_instrument 한 성부만 늘 수 있다. 나머지는 원본 그대로다
      expect(out.parts.slice(0, doc.parts.length).map((p) => p.notes)).toEqual(doc.parts.map((p) => p.notes));
      expect(out.tempoBpm).toBe(doc.tempoBpm);
      expect(validateOps(doc, bad).length).toBeGreaterThanOrEqual(bad.length - 1);
    });
  });

  it('조옮김 뒤 조표의 으뜸음은 정확히 그 반음 수만큼 옮겨 간다', () => {
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (let s = -24; s <= 24; s++) {
        const out = transposeFifths(fifths, s);
        const tonic = (f: number) => (((f * 7) % 12) + 12) % 12;
        expect(tonic(out), `조표 ${fifths} · ${s}반음`).toBe((((tonic(fifths) + s) % 12) + 12) % 12);
        if (s % 12 !== 0) { expect(out).toBeGreaterThanOrEqual(-6); expect(out).toBeLessThanOrEqual(6); }
        else expect(out).toBe(fifths);
      }
    }
  });

  it('올렸다 내리면 음높이가 제자리다 (양 끝에서 잘리지 않는 한)', () => {
    forSeeds(SEEDS.slice(0, 60), (seed) => {
      const doc = genDoc(seed);
      const r = rng(seed + 3000);
      const s = r.int(1, 12);
      const safe = doc.parts.every((p) => p.isPercussion || p.notes.every((n) => n.pitch + s <= 127 && n.pitch - s >= 0));
      if (!safe) return;
      const out = applyOps(doc, [{ op: 'transpose', semitones: s }, { op: 'transpose', semitones: -s }]);
      expect(shape(out)).toEqual(shape(doc));
      // 타악 성부는 조옮김에 움직이지 않는다
      const up = applyOps(doc, [{ op: 'transpose', semitones: s }]);
      doc.parts.forEach((p, i) => { if (p.isPercussion) expect(up.parts[i].notes).toEqual(p.notes); });
    });
  });

  it('[음역에 맞게 옮기기]는 음역 밖 음을 늘리지 않고, 옮긴 음은 옥타브만 다르며 음역 안에 든다', () => {
    forSeeds(SEEDS, (seed) => {
      const doc = genDoc(seed);
      const ops = fitToRangeOps(doc);
      const out = applyOps(doc, ops);
      expect(rangeWarnings(out).length).toBeLessThanOrEqual(rangeWarnings(doc).length);
      expect(validateOps(doc, ops)).toEqual([]);
      const before = new Map(doc.parts.flatMap((p) => p.notes.map((n) => [n.id, n.pitch] as const)));
      const stillOut = new Set(rangeWarnings(out).map((w) => w.noteId));
      for (const op of ops) {
        if (op.op !== 'set_note_pitch') throw new Error('set_note_pitch 만 나와야 한다');
        expect(Math.abs(op.midi_pitch - before.get(op.note_id)!) % 12).toBe(0);
        expect(stillOut.has(op.note_id)).toBe(false);
      }
      // 한 번 더 눌러도 더 옮길 것이 없다
      expect(fitToRangeOps(out)).toEqual([]);
    });
  });

  it('요약은 연산 목록과 맞아떨어진다', () => {
    forSeeds(SEEDS.slice(0, 60), (seed) => {
      const doc = genDoc(seed);
      const ops = genOps(rng(seed + 4000), doc);
      const s = summarizeOps(ops);
      expect(s.edited).toBe(ops.length > 0);
      expect(s.transpose_semitones).toBe(ops.reduce((a, o) => a + (o.op === 'transpose' ? o.semitones : 0), 0));
      expect(s.instrument_changes.length).toBe(ops.filter((o) => ['add_instrument', 'remove_track', 'change_instrument'].includes(o.op)).length);
      expect(s.pitch_fixes).toBe(new Set(ops.flatMap((o) => (o.op === 'set_note_pitch' ? [o.note_id] : []))).size);
      expect(s.volume_changes.notes).toBe(new Set(ops.flatMap((o) => (o.op === 'set_note_volume' ? [o.note_id] : []))).size);
    });
  });

  it('내려받기(exportScore)는 편집본을 그대로 적은 것과 같다', () => {
    forSeeds(SEEDS.slice(0, 40), (seed) => {
      const doc = genDoc(seed);
      const ops = genOps(rng(seed + 5000), doc);
      const edited = applyOps(doc, ops);
      const xml = exportScore(doc, ops, 'musicxml');
      const mid = exportScore(doc, ops, 'midi');
      expect(xml.data).toBe(toMusicXml(edited));
      expect(Array.from(mid.data as Uint8Array)).toEqual(Array.from(toMidi(edited)));
      expect(xml.doc).toEqual(edited);
    });
  });
});

// ───────────────────────── 깨진 입력 ─────────────────────────

describe('성질: 깨진 파일을 읽어도 멈추거나 이상한 값을 내지 않는다', () => {
  it('MusicXML 의 일부를 지우거나 바꿔도 — 악보를 돌려주거나 Error 를 던진다', () => {
    forSeeds(SEEDS.slice(0, 80), (seed) => {
      const r = rng(seed + 6000);
      let xml = toMusicXml(genDoc(seed));
      for (let k = 0; k < r.int(1, 4); k++) {
        const at = r.int(0, xml.length - 1);
        const len = r.int(1, 200);
        const kind = r.int(0, 2);
        if (kind === 0) xml = xml.slice(0, at) + xml.slice(at + len);                       // 잘라 냄
        else if (kind === 1) xml = xml.slice(0, at);                                         // 중간에서 끊김
        else xml = xml.slice(0, at) + r.pick(['<', '>', '&', '-1', '999999999', 'NaN', '</note>']) + xml.slice(at); // 끼워 넣음
      }
      let doc: ScoreDoc | undefined;
      try { doc = parseMusicXml(xml); } catch (e) { expect(e).toBeInstanceOf(Error); return; }
      for (const p of doc.parts) {
        for (const n of p.notes) {
          expect(Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127, `pitch ${n.pitch}`).toBe(true);
          expect(Number.isFinite(n.startTick) && n.startTick >= 0, `start ${n.startTick}`).toBe(true);
          expect(Number.isFinite(n.durationTicks) && n.durationTicks > 0, `dur ${n.durationTicks}`).toBe(true);
          expect(n.velocity >= 1 && n.velocity <= 127, `vel ${n.velocity}`).toBe(true);
        }
      }
      expect(Number.isFinite(doc.tempoBpm) && doc.tempoBpm > 0).toBe(true);
      expect(doc.timeSignature.beats > 0 && doc.timeSignature.beatType > 0).toBe(true);
      // 읽어 낸 것은 다시 적을 수 있어야 한다
      expect(() => toMusicXml(doc!)).not.toThrow();
      expect(() => toMidi(doc!)).not.toThrow();
    });
  });

  it('MIDI 바이트를 몇 개 뒤집어도 — 악보를 돌려주거나 Error 를 던진다', () => {
    forSeeds(SEEDS.slice(0, 80), (seed) => {
      const r = rng(seed + 7000);
      const bytes = toMidi(genDoc(seed)).slice();
      for (let k = 0; k < r.int(1, 6); k++) bytes[r.int(0, bytes.length - 1)] = r.int(0, 255);
      let doc: ScoreDoc | undefined;
      try { doc = parseMidi(r.chance(0.3) ? bytes.subarray(0, r.int(0, bytes.length)) : bytes); } catch (e) { expect(e).toBeInstanceOf(Error); return; }
      for (const p of doc.parts) {
        for (const n of p.notes) {
          expect(Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127, `pitch ${n.pitch}`).toBe(true);
          expect(Number.isFinite(n.startTick) && n.startTick >= 0, `start ${n.startTick}`).toBe(true);
          expect(Number.isFinite(n.durationTicks) && n.durationTicks > 0, `dur ${n.durationTicks}`).toBe(true);
        }
      }
      expect(Number.isFinite(doc.tempoBpm) && doc.tempoBpm > 0, `tempo ${doc.tempoBpm}`).toBe(true);
    });
  });
});
