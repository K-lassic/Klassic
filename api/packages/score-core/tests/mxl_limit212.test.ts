// (#212) .mxl 압축 해제 상한 — 항목 수 · 풀린 크기 합이 상한을 넘으면 풀지 않고 오류를 낸다.
//   구조에서의 위치: parseMusicXml() 은 backend(직행 접수) · frontend(편집 · 연주)가 함께 쓴다.
//   전자 악보 바로 듣기(PR #199)로 웹이 .mxl 을 받게 되면 사용자가 올린 압축 파일이 그대로 여기로 온다.
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { MXL_MAX_ENTRIES, MXL_MAX_UNCOMPRESSED_BYTES, parseMusicXml } from '../src/index.js';
import { fixture, fixtureText } from './helpers.js';

const SCORE = strToU8(fixtureText('two-parts.musicxml'));
const CONTAINER = strToU8('<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>');
const mxl = (extra: Record<string, Uint8Array>) => zipSync({ 'META-INF/container.xml': CONTAINER, 'score.musicxml': SCORE, ...extra });

/** zip 목록(central directory)에 적힌 「풀린 크기」만 바꾼다 — 크기를 속인 조작 파일을 만든다. */
function lieAboutSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  let changed = 0;
  for (let i = 0; i + 46 <= out.length; i += 1) {
    if (view.getUint32(i, true) !== 0x02014b50) continue; // 목록 항목 표시
    const nameLength = view.getUint16(i + 28, true);
    if (new TextDecoder().decode(out.subarray(i + 46, i + 46 + nameLength)) !== name) continue;
    view.setUint32(i + 24, size, true); // 풀린 크기
    changed += 1;
  }
  if (changed !== 1) throw new Error(`목록에서 ${name} 을 ${changed}번 찾았어요`);
  return out;
}

describe('.mxl 압축 해제 상한 (#212)', () => {
  it('상한 값은 model-api 업로드 검사와 같다 (항목 100개 · 20MB)', () => {
    expect(MXL_MAX_ENTRIES).toBe(100);
    expect(MXL_MAX_UNCOMPRESSED_BYTES).toBe(20 * 1024 * 1024);
  });

  it('정상 .mxl 은 그대로 읽는다', () => {
    expect(parseMusicXml(fixture('waltz.mxl')).parts.length).toBeGreaterThan(0);
    expect(parseMusicXml(mxl({})).parts).toHaveLength(2);
  });

  it('항목이 꼭 100개면 읽고, 101개면 오류', () => {
    const pad = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`pad/${i}.txt`, strToU8('x')]));
    expect(parseMusicXml(mxl(pad(MXL_MAX_ENTRIES - 2))).parts).toHaveLength(2);
    expect(() => parseMusicXml(mxl(pad(MXL_MAX_ENTRIES - 1)))).toThrow('너무 커서');
  });

  it('풀린 크기 합이 20MB 를 넘으면 오류 — 압축된 크기는 작아도 (zip 폭탄)', () => {
    const bomb = mxl({ 'big.bin': new Uint8Array(MXL_MAX_UNCOMPRESSED_BYTES) });
    expect(bomb.length).toBeLessThan(1024 * 1024); // 0 으로 찬 20MB 는 수십 KB 로 줄어든다
    expect(() => parseMusicXml(bomb)).toThrow('너무 커서');
  });

  it('풀린 크기 합이 꼭 20MB 면 읽고, 1바이트 넘으면 오류', () => {
    const fit = MXL_MAX_UNCOMPRESSED_BYTES - CONTAINER.length - SCORE.length;
    expect(parseMusicXml(mxl({ 'big.bin': new Uint8Array(fit) })).parts).toHaveLength(2);
    expect(() => parseMusicXml(mxl({ 'big.bin': new Uint8Array(fit + 1) }))).toThrow('너무 커서');
  });

  it('크기를 작게 속인 항목은 적힌 크기까지만 푼다 — 상한을 넘는 메모리를 쓰지 않는다', () => {
    const lied = lieAboutSize(mxl({ 'big.bin': new Uint8Array(MXL_MAX_UNCOMPRESSED_BYTES + 1024) }), 'big.bin', 10);
    expect(unzipSync(lied)['big.bin']).toHaveLength(10); // 오류 없이 잘린다 (fflate 0.8.2)
    expect(parseMusicXml(lied).parts).toHaveLength(2); // 악보 항목은 멀쩡해서 그대로 읽힌다
  });

  it('악보 항목의 크기를 속이면 잘린 XML 이라 해석에서 오류', () => {
    expect(() => parseMusicXml(lieAboutSize(mxl({}), 'score.musicxml', 200))).toThrow();
    expect(() => parseMusicXml(lieAboutSize(mxl({}), 'score.musicxml', SCORE.length - 5))).toThrow();
    expect(() => parseMusicXml(lieAboutSize(mxl({}), 'score.musicxml', 0))).toThrow('score-partwise');
  });
});
