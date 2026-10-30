// T054 (US1): 오선보 이미지 올리기 → 상태 폴링 → 완료 → 악보·편집 전 MusicXML·MIDI 받기 (모델 API 는 가짜)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makePng, makeMidi } from '../helpers/files.js';
import { waitFor, one } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { startWorker } from '../../src/services/requestWorker.js';
import { closePool } from '../../src/db/pool.js';

let fake: FakeModelApi;
const app = serve(createWebApp());

beforeAll(async () => {
  fake = await startFakeModelApi();
  fake.on('post', '/v1/omr/staff', (_req, res) => {
    res.json({ api_version: 'v1', fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false,
      detected_type: null, validity_grade: 'trust', musicxml: SAMPLE_MUSICXML, midi_base64: makeMidi().toString('base64'),
      engine: { name: 'homr', version: '0.test' } });
  });
  await startWorker();
});
afterAll(async () => { await fake.close(); await closePool(); });

describe('US1 upload → result', () => {
  it('converts an image and serves the score and original downloads', async () => {
    const agent = (await loggedInAgent(app));
    const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'score.png');
    expect(up.status).toBe(202);
    expect(up.body.id).toMatch(/^R-\d{4}-[A-Z2-9]{8}$/);
    expect(['received', 'queued', 'converting']).toContain(up.body.status);

    const done = await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
    expect(done.route).toBe('recognize');
    expect(done.result_band).toBe('trust');
    // 모델 API 에 요청 번호와 마감 시각이 함께 갔다
    const call = fake.calls.find((c) => c.path === 'POST /v1/omr/staff')!;
    expect(call.fields.request_no).toBe(up.body.id);

    const score = await agent.get(`/api/requests/${up.body.id}/score`);
    expect(score.status).toBe(200);
    expect(score.body.scoredoc.parts.length).toBeGreaterThan(0);
    const xml = await agent.get(`/api/requests/${up.body.id}/original/musicxml`);
    expect(xml.status).toBe(200);
    const mid = await agent.get(`/api/requests/${up.body.id}/original/midi`);
    expect(mid.status).toBe(200);
    const ev = await one<{ n: number }>('SELECT COUNT(*) AS n FROM download_event d JOIN score_request r ON r.request_id = d.request_id WHERE r.request_no = ?', [up.body.id]);
    expect(Number(ev!.n)).toBe(2);
  });

  it('hides a request from another session (ownership)', async () => {
    const a = (await loggedInAgent(app));
    const up = await a.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 's.png');
    const other = (await loggedInAgent(app));
    const r = await other.get(`/api/requests/${up.body.id}`);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('REQUEST_NOT_FOUND');
  });
});
