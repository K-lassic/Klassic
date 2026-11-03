// #91 API 안내 · 외부 키 신청 통합 시험 — 실제 MariaDB 필요 (TEST_DB_HOST 가 있을 때만 돈다).
//   model-api 는 가짜 서버로 둔다. 외부 키를 실제 model-api 가 받는지는 서버 PC 시험에서 확인한다.
import { HAS_DB } from '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import request from 'supertest';
import type { Server } from 'node:http';
import type { FakeModelApi } from '../helpers/fakeModelApi.js';

let app: Server;
let fake: FakeModelApi;
let db: typeof import('../../src/db/pool.js');
let h: typeof import('../helpers/db.js');
let loggedInAgent: typeof import('../helpers/auth.js').loggedInAgent;
let n = 0;

beforeAll(async () => {
  if (!HAS_DB) return;
  const { serve } = await import('../helpers/serve.js');
  const { createWebApp } = await import('../../src/app.js');
  const { startFakeModelApi } = await import('../helpers/fakeModelApi.js');
  db = await import('../../src/db/pool.js');
  h = await import('../helpers/db.js');
  ({ loggedInAgent } = await import('../helpers/auth.js'));
  app = serve(createWebApp());
  fake = await startFakeModelApi();
  // 시험은 한 주소에서 오므로, 빈도 시험 앞까지는 G11 에 걸리지 않게 한다
  await h.setSettings({ apply_rate_limit_count: 100000 });
});
afterAll(async () => { if (HAS_DB) { await fake.close(); await db.closePool(); } });

const form = (over: Record<string, unknown> = {}) => ({
  name: '시험', organization: '시험 소속', contact_email: `key-${process.pid}-${Date.now()}-${n++}@test.kr`, purpose: '시험', consent: true, ...over,
});

describe.skipIf(!HAS_DB)('외부 키 신청 (#91)', () => {
  it('로그인 없이는 401', async () => {
    expect((await request(app).post('/api/key-applications').send(form())).status).toBe(401);
  });

  it('필수 항목 누락 · 동의 없음은 반려되고 키를 만들지 않는다', async () => {
    const u = await loggedInAgent(app, 'key');
    const missing = await u.post('/api/key-applications').send(form({ purpose: ' ' }));
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe('APPLICATION_MISSING_FIELD');
    const noConsent = await u.post('/api/key-applications').send(form({ consent: false }));
    expect(noConsent.status).toBe(422);
    expect(noConsent.body.error.code).toBe('APPLICATION_CONSENT_REQUIRED');
  });

  it('발급: 원문은 응답에만 있고 DB 에는 해시와 신청 기록이 남는다', async () => {
    const u = await loggedInAgent(app, 'key');
    const body = form();
    const r = await u.post('/api/key-applications').send(body);
    expect(r.status).toBe(201);
    expect(r.body.application_no).toMatch(/^A-[A-Z2-9]{10}$/);
    expect(r.body.api_key).toMatch(/^gk_[A-Za-z0-9]{43}$/);
    const k = await db.one<{ key_id: number; key_kind: string; key_hash: string; key_prefix: string; status: string; call_limit_per_hour: number; issued_by: number | null }>(
      'SELECT * FROM access_key WHERE application_no = ?', [r.body.application_no]);
    expect(k).toMatchObject({ key_kind: 'external', status: 'active', issued_by: null, key_prefix: r.body.api_key.slice(0, 8) });
    expect(k!.key_hash).toBe(createHash('sha256').update(r.body.api_key).digest('hex'));
    expect(k!.call_limit_per_hour).toBe(r.body.call_limit_per_hour);
    const a = await db.one<{ contact_email: string; account_id: number }>('SELECT contact_email, account_id FROM key_application WHERE key_id = ?', [k!.key_id]);
    expect(a).toMatchObject({ contact_email: body.contact_email, account_id: u.accountId });
  });

  it('같은 메일로 신청 한도를 넘으면 429 + 다시 시도할 시각 (G11)', async () => {
    await h.setSettings({ apply_rate_limit_count: 1 });
    const u = await loggedInAgent(app, 'key');
    const last = await u.post('/api/key-applications').send(form());
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('APPLICATION_RATE_LIMITED');
    expect(last.body.error.retry_after).toBeTruthy();
  });
});

describe.skipIf(!HAS_DB)('API 안내 (#91)', () => {
  const spec = {
    paths: {
      '/v1/performances/{request_no}': { get: { summary: '상태', responses: { 200: { description: '성공' } } } },
      '/v1/performances': { post: { summary: '연주', requestBody: { content: { 'multipart/form-data': {} } }, responses: {} } },
      '/v1/omr/staff': { post: { summary: '인식', requestBody: { content: { 'multipart/form-data': {} } }, responses: {} } },
      '/v1/internal/upload-check': { post: { summary: '내부', responses: {} } },
    },
  };

  it('명세를 읽어 목록을 만들고 내부 경로는 뺀다 · 로그인 없이 열린다', async () => {
    fake.on('get', '/v1/health', (_q, s) => { s.json({ api_version: 'v1' }); });
    fake.on('get', '/v1/versions', (_q, s) => { s.json({ api_version: 'v1', engines: [{ name: 'homr', version: '0.7.0' }] }); });
    fake.on('get', '/v1/openapi.json', (_q, s) => { s.json(spec); });
    const r = await request(app).get('/api/api-docs');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ server_status: 'running', spec_source: 'live', api_version: 'v1' });
    const paths = r.body.endpoints.map((e: { path: string }) => e.path);
    expect(paths).toContain('/v1/performances');
    expect(paths).not.toContain('/v1/internal/upload-check');
    const example = (p: string) => r.body.endpoints.find((e: { path: string }) => e.path === p).example as string;
    expect(example('/v1/performances/{request_no}')).toContain('/v1/performances/R-0928-XXXXXXXX');
    expect(example('/v1/performances')).toContain('score=@');
    expect(example('/v1/omr/staff')).toContain('image=@');
  });

  it('서버가 멈추면 마지막 확인본을 보인다', async () => {
    fake.on('get', '/v1/health', (_q, s) => { s.status(500).json({}); });
    const r = await request(app).get('/api/api-docs');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ server_status: 'stopped', spec_source: 'last_known' });
    expect(r.body.endpoints.length).toBeGreaterThan(0);
  });
});
