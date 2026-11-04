// #35 인식 작업자 통합 시험 — 실제 MariaDB 필요 (TEST_DB_HOST 가 있을 때만 돈다). model-api 는 가짜.
//   v0.1.1 us1_upload_to_result · us2_fallback 과, 재시작 복구 · 마감 · 종류 확인을 시험한다.
import { HAS_DB } from '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Response } from 'express';
import { MIDI, SAMPLE_MUSICXML, makePng } from '../helpers/files.js';
import type { FakeModelApi } from '../helpers/fakeModelApi.js';

let app: Server;
let fake: FakeModelApi;
let db: typeof import('../../src/db/pool.js');
let h: typeof import('../helpers/db.js');
let worker: typeof import('../../src/services/requestWorker.js');
let loggedInAgent: typeof import('../helpers/auth.js').loggedInAgent;

type Agent = ReturnType<typeof request.agent>;
const BASE = { web_max_active_per_client: 100000, web_hourly_request_cap: 100000, max_concurrency_recognize: 4, web_concurrency_share: 3, timeout_seconds: 180 };

const recognized = (extra: Record<string, unknown> = {}) => ({
  fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false, detected_type: null, validity_grade: 'trust',
  musicxml: SAMPLE_MUSICXML, midi_base64: MIDI.toString('base64'), engine: { name: 'homr', version: 't' }, ...extra });
const ok = (_q: unknown, s: Response) => { s.json(recognized()); };

beforeAll(async () => {
  if (!HAS_DB) return;
  const { serve } = await import('../helpers/serve.js');
  const { createWebApp } = await import('../../src/app.js');
  const { startFakeModelApi } = await import('../helpers/fakeModelApi.js');
  db = await import('../../src/db/pool.js');
  h = await import('../helpers/db.js');
  worker = await import('../../src/services/requestWorker.js');
  ({ loggedInAgent } = await import('../helpers/auth.js'));
  app = serve(createWebApp());
  fake = await startFakeModelApi();
  await h.setSettings(BASE);
  await worker.startWorker();
});
afterAll(async () => { if (HAS_DB) { worker.stopWorker(); await fake.close(); await db.closePool(); } });

/** 단조 시계(performance.now)를 ms 만큼 앞으로 보낸다 — 마감을 단조 시계로만 재므로 DB 시각을 고치는 대신 이것으로 시간을 보낸다 (#105) */
const advanceMonotonic = (ms: number) => {
  const real = performance.now.bind(performance);
  vi.spyOn(performance, 'now').mockImplementation(() => real() + ms);
};

const upload = async (u: Agent, type = 'staff') => {
  const up = await u.post('/api/requests').field('score_type', type).attach('file', makePng(1000, 900), 'a.png');
  expect(up.status).toBe(202);
  return up.body.id as string;
};
const finished = (u: Agent, no: string, timeoutMs = 15000) => h.waitFor(
  () => u.get(`/api/requests/${no}`).then((r) => r.body), (b) => ['completed', 'service_down'].includes(b.status), timeoutMs);

describe.skipIf(!HAS_DB)('인식', () => {
  it('올리기 → 인식 → 완료 → 악보: 요청 번호 · 마감 · 서비스 키를 넘기고 결과를 볼륨 · DB 에 남긴다', async () => {
    fake.calls.length = 0;
    fake.on('post', '/v1/omr/staff', ok);
    const u = await loggedInAgent(app, 'w1');
    const no = await upload(u);
    const done = await finished(u, no);
    expect(done).toMatchObject({ status: 'completed', route: 'recognize', fallback: false, midi_available: true });
    const call = fake.calls.find((c) => c.path === 'POST /v1/omr/staff')!;
    expect(call).toMatchObject({ apiKey: 'test-service-key', fields: { request_no: no } });
    expect(new Date(call.deadline!).getTime()).toBeGreaterThan(Date.now());
    const score = await u.get(`/api/requests/${no}/score`);
    expect(score.status).toBe(200);
    expect(score.body.scoredoc.parts.length).toBeGreaterThan(0);
    expect(await db.one<{ musicxml_uri: string; midi_uri: string }>('SELECT musicxml_uri, midi_uri FROM v_current_result WHERE request_id = ?', [await h.requestIdOf(no)]))
      .toEqual({ musicxml_uri: `${no}/result.musicxml`, midi_uri: `${no}/result.mid` });
  });

  it('사진 여러 장은 올린 순서대로 보낸다', async () => {
    fake.calls.length = 0;
    fake.on('post', '/v1/omr/staff', ok);
    const u = await loggedInAgent(app, 'w2');
    const up = await u.post('/api/requests').field('score_type', 'staff')
      .attach('file', makePng(1000, 900), 'p1.png').attach('file', makePng(1000, 900), 'p2.png').attach('file', makePng(1000, 900), 'p3.png');
    await finished(u, up.body.id);
    expect(fake.calls.find((c) => c.path === 'POST /v1/omr/staff')!.files).toEqual(['p1.png', 'p2.png', 'p3.png']);
  });

  it('MIDI 변환에 실패한 결과는 MusicXML 만으로 완료', async () => {
    fake.on('post', '/v1/omr/staff', (_q, s) => { s.json(recognized({ midi_base64: null })); });
    const u = await loggedInAgent(app, 'w3');
    const no = await upload(u);
    expect(await finished(u, no)).toMatchObject({ status: 'completed', fallback: false, midi_available: false });
  });

  it('model-api 가 바쁘면(429) 안내한 시각에 다시 시도해 완료', async () => {
    let n = 0;
    fake.on('post', '/v1/omr/staff', (_q, s) => {
      if (n++ === 0) { s.status(429).json({ error: { code: 'BUSY', retry_after: new Date(Date.now() + 600).toISOString() } }); return; }
      s.json(recognized());
    });
    const u = await loggedInAgent(app, 'w4');
    const no = await upload(u);
    expect(await finished(u, no)).toMatchObject({ status: 'completed', fallback: false });
    expect(n).toBe(2);
  });
});

describe.skipIf(!HAS_DB)('대체 결과', () => {
  afterEach(async () => { await h.setSettings(BASE); });

  it.each([
    ['NO_SCORE_STRUCTURE', 'NO_SCORE_STRUCTURE'],
    ['UNTRUSTED_RESULT', 'UNTRUSTED_RESULT'],
    ['없는 코드', 'RECOGNITION_FAILED'],
  ])('model-api 가 대체(%s)라고 하면 웹 템플릿으로 완료', async (reason, code) => {
    fake.on('post', '/v1/omr/staff', (_q, s) => { s.json({ fallback: true, fallback_reason: reason, type_mismatch: false, musicxml: null, midi_base64: null }); });
    const u = await loggedInAgent(app, 'f1');
    const no = await upload(u);
    expect(await finished(u, no)).toMatchObject({ status: 'completed', route: 'fallback', fallback: true, fallback_reason: code });
    expect((await u.get(`/api/requests/${no}/score`)).body.scoredoc.parts.length).toBeGreaterThan(0);
  });

  it('model-api 500 은 ENGINE_DOWN, 4xx 는 RECOGNITION_FAILED', async () => {
    fake.on('post', '/v1/omr/staff', (_q, s) => { s.status(500).end(); });
    const u = await loggedInAgent(app, 'f2');
    expect((await finished(u, await upload(u))).fallback_reason).toBe('ENGINE_DOWN');
    fake.on('post', '/v1/omr/staff', (_q, s) => { s.status(422).json({ error: { code: 'VALIDATION_ERROR' } }); });
    expect((await finished(u, await upload(u))).fallback_reason).toBe('RECOGNITION_FAILED');
  });

  it('시간을 넘기면 TIMEOUT 으로 끝나고 늦게 온 결과는 버린다', async () => {
    await h.setSettings({ timeout_seconds: 1 });
    fake.on('post', '/v1/omr/staff', (_q, s) => { setTimeout(() => s.json(recognized()), 2000); });
    const u = await loggedInAgent(app, 'f3');
    const t0 = performance.now(); // WSL2 시계 보정에 흔들리지 않는 경과 시간
    const no = await upload(u);
    const st = await finished(u, no);
    expect(st.fallback_reason).toBe('TIMEOUT');
    expect(performance.now() - t0).toBeLessThan(6000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await db.one("SELECT 1 AS x FROM score_result WHERE request_id = ? AND origin = 'recognized'", [await h.requestIdOf(no)])).toBeNull();
  });

  it('처리할 파일이 없으면 마감까지 기다리지 않고 바로 대체', async () => {
    fake.on('post', '/v1/omr/staff', ok);
    await h.setSettings({ web_concurrency_share: 1 });
    // 앞 요청이 처리되는 동안 뒤 요청의 파일을 지운다
    fake.on('post', '/v1/omr/staff', (_q, s) => { setTimeout(() => s.json(recognized()), 500); });
    const u = await loggedInAgent(app, 'f4');
    await upload(u);
    const second = await upload(u);
    rmSync(join(process.env.STORAGE_DIR!, second, 'original.png'));
    const t0 = performance.now(); // WSL2 시계 보정에 흔들리지 않는 경과 시간
    expect((await finished(u, second)).fallback_reason).toBe('RECOGNITION_FAILED');
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('줄에서 대기 상한을 넘기면 인식하지 않고 TIMEOUT', async () => {
    // 앞 요청은 제한 30초로 자리를 차지하고, 뒤 요청만 제한 1초로 접수한다 (제한은 접수 때의 설정 판본을 따른다)
    await h.setSettings({ web_concurrency_share: 1 });
    fake.on('post', '/v1/omr/staff', (_q, s) => { setTimeout(() => s.json(recognized()), 2500); });
    const u = await loggedInAgent(app, 'f5');
    await h.setSettings({ timeout_seconds: 30 });
    const first = await upload(u);
    await h.setSettings({ timeout_seconds: 1 });
    const waiting = await upload(u);
    fake.calls.length = 0;
    const st = await finished(u, waiting);
    expect(st.fallback_reason).toBe('TIMEOUT');
    expect(fake.calls.filter((c) => c.fields.request_no === waiting)).toEqual([]);
    expect((await finished(u, first)).fallback).toBe(false); // 앞 요청은 그대로 끝나 자리가 빈다
  });
});

describe.skipIf(!HAS_DB)('악보 종류 확인', () => {
  afterEach(async () => { await h.setSettings(BASE); });

  /** 다른 종류 같다고 답하는 model-api — 처리 작업 행은 model-api 가 적는다 */
  const mismatchOnce = () => {
    fake.on('post', '/v1/omr/staff', (q, s) => {
      void (async () => {
        const id = await h.requestIdOf(String(q.body.request_no));
        await db.exec("INSERT INTO processing_job (request_id, confirmed_score_type, structure_verdict, validity_grade, type_mismatch) VALUES (?, 'staff', 'pass', 'trust', TRUE)", [id]);
        s.json(recognized({ type_mismatch: true, detected_type: 'jeongganbo' }));
      })();
    });
  };
  const asking = (u: Agent, no: string) => h.waitFor(() => u.get(`/api/requests/${no}`).then((r) => r.body), (b) => b.status === 'awaiting_type_answer');

  it('그대로 → 받아 둔 결과로 완료', async () => {
    mismatchOnce();
    const u = await loggedInAgent(app, 't1');
    const no = await upload(u);
    expect(await asking(u, no)).toMatchObject({ type_mismatch: true, detected_type: 'jeongganbo' });
    const r = await u.post(`/api/requests/${no}/type-confirmation`).send({ change_to: null });
    expect(r.body).toMatchObject({ status: 'completed', fallback: false });
  });

  it('바꾸기 → 고른 종류로 다시 인식해 완료, 다시 묻지 않고 마감도 새로 잰다', async () => {
    mismatchOnce();
    fake.calls.length = 0;
    fake.on('post', '/v1/omr/jeongganbo', (_q, s) => { s.json(recognized({ type_mismatch: true })); });
    const u = await loggedInAgent(app, 't2');
    const no = await upload(u);
    const before = await asking(u, no);
    // 서버 PC 시계가 수십 ms 뒤로 밀려도 비교가 틀리지 않을 만큼 기다린다 (#105 — 60ms 밀린 것을 봤다)
    await new Promise((r) => setTimeout(r, 300));
    const r = await u.post(`/api/requests/${no}/type-confirmation`).send({ change_to: 'jeongganbo' });
    expect(r.status).toBe(202);
    expect(new Date(r.body.deadline_at).getTime()).toBeGreaterThan(new Date(before.deadline_at).getTime());
    const done = await finished(u, no);
    expect(done).toMatchObject({ status: 'completed', score_type: 'jeongganbo', fallback: false });
    expect(fake.calls.filter((c) => c.path === 'POST /v1/omr/jeongganbo').length).toBe(1);
  });

  it('답이 없으면 마감에 고른 종류 결과로 끝낸다 (감시)', async () => {
    await h.setSettings({ timeout_seconds: 1 });
    mismatchOnce();
    const u = await loggedInAgent(app, 't3');
    const no = await upload(u);
    await asking(u, no);
    advanceMonotonic(60_000); // 1분이 흘렀다 (제한 1초 + 여유 15초를 넘김)
    const done = await finished(u, no);
    vi.restoreAllMocks();
    expect(done).toMatchObject({ status: 'completed', fallback: false });
  });
});

describe.skipIf(!HAS_DB)('시계가 뒤로 밀릴 때 (#105)', () => {
  it('처리 시작 시각이 대기 시작보다 앞서도 대체로 빠지지 않고 인식을 끝낸다', async () => {
    fake.on('post', '/v1/omr/staff', ok);
    worker.stopWorker();
    const u = await loggedInAgent(app, 'clock');
    const no = await upload(u);
    // 대기 시작이 현재보다 뒤에 찍힌 상태 = 그 사이 시계가 뒤로 밀렸다
    await db.exec("UPDATE stage_timing SET started_at = CURRENT_TIMESTAMP(3) + INTERVAL 5 SECOND WHERE request_id = ? AND stage_code = 'queue'", [await h.requestIdOf(no)]);
    await worker.startWorker();
    expect(await finished(u, no)).toMatchObject({ status: 'completed', route: 'recognize', fallback: false });
  });
});

describe.skipIf(!HAS_DB)('재시작 복구', () => {
  it('작업자가 멈춰 있던 동안의 요청을 다시 켜면 DB 에서 다시 줄 세워 끝낸다', async () => {
    fake.on('post', '/v1/omr/staff', ok);
    worker.stopWorker();
    const u = await loggedInAgent(app, 'r1');
    const queued = await upload(u);
    const converting = await upload(u);
    await db.exec("UPDATE score_request SET status = 'converting' WHERE request_id = ?", [await h.requestIdOf(converting)]);
    expect((await u.get(`/api/requests/${queued}`)).body.status).toBe('queued');
    await worker.startWorker();
    expect((await finished(u, queued)).status).toBe('completed');
    expect((await finished(u, converting)).status).toBe('completed');
  });

  it('감시: 마감을 넘긴 처리 중 요청은 대체로 끝낸다', async () => {
    fake.on('post', '/v1/omr/staff', ok);
    worker.stopWorker();
    const u = await loggedInAgent(app, 'r2');
    const no = await upload(u);
    advanceMonotonic(3_600_000); // 1시간이 흘렀다
    await worker.watchdogTick();
    vi.restoreAllMocks();
    expect((await u.get(`/api/requests/${no}`)).body).toMatchObject({ status: 'completed', fallback_reason: 'TIMEOUT' });
    await worker.startWorker();
  });
});

// #105 마감은 단조 시계로만 잰다 — 벽시계(Date.now)가 튀어도 마감 판단이 따라가지 않는다.
//   DB 가 잰 경과 시간은 그대로이고 Date.now 만 튀게 해서, 마감 계산에 벽시계가 섞이면 결과가 바뀌는지 본다.
describe.skipIf(!HAS_DB)('벽시계가 튀어도 마감은 그대로 (#105)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('감시: 벽시계가 1시간 앞으로 튀어도 아직 시간이 남은 요청을 끝내지 않는다', async () => {
    fake.on('post', '/v1/omr/staff', ok);
    worker.stopWorker();
    const u = await loggedInAgent(app, 'c1');
    const no = await upload(u);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000);
    await worker.watchdogTick();
    vi.restoreAllMocks();
    expect((await u.get(`/api/requests/${no}`)).body.status).toBe('queued');
    await worker.startWorker();
    expect((await finished(u, no)).status).toBe('completed');
  });

  it('감시: 벽시계가 1시간 뒤로 가도 마감을 넘긴 요청은 대체로 끝낸다', async () => {
    fake.on('post', '/v1/omr/staff', ok);
    worker.stopWorker();
    const u = await loggedInAgent(app, 'c2');
    const no = await upload(u);
    advanceMonotonic(3_600_000); // 1시간이 흘렀는데 벽시계는 오히려 1시간 뒤로 갔다
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 3_600_000);
    await worker.watchdogTick();
    vi.restoreAllMocks();
    expect((await u.get(`/api/requests/${no}`)).body).toMatchObject({ status: 'completed', fallback_reason: 'TIMEOUT' });
    await worker.startWorker();
  });

  it('처리: 벽시계가 마감(180초)보다 크게 튀어 있어도 정상 인식은 대체로 끝나지 않는다', async () => {
    fake.on('post', '/v1/omr/staff', ok);
    const u = await loggedInAgent(app, 'c3');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200_000);
    const no = await upload(u);
    const done = await finished(u, no);
    vi.restoreAllMocks();
    expect(done).toMatchObject({ status: 'completed', route: 'recognize', fallback: false });
  });

  it('처리: model-api 에 넘기는 마감(X-Deadline)은 지금부터 제한 시간 안이다', async () => {
    fake.calls.length = 0;
    fake.on('post', '/v1/omr/staff', ok);
    const u = await loggedInAgent(app, 'c4');
    const no = await upload(u);
    await finished(u, no);
    const left = new Date(fake.calls.at(-1)!.deadline!).getTime() - Date.now();
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(180_000);
  });
});

// 맨 끝에 둔다 — 가짜 model-api 를 닫는다
describe.skipIf(!HAS_DB)('모델 상태 · model-api 멈춤', () => {
  it('켜진 모델의 공개 항목만 보이고, 비밀 · 내부 값은 내보내지 않는다', async () => {
    fake.on('get', '/v1/models', (_q, s) => { s.json([
      { name: 'homr', display_name: '오선보', kind: 'omr_staff', provider: 'venv', enabled: true, installed: true, state: 'ready', expected_seconds: 5, error: 'x' },
      { name: 'off', display_name: '꺼짐', kind: 'recommend', provider: 'builtin', enabled: false, installed: true, state: 'ready', expected_seconds: null },
    ]); });
    const { modelStates } = await import('../../src/services/modelStatus.js');
    await modelStates(true);
    const u = await loggedInAgent(app, 'm1');
    const r = await u.get('/api/models/status');
    expect(r.status).toBe(200);
    expect(r.body.model_api).toBe('running');
    expect(r.body.models).toEqual([{ name: 'homr', display_name: '오선보', kind: 'omr_staff', provider: 'venv', state: 'ready', expected_seconds: 5 }]);
    expect((await request(app).get('/api/models/status')).status).toBe(401);
  });

  it('model-api 가 닿지 않으면 ENGINE_DOWN 대체, 모델 상태는 stopped', async () => {
    await fake.close();
    fake = { calls: [], on: () => undefined, close: async () => undefined };
    const u = await loggedInAgent(app, 'm2');
    const no = await upload(u);
    expect(await finished(u, no)).toMatchObject({ status: 'completed', fallback: true, fallback_reason: 'ENGINE_DOWN' });
    expect((await u.get(`/api/requests/${no}/score`)).status).toBe(200);
    const { modelStates } = await import('../../src/services/modelStatus.js');
    await modelStates(true);
    expect((await u.get('/api/models/status')).body).toMatchObject({ model_api: 'stopped', models: [] });
  });
});
