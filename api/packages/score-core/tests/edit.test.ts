// T118: 편집 연산마다 · 여러 성부 원본(첫 성부 = 원래 선율) · 음역 경고 · 되돌리기 = 빈 연산 목록
import { describe, expect, it } from 'vitest';
import {
  applyInstrumentMode, applyOps, exportScore, parseMidi, parseMusicXml,
  rangeWarnings, summarizeOps, transposeFifths, validateOps, type EditOp, type ScoreDoc,
} from '../src/index.js';
import { deepFreeze, fixture, fixtureText, noteKey, templateFile } from './helpers.js';

const template = () => deepFreeze(parseMusicXml(templateFile('gutgeori-v1.musicxml')));
const twoParts = () => deepFreeze(parseMusicXml(fixtureText('two-parts.musicxml')));
const pitches = (d: ScoreDoc, part: number) => d.parts[part].notes.map((n) => n.pitch);

describe('applyOps 기본', () => {
  it('원본을 바꾸지 않는다(얼린 원본에도 동작)', () => {
    const doc = template();
    const before = JSON.stringify(doc);
    applyOps(doc, [{ op: 'transpose', semitones: 3 }, { op: 'add_instrument', instrument: 'daegeum' }, { op: 'set_note_pitch', note_id: 'P1-n1', midi_pitch: 60 }]);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('되돌리기 = 빈 연산 목록 → 원본과 같은 사본', () => {
    const doc = template();
    const out = applyOps(doc, []);
    expect(out).toEqual(doc);
    expect(out).not.toBe(doc);
  });
});

describe('add_instrument (BR-EDT-07)', () => {
  it('여러 성부 원본에서도 첫 성부(원래 선율)를 복사한 새 트랙', () => {
    const doc = twoParts();
    const out = applyOps(doc, [{ op: 'add_instrument', instrument: 'haegeum' }]);
    expect(out.parts).toHaveLength(3);
    const added = out.parts[2];
    expect(added).toMatchObject({ id: 'P3', name: '해금', instrument: 'haegeum', origin: 'melody_copy', isPercussion: false, volume: 100, sourceInstrument: null });
    expect(pitches(out, 2)).toEqual(pitches(doc, 0));
    expect(added.notes.map((n) => n.startTick)).toEqual(doc.parts[0].notes.map((n) => n.startTick));
    expect(added.notes[0].id).toBe('P3-n1');
    expect(pitches(out, 2)).not.toEqual(pitches(doc, 1));          // 피아노 성부가 아니라 첫 성부
  });
  it('장구가 있는 템플릿에서도 가야금 선율을 복사', () => {
    const out = applyOps(template(), [{ op: 'add_instrument', instrument: 'daegeum' }, { op: 'add_instrument', instrument: 'piri' }]);
    expect(out.parts.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
    expect(pitches(out, 3)).toEqual(pitches(out, 0));
  });
});

describe('change_instrument', () => {
  it('악기만 바뀌고 음표는 그대로', () => {
    const doc = template();
    const out = applyOps(doc, [{ op: 'change_instrument', part: 0, instrument: 'geomungo' }]);
    expect(out.parts[0]).toMatchObject({ instrument: 'geomungo', name: '거문고' });
    expect(noteKey(out)[0]).toEqual(noteKey(doc)[0]);
  });
  it('없는 트랙은 건너뛴다', () => {
    expect(applyOps(template(), [{ op: 'change_instrument', part: 9, instrument: 'piri' }])).toEqual(template());
  });
});

describe('transpose (BR-EDT-01·06)', () => {
  it('누적되고 음표와 조표가 함께 바뀌며 타악은 그대로', () => {
    const doc = template();                                           // 조표 -3 (E♭)
    const out = applyOps(doc, [{ op: 'transpose', semitones: 2 }, { op: 'transpose', semitones: 3 }]);
    expect(pitches(out, 0)).toEqual(pitches(doc, 0).map((p) => p + 5));
    expect(pitches(out, 1)).toEqual(pitches(doc, 1));
    expect(out.keyFifths).toBe(-4);                                   // E♭ + 5반음 = A♭
    expect(applyOps(doc, [{ op: 'transpose', semitones: 5 }]).keyFifths).toBe(-4);
    expect(applyOps(doc, [{ op: 'transpose', semitones: 2 }, { op: 'transpose', semitones: -2 }])).toEqual(doc);
  });
  it('5도권 이동: 반음 1개 = 5도 7칸, -6..6 안으로', () => {
    expect(transposeFifths(0, 2)).toBe(2);        // C → D
    expect(transposeFifths(0, 1)).toBe(-5);       // C → D♭
    expect(transposeFifths(0, -1)).toBe(5);       // C → B
    expect(transposeFifths(-1, 5)).toBe(-2);      // F → B♭
    expect(transposeFifths(0, 6)).toBe(6);        // C → F#
    expect(transposeFifths(-1, 6)).toBe(5);       // F → B(C♭ -7 보다 올림 5개)
    expect(transposeFifths(-1, 1)).toBe(-6);      // F → G♭(내림 조에서 왔으니 F# 대신)
    expect(transposeFifths(-7, 12)).toBe(-7);     // 옥타브는 조표 그대로
    expect(transposeFifths(7, 1)).toBe(2);        // C# → D
  });
  it('음높이는 0..127 안에서 멈춘다', () => {
    const out = applyOps(template(), [{ op: 'transpose', semitones: 100 }]);
    expect(Math.max(...pitches(out, 0))).toBe(127);
  });
});

describe('음량·음높이 연산', () => {
  it('set_track_volume', () => {
    const out = applyOps(template(), [{ op: 'set_track_volume', part: 1, velocity: 64 }, { op: 'set_track_volume', part: 0, velocity: 200 }]);
    expect(out.parts[1].volume).toBe(64);
    expect(out.parts[0].volume).toBe(127);
  });
  it('set_note_volume / set_note_pitch 는 note_id 로 찾는다', () => {
    const doc = template();
    const out = applyOps(doc, [
      { op: 'set_note_volume', note_id: 'P2-n3', velocity: 30 },
      { op: 'set_note_pitch', note_id: 'P1-n2', midi_pitch: 67 },
      { op: 'set_note_volume', note_id: 'P1-n1', velocity: 0 },
      { op: 'set_note_pitch', note_id: 'P9-n1', midi_pitch: 60 },
    ]);
    expect(out.parts[1].notes[2].velocity).toBe(30);
    expect(out.parts[0].notes[1].pitch).toBe(67);
    expect(out.parts[0].notes[0].velocity).toBe(1);
    expect(out.parts[0].notes.filter((_, i) => i !== 1 && i !== 0)).toEqual(doc.parts[0].notes.filter((_, i) => i !== 1 && i !== 0));
  });
  it('수정한 음표 뒤 조옮김도 누적된다', () => {
    const out = applyOps(template(), [{ op: 'set_note_pitch', note_id: 'P1-n1', midi_pitch: 60 }, { op: 'transpose', semitones: 2 }]);
    expect(out.parts[0].notes[0].pitch).toBe(62);
  });
});

describe('내려받기 (BR-RND-04·07) · 삭제된 사용자 음원 연산(assign_sf2)은 건너뛴다', () => {
  // 2026-09-29 US8 삭제 전 기기에 남은 편집에 'assign_sf2' 가 있어도 악보는 그대로, 안내도 없다
  const ops = [{ op: 'assign_sf2', part: 0, sf2_instrument_id: 'custom-7' }, { op: 'transpose', semitones: 2 }] as unknown as EditOp[];
  it('MIDI 에는 서비스 악기로 적고 안내가 없다', () => {
    const r = exportScore(template(), ops, 'midi');
    expect(r.notices).toEqual([]);
    expect(r.extension).toBe('mid');
    const back = parseMidi(r.data as Uint8Array);
    expect(back.parts[0]).toMatchObject({ instrument: 'gayageum', name: '가야금' });
    expect(back.parts[0]).not.toHaveProperty('sf2Ref');
    expect(back.parts[0].notes[0].pitch).toBe(template().parts[0].notes[0].pitch + 2);
    expect(back.keyFifths).toBe(-1);
  });
  it('MusicXML 에도 서비스 악기(가야금 GM 108)로 적는다', () => {
    const r = exportScore(template(), ops, 'musicxml');
    expect(r.notices).toEqual([]);
    expect(r.data as string).toContain('<midi-program>108</midi-program>');
    expect(r.data as string).not.toContain('custom-7');
  });
  it('추가 트랙은 새 성부', () => {
    const r = exportScore(template(), [{ op: 'add_instrument', instrument: 'daegeum' }, { op: 'set_track_volume', part: 2, velocity: 50 }], 'musicxml');
    expect(r.notices).toEqual([]);
    const back = parseMusicXml(r.data as string);
    expect(back.parts.map((p) => p.name)).toEqual(['가야금', '장구', '대금']);
    expect(back.parts[2]).toMatchObject({ origin: 'melody_copy', volume: 50 });
    expect(back.parts[2].notes.map((n) => n.pitch)).toEqual(back.parts[0].notes.map((n) => n.pitch));
    expect(r.data as string).toContain('<score-part id="P3">');
  });
  it('악기 구성을 먼저 적용한 뒤 편집 연산', () => {
    const piano = deepFreeze(parseMidi(fixture('piano.mid')));
    const r = exportScore(piano, [{ op: 'add_instrument', instrument: 'haegeum' }], 'midi', { instruments: { mode: 'default' } });
    expect(parseMidi(r.data as Uint8Array).parts.map((p) => p.instrument)).toEqual(['gayageum', 'haegeum']);
  });
});

describe('applyInstrumentMode (FR-021·FR-056)', () => {
  it('default: 선율 성부 → 가야금, 타악 → 장구, 타악이 없으면 만들지 않는다', () => {
    const w = deepFreeze(parseMusicXml(fixture('waltz.mxl')));
    const out = applyInstrumentMode(w, 'default');
    expect(out.parts.map((p) => [p.instrument, p.name])).toEqual([['gayageum', '가야금'], ['janggu', '장구']]);
    expect(out.parts[0].sourceInstrument).toEqual({ name: 'Flute', program: 73 });   // 원래 악기 정보는 남는다
    const two = applyInstrumentMode(twoParts(), 'default');
    expect(two.parts.map((p) => p.instrument)).toEqual(['gayageum', 'gayageum']);
    const piano = applyInstrumentMode(parseMidi(fixture('piano.mid')), 'default', { defaultEnsemble: [{ part_role: 'melody', instrument: 'daegeum' }] });
    expect(piano.parts.map((p) => p.instrument)).toEqual(['daegeum']);
  });
  it('original: 원래 악기로 되돌린다(목록에 없으면 original:<GM번호>)', () => {
    const w = applyInstrumentMode(applyInstrumentMode(parseMusicXml(fixture('waltz.mxl')), 'default'), 'original');
    expect(w.parts.map((p) => [p.instrument, p.name])).toEqual([['flute', '플루트'], ['original:0', 'Bass Drum']]);
    const two = applyInstrumentMode(applyInstrumentMode(twoParts(), 'default'), 'original');
    // 'Violin' 은 목록의 violin 코드와 같아 서비스 악기로, 피아노 이름은 목록에 없어 GM 번호로
    expect(two.parts.map((p) => p.instrument)).toEqual(['violin', 'original:0']);
    expect(two.parts.map((p) => p.name)).toEqual(['바이올린', 'Acoustic Grand Piano']);
    // original:<n> 도 MIDI 에 그 GM 번호로 적힌다
    const mid = parseMidi(exportScore(two, [], 'midi').data as Uint8Array);
    expect(mid.parts.map((p) => p.instrument)).toEqual(['violin', 'original:0']);
    const x = applyInstrumentMode(parseMidi(fixture('piano.mid')), 'custom', { tracks: [{ part: 0, instrument: 'original:5' }] });
    expect(x.parts[0]).toMatchObject({ instrument: 'original:5', name: 'Piano' });
    expect(exportScore(x, [], 'musicxml').data as string).toContain('<midi-program>6</midi-program>');
  });
  it('custom: 트랙마다 고른 악기', () => {
    const out = applyInstrumentMode(template(), 'custom', { tracks: [{ part: 0, instrument: 'piri' }, { part: 1, instrument: 'buk' }, { part: 5, instrument: 'piano' }] });
    expect(out.parts.map((p) => p.instrument)).toEqual(['piri', 'buk']);
  });
});

describe('rangeWarnings (BR-EDT-03)', () => {
  it('음역 밖 음표만 경고, 타악은 보지 않는다', () => {
    const doc = template();
    expect(rangeWarnings(doc)).toEqual([]);
    const up = applyOps(doc, [{ op: 'transpose', semitones: 7 }]);    // 가야금 최고 81
    const warn = rangeWarnings(up);
    const expected = up.parts[0].notes.filter((n) => n.pitch > 81).map((n) => ({ part: 0, noteId: n.id }));
    expect(expected.length).toBeGreaterThan(0);
    expect(warn).toEqual(expected);
    const low = applyOps(doc, [{ op: 'set_note_pitch', note_id: 'P1-n4', midi_pitch: 30 }]);
    expect(rangeWarnings(low, [{ code: 'gayageum', range_low: 43, range_high: 81 }])).toEqual([{ part: 0, noteId: 'P1-n4' }]);
    expect(rangeWarnings(low, [{ code: 'gayageum', range_low: null, range_high: null }])).toEqual([]);
  });
  it('추가 트랙도 그 악기 음역으로 본다', () => {
    const out = applyOps(template(), [{ op: 'add_instrument', instrument: 'daegeum' }]);   // 대금 58..87
    expect(rangeWarnings(out).every((w) => w.part === 2)).toBe(true);
    expect(rangeWarnings(out).length).toBe(out.parts[2].notes.filter((n) => n.pitch < 58).length);
  });
});

describe('summarizeOps / validateOps', () => {
  it('편집 기록 요약', () => {
    expect(summarizeOps([])).toEqual({ edited: false, instrument_changes: [], transpose_semitones: 0, volume_changes: { tracks: {}, notes: 0 }, pitch_fixes: 0 });
    const s = summarizeOps([
      { op: 'add_instrument', instrument: 'daegeum' },
      { op: 'change_instrument', part: 0, instrument: 'piri' },
      { op: 'transpose', semitones: 2 }, { op: 'transpose', semitones: -5 },
      { op: 'set_track_volume', part: 1, velocity: 70 }, { op: 'set_track_volume', part: 1, velocity: 80 },
      { op: 'set_note_volume', note_id: 'P1-n1', velocity: 40 }, { op: 'set_note_volume', note_id: 'P1-n1', velocity: 50 },
      { op: 'set_note_pitch', note_id: 'P1-n2', midi_pitch: 60 }, { op: 'set_note_pitch', note_id: 'P1-n3', midi_pitch: 61 },
    ]);
    expect(s).toEqual({
      edited: true,
      instrument_changes: [{ kind: 'add', instrument: 'daegeum' }, { kind: 'change', part: 0, instrument: 'piri' }],
      transpose_semitones: -3,
      volume_changes: { tracks: { 1: 80 }, notes: 1 },
      pitch_fixes: 2,
    });
  });
  it('없는 트랙·음표·악기를 알려 준다(추가된 트랙은 뒤 연산에서 쓸 수 있다)', () => {
    const doc = template();
    expect(validateOps(doc, [{ op: 'add_instrument', instrument: 'daegeum' }, { op: 'set_track_volume', part: 2, velocity: 60 }, { op: 'set_note_pitch', note_id: 'P3-n1', midi_pitch: 60 }])).toEqual([]);
    const errs = validateOps(doc, [{ op: 'set_track_volume', part: 2, velocity: 60 }, { op: 'change_instrument', part: 0, instrument: 'kazoo' }, { op: 'set_note_volume', note_id: 'nope', velocity: 1 }]);
    expect(errs).toHaveLength(3);
  });
});

describe('remove_track (2026-09-30 황송해, UC_06 BR-EDT-08)', () => {
  it('추가한 트랙(선율 복사)만 지운다 · 원래 트랙은 그대로 · 요약에 남는다 · 내보내기에서도 빠진다', () => {
    const doc = twoParts();
    const n = doc.parts.length;
    const ops: EditOp[] = [{ op: 'add_instrument', instrument: 'haegeum' }, { op: 'add_instrument', instrument: 'daegeum' }, { op: 'remove_track', part: n }];
    const out = applyOps(doc, ops);
    expect(out.parts).toHaveLength(n + 1);
    expect(out.parts[n].instrument).toBe('daegeum');
    expect(validateOps(doc, ops)).toEqual([]);
    expect(summarizeOps(ops).instrument_changes.at(-1)).toEqual({ kind: 'remove', part: n });
    const kept = applyOps(doc, [{ op: 'remove_track', part: 0 }]);
    expect(kept.parts).toHaveLength(n);
    expect(validateOps(doc, [{ op: 'remove_track', part: 0 }])[0]).toContain('원래 악보 트랙은 지울 수 없음');
    expect(validateOps(doc, [{ op: 'remove_track', part: 9 }])[0]).toContain('없는 트랙');
  });
});
