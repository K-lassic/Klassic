// (2026-09-30 황송해 161번 — T164 결정 변경) 편집 기록의 set_tempo 가 편집 반영 받기(MIDI · MusicXML)에 들어간다
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Midi } from '@tonejs/midi';
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

describe('set_tempo 받기', () => {
  it('1.5배(150 BPM) → MIDI 템포 150 · MusicXML <sound tempo="150">', async () => {
    const u = await loggedInAgent(app, 'tempo');
    const up = await u.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 't.png');
    await waitFor(() => u.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
    const ops = [{ op: 'set_tempo', bpm: 150 }];
    const get = async (format: string) => {
      const t = await u.post(`/api/requests/${up.body.id}/exports`).send({ format, edit_ops: ops });
      expect(t.status).toBe(202);
      const f = await u.get(`/api/requests/${up.body.id}/exports/${t.body.id}/file`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      return f.body as Buffer;
    };
    const midi = new Midi(await get('midi'));
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(150);
    expect((await get('musicxml')).toString('utf8')).toContain('<sound tempo="150"/>');
  });
});
