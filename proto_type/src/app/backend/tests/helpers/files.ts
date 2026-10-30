// 시험용 파일 만들기: 실제로 열리는 PNG(원하는 크기)와 MIDI
import { deflateSync } from 'node:zlib';
import { Midi } from '@tonejs/midi';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 흰 바탕 회색조 PNG. 오선 5줄을 그려 넣는다 */
export function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    const onLine = [0, 1, 2, 3, 4].some((i) => y === 100 + i * 12);
    if (onLine) raw.fill(0, y * (width + 1) + 1 + 40, y * (width + 1) + 1 + width - 40);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function makeMidi(program = 0): Buffer {
  const midi = new Midi();
  const t = midi.addTrack();
  t.name = 'Piano';
  t.instrument.number = program;
  [60, 62, 64, 65, 67].forEach((n, i) => t.addNote({ midi: n, time: i * 0.5, duration: 0.5, velocity: 0.8 }));
  return Buffer.from(midi.toArray());
}
