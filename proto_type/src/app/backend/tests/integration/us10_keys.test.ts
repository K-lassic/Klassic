// T110 (US10): 신청 필수 항목·동의·빈도 제한·키 한 번만·해시만 저장·신청 없는 키 없음 / 운영자 폐기·한도·보관 처리
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { exec, one, query } from '../helpers/db.js';
import { createWebApp, createAdminApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';

const web = serve(createWebApp());
const admin = serve(createAdminApp());
const form = (email: string) => ({ name: '김개발', organization: '국악 교육 앱', contact_email: email, purpose: '연주 API 시험', consent: true });

beforeAll(async () => {
  await exec("INSERT IGNORE INTO operator_account (login_id, password_hash, display_name) VALUES ('keyops', ?, '키 운영자')",
    [await argon2.hash('keyops-password-123', { type: argon2.argon2id })]);
});
afterAll(async () => { await closePool(); });

describe('US10 key applications', () => {
  it('validates fields and consent', async () => {
    const a = await (await loggedInAgent(web)).post('/api/key-applications').send({ ...form('a@x.kr'), purpose: '' });
    expect(a.status).toBe(422);
    expect(a.body.error).toMatchObject({ code: 'APPLICATION_MISSING_FIELD', gate: 'G10' });
    expect(a.body.error.details.fields).toContain('purpose');
    const b = await (await loggedInAgent(web)).post('/api/key-applications').send({ ...form('a@x.kr'), consent: false });
    expect(b.body.error.code).toBe('APPLICATION_CONSENT_REQUIRED');
  });

  it('issues a key once, stores only the hash, and rate-limits repeats', async () => {
    const r = await (await loggedInAgent(web)).post('/api/key-applications').send(form('dev@x.kr'));
    expect(r.status).toBe(201);
    expect(r.body.api_key).toMatch(/^gk_[A-Za-z0-9]{43}$/);
    expect(r.body.key_prefix).toBe(r.body.api_key.slice(0, 8));
    const row = await one<{ key_hash: string }>('SELECT key_hash FROM access_key WHERE application_no = ?', [r.body.application_no]);
    expect(row!.key_hash).toBe(createHash('sha256').update(r.body.api_key).digest('hex'));
    const leaked = await query("SELECT * FROM access_key WHERE key_hash = ? OR key_prefix = ?", [r.body.api_key, r.body.api_key]);
    expect(leaked.length).toBe(0);
    await (await loggedInAgent(web)).post('/api/key-applications').send(form('dev@x.kr'));
    await (await loggedInAgent(web)).post('/api/key-applications').send(form('dev@x.kr'));
    const fourth = await (await loggedInAgent(web)).post('/api/key-applications').send(form('dev@x.kr'));
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('APPLICATION_RATE_LIMITED');
    expect(fourth.body.error.retry_after).toBeTruthy();
    const orphans = await query("SELECT k.key_id FROM access_key k WHERE k.key_kind = 'external' AND NOT EXISTS (SELECT 1 FROM key_application a WHERE a.key_id = k.key_id)");
    expect(orphans.length).toBe(0);
  });

  it('lets an operator revoke, change limit, archive — with history', async () => {
    const agent = request.agent(admin);
    await agent.post('/admin/login').send({ login_id: 'keyops', password: 'keyops-password-123' });
    const keys = await agent.get('/admin/keys');
    const ext = keys.body.items.find((k: any) => k.key_kind === 'external');
    const lim = await agent.put(`/admin/keys/${ext.key_id}/limit`).send({ call_limit_per_hour: 0 });
    expect(lim.body.error.code).toBe('SETTINGS_INVALID_VALUE');
    expect((await agent.put(`/admin/keys/${ext.key_id}/limit`).send({ call_limit_per_hour: 60 })).body.call_limit_per_hour).toBe(60);
    const apps = await agent.get('/admin/applications');
    expect(apps.body.items[0].contact_email_masked).toMatch(/^\w\*\*\*@/);
    const arch = await agent.post(`/admin/applications/${ext.application_no}/archive`);
    expect(arch.body.is_retained).toBe(1);
    const rv = await agent.post(`/admin/keys/${ext.key_id}/revoke`);
    expect(rv.body.status).toBe('revoked');
    const hist = await query("SELECT field_name FROM change_history WHERE target_ref = ?", [String(ext.key_id)]);
    expect(hist.map((h: any) => h.field_name)).toEqual(expect.arrayContaining(['call_limit_per_hour', 'retained', 'status']));
  });
});
