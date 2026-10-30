// (2026-09-30 황송해 74번) RequestStatus.midi_available — MIDI 가 없는 결과(MIDI 안전 변환 실패)면 false, 원본 MIDI 받기는 409
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi, makePng } from '../helpers/files.js';
import { waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';
import { startWorker } from '../../src/services/requestWorker.js';

let fake: FakeModelApi;
const app = serve(createWebApp());
const ok = (midi: boolean) => ({ api_version: 'v1', fallback: false, fallback_reason: null, structure_verdict: 'pass', type_mismatch: false,
  detected_type: null, validity_grade: 'trust', musicxml: SAMPLE_MUSICXML, midi_base64: midi ? makeMidi().toString('base64') : null,
  midi_available: midi, engine: { name: 'homr', version: '0.test' } });

beforeAll(async () => {
  fake = await startFakeModelApi();
  fake.on('post', '/v1/omr/staff', (_req, res) => { res.json(ok(true)); });
  fake.on('post', '/v1/omr/jeongganbo', (_req, res) => { res.json(ok(false)); });
  await startWorker();
});
afterAll(async () => { await fake.close(); await closePool(); });

describe('RequestStatus.midi_available (74번)', () => {
  it('MIDI 가 있으면 true · 없으면 false 이고 원본 MIDI 받기는 409 MIDI_UNAVAILABLE', async () => {
    const u = await loggedInAgent(app, 'midi-av');
    for (const [type, want] of [['staff', true], ['jeongganbo', false]] as const) {
      const up = await u.post('/api/requests').field('score_type', type).attach('file', makePng(1000, 900), 'p.png');
      expect(up.status).toBe(202);
      expect(up.body.midi_available).toBeNull();
      const done = await waitFor(() => u.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
      expect(done.midi_available).toBe(want);
      const mid = await u.get(`/api/requests/${up.body.id}/original/midi`);
      expect(mid.status).toBe(want ? 200 : 409);
    }
  });
});
