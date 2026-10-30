// (2026-09-30 황송해 131번) 화음의 음을 하나씩 고친다 — set_note_pitch 는 음 하나(note_id)만 바꾼다
import { describe, expect, it } from 'vitest';
import { applyOps, parseMusicXml, toMusicXml } from '../src/index.js';

const CHORD = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
<note><chord/><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
</measure></part></score-partwise>`;

describe('화음 안의 음 하나 고치기', () => {
  it('화음의 음은 id 가 따로 있고 같은 자리에서 시작한다', () => {
    const doc = parseMusicXml(CHORD);
    const notes = doc.parts[0].notes;
    expect(notes.map((n) => n.pitch).sort()).toEqual([60, 62, 64]);
    expect(new Set(notes.map((n) => n.id)).size).toBe(3);
    expect(new Set(notes.map((n) => n.startTick)).size).toBe(1);
  });
  it('가운데 음(레)만 반음 올리면 도 · 미는 그대로이고, MusicXML 에서도 화음으로 남는다', () => {
    const doc = parseMusicXml(CHORD);
    const re = doc.parts[0].notes.find((n) => n.pitch === 62)!;
    const out = applyOps(doc, [{ op: 'set_note_pitch', note_id: re.id, midi_pitch: 63 }]);
    expect(out.parts[0].notes.map((n) => n.pitch).sort()).toEqual([60, 63, 64]);
    const xml = toMusicXml(out);
    expect((xml.match(/<chord\/>/g) ?? []).length).toBe(2);
    const back = parseMusicXml(xml);
    expect(back.parts[0].notes.map((n) => n.pitch).sort()).toEqual([60, 63, 64]);
  });
});
