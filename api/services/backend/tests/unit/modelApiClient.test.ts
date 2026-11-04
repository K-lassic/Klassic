// #174 model-api 클라이언트 — DB 없이 돈다. 느린 응답도 마감까지 기다리고, 끊기면 시간 초과 · 연결 실패를 구분한다.
//   300초를 넘는 응답(undici headersTimeout)은 시험 시간이 길어 여기서 돌리지 않는다 — PR 에 수동 확인 기록.
import '../helpers/env.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { blobOf, ModelApiDown, modelJson } from '../../src/services/modelApiClient.js';
import { startFakeModelApi, type FakeModelApi } from '../helpers/fakeModelApi.js';

const later = (ms: number) => new Date(Date.now() + ms);

describe('model-api 클라이언트 (#174)', () => {
  let fake: FakeModelApi;
  beforeEach(async () => { fake = await startFakeModelApi(); });
  afterEach(async () => { await fake.close(); });

  it('마감 안이면 느린 응답도 받고, 사진 여러 장을 올린 순서대로 보낸다', async () => {
    fake.on('post', '/v1/omr/staff', (_q, s) => { setTimeout(() => s.json({ ok: true }), 1500); });
    const form = new FormData();
    form.append('image', blobOf(Buffer.from('a')), '1.png');
    form.append('image', blobOf(Buffer.from('b')), '2.png');
    form.set('request_no', 'R-TEST');
    await expect(modelJson('POST', '/v1/omr/staff', form, { deadline: later(10000) })).resolves.toEqual({ ok: true });
    expect(fake.calls.at(-1)).toMatchObject({ files: ['1.png', '2.png'], fields: { request_no: 'R-TEST' }, apiKey: 'test-service-key' });
    expect(fake.calls.at(-1)?.deadline).toBeTruthy();
  });

  it('마감을 넘기면 timeout 으로 끊는다', async () => {
    fake.on('post', '/v1/omr/staff', (_q, s) => { setTimeout(() => s.json({ ok: true }), 3000); });
    const err = await modelJson('POST', '/v1/omr/staff', new FormData(), { deadline: later(300) }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelApiDown);
    expect(err.reason).toBe('timeout');
  });

  it('model-api 가 없으면 unreachable', async () => {
    await fake.close();
    const err = await modelJson('GET', '/v1/models', undefined, { timeoutMs: 2000 }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelApiDown);
    expect(err.reason).toBe('unreachable');
    fake = await startFakeModelApi(); // afterEach 가 닫을 서버
  });

  it('오류 응답은 상태 코드와 본문을 담는다', async () => {
    fake.on('post', '/v1/omr/staff', (_q, s) => { s.status(429).json({ error: { code: 'BUSY' } }); });
    const err = await modelJson('POST', '/v1/omr/staff', new FormData(), { deadline: later(5000) }).catch((e) => e);
    expect(err).toMatchObject({ reason: 'http', status: 429, body: { error: { code: 'BUSY' } } });
  });
});
