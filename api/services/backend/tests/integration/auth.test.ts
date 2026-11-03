// #27 세션 · 가입 · 로그인 · 권한 통합 시험 — 실제 MariaDB 가 필요하다 (TEST_DB_HOST 가 있을 때만 돈다).
//   v0.1.1 tests/integration/login_single.test.ts · rbac.test.ts 중 #27 범위(업로드 · 키 신청 · 관리자 로그인은 각 이슈에서)를 옮겼다.
//   실행: 시험용 DB 프로젝트(-p klassic-api-test)를 띄우고 그 네트워크에 붙은 컨테이너에서 — README 「시험」
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import request from 'supertest';
import type { Server } from 'node:http';

const HAS_DB = Boolean(process.env.TEST_DB_HOST);
const here = dirname(fileURLToPath(import.meta.url));

// 앱 모듈을 불러오기 전에 설정을 채운다 — 가입 한도는 시험 계정을 많이 만들므로 크게
Object.assign(process.env, {
  DB_HOST: process.env.TEST_DB_HOST ?? '127.0.0.1', DB_PORT: process.env.TEST_DB_PORT ?? '3306',
  DB_USER: process.env.TEST_DB_USER ?? 'klassic', DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? '', DB_NAME: process.env.TEST_DB_NAME ?? 'klassic',
  SESSION_SECRET: 'test-secret-test-secret-test-secret-0123456789', ADDR_HASH_SALT: 'test-salt-test-salt',
  SIGNUP_HOURLY_CAP: '100000', SHARED_DIR: process.env.SHARED_DIR ?? join(here, '..', '..', '..', '..', 'shared'),
});
// 요청마다 서버를 여닫는 supertest 에서 끊긴 연결을 다시 쓰지 않게 (v0.1.1 helpers/env.ts)
http.globalAgent = new http.Agent({ keepAlive: false });

let app: Server;
let db: typeof import('../../src/db/pool.js');
let loggedInAgent: typeof import('../helpers/auth.js').loggedInAgent;

beforeAll(async () => {
  if (!HAS_DB) return;
  const { serve } = await import('../helpers/serve.js');
  const { createWebApp } = await import('../../src/app.js');
  db = await import('../../src/db/pool.js');
  ({ loggedInAgent } = await import('../helpers/auth.js'));
  app = serve(createWebApp());
});
afterAll(async () => { if (HAS_DB) await db.closePool(); });

const email = () => `auth-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.kr`;
const cookieOf = (res: request.Response) => String(res.headers['set-cookie'] ?? '');

describe.skipIf(!HAS_DB)('세션 (H4)', () => {
  it('/api/health 는 세션을 만들지 않는다', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('첫 요청에 HttpOnly · SameSite=Lax 서명 쿠키를 주고, [나가기] 하면 다음 요청에 새 세션', async () => {
    const agent = request.agent(app);
    const first = await agent.get('/api/auth/me');
    expect(cookieOf(first)).toMatch(/gugak_sid=[0-9a-f-]{36}\.[\w-]+;.*HttpOnly/i);
    expect(cookieOf(first)).toMatch(/SameSite=Lax/i);
    expect((await agent.post('/api/session/end')).status).toBe(204);
    const next = await agent.get('/api/auth/me');
    expect(cookieOf(next)).toMatch(/gugak_sid=/);
    expect(cookieOf(next)).not.toBe(cookieOf(first));
  });
  it('서명이 틀린 쿠키는 버리고 새 세션', async () => {
    const r = await request(app).get('/api/auth/me').set('Cookie', 'gugak_sid=00000000-0000-0000-0000-000000000000.forged');
    expect(cookieOf(r)).toMatch(/gugak_sid=/);
    expect(r.body.account).toBeNull();
  });
});

// #37 Funnel(HTTPS) → Nginx 뒤 동작 — 시험 요청은 127.0.0.1 에서 오므로 trust proxy 범위 안이다 (Nginx 와 같은 조건)
describe.skipIf(!HAS_DB)('프록시 뒤 (#37)', () => {
  it('X-Forwarded-Proto: https 면 쿠키에 Secure · http 면 없음', async () => {
    const https = await request(app).get('/api/auth/me').set('X-Forwarded-Proto', 'https');
    expect(cookieOf(https)).toMatch(/;\s*Secure/i);
    const plain = await request(app).get('/api/auth/me');
    expect(cookieOf(plain)).not.toMatch(/;\s*Secure/i);
  });

  it('로그아웃 때 지우는 쿠키도 같은 Secure 속성', async () => {
    const first = await request(app).get('/api/auth/me').set('X-Forwarded-Proto', 'https');
    const r = await request(app).post('/api/auth/logout').set('X-Forwarded-Proto', 'https')
      .set('Cookie', cookieOf(first).split(';')[0]);
    expect(r.status).toBe(204);
    expect(cookieOf(r)).toMatch(/gugak_sid=;.*Secure/i);
  });

  it('접속 주소 해시는 X-Forwarded-For 의 실제 주소 기준 — 사용자마다 다르게 센다', async () => {
    const { hashAddr } = await import('../../src/lib/ids.js');
    const ask = (ip: string) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip)
      .send({ email: email(), password: 'whatever-123' });
    const last = async () => (await db.one<{ subject_ref: string }>(
      "SELECT subject_ref FROM gate_event WHERE gate_code = 'G15' AND subject_type = 'client' ORDER BY event_id DESC LIMIT 1"))!.subject_ref;
    await ask('203.0.113.1');
    const a = await last();
    await ask('203.0.113.2');
    const b = await last();
    expect(a).toBe(hashAddr('203.0.113.1'));
    expect(b).toBe(hashAddr('203.0.113.2'));
    expect(a).not.toBe(b);
  });
});

describe.skipIf(!HAS_DB)('가입 · 로그인 (UC16)', () => {
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

  it('형식 오류 · 중복 이메일은 가입하지 않는다 (G14) — 어느 칸이 통과했는지만 알린다', async () => {
    const bad = await request(app).post('/api/auth/signup').send({ email: 'nope', password: 'short', name: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'SIGNUP_INVALID', details: { email: false, password: false, name: false } });
    const e = email();
    await request(app).post('/api/auth/signup').send({ email: e, password: 'password-1234', name: 'a' });
    const dup = await request(app).post('/api/auth/signup').send({ email: e.toUpperCase(), password: 'password-1234', name: 'b' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SIGNUP_EMAIL_TAKEN');
  });

  it('비밀번호는 argon2id 해시로만 저장된다', async () => {
    const e = email();
    await request(app).post('/api/auth/signup').send({ email: e, password: 'password-1234', name: 'h' });
    const row = await db.one<{ password_hash: string }>('SELECT password_hash FROM account WHERE login_id = ?', [e]);
    expect(row!.password_hash).toMatch(/^\$argon2id\$/);
    expect(row!.password_hash).not.toContain('password-1234');
  });

  it('로그인하면 세션 식별자가 바뀌고(세션 고정 방지 H5), 5번 틀리면 잠긴다 (H6 · G15)', async () => {
    const e = email();
    const signup = request.agent(app);
    await signup.post('/api/auth/signup').send({ email: e, password: 'password-1234', name: 'c' });
    await signup.post('/api/auth/logout');
    const agent = request.agent(app);
    const before = cookieOf(await agent.get('/api/auth/me'));
    const ok = await agent.post('/api/auth/login').send({ email: e, password: 'password-1234' });
    expect(ok.status).toBe(200);
    expect(cookieOf(ok)).not.toBe('');
    expect(cookieOf(ok)).not.toBe(before);

    for (let i = 0; i < 4; i++) {
      const f = await request(app).post('/api/auth/login').send({ email: e, password: 'wrong-password' });
      expect(f.body.error.code).toBe('LOGIN_FAILED');
    }
    const locked = await request(app).post('/api/auth/login').send({ email: e, password: 'wrong-password' });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('LOGIN_LOCKED');
    expect(locked.headers['retry-after']).toBeDefined();
    const still = await request(app).post('/api/auth/login').send({ email: e, password: 'password-1234' });
    expect(still.body.error.code).toBe('LOGIN_LOCKED');
  });

  it('없는 계정도 같은 문구로 거절한다 (계정 존재를 드러내지 않음)', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: email(), password: 'whatever-123' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('LOGIN_FAILED');
  });
});

describe.skipIf(!HAS_DB)('한 계정 한 곳 로그인 (H7 · v0.1.1 login_single)', () => {
  it('다른 브라우저에서 로그인 중이면 409 LOGIN_ALREADY_ACTIVE · 로그아웃하면 된다 · 비밀번호가 틀리면 401 그대로', async () => {
    const a = await loggedInAgent(app, 'single-a');
    const b = request.agent(app);
    expect((await b.post('/api/auth/login').send({ email: a.email, password: 'wrong-password' })).status).toBe(401);
    const dup = await b.post('/api/auth/login').send({ email: a.email, password: 'password-1234' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('LOGIN_ALREADY_ACTIVE');
    const g = await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM gate_event WHERE gate_code = 'G15' AND reason_code = 'LOGIN_ALREADY_ACTIVE' AND subject_ref = ?", [String(a.accountId)]);
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

  it('다른 곳 세션이 10분 넘게 활동이 없으면 로그인된다 · 10분 안이면 막힌다', async () => {
    const a = await loggedInAgent(app, 'single-c');
    const b = request.agent(app);
    await db.exec('UPDATE anon_session SET last_active_at = CURRENT_TIMESTAMP(3) - INTERVAL 9 MINUTE WHERE account_id = ?', [a.accountId]);
    expect((await b.post('/api/auth/login').send({ email: a.email, password: 'password-1234' })).status).toBe(409);
    await db.exec('UPDATE anon_session SET last_active_at = CURRENT_TIMESTAMP(3) - INTERVAL 11 MINUTE WHERE account_id = ?', [a.accountId]);
    expect((await b.post('/api/auth/login').send({ email: a.email, password: 'password-1234' })).status).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('권한표 판정 (H9 · G13)', () => {
  it('로그인 안 하면 악보 기능은 401 AUTH_LOGIN_REQUIRED 이고 G13 이 남는다', async () => {
    const r = await request(app).get('/api/instruments');
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: 'AUTH_LOGIN_REQUIRED', details: { uc: 'UC5' } });
    const g = await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM gate_event WHERE gate_code = 'G13' AND reason_code = 'AUTH_LOGIN_REQUIRED'");
    expect(Number(g!.n)).toBeGreaterThan(0);
  });

  it('역할이 없는 계정은 403 AUTH_FORBIDDEN', async () => {
    const agent = await loggedInAgent(app, 'norole');
    await db.exec("DELETE FROM account_role WHERE account_id = ? AND role_code = 'user'", [agent.accountId]);
    const r = await agent.get('/api/instruments');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('권한이 있어도 아직 만들지 않은 경로는 404 (권한 통과 뒤 · 추천 #89)', async () => {
    const a = await loggedInAgent(app, 'later');
    expect((await a.get('/api/requests/R-0101-AAAAAAAA/recommendation')).status).toBe(404);
  });

  it('대응표에 없는 경로는 로그인 여부와 상관없이 404 (권한 존재를 드러내지 않음)', async () => {
    expect((await request(app).get('/api/nothing-here')).status).toBe(404);
    const a = await loggedInAgent(app, 'nf');
    const r = await a.get('/api/nothing-here');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('REQUEST_NOT_FOUND');
  });
});
