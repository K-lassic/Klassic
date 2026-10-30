// 대체 템플릿 만들기 (tasks T043, research R9, UC_02 BR-FBK-09): 「아리랑 (세마치장단)」 9/8 · 16마디 · 가야금 선율 + 장구.
// (2026-09-30 박예은 팀장 결정·국악 검수) 임시였던 「굿거리장단 기본」(gutgeori-v1)을 바꾼다 — 옛 파일은 지우지 않는다(DB 옛 행이 가리킴).
// 선율은 검수한 9/8 악보(PYE_국악검수/아리랑8분의9박자.jpg · 아리랑_세마치_이벤트표.md) 그대로 — 음높이·리듬을 바꾸지 않는다.
// 실행: app/ 에서  node_modules/.bin/tsx packages/score-core/scripts/make-template.ts
//   (TEMPLATE_OUT_DIR 를 주면 그 폴더에 쓴다 — 서비스 폴더에 넣기 전에 확인할 때)
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noteId, parseMidi, parseMusicXml, toMidi, toMusicXml, type Note, type ScoreDoc } from '../src/index.js';

const outDir = process.env.TEMPLATE_OUT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'templates');
const ID = 'arirang-semachi-v1';
const TITLE = '아리랑 (세마치장단)';
const E8 = 240;                                  // 8분음표
const MEASURE = 9 * E8;                          // 9/8 한 마디 = 세마치 한 장단
const DOTTED_QUARTER_BPM = 100;

// 선율 [음(MIDI), 8분음표 개수] — 0 은 쉼표. 붙임줄로 이은 같은 음은 한 음(예: 1마디 C4 = 8분 5개), 이음줄은 따로 뜯는다.
const C4 = 60, D4 = 62, F4 = 65, G4 = 67, A4 = 69, C5 = 72, REST = 0;
const M2: [number, number][] = [[F4, 5], [G4, 1], [F4, 2], [G4, 1]];
const M4: [number, number][] = [[C4, 5], [D4, 1], [C4, 1], [D4, 1], [REST, 1]];
const M6: [number, number][] = [[A4, 2], [G4, 1], [F4, 2], [D4, 1], [C4, 2], [D4, 1]];
const M7: [number, number][] = [[F4, 5], [G4, 1], [F4, 3]];
const MELODY: [number, number][][] = [
  [[C4, 5], [D4, 1], [C4, 2], [D4, 1]],                          // 1  아 - 리랑 -
  M2,                                                              // 2  아 - 리랑 -
  [[A4, 3], [G4, 1], [A4, 1], [G4, 1], [F4, 2], [D4, 1]],         // 3  아 라 - - 리 -
  M4,                                                              // 4  요 - - - -
  M2,                                                              // 5  아 - 리랑 -
  M6,                                                              // 6  고 - 개 - 로 -
  M7,                                                              // 7  넘 - 어간
  [[F4, 6], [REST, 3]],                                            // 8  다 -
  [[C5, 6], [C5, 3]],                                              // 9  나 - 를
  [[C5, 3], [A4, 3], [G4, 3]],                                     // 10 버 리 고
  [[A4, 3], [G4, 2], [A4, 1], [F4, 2], [D4, 1]],                  // 11 가 시 는님 -
  M4,                                                              // 12 은 - - - -
  M2,                                                              // 13 십 - 리도 -
  M6,                                                              // 14 못 - 가 - 서 -
  M7,                                                              // 15 발 - 병난
  [[F4, 6], [REST, 3]],                                            // 16 다 - (F4 2박을 다 내고 끝)
];

// 세마치 한 장단: 8분 칸 1 덩 · 4 덩 · 6 기덕 · 7 쿵 · 8 기덕 — 국악 타악 세트(gugak.sf2 bank 128 · program 1) 건반
// 덩 36 · 기덕 38 · 쿵 42, 세기 95 이하 = 중 · 96 이상 = 강 → 덩·쿵 중, 기덕 강(국악 검수에서 고름). [시작 칸, 칸 수, 건반, 세기]
const DUNG = 36, GIDEOK = 38, KUNG = 42;
const SEMACHI: [number, number, number, number][] = [
  [0, 3, DUNG, 95], [3, 2, DUNG, 95], [5, 1, GIDEOK, 100], [6, 1, KUNG, 95], [7, 2, GIDEOK, 100],
];
const LAST_BAR: [number, number, number, number][] = [[0, 3, DUNG, 95]];   // 16마디는 첫 덩 1박만

function melodyNotes(): Note[] {
  const notes: Note[] = [];
  MELODY.forEach((bar, mi) => {
    let t = mi * MEASURE;
    for (const [pitch, eighths] of bar) {
      if (pitch !== REST) notes.push({ id: '', startTick: t, durationTicks: eighths * E8, pitch, velocity: 88 });
      t += eighths * E8;
    }
    if (t !== (mi + 1) * MEASURE) throw new Error(`${mi + 1}마디 길이가 맞지 않아요`);
  });
  return notes;
}

function jangguNotes(): Note[] {
  const notes: Note[] = [];
  MELODY.forEach((_bar, mi) => {
    for (const [s, d, p, v] of mi === MELODY.length - 1 ? LAST_BAR : SEMACHI) {
      notes.push({ id: '', startTick: mi * MEASURE + s * E8, durationTicks: d * E8, pitch: p, velocity: v });
    }
  });
  return notes;
}

const withIds = (partId: string, notes: Note[]) =>
  notes.sort((a, b) => a.startTick - b.startTick || b.pitch - a.pitch).map((n, i) => ({ ...n, id: noteId(partId, i) }));

const doc: ScoreDoc = {
  version: 1,
  title: TITLE,
  ppq: 480,
  tempoBpm: DOTTED_QUARTER_BPM * 1.5,            // 4분음표 기준 150
  timeSignature: { beats: 9, beatType: 8 },
  keyFifths: -1,                                  // 악보 조표 내림표 1개
  parts: [
    { id: 'P1', name: '가야금', instrument: 'gayageum', sourceInstrument: null, isPercussion: false, volume: 100, origin: 'original', notes: withIds('P1', melodyNotes()) },
    { id: 'P2', name: '장구', instrument: 'janggu', sourceInstrument: null, isPercussion: true, volume: 100, origin: 'original', notes: withIds('P2', jangguNotes()) },
  ],
};

const xml = toMusicXml(doc);
const mid = toMidi(doc);
const json = JSON.stringify(doc, null, 2) + '\n';

// 다시 읽어서 음표가 같은지 확인
const key = (d: ScoreDoc) => d.parts.map((p) => `${p.id}|${p.instrument}|${p.notes.map((n) => `${n.startTick}+${n.durationTicks}:${n.pitch}@${n.velocity}`).join(',')}`).join('\n');
for (const [label, back] of [['musicxml', parseMusicXml(xml)], ['midi', parseMidi(mid)]] as const) {
  if (key(back) !== key(doc)) throw new Error(`${label} 로 다시 읽은 음표가 달라요`);
  if (back.keyFifths !== doc.keyFifths || back.tempoBpm !== doc.tempoBpm) throw new Error(`${label} 조표·빠르기가 달라요`);
}

mkdirSync(outDir, { recursive: true });
const files = { musicxml: `${ID}.musicxml`, midi: `${ID}.mid`, scoredoc: `${ID}.scoredoc.json` };
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
writeFileSync(join(outDir, files.musicxml), xml);
writeFileSync(join(outDir, files.midi), mid);
writeFileSync(join(outDir, files.scoredoc), json);

const manifest = {
  id: ID,
  version: 'v1',
  status: 'reviewed',
  title: TITLE,
  note: '선율은 국악 검수한 9/8 아리랑 악보 그대로(붙임줄은 한 음, 이음줄은 따로). 장구는 국악 타악 세트 건반(덩 36 · 기덕 38 · 쿵 42)으로 세마치 1마디 1장단(덩·덩·기덕·쿵·기덕), 16마디는 첫 덩만',
  selection_rule: 'always-default',
  time_signature: '9/8',
  tempo: { dotted_quarter_bpm: DOTTED_QUARTER_BPM, quarter_bpm: doc.tempoBpm },
  key_fifths: doc.keyFifths,
  measures: MELODY.length,
  parts: doc.parts.map((p) => ({ id: p.id, name: p.name, instrument: p.instrument, percussion: p.isPercussion, notes: p.notes.length })),
  files: {
    musicxml: { path: files.musicxml, sha256: sha(xml) },
    midi: { path: files.midi, sha256: sha(mid) },
    scoredoc: { path: files.scoredoc, sha256: sha(json) },
  },
  melody_author: '박예은(국악 검수, 2026-09-30)',
  replaces: 'gutgeori-v1',
  generator: 'app/packages/score-core/scripts/make-template.ts',
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('template written:', outDir);
