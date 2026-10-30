// 2026-09-29 RBAC — 가입·로그인(FR-066·067), 권한표 판정(FR-068 · G13), 계정 소유, 관리자 operator 역할
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { makePng } from '../helpers/files.js';
import { exec, one } from '../helpers/db.js';
import { createWebApp, createAdminApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';

const app = serve(createWebApp());
const admin = serve(createAdminApp());
afterAll(async () => { await closePool(); });

const email = () => `rbac-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.kr`;

describe('가입·로그인 (UC16)', () => {
  it('가입하면 user 역할로 바로 로그인되고, 로그아웃하면 풀린다', async () => {
    const agent = request.agent(app);
    const e = email();
    const r = await agent.post('/api/auth/signup').send({ email: e, password: 'password-1234', name: '홍길동' });
    expect(r.status).toBe(201);
    expect(r.body.roles).toEqual(['user']);
    expect((await agent.get('/api/auth/me')).body.account.login_id).toBe(e);
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).body.account).toBeNull();
  });

  it('형식 오류·중복 이메일은 가입하지 않는다 (G14)', async () => {
    const bad = await request(app).post('/api/auth/signup').send({ email: 'nope', password: 'short', name: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('SIGNUP_INVALID');
    const e = email();
    await request(app).post('/api/auth/signup').send({ email: e, password: 'password-1234', name: 'a' });
    const dup = await request(app).post('/api/auth/signup').send({ email: e.toUpperCase(), password: 'password-1234', name: 'b' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SIGNUP_EMAIL_TAKEN');
  });

  it('로그인하면 세션 식별자가 바뀌고(세션 고정 방지), 5번 틀리면 잠긴다 (G15)', async () => {
    const e = email();
    // (2026-10-01 황송해 209번) 한 계정 한 곳 로그인 — 가입한 브라우저에서 로그아웃한 뒤 다른 브라우저로 로그인
    const signup = request.agent(app);
    await signup.post('/api/auth/signup').send({ email: e, password: 'password-1234', name: 'c' });
    await signup.post('/api/auth/logout');
    const agent = request.agent(app);
    const first = await agent.get('/api/auth/me');
    const before = String(first.headers['set-cookie'] ?? '');
    const ok = await agent.post('/api/auth/login').send({ email: e, password: 'password-1234' });
    expect(ok.status).toBe(200);
    expect(String(ok.headers['set-cookie'] ?? '')).not.toBe('');
    expect(String(ok.headers['set-cookie'])).not.toBe(before);

    for (let i = 0; i < 4; i++) {
      const f = await request(app).post('/api/auth/login').send({ email: e, password: 'wrong-password' });
      expect(f.body.error.code).toBe('LOGIN_FAILED');
    }
    const locked = await request(app).post('/api/auth/login').send({ email: e, password: 'wrong-password' });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('LOGIN_LOCKED');
    const still = await request(app).post('/api/auth/login').send({ email: e, password: 'password-1234' });
    expect(still.body.error.code).toBe('LOGIN_LOCKED');
  });

  it('없는 계정도 같은 문구로 거절한다(계정 존재를 드러내지 않음)', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: email(), password: 'whatever-123' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('LOGIN_FAILED');
  });
});

describe('권한표 판정 (FR-068 · G13)', () => {
  it('로그인 안 하면 악보 기능·키 신청은 401, 안내는 누구나', async () => {
    const up = await request(app).post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 's.png');
    expect(up.status).toBe(401);
    expect(up.body.error.code).toBe('AUTH_LOGIN_REQUIRED');
    const key = await request(app).post('/api/key-applications').send({});
    expect(key.status).toBe(401);
    expect((await request(app).get('/api/api-docs')).status).toBe(200);
    const g = await one<{ n: number }>("SELECT COUNT(*) AS n FROM gate_event WHERE gate_code = 'G13'");
    expect(Number(g!.n)).toBeGreaterThan(0);
  });

  it('역할이 없는 계정은 403', async () => {
    const agent = await loggedInAgent(app, 'norole');
    await exec("DELETE FROM account_role WHERE account_id = ? AND role_code = 'user'", [agent.accountId]);
    const r = await agent.get('/api/instruments');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('요청은 계정 소유 — 같은 계정은 다른 브라우저에서도 보고, 다른 계정은 못 본다', async () => {
    const a = await loggedInAgent(app, 'owner');
    const up = await a.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 's.png');
    expect(up.status).toBe(202);
    const row = await one<{ account_id: number }>('SELECT account_id FROM score_request WHERE request_no = ?', [up.body.id]);
    expect(Number(row!.account_id)).toBe(a.accountId);

    // (2026-10-01 황송해 209번) 한 계정 한 곳 로그인 — 첫 브라우저에서 로그아웃한 뒤 다른 브라우저로
    await a.post('/api/auth/logout');
    const again = request.agent(app);
    await again.post('/api/auth/login').send({ email: a.email, password: 'password-1234' });
    expect((await again.get(`/api/requests/${up.body.id}`)).status).toBe(200);

    const other = await loggedInAgent(app, 'other');
    const r = await other.get(`/api/requests/${up.body.id}`);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('REQUEST_NOT_FOUND');
  });

  it('키 신청은 로그인한 user 가 하고, 신청 기록에 계정이 남는다', async () => {
    const a = await loggedInAgent(app, 'keyreq');
    const r = await a.post('/api/key-applications').send({
      name: '개발자', organization: '3팀', contact_email: a.email, purpose: '시험', consent: true });
    expect(r.status).toBe(201);
    const row = await one<{ account_id: number }>(
      'SELECT ka.account_id FROM key_application ka JOIN access_key k ON k.key_id = ka.key_id WHERE k.application_no = ?', [r.body.application_no]);
    expect(Number(row!.account_id)).toBe(a.accountId);
  });

  it('대응표에 없는 경로는 404', async () => {
    const a = await loggedInAgent(app, 'nf');
    expect((await a.get('/api/nothing-here')).status).toBe(404);
  });
});

describe('관리자 화면 (operator 역할)', () => {
  it('operator 역할이 없는 계정은 비밀번호가 맞아도 ADMIN_FORBIDDEN', async () => {
    const e = email();
    await request(app).post('/api/auth/signup').send({ email: e, password: 'password-1234', name: '사용자' });
    const r = await request(admin).post('/admin/login').send({ login_id: e, password: 'password-1234' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ADMIN_FORBIDDEN');
  });

  it('운영자 표에만 있는 옛 운영자는 로그인할 때 계정에 이어지고 operator 역할을 받는다', async () => {
    const id = `legacy-${Date.now()}`;
    await exec('INSERT INTO operator_account (login_id, password_hash, display_name) VALUES (?, ?, ?)',
      [id, await argon2.hash('legacy-password-123', { type: argon2.argon2id }), '옛 운영자']);
    const agent = request.agent(admin);
    const r = await agent.post('/admin/login').send({ login_id: id, password: 'legacy-password-123' });
    expect(r.status).toBe(200);
    expect((await agent.get('/admin/me')).status).toBe(200);
    const role = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM account a JOIN account_role ar ON ar.account_id = a.account_id WHERE a.login_id = ? AND ar.role_code = 'operator'", [id]);
    expect(Number(role!.n)).toBe(1);
  });
});
