// 시험용 표본 파일 만들기: .mxl(손으로 쓴 MusicXML 을 압축) · 피아노 MIDI(@tonejs/midi 로 직접, ppq 96)
// 실행: ../../node_modules/.bin/tsx scripts/make-fixtures.ts  (packages/score-core 에서)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import tonejs from '@tonejs/midi';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

const xml = readFileSync(join(dir, 'mxl-source.musicxml'));
const container = '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="music/waltz.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>\n';
writeFileSync(join(dir, 'waltz.mxl'), zipSync({
  mimetype: [strToU8('application/vnd.recordare.musicxml'), { level: 0 }],
  'META-INF/container.xml': strToU8(container),
  'music/waltz.xml': new Uint8Array(xml),
}));

const midi = new tonejs.Midi();
midi.header.fromJSON({ ...midi.header.toJSON(), ppq: 96, name: 'Piano sample', tempos: [], timeSignatures: [], keySignatures: [], meta: [] });
midi.header.setTempo(100);
midi.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] });
const t = midi.addTrack();
t.name = 'Piano';
t.channel = 0;
t.instrument.number = 0;
t.addCC({ number: 7, value: 90.5 / 127, ticks: 0 });
// 도-미-솔 화음, 선율, 셋잇단
const add = (m: number, ticks: number, dur: number, v: number) => t.addNote({ midi: m, ticks, durationTicks: dur, velocity: (v + 0.5) / 127 });
add(48, 0, 288, 70); add(52, 0, 288, 70); add(55, 0, 288, 70);
add(72, 0, 96, 100); add(74, 96, 48, 90); add(76, 144, 48, 90); add(77, 192, 96, 110);
add(79, 288, 32, 80); add(77, 320, 32, 80); add(76, 352, 32, 80); add(74, 384, 192, 64);
add(43, 288, 288, 60);
writeFileSync(join(dir, 'piano.mid'), midi.toArray());
console.log('fixtures written to', dir);
