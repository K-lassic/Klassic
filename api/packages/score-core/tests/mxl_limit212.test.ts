// (#212) .mxl 압축 해제 상한 — 항목 수 · 풀린 크기 합이 상한을 넘으면 풀지 않고 오류를 낸다.
//   구조에서의 위치: parseMusicXml() 은 backend(직행 접수) · frontend(편집 · 연주)가 함께 쓴다.
//   전자 악보 바로 듣기(PR #199)로 웹이 .mxl 을 받게 되면 사용자가 올린 압축 파일이 그대로 여기로 온다.
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { MXL_MAX_ENTRIES, MXL_MAX_UNCOMPRESSED_BYTES, parseMusicXml } from '../src/index.js';
import { fixture, fixtureText } from './helpers.js';

const SCORE = strToU8(fixtureText('two-parts.musicxml'));
const CONTAINER = strToU8('<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>');
const mxl = (extra: Record<string, Uint8Array>) => zipSync({ 'META-INF/container.xml': CONTAINER, 'score.musicxml': SCORE, ...extra });

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
});
