// 붙임줄 — 다른 성부에 같은 음이 있어도 마디를 넘는 음이 쪼개지지 않는다.
//
//   구조에서의 위치: parseMusicXml 은 backend 가 인식 결과(model-api 가 준 MusicXML)를 ScoreDoc 으로 바꿀 때,
//     frontend 가 공유 악보를 읽을 때 쓴다. 여기서 음이 둘로 쪼개지면 화면 연주 · MP3 · 내려받는 MIDI 에서 그 음을 두 번 친다.
//   무슨 일이었나: 열려 있는 붙임줄을 음높이로만 기억했다. 같은 마디의 다른 성부에 같은 음높이의 (붙임줄 없는) 음이 있으면
//     그 음을 읽는 순간 기억이 지워졌고, 다음 마디의 이어지는 조각은 짝을 못 찾아 새 음표가 됐다.
//     MusicXML 은 성부를 차례로 적으므로(1성부 전부 → backup → 2성부) 시간상 앞선 음이 파일에서는 뒤에 나온다.
import { describe, expect, it } from 'vitest';
import { createScoreDoc, noteId, parseMusicXml, sortNotes, toMusicXml, type Note, type ScoreDoc } from '../src/index.js';

function docOf(notes: Omit<Note, 'id'>[], init: Partial<ScoreDoc> = {}): ScoreDoc {
  const doc = createScoreDoc(init);
  const ns = sortNotes(notes.map((n) => ({ ...n, id: '' })));
  ns.forEach((n, i) => { n.id = noteId('P1', i); });
  doc.parts.push({ id: 'P1', name: '피아노', instrument: 'piano', sourceInstrument: null, isPercussion: false, volume: 100, origin: 'original', notes: ns });
  return doc;
}
const shape = (doc: ScoreDoc) => doc.parts[0].notes.map((n) => `${n.startTick}:${n.durationTicks}:${n.pitch}`);

describe('붙임줄과 성부', () => {
  it('2성부에 같은 음이 먼저 나와도, 1성부의 마디를 넘는 음은 한 음으로 읽힌다', () => {
    const doc = docOf([
      { startTick: 0, durationTicks: 1440, pitch: 64, velocity: 80 },      // 1성부: 미 (점2분)
      { startTick: 1440, durationTicks: 960, pitch: 60, velocity: 80 },    // 1성부: 도 — 마디선(1920)을 넘는다
      { startTick: 480, durationTicks: 480, pitch: 60, velocity: 80 },     // 2성부: 도 — 위의 미와 겹쳐 2성부가 된다
    ]);
    const back = parseMusicXml(toMusicXml(doc));
    expect(shape(back)).toEqual(shape(doc));
    expect(back.parts[0].notes).toHaveLength(3);
  });

  it('다른 프로그램이 적은 악보도 같다 — 1성부 붙임줄 시작 뒤에 2성부의 같은 음이 적힌 마디', () => {
    // music21 · MuseScore 가 적는 모양: 한 마디 안에서 1성부를 다 적고 <backup> 뒤에 2성부를 적는다
    const note = (step: string, dur: number, voice: number, extra = '') =>
      `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${dur}</duration>${extra}<voice>${voice}</voice></note>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${note('E', 3, 1)}
      ${note('C', 1, 1, '<tie type="start"/>')}
      <backup><duration>4</duration></backup>
      <note><rest/><duration>1</duration><voice>2</voice></note>
      ${note('C', 1, 2)}
      <note><rest/><duration>2</duration><voice>2</voice></note>
    </measure>
    <measure number="2">
      ${note('C', 1, 1, '<tie type="stop"/>')}
      <note><rest/><duration>3</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const doc = parseMusicXml(xml);
    // 미(0~1440) · 2성부 도(480~960) · 1성부 도(1440~2400, 마디를 넘어 이어짐) — 세 음
    expect(shape(doc)).toEqual(['0:1440:64', '480:480:60', '1440:960:60']);
  });

  it('타악 성부 — 같은 북 소리가 여러 성부에 흩어져 있어도 마디를 넘는 음은 한 번만 친다', () => {
    const doc = docOf([
      { startTick: 0, durationTicks: 1680, pitch: 36, velocity: 90 },
      { startTick: 1680, durationTicks: 480, pitch: 42, velocity: 90 },    // 마디선을 넘는다
      { startTick: 240, durationTicks: 240, pitch: 42, velocity: 90 },     // 2성부
      { startTick: 960, durationTicks: 240, pitch: 42, velocity: 90 },     // 2성부
    ]);
    doc.parts[0].isPercussion = true;
    doc.parts[0].instrument = 'janggu';
    doc.parts[0].name = '장구';
    expect(shape(parseMusicXml(toMusicXml(doc)))).toEqual(shape(doc));
  });

  it('붙임줄 없이 같은 음을 이어 치는 것은 합치지 않는다 (고치면서 반대로 망가지지 않았는지)', () => {
    const doc = docOf([
      { startTick: 1440, durationTicks: 480, pitch: 60, velocity: 80 },    // 마디 끝까지
      { startTick: 1920, durationTicks: 480, pitch: 60, velocity: 80 },    // 다음 마디 첫 박에 다시 친다
    ]);
    expect(shape(parseMusicXml(toMusicXml(doc)))).toEqual(['1440:480:60', '1920:480:60']);
  });

  it('다음 마디에서 앞 성부가 같은 음을 나중에 쳐도, 뒤 성부의 이어지는 조각은 짝을 찾는다', () => {
    // 2마디: 1성부가 셋째 박에 도를 친다(파일에서는 먼저 읽힌다). 2성부의 도는 1마디에서 넘어와 첫 박에 이어진다
    const doc = docOf([
      { startTick: 0, durationTicks: 1920, pitch: 72, velocity: 80 },      // 1마디 1성부
      { startTick: 1440, durationTicks: 960, pitch: 60, velocity: 80 },    // 1마디 2성부 → 2마디로 넘어간다
      { startTick: 1920, durationTicks: 960, pitch: 76, velocity: 80 },    // 2마디 1성부 앞 절반
      { startTick: 2880, durationTicks: 480, pitch: 60, velocity: 80 },    // 2마디 1성부: 도 (2성부의 도가 끝난 뒤)
    ]);
    expect(shape(parseMusicXml(toMusicXml(doc)))).toEqual(shape(doc));
  });

  it('두 성부가 같은 음을 함께 마디 너머로 끌면, 성부 번호로 각자의 뒷부분을 찾는다', () => {
    const doc = docOf([
      { startTick: 0, durationTicks: 2880, pitch: 58, velocity: 80 },      // 길게 — 마디선(1920) 뒤 960 더
      { startTick: 1200, durationTicks: 1200, pitch: 58, velocity: 80 },   // 같은 음, 마디선 뒤 480 더
    ]);
    const back = parseMusicXml(toMusicXml(doc));
    // 뒷부분이 서로 바뀌면 0:2400 · 1200:1680 이 된다
    expect(shape(back)).toEqual(['0:2880:58', '1200:1200:58']);
  });

  it('두 보표가 같은 음을 함께 마디 너머로 끌면, 보표 번호로 각자의 뒷부분을 찾는다 (성부 번호가 없는 파일)', () => {
    // 한 파트에 보표 둘(#180: 보표마다 파트로 나뉜다). 2마디에서는 2보표를 먼저 적어, 먼저 열린 붙임줄을 고르면 틀리게 한다
    const c = (dur: number, staff: number, tie: string) =>
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>${dur}</duration><tie type="${tie}"/><staff>${staff}</staff></note>`;
    const rest = (dur: number, staff: number) => `<note><rest/><duration>${dur}</duration><staff>${staff}</staff></note>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
      ${rest(2, 1)}${c(2, 1, 'start')}
      <backup><duration>4</duration></backup>
      ${rest(2, 2)}${c(2, 2, 'start')}
    </measure>
    <measure number="2">
      ${c(1, 2, 'stop')}${rest(3, 2)}
      <backup><duration>4</duration></backup>
      ${c(3, 1, 'stop')}${rest(1, 1)}
    </measure>
  </part>
</score-partwise>`;
    const doc = parseMusicXml(xml);
    // 뒷부분이 서로 바뀌면 1보표 960:1440 · 2보표 960:2400 이 된다
    expect(doc.parts.map((p) => p.notes.map((n) => `${n.startTick}:${n.durationTicks}:${n.pitch}`)))
      .toEqual([['960:2400:60'], ['960:1440:60']]);
  });

  it('세 마디에 걸친 음 — 가운데 마디의 다른 성부에 같은 음이 있어도 끝까지 한 음이다', () => {
    const doc = docOf([
      { startTick: 1440, durationTicks: 4320, pitch: 67, velocity: 80 },   // 1마디 끝 ~ 3마디 끝
      { startTick: 1920, durationTicks: 1920, pitch: 72, velocity: 80 },   // 2마디를 채워 아래 음을 2성부로 민다
      { startTick: 0, durationTicks: 480, pitch: 67, velocity: 80 },
    ]);
    const back = parseMusicXml(toMusicXml(doc));
    expect(shape(back)).toEqual(shape(doc));
  });
});
