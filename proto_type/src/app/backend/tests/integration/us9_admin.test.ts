// T093·T100 (US9): 내부망 밖 403 · 비밀번호 틀림 401 · 5회 실패 잠금 423 · 설정 변경은 다음 요청부터 · G6 · 변경 이력
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import argon2 from 'argon2';
import { startFakeModelApi, type FakeModelApi } from '../helpers/fakeModelApi.js';
import { makePng } from '../helpers/files.js';
import { exec, one } from '../helpers/db.js';
import { createAdminApp, createWebApp } from '../../src/server.js';
import { ipAllowed } from '../../src/admin/networkGuard.js';
import { closePool } from '../../src/db/pool.js';
import { invalidateSettings } from '../../src/config/settings.js';

let fake: FakeModelApi;
const admin = serve(createAdminApp());
const web = serve(createWebApp());
const PW = 'correct-horse-battery';

beforeAll(async () => {
  fake = await startFakeModelApi();
  fake.on('post', '/v1/internal/settings/reload', (_q, s) => s.json({ settings_version: 0 }));
  fake.on('post', '/v1/omr/staff', (_q, s) => s.status(503).end());
  await exec("INSERT IGNORE INTO operator_account (login_id, password_hash, display_name) VALUES ('ops1', ?, '운영자1'), ('ops2', ?, '운영자2')",
    [await argon2.hash(PW, { type: argon2.argon2id }), await argon2.hash(PW, { type: argon2.argon2id })]);
});
afterAll(async () => { await fake.close(); await closePool(); });

async function login(id = 'ops1') {
  const agent = request.agent(admin);
  const r = await agent.post('/admin/login').timeout(10000).send({ login_id: id, password: PW });
  expect(r.status).toBe(200);
  return agent;
}

describe('US9 admin auth', () => {
  it('CIDR check', () => {
    expect(ipAllowed('127.0.0.1', '127.0.0.1/32')).toBe(true);
    expect(ipAllowed('::ffff:127.0.0.1', '127.0.0.1/32')).toBe(true);
    expect(ipAllowed('10.0.0.5', '127.0.0.1/32,192.168.0.0/16')).toBe(false);
    expect(ipAllowed('192.168.3.4', '192.168.0.0/16')).toBe(true);
    expect(ipAllowed('::1', '::1/128')).toBe(true);
  });

  it('requires login, rejects wrong password, locks after 5 failures', async () => {
    expect((await request(admin).get('/admin/metrics')).body.error.code).toBe('ADMIN_LOGIN_REQUIRED');
    const bad = await request(admin).post('/admin/login').send({ login_id: 'ops2', password: 'nope' });
    expect(bad.status).toBe(401);
    for (let i = 0; i < 3; i++) await request(admin).post('/admin/login').send({ login_id: 'ops2', password: 'nope' });
    const locked = await request(admin).post('/admin/login').send({ login_id: 'ops2', password: 'nope' });
    expect(locked.status).toBe(423);
    expect(locked.body.error.retry_after).toBeTruthy();
    const stillLocked = await request(admin).post('/admin/login').send({ login_id: 'ops2', password: PW });
    expect(stillLocked.status).toBe(423);
    const me = await (await login()).get('/admin/me');
    expect(me.body.login_id_masked).toBe('ops**');
  });
});

describe('US9 settings', () => {
  it('stamps new requests with the new setting version and records history', async () => {
    const agent = await login();
    const before = await agent.get('/admin/settings');
    const put = await agent.put('/admin/settings').send({ timeout_seconds: 240 });
    expect(put.status).toBe(200);
    expect(put.body.timeout_seconds).toBe(240);
    expect(put.body.setting_version_id).toBeGreaterThan(before.body.setting_version_id);
    expect(put.body.api_apply_status).toBe('applied');
    // 다른 값은 이전 판본에서 복사됐다(Q4)
    expect(put.body.engine_order.staff).toEqual(before.body.engine_order.staff);
    const up = await (await loggedInAgent(web)).post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png');
    const r = await one<{ setting_version_id: number }>('SELECT setting_version_id FROM score_request WHERE request_no = ?', [up.body.id]);
    expect(r!.setting_version_id).toBe(put.body.setting_version_id);
    const audit = await agent.get('/admin/audit');
    expect(audit.body.items.some((h: any) => h.field_name === 'timeout_seconds' && h.after_value === '240')).toBe(true);
  });

  it('G6 rejects invalid values and unknown engines', async () => {
    const agent = await login();
    const a = await agent.put('/admin/settings').timeout(10000).send({ timeout_seconds: 0 });
    expect(a.status).toBe(422);
    expect(a.body.error).toMatchObject({ code: 'SETTINGS_INVALID_VALUE', gate: 'G6', details: { field: 'timeout_seconds' } });
    const b = await agent.put('/admin/settings').timeout(10000).send({ grade_caution_boundary: 0.3, grade_distrust_boundary: 0.5 });
    expect(b.body.error.details.field).toBe('grade_distrust_boundary');
    const c = await agent.put('/admin/settings').timeout(10000).send({ engine_order: { staff: ['nope'] } });
    expect(c.body.error.code).toBe('SETTINGS_UNKNOWN_ENGINE');
    const d = await agent.put('/admin/settings').timeout(10000).send({ engine_order: { recommend: ['rules', 'llm-gemma3-4b'] } });
    expect(d.body.error.details.reason).toBe('builtin_last');
  });

  it('marks unapplied when the model API is down', async () => {
    const agent = await login();
    fake.on('post', '/v1/internal/settings/reload', (_q, s) => s.status(503).end());
    const put = await agent.put('/admin/settings').send({ timeout_seconds: 180 });
    expect(put.body.api_apply_status).toBe('unapplied');
    invalidateSettings();
  });

  it('serves metrics and job log', async () => {
    const agent = await login();
    const m = await agent.get('/admin/metrics');
    expect(m.body.scopes.all).toHaveProperty('first_pass_rate');
    const jobs = await agent.get('/admin/jobs?limit=5');
    expect(Array.isArray(jobs.body.items)).toBe(true);
    if (jobs.body.items[0]) {
      const d = await agent.get(`/admin/jobs/${jobs.body.items[0].request_no}`);
      expect(d.body).toHaveProperty('stage_timings');
    }
  });
});
