// T045: 템플릿 + 표본 3종이 MusicXML→ScoreDoc→MusicXML/MIDI 를 거쳐도 음표·파트·악기 이름을 잃지 않는다
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DEFAULT_ENSEMBLE, BUILTIN_INSTRUMENTS, instrumentsCatalog, parseMidi, parseMusicXml, toMidi, toMusicXml, toMxl,
  type ScoreDoc,
} from '../src/index.js';
import { fixture, fixtureText, noteKey, partKey, sharedJson, templateFile } from './helpers.js';

const sources: [string, () => ScoreDoc][] = [
  ['템플릿 MusicXML', () => parseMusicXml(templateFile('gutgeori-v1.musicxml'))],
  ['템플릿 MIDI', () => parseMidi(templateFile('gutgeori-v1.mid'))],
  ['2성부 MusicXML(화음·붙임줄)', () => parseMusicXml(fixtureText('two-parts.musicxml'))],
  ['압축 MusicXML(.mxl)', () => parseMusicXml(fixture('waltz.mxl'))],
  ['피아노 MIDI', () => parseMidi(fixture('piano.mid'))],
];

describe.each(sources)('%s 왕복', (_label, load) => {
  it('MusicXML 로 쓰고 다시 읽어도 같다', () => {
    const doc = load();
    const back = parseMusicXml(toMusicXml(doc));
    expect(noteKey(back)).toEqual(noteKey(doc));
    expect(partKey(back)).toEqual(partKey(doc));
    expect(back.tempoBpm).toBe(doc.tempoBpm);
    expect(back.timeSignature).toEqual(doc.timeSignature);
    expect(back.keyFifths).toBe(doc.keyFifths);
    expect(back.title).toBe(doc.title);
  });
  it('MIDI 로 쓰고 다시 읽어도 같다', () => {
    const doc = load();
    const back = parseMidi(toMidi(doc));
    expect(noteKey(back)).toEqual(noteKey(doc));
    expect(partKey(back)).toEqual(partKey(doc));
    expect(back.tempoBpm).toBe(doc.tempoBpm);
    expect(back.timeSignature).toEqual(doc.timeSignature);
    expect(back.keyFifths).toBe(doc.keyFifths);
  });
  it('.mxl 로 묶어도 같다', () => {
    const doc = load();
    expect(noteKey(parseMusicXml(toMxl(doc)))).toEqual(noteKey(doc));
  });
});

describe('템플릿 gutgeori-v1', () => {
  const stored = JSON.parse(new TextDecoder().decode(templateFile('gutgeori-v1.scoredoc.json'))) as ScoreDoc;
  const manifest = JSON.parse(new TextDecoder().decode(templateFile('manifest.json')));

  it('세 형식이 같은 악보다', () => {
    const fromXml = parseMusicXml(templateFile('gutgeori-v1.musicxml'));
    const fromMid = parseMidi(templateFile('gutgeori-v1.mid'));
    expect(noteKey(fromXml)).toEqual(noteKey(stored));
    expect(noteKey(fromMid)).toEqual(noteKey(stored));
    expect(partKey(fromXml)).toEqual(partKey(stored));
  });
  it('굿거리 12/8 · 8마디 · 가야금 + 장구', () => {
    expect(stored.timeSignature).toEqual({ beats: 12, beatType: 8 });
    expect(stored.tempoBpm).toBeGreaterThanOrEqual(90);           // 점4분 60~70 = 4분 90~105
    expect(stored.tempoBpm).toBeLessThanOrEqual(105);
    expect(stored.parts.map((p) => [p.instrument, p.name, p.isPercussion])).toEqual([['gayageum', '가야금', false], ['janggu', '장구', true]]);
    const end = Math.max(...stored.parts.flatMap((p) => p.notes.map((n) => n.startTick + n.durationTicks)));
    expect(end).toBe(8 * 2880);
    expect(manifest).toMatchObject({ id: 'gutgeori-v1', version: 'v1', status: 'placeholder', title: '굿거리장단 기본' });
  });
});

describe('MusicXML 읽기 세부', () => {
  const doc = parseMusicXml(fixtureText('two-parts.musicxml'));
  it('붙임줄은 한 음으로, 화음·둘째 성부·꾸밈음 처리', () => {
    const [vn, pf] = doc.parts;
    expect(vn.notes.find((n) => n.pitch === 74)).toMatchObject({ startTick: 1440, durationTicks: 1200, velocity: 108 });
    expect(pf.notes.filter((n) => n.startTick === 0).map((n) => n.pitch)).toEqual([59, 55, 50, 43]);
    expect(pf.notes.find((n) => n.pitch === 57)).toMatchObject({ startTick: 1440, durationTicks: 480 });
    expect(pf.notes.find((n) => n.pitch === 50 && n.startTick === 1920)?.durationTicks).toBe(2880);
    expect(pf.notes.some((n) => n.pitch === 52 && n.startTick >= 3840)).toBe(false);   // 꾸밈음 없음
  });
  it('빠르기(메트로놈)·조표·원래 악기', () => {
    expect(doc.tempoBpm).toBe(96);
    expect(doc.keyFifths).toBe(1);
    expect(doc.parts[0].sourceInstrument).toEqual({ name: 'Violin', program: 40 });
    expect(doc.parts[1].sourceInstrument).toEqual({ name: 'Acoustic Grand Piano', program: 0 });
    expect(doc.parts[0].volume).toBe(102);
  });
  it('.mxl: 셋잇단 · 점 붙은 메트로놈보다 sound tempo 우선 · 음높이 없는 타악', () => {
    const w = parseMusicXml(fixture('waltz.mxl'));
    expect(w.title).toBe('Waltz with drums');
    expect(w.tempoBpm).toBe(180);
    expect(w.keyFifths).toBe(-2);
    expect(w.parts[0].notes.slice(1, 4).map((n) => n.durationTicks)).toEqual([160, 160, 160]);
    expect(w.parts[1].isPercussion).toBe(true);
    expect(w.parts[1].notes.map((n) => n.pitch)).toEqual([35, 38, 38, 35]);
    expect(w.parts[1].instrument).toBe('original:0');
  });
});

describe('MIDI 읽기 세부', () => {
  it('ppq 96 → 480, 피아노 프로그램, CC7 음량', () => {
    const d = parseMidi(fixture('piano.mid'));
    expect(d.ppq).toBe(480);
    expect(d.tempoBpm).toBe(100);
    expect(d.timeSignature).toEqual({ beats: 3, beatType: 4 });
    expect(d.parts).toHaveLength(1);
    expect(d.parts[0]).toMatchObject({ instrument: 'piano', sourceInstrument: { name: 'Piano', program: 0 }, volume: 90 });
    expect(d.parts[0].notes).toHaveLength(12);
    expect(d.parts[0].notes.filter((n) => n.startTick === 1440).map((n) => n.durationTicks).sort()).toEqual([1440, 160]);
  });
});

describe('쓰기 세부', () => {
  const doc = parseMusicXml(templateFile('gutgeori-v1.musicxml'));
  it('MusicXML: 한글 악기 이름 · GM 번호(1부터) · 타악 채널 10 · 빠르기 · 셈여림', () => {
    const xml = toMusicXml(doc);
    expect(xml).toContain('<part-name>가야금</part-name>');
    expect(xml).toContain('<instrument-name>장구</instrument-name>');
    expect(xml).toContain('<midi-program>108</midi-program>');
    expect(xml).toMatch(/<midi-channel>10<\/midi-channel><midi-program>1<\/midi-program><midi-unpitched>37<\/midi-unpitched>/);
    expect(xml).toContain('<sound tempo="99"/>');
    expect(xml).toMatch(/<dynamics><(pp|p|mp|mf|f|ff)\/><\/dynamics>/);
    expect(xml).toMatch(/<note dynamics="[\d.]+">/);
    expect(xml).toContain('<unpitched>');
  });
  it('MIDI: 한글 트랙 이름 · 프로그램 · 타악 채널 10 · CC7', async () => {
    const { Midi } = (await import('@tonejs/midi')).default ?? (await import('@tonejs/midi'));
    const m = new Midi(toMidi({ ...doc, parts: [{ ...doc.parts[0], volume: 77 }, doc.parts[1]] }));
    const dec = (s: string) => new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    expect(m.tracks.map((t) => dec(t.name))).toEqual(['가야금', '장구']);
    expect(m.tracks[0].instrument.number).toBe(107);
    expect(m.tracks[1].channel).toBe(9);
    expect(Math.round(m.tracks[0].controlChanges[7][0].value * 127)).toBe(77);
  });
  it('마디를 넘는 음·격자 밖 음은 붙임줄로 나눠 적고 다시 읽으면 한 음', () => {
    const d: ScoreDoc = {
      version: 1, ppq: 480, tempoBpm: 120, timeSignature: { beats: 4, beatType: 4 }, keyFifths: -1,
      parts: [{ id: 'P1', name: '대금', instrument: 'daegeum', isPercussion: false, volume: 100, origin: 'original', notes: [
        { id: 'P1-n1', startTick: 1200, durationTicks: 4200, pitch: 70, velocity: 64 },
        { id: 'P1-n2', startTick: 5403, durationTicks: 157, pitch: 61, velocity: 64 },
      ] }],
    };
    const xml = toMusicXml(d);
    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<step>D</step><alter>-1</alter>');            // 내림 조라 D♭
    const back = parseMusicXml(xml);
    expect(back.parts[0].notes[0]).toMatchObject({ startTick: 1200, durationTicks: 4200, pitch: 70 });
    expect(back.parts[0].notes[1]).toMatchObject({ startTick: 5400, durationTicks: 160, pitch: 61 });
  });
  it('빈 악보도 올바른 파일이 된다', () => {
    const empty: ScoreDoc = { version: 1, ppq: 480, tempoBpm: 120, timeSignature: { beats: 4, beatType: 4 }, keyFifths: 0, parts: [] };
    expect(parseMusicXml(toMusicXml(empty)).parts).toEqual([]);
    expect(parseMidi(toMidi(empty)).parts).toEqual([]);
  });
});

describe('악기 목록', () => {
  it('기본 악기 목록이 shared/instruments.json 과 같다', () => {
    const shared = sharedJson('instruments.json');
    const pick = (i: Record<string, unknown>) => ({ code: i.code, name_ko: i.name_ko, gm_program: i.gm_program, bank: i.bank, program: i.program, is_percussion: i.is_percussion, range_low: i.range_low, range_high: i.range_high });
    expect(BUILTIN_INSTRUMENTS.map(pick)).toEqual(shared.instruments.map(pick));
    expect(BUILTIN_DEFAULT_ENSEMBLE).toEqual(shared.default_ensemble);
    expect(instrumentsCatalog(shared).catalog).toBe(shared.instruments);
    expect(instrumentsCatalog(null).catalog).toBe(BUILTIN_INSTRUMENTS);
  });
});
