// (2026-09-30 황송해 161번 — T164 결정 변경) set_tempo: 재생 빠르기를 받기 파일(MIDI · MusicXML · MP3 · PDF)에도
import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { applyOps, parseMusicXml, summarizeOps, toMidi, toMusicXml, validateOps } from '../src/index.js';
import { fixtureText } from './helpers.js';

describe('set_tempo', () => {
  const doc = () => parseMusicXml(fixtureText('two-parts.musicxml'));
  it('곡 전체 빠르기를 바꾸고 MIDI 템포 메타 · MusicXML <sound tempo> 가 그 값', () => {
    const out = applyOps(doc(), [{ op: 'set_tempo', bpm: 150 }]);
    expect(out.tempoBpm).toBe(150);
    const midi = new Midi(toMidi(out));
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(150);
    expect(toMusicXml(out)).toContain('<sound tempo="150"/>');
    expect(summarizeOps([{ op: 'set_tempo', bpm: 150 }])).toMatchObject({ edited: true, tempo_bpm: 150 });
  });
  it('1.5배(150)면 같은 음표의 길이가 100 BPM 의 2/3', () => {
    const d = doc();
    const at = (bpm: number) => new Midi(toMidi(applyOps(d, [{ op: 'set_tempo', bpm }]))).duration;
    expect(at(150) / at(100)).toBeCloseTo(2 / 3, 2);
  });
  it('범위 밖은 오류 · 적용은 범위 안으로', () => {
    expect(validateOps(doc(), [{ op: 'set_tempo', bpm: 1000 }])[0]).toContain('빠르기');
    expect(applyOps(doc(), [{ op: 'set_tempo', bpm: 1000 }]).tempoBpm).toBe(300);
  });
});
