// 결정 C11 (2026-09-29): 서비스 음원 소리 번호 — 국악기 bank 1 · program 0~5, 장구·북 128/1, 일반 악기 GM bank 0.
// 화면 연주는 toMidi(doc, { soundNumbers: 'service' }), 내려받는 MIDI·MusicXML 은 GM 호환 번호 그대로.
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_INSTRUMENTS, createScoreDoc, originalCode, parseMidi, serviceSound, toMidi, toMusicXml,
  type Part, type ScoreDoc,
} from '../src/index.js';
import { sharedJson } from './helpers.js';

function part(id: string, instrument: string, isPercussion = false): Part {
  return {
    id, name: id, instrument, isPercussion, volume: 100, origin: 'original', sourceInstrument: null,
    notes: [{ id: `${id}-n1`, startTick: 0, durationTicks: 480, pitch: isPercussion ? 38 : 62, velocity: 90 }],
  };
}

function doc(): ScoreDoc {
  const d = createScoreDoc({ ppq: 480 });
  d.parts = [part('P1', 'ajaeng'), part('P2', 'cello'), part('P3', 'janggu', true), part('P4', originalCode(42)),
    part('P5', originalCode(0), true)];
  return d;
}

type Ev = { kind: 'cc' | 'pc'; channel: number; a: number; b?: number };

/** MIDI 바이트 → 트랙별 채널 이벤트(CC·program change)를 적힌 순서대로 */
function channelEvents(bytes: Uint8Array): Ev[][] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Ev[][] = [];
  let pos = 14;
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos + 4);
    const end = pos + 8 + len;
    let i = pos + 8;
    let status = 0;
    const evs: Ev[] = [];
    const vlq = () => { let v = 0; let c; do { c = bytes[i++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
    while (i < end) {
      vlq();
      let s = bytes[i];
      if (s & 0x80) i++; else s = status;
      if (s === 0xff) { i++; const l = vlq(); i += l; continue; }
      if (s === 0xf0 || s === 0xf7) { const l = vlq(); i += l; continue; }
      status = s;
      const hi = s & 0xf0; const ch = s & 0x0f;
      if (hi === 0xc0 || hi === 0xd0) { const a = bytes[i++]; if (hi === 0xc0) evs.push({ kind: 'pc', channel: ch, a }); continue; }
      const a = bytes[i++]; const b = bytes[i++];
      if (hi === 0xb0) evs.push({ kind: 'cc', channel: ch, a, b });
    }
    out.push(evs);
    pos = end;
  }
  return out;
}

describe('서비스 음원 소리 번호 (결정 C11)', () => {
  it('악기 목록의 bank·program 이 shared/instruments.json 과 같고 국악기와 일반 악기가 겹치지 않는다', () => {
    const shared = sharedJson('instruments.json');
    const pick = (i: Record<string, unknown>) => ({ code: i.code, bank: i.bank, program: i.program });
    expect(BUILTIN_INSTRUMENTS.map(pick)).toEqual(shared.instruments.map(pick));
    const melodic = BUILTIN_INSTRUMENTS.filter((i) => !i.is_percussion).map((i) => `${i.bank}:${i.program}`);
    expect(new Set(melodic).size).toBe(melodic.length);
  });

  it('파트 → (bank, program): 아쟁 1/5 · 첼로 0/42 · 장구 128/1 · 원래 악기는 GM 그대로', () => {
    const d = doc();
    expect(d.parts.map((p) => serviceSound(p))).toEqual([
      { bank: 1, program: 5, isPercussion: false },
      { bank: 0, program: 42, isPercussion: false },
      { bank: 128, program: 1, isPercussion: true },
      { bank: 0, program: 42, isPercussion: false },
      { bank: 128, program: 0, isPercussion: true },
    ]);
    const [ajaeng, cello] = d.parts.map((p) => serviceSound(p));
    expect(`${ajaeng.bank}:${ajaeng.program}`).not.toBe(`${cello.bank}:${cello.program}`);
    const gugak = ['gayageum', 'geomungo', 'daegeum', 'haegeum', 'piri', 'ajaeng'].map((c) => serviceSound(part('X', c)));
    expect(gugak.map((s) => [s.bank, s.program])).toEqual([[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
    expect(serviceSound(part('B', 'buk', true))).toEqual({ bank: 128, program: 1, isPercussion: true });
  });

  it("toMidi soundNumbers 'service': 국악기 트랙은 bank select(CC0=1·CC32=0) 뒤에 program change", () => {
    const tracks = channelEvents(toMidi(doc(), { soundNumbers: 'service' })).slice(1); // 0번은 머리 트랙
    const firstFour = (evs: Ev[]) => evs.slice(0, 4).map((e) => (e.kind === 'cc' ? `cc${e.a}=${e.b}` : `pc${e.a}`));
    expect(firstFour(tracks[0])).toEqual(['pc5', 'cc0=1', 'cc32=0', 'pc5']);    // 아쟁 = gugak.sf2 1/5
    expect(firstFour(tracks[1])).toEqual(['pc42', 'cc0=0', 'cc32=0', 'pc42']);  // 첼로 = GM 0/42
    const kit = tracks[2];
    expect(kit.every((e) => e.channel === 9)).toBe(true);
    expect(kit.filter((e) => e.kind === 'pc').map((e) => e.a)).toEqual([1]);  // 국악 타악 세트
    expect(kit.some((e) => e.kind === 'cc' && e.a === 0)).toBe(false);          // 타악 채널에는 bank select 없음
    expect(firstFour(tracks[3])).toEqual(['pc42', 'cc0=0', 'cc32=0', 'pc42']);  // 원래 악기(첼로 42) = GM
    expect(tracks[4].filter((e) => e.kind === 'pc').map((e) => e.a)).toEqual([0]);  // 원래 드럼 = GM 표준 세트
    // 서비스 번호로 써도 우리 파일로 다시 읽으면 파트·음표는 같다
    expect(parseMidi(toMidi(doc(), { soundNumbers: 'service' })).parts.map((p) => p.instrument))
      .toEqual(doc().parts.map((p) => p.instrument));
  });

  it('내려받는 MIDI·MusicXML(기본)은 GM 호환 번호 그대로 — bank select 없음', () => {
    const tracks = channelEvents(toMidi(doc())).slice(1);
    expect(tracks.map((evs) => evs.filter((e) => e.kind === 'pc').map((e) => e.a))).toEqual([[42], [42], [0], [42], [0]]);
    expect(tracks.flat().some((e) => e.kind === 'cc' && (e.a === 0 || e.a === 32))).toBe(false);
    const xml = toMusicXml(doc());
    expect(xml).toContain('<midi-program>43</midi-program>');   // 아쟁·첼로 = GM 42(+1)
    expect(xml).not.toContain('<midi-bank>');
  });
});
