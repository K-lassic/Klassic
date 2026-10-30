// (2026-09-30 황송해 130번) RequestStatus.validity_items — 모델 API 가 적은 타당성 점검 항목 값을 1단계 판별 사유에 쓴다
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi, makePng } from '../helpers/files.js';
import { exec, one, waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';
import { startWorker } from '../../src/services/requestWorker.js';

let fake: FakeModelApi;
const app = serve(createWebApp());
beforeAll(async () => {
  fake = await startFakeModelApi();
  fake.on('post', '/v1/omr/staff', (_req, res) => {
    res.json({ api_version: 'v1', fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false,
      detected_type: null, validity_grade: 'caution', musicxml: SAMPLE_MUSICXML, midi_base64: makeMidi().toString('base64'),
      engine: { name: 'homr', version: '0.test' } });
  });
  await startWorker();
});
afterAll(async () => { await fake.close(); await closePool(); });

describe('RequestStatus.validity_items (130번)', () => {
  it('점검 항목이 없으면 null, 있으면 항목 값', async () => {
    const u = await loggedInAgent(app, 'validity');
    const up = await u.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'p.png');
    const done = await waitFor(() => u.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
    expect(done.validity_items).toBeNull();
    const r = await one<{ request_id: number }>('SELECT request_id FROM score_request WHERE request_no = ?', [up.body.id]);
    await exec("INSERT IGNORE INTO processing_job (request_id, confirmed_score_type, structure_verdict, validity_grade) VALUES (?, 'staff', 'pass', 'caution')", [r!.request_id]);
    await exec("INSERT INTO validity_check_item (request_id, item_code, measured_value) VALUES (?, 'note_count', 12), (?, 'beat_sum', 0.6875)",
      [r!.request_id, r!.request_id]);
    const again = await u.get(`/api/requests/${up.body.id}`);
    expect(again.body.validity_items).toEqual({ note_count: 12, beat_sum: 0.6875 });
  });
});
