// (2026-09-30 박예은 팀장 결정) 음역에 맞게 옥타브 옮기기(UC_06 BR-EDT-03) · 국악기 잔향 보내기(UC_07 BR-RND-05)
import { describe, expect, it } from 'vitest';
import { applyOps, fitToRangeOps, isGugakSound, parseMidi, rangeWarnings, toMidi, type ScoreDoc } from '../src/index.js';

const doc = (): ScoreDoc => ({
  version: 1, title: 't', ppq: 480, tempoBpm: 100, timeSignature: { beats: 4, beatType: 4 }, keyFifths: 0,
  parts: [
    { id: 'P1', name: '가야금', instrument: 'gayageum', sourceInstrument: null, isPercussion: false, volume: 100, origin: 'original',
      notes: [
        { id: 'a', startTick: 0, durationTicks: 480, pitch: 60, velocity: 80 },   // 음역 안 (가야금 43~81)
        { id: 'b', startTick: 480, durationTicks: 480, pitch: 96, velocity: 80 }, // 위로 벗어남 → 72
        { id: 'c', startTick: 960, durationTicks: 480, pitch: 30, velocity: 80 }, // 아래로 벗어남 → 54
      ] },
    { id: 'P2', name: '피아노', instrument: 'piano', sourceInstrument: null, isPercussion: false, volume: 100, origin: 'original',
      notes: [{ id: 'd', startTick: 0, durationTicks: 480, pitch: 60, velocity: 80 }] },
  ],
});

describe('음역에 맞게 옥타브 옮기기', () => {
  it('벗어난 음만 가장 가까운 옥타브로, 안의 음은 그대로', () => {
    const d = doc();
    expect(rangeWarnings(d).map((w) => w.noteId).sort()).toEqual(['b', 'c']);
    const ops = fitToRangeOps(d);
    expect(ops).toEqual([
      { op: 'set_note_pitch', note_id: 'b', midi_pitch: 72 },
      { op: 'set_note_pitch', note_id: 'c', midi_pitch: 54 },
    ]);
    const fixed = applyOps(d, ops);
    expect(rangeWarnings(fixed)).toEqual([]);
    expect(fixed.parts[0].notes.find((n) => n.id === 'a')?.pitch).toBe(60);
  });
});

describe('국악기 잔향 보내기(CC91)', () => {
  it('국악기 성부에만, 옵션을 줄 때만 넣는다', () => {
    const d = doc();
    expect(isGugakSound(d.parts[0])).toBe(true);
    expect(isGugakSound(d.parts[1])).toBe(false);
    const withRev = toMidi(d, { soundNumbers: 'service', gugakReverbSend: 60 });
    const without = toMidi(d, { soundNumbers: 'service' });
    // CC91(컨트롤 체인지 0xBn, 91) 값 모으기
    const find91 = (b: Uint8Array) => {
      const out: number[] = [];
      for (let i = 0; i + 2 < b.length; i++) if ((b[i] & 0xf0) === 0xb0 && b[i + 1] === 91) out.push(b[i + 2]);
      return out;
    };
    expect(find91(withRev)).toEqual([60]);
    expect(find91(without)).toEqual([]);
    expect(parseMidi(withRev).parts.map((p) => p.notes.length)).toEqual([3, 1]);
  });
});
