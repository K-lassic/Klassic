// T134·T136: 24시간 결과물 삭제 · FR-063 식별값 삭제(기록 행은 남김) · SD_03 §15-4 점검 쿼리가 모두 실행된다
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi, makePng } from '../helpers/files.js';
import { exec, one, waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { purgeResults } from '../../src/services/jobs/purgeResults.js';
import { purgeIdentity } from '../../src/services/jobs/purgeIdentity.js';
import { runChecks } from '../../src/services/jobs/index.js';
import { closePool } from '../../src/db/pool.js';
import { startWorker } from '../../src/services/requestWorker.js';

const app = serve(createWebApp());
let fake: FakeModelApi;
// 웹은 사진만 받으므로(2026-09-29) 완료된 요청을 사진 → 가짜 인식 결과로 만든다
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

describe('periodic jobs', () => {
  it('expires results after 24h and purges identity but keeps the record', async () => {
    const agent = (await loggedInAgent(app));
    const up = await agent.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'old.png');
    await waitFor(() => agent.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
    await exec('UPDATE score_request SET received_at = received_at - INTERVAL 25 HOUR, completed_at = completed_at - INTERVAL 25 HOUR WHERE request_no = ?', [up.body.id]);
    const expired = await agent.get(`/api/requests/${up.body.id}/score`);
    expect(expired.status).toBe(410);
    expect(expired.body.error.code).toBe('RESULT_EXPIRED');
    await purgeResults();
    await purgeIdentity();
    const r = await one<Record<string, unknown>>('SELECT session_id, client_addr_hash, identity_purged_at, purged_at, status FROM score_request WHERE request_no = ?', [up.body.id]);
    expect(r).toMatchObject({ session_id: null, client_addr_hash: null, status: 'completed' });
    expect(r!.identity_purged_at).not.toBeNull();
    expect(r!.purged_at).not.toBeNull();
    const res = await one<{ deleted_at: Date | null }>('SELECT sr.deleted_at FROM score_result sr JOIN score_request q ON q.request_id = sr.request_id WHERE q.request_no = ?', [up.body.id]);
    expect(res!.deleted_at).not.toBeNull();
  });

  it('runs all SD_03 check queries', async () => {
    const out = await runChecks();
    expect(Object.keys(out).sort()).toEqual(['P1', 'P2', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9']);
    expect(out.Q5).toBe(0);
    expect(out.Q7).toBe(0);
  });
});
