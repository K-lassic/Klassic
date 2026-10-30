// 예시 악보 — 서버 전용 폴더 · 예시 id 로 접수 (2026-09-30 황송해 70~73, SD_02 ㊹ · UC_01 기본흐름 1 · SD_01 1.1)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { startFakeModelApi, SAMPLE_MUSICXML, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makeMidi } from '../helpers/files.js';
import { one, waitFor } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';
import { startWorker } from '../../src/services/requestWorker.js';
import { EXAMPLES_DIR, exampleList } from '../../src/web/examples.js';

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

describe('예시 악보 (72번 서버 전용 폴더)', () => {
  it('목록 순서 · 파일은 모두 서버 전용 폴더에 있다 · 전 아리랑 예시는 없다', () => {
    const ids = exampleList().map((e) => e.id);
    expect(ids).toEqual(['arirang-semachi-staff', 'arirang-98-staff', 'minuet-staff', 'taryeong-gayageum-jeongganbo']); // 2026-09-30 도라지 예시 뺌
    for (const e of exampleList()) {
      expect(existsSync(resolve(EXAMPLES_DIR, e.file))).toBe(true);
      expect(existsSync(resolve(EXAMPLES_DIR, 'thumbs', `${e.id}.jpg`))).toBe(true);
    }
    expect(existsSync(resolve(EXAMPLES_DIR, 'arirang-staff.png'))).toBe(false);
  });

  it('방문자는 목록 · 미리보기를 볼 수 없다(로그인 사용자 UC1)', async () => {
    const guest = request(app);
    expect((await guest.get('/api/examples')).status).toBe(401);
    expect((await guest.get('/api/examples/minuet-staff/thumb')).status).toBe(401);
    expect((await guest.post('/api/requests/example').send({ example_id: 'minuet-staff' })).status).toBe(401);
  });

  it('목록 · 미리보기 · 목록 밖 id 와 경로 문자는 404', async () => {
    const u = await loggedInAgent(app, 'ex-list');
    const list = await u.get('/api/examples');
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toEqual({ id: 'arirang-semachi-staff', title: '아리랑 세마치 (오선보)', score_type: 'staff' });
    expect(JSON.stringify(list.body)).not.toMatch(/\.(png|jpe?g|pdf)/);
    const th = await u.get('/api/examples/minuet-staff/thumb');
    expect(th.status).toBe(200);
    expect(th.headers['content-type']).toMatch(/image\/jpeg/);
    expect((await u.get('/api/examples/nothing/thumb')).status).toBe(404);
    for (const bad of ['../examples.json', '..%2Fexamples.json', 'SOURCES.md', 'arirang-staff', '타령_2021 거문고정악보.pdf', '', null]) {
      const r = await u.post('/api/requests/example').send({ example_id: bad });
      expect(r.status, String(bad)).toBe(404);
    }
    expect((await u.get('/api/examples/..%2F..%2Fexamples.json/thumb')).status).toBe(404);
  });

  it('예시 id 로 올리면 서버가 그 파일로 접수한다(보통 올리기와 같은 흐름)', async () => {
    const u = await loggedInAgent(app, 'ex-up');
    const up = await u.post('/api/requests/example').send({ example_id: 'arirang-semachi-staff' });
    expect(up.status).toBe(202);
    expect(up.body.score_type).toBe('staff');
    const f = await one<{ original_name: string; size_bytes: number }>(
      'SELECT u.original_name, u.size_bytes FROM upload_file u JOIN score_request r USING (request_id) WHERE r.request_no = ?', [up.body.id]);
    expect(f?.original_name).toBe('arirang-semachi-staff.png');
    expect(Number(f?.size_bytes)).toBeGreaterThan(1000);
    const done = await waitFor(() => u.get(`/api/requests/${up.body.id}`).then((r) => r.body), (b) => b.status === 'completed');
    expect(done.fallback).toBe(false);
  });
});
