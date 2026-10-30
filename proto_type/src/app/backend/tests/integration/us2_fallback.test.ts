// T070 (US2, SC-001·SC-003): 모델 API 멈춤·시간 초과·사용자 요청 대체·늦게 온 결과 버리기
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makePng, makeMidi } from '../helpers/files.js';
import { waitFor, one, setSettings } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { startWorker } from '../../src/services/requestWorker.js';
import { closePool } from '../../src/db/pool.js';

let fake: FakeModelApi;
const app = serve(createWebApp());
const ok = (_req: unknown, res: { json: (b: unknown) => void }) => res.json({
  fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false, detected_type: null, validity_grade: 'trust',
  musicxml: SAMPLE_MUSICXML, midi_base64: makeMidi().toString('base64'), engine: { name: 'homr', version: 't' } });

beforeAll(async () => { fake = await startFakeModelApi(); await startWorker(); });
afterAll(async () => { await fake.close().catch(() => {}); await closePool(); });

async function upload(agent: ReturnType<typeof request.agent>) {
  const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png');
  expect(up.status).toBe(202);
  return up.body.id as string;
}

describe('US2 fallback', () => {
  it('uses the web template when recognition says the structure is missing', async () => {
    fake.on('post', '/v1/omr/staff', (_q, s) => s.json({ fallback: true, fallback_reason: 'NO_SCORE_STRUCTURE', structure_verdict: 'fail',
      type_mismatch: false, validity_grade: null, musicxml: null, midi_base64: null }));
    const agent = (await loggedInAgent(app));
    const id = await upload(agent);
    const st = await waitFor(() => agent.get(`/api/requests/${id}`).then((r) => r.body), (b) => b.status === 'completed');
    expect(st.fallback).toBe(true);
    expect(st.fallback_reason).toBe('NO_SCORE_STRUCTURE');
    expect(st.retry_hint).toContain('다시 올려');
    const score = await agent.get(`/api/requests/${id}/score`);
    expect(score.body.scoredoc.parts.length).toBeGreaterThan(0); // 굿거리 템플릿
  });

  it('falls back with TIMEOUT within timeout + 10s and discards the late result', async () => {
    await setSettings({ timeout_seconds: 2 });
    fake.on('post', '/v1/omr/staff', async (req, res) => { await new Promise((r) => setTimeout(r, 4000)); ok(req, res); });
    const agent = (await loggedInAgent(app));
    const t0 = Date.now();
    const id = await upload(agent);
    const st = await waitFor(() => agent.get(`/api/requests/${id}`).then((r) => r.body), (b) => b.status === 'completed', 15000);
    expect(Date.now() - t0).toBeLessThan(2000 + 10000);
    expect(st.fallback_reason).toBe('TIMEOUT');
    await new Promise((r) => setTimeout(r, 3000));
    const late = await one("SELECT 1 FROM score_result sr JOIN score_request r ON r.request_id = sr.request_id WHERE r.request_no = ? AND sr.origin = 'recognized'", [id]);
    expect(late).toBeNull();
    await setSettings({ timeout_seconds: 180 });
  });

  it('switches a completed result to the template on user request', async () => {
    fake.on('post', '/v1/omr/staff', ok);
    const agent = (await loggedInAgent(app));
    const id = await upload(agent);
    await waitFor(() => agent.get(`/api/requests/${id}`).then((r) => r.body), (b) => b.status === 'completed');
    const fb = await agent.post(`/api/requests/${id}/fallback`);
    expect(fb.body.route).toBe('fallback');
    expect(fb.body.fallback_reason).toBe('USER_REQUEST');
  });

  it('returns ENGINE_DOWN when the model API is unreachable', async () => {
    await fake.close();
    const agent = (await loggedInAgent(app));
    const id = await upload(agent);
    const st = await waitFor(() => agent.get(`/api/requests/${id}`).then((r) => r.body), (b) => b.status === 'completed');
    expect(st.fallback_reason).toBe('ENGINE_DOWN');
    // MIDI 받기는 모델 API 없이도 된다(FR-042)
    expect((await agent.get(`/api/requests/${id}/original/midi`)).status).toBe(200);
  });
});
