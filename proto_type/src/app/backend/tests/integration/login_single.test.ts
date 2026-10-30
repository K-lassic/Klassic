// (2026-10-01 황송해 209번, UC16 A5 · E7 · BR-AUTH-02) 한 계정 한 곳 로그인
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { exec, query } from '../helpers/db.js';
import { createWebApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';

const app = serve(createWebApp());
afterAll(async () => { await closePool(); });

describe('한 계정 한 곳 로그인', () => {
  it('다른 브라우저에서 로그인 중이면 409 LOGIN_ALREADY_ACTIVE · 로그아웃하면 된다 · 비밀번호가 틀리면 401 그대로', async () => {
    const a = await loggedInAgent(app, 'single-a');   // 가입하면 로그인된 상태
    const b = request.agent(app);
    const wrong = await b.post('/api/auth/login').send({ email: a.email, password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    const dup = await b.post('/api/auth/login').send({ email: a.email, password: 'password-1234' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('LOGIN_ALREADY_ACTIVE');
    const g = await query<{ n: number }>("SELECT COUNT(*) AS n FROM gate_event WHERE gate_code = 'G15' AND reason_code = 'LOGIN_ALREADY_ACTIVE' AND subject_ref = ?", [String(a.accountId)]);
    expect(Number(g[0].n)).toBeGreaterThan(0);
    expect((await a.post('/api/auth/logout')).status).toBe(204);
    expect((await b.post('/api/auth/login').send({ email: a.email, password: 'password-1234' })).status).toBe(200);
  });

  it('이미 로그인한 브라우저에서 다시 로그인하면 409 ALREADY_LOGGED_IN', async () => {
    const a = await loggedInAgent(app, 'single-b');
    const again = await a.post('/api/auth/login').send({ email: a.email, password: 'password-1234' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_LOGGED_IN');
  });

  it('(212번) 다른 곳 세션이 10분 넘게 활동이 없으면 로그인된다 · 10분 안이면 막힌다', async () => {
    const a = await loggedInAgent(app, 'single-c');
    const b = request.agent(app);
    await exec('UPDATE anon_session SET last_active_at = CURRENT_TIMESTAMP(3) - INTERVAL 9 MINUTE WHERE account_id = ?', [a.accountId]);
    expect((await b.post('/api/auth/login').send({ email: a.email, password: 'password-1234' })).status).toBe(409);
    await exec('UPDATE anon_session SET last_active_at = CURRENT_TIMESTAMP(3) - INTERVAL 11 MINUTE WHERE account_id = ?', [a.accountId]);
    expect((await b.post('/api/auth/login').send({ email: a.email, password: 'password-1234' })).status).toBe(200);
  });
});
