// 이 악보로 작업하기 (2026-09-30 황송해 109번 — UC18 기본흐름 5 · A5 · BR-SHR-07 · SD_01 9.8)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi, makePng } from '../helpers/files.js';
import { one, waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';
import { startWorker } from '../../src/services/requestWorker.js';

let fake: FakeModelApi;
let omrCalls = 0;
const app = serve(createWebApp());

beforeAll(async () => {
  fake = await startFakeModelApi();
  fake.on('post', '/v1/omr/staff', (_req, res) => {
    omrCalls++;
    res.json({ api_version: 'v1', fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false,
      detected_type: null, validity_grade: 'trust', musicxml: SAMPLE_MUSICXML, midi_base64: makeMidi().toString('base64'),
      engine: { name: 'homr', version: '0.test' } });
  });
  await startWorker();
});
afterAll(async () => { await fake.close(); await closePool(); });

describe('UC18 기본흐름 5 — 이 악보로 작업하기', () => {
  it('공유 복사본으로 내 새 요청(인식 없음 · 바로 완료 · 공유자 정보 없음) · 거두면 404', async () => {
    const owner = await loggedInAgent(app, 'use-owner');
    const other = await loggedInAgent(app, 'use-other');
    const up = await owner.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'song.png');
    await waitFor(() => owner.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
    const sh = await owner.put(`/api/requests/${up.body.id}/share`).send({ title: '작업 시험' });
    const shareNo = String(sh.body.share_no);
    const before = omrCalls;

    expect((await request(app).post(`/api/shared-scores/${shareNo}/use`)).status).toBe(401);
    const use = await other.post(`/api/shared-scores/${shareNo}/use`);
    expect(use.status).toBe(202);
    expect(use.body).toMatchObject({ status: 'completed', route: 'direct', file_kind: 'musicxml', from_shared: true });
    expect(use.body.id).not.toBe(up.body.id);
    expect(JSON.stringify(use.body)).not.toContain(String(up.body.id));
    expect(JSON.stringify(use.body)).not.toContain(shareNo);
    expect(omrCalls).toBe(before); // 인식을 다시 하지 않는다
    const score = await other.get(`/api/requests/${use.body.id}/score`);
    expect(score.status).toBe(200);
    expect(score.body.musicxml).toContain('score-partwise');
    // 새 요청은 쓴 사람 것 — 공유자는 볼 수 없다
    expect((await owner.get(`/api/requests/${use.body.id}`)).status).toBe(404);
    const row = await one<{ from_share_id: number | null }>('SELECT from_share_id FROM score_request WHERE request_no = ?', [use.body.id]);
    expect(row?.from_share_id).not.toBeNull();

    await owner.delete(`/api/requests/${up.body.id}/share`);
    expect((await other.post(`/api/shared-scores/${shareNo}/use`)).status).toBe(404);
  });
});
