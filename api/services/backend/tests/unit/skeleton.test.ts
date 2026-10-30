// #23 백엔드 골격 시험 — DB 없이 돈다. (DB 가 필요한 시험은 #44)
//   score-core file: 설치 확인은 #18 에서 옮겨 온 완료 기준이다.
import { describe, expect, it, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import request from 'supertest';

const here = dirname(fileURLToPath(import.meta.url));

// 앱 모듈을 불러오기 전에 설정을 채운다 — DB 는 일부러 닿지 않는 주소(연결 거부)
beforeAll(() => {
  Object.assign(process.env, {
    DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test',
    SESSION_SECRET: 'x'.repeat(32), ADDR_HASH_SALT: 'y'.repeat(16),
    SHARED_DIR: process.env.SHARED_DIR ?? join(here, '..', '..', '..', '..', 'shared'),
  });
});

describe('score-core (file: 설치 · #18 에서 옮겨 온 확인)', () => {
  it('공개 함수를 가져와 MusicXML → 편집 연산 → MIDI 로 쓸 수 있다', async () => {
    const sc = await import('@gugak/score-core');
    for (const fn of ['parseMusicXml', 'parseMidi', 'toMusicXml', 'toMidi', 'applyOps']) {
      expect(typeof (sc as Record<string, unknown>)[fn]).toBe('function');
    }
    const doc = sc.parseMidi(sc.toMidi({
      version: 1, ppq: 480, tempoBpm: 90, timeSignature: { beats: 4, beatType: 4 }, keyFifths: 0,
      parts: [{ id: 'P1', name: '가야금', instrument: 'gayageum', isPercussion: false, volume: 100, origin: 'original',
        notes: [{ id: 'P1-n1', startTick: 0, durationTicks: 480, pitch: 60, velocity: 90 }] }],
    } as never));
    const up = sc.applyOps(doc, [{ op: 'transpose', semitones: 2 }] as never);
    expect(up.parts[0].notes[0].pitch).toBe(62);
  });
});

describe('설정 검증 (기능 목록 H1)', () => {
  it('빠진 키 이름만 알리고 값은 출력하지 않는다', async () => {
    const { loadEnv } = await import('../../src/config/env.js');
    expect(() => loadEnv({ DB_PASSWORD: 'secret-value' })).toThrow(/DB_HOST.*DB_USER.*DB_NAME.*SESSION_SECRET/);
    expect(() => loadEnv({ DB_PASSWORD: 'secret-value' })).not.toThrow(/secret-value/);
  });
  it('기본값 — 0.0.0.0 수신 · 서비스 이름으로 model-api', async () => {
    const { loadEnv } = await import('../../src/config/env.js');
    const e = loadEnv({ DB_HOST: 'db', DB_USER: 'u', DB_PASSWORD: '', DB_NAME: 'n', SESSION_SECRET: 'x'.repeat(32), ADDR_HASH_SALT: 'y'.repeat(16) });
    expect([e.WEB_HOST, e.WEB_PORT, e.ADMIN_PORT, e.MODEL_API_URL]).toEqual(['0.0.0.0', 9523, 26101, 'http://model-api:9543']);
  });
});

describe('공용 설정 (api/shared · #19)', () => {
  it('세 오류 파일을 합치면 v0.1.1 과 같은 70개', async () => {
    const { loadShared } = await import('../../src/config/shared.js');
    const s = loadShared(process.env.SHARED_DIR);
    const n = Object.keys(s.errorCodes.gate_codes).length + Object.keys(s.errorCodes.fallback_reasons).length
      + Object.keys(s.errorCodes.status_codes).length;
    expect(n).toBe(70);
    expect(s.errorCodes.api_version).toBe('v1');
  });
  it('같은 코드가 두 파일에 있으면 시작하지 않는다', async () => {
    const { mergeErrorCodes } = await import('../../src/config/shared.js');
    const dup = { gate_codes: { BAD_REQUEST: { http: 400 } } };
    expect(() => mergeErrorCodes({ common: dup, web: dup })).toThrow(/중복/);
  });
});

describe('오류 응답 · 준비 상태', () => {
  it('오류 응답 모양이 계약(ErrorResponse)과 같다', async () => {
    const { errorBody } = await import('../../src/web/errors.js');
    const b = errorBody('REQUEST_NOT_FOUND');
    expect(Object.keys(b.error).sort()).toEqual(['code', 'details', 'fix', 'gate', 'message', 'retry_after']);
    expect(b.api_version).toBe('v1');
    expect(errorBody('없는_코드').error.code).toBe('INTERNAL_ERROR');
  });
  it('DB 에 닿지 않으면 /api/health 는 503 SERVICE_NOT_READY (v0.1.1 은 늘 200 이었다)', async () => {
    const { createWebApp } = await import('../../src/app.js');
    const res = await request(createWebApp()).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'SERVICE_NOT_READY', details: { reason: 'db' } });
  });
  // "대응표에 없는 /api 경로는 404" 는 #27 부터 세션(DB)을 거치므로 통합 시험(tests/integration/auth.test.ts)으로 옮겼다
});
