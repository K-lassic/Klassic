// #100 관리자 API 통합 시험 — 접속 허용 범위(G5) · 운영자 로그인/세션 · 로그인 전 기본 거부 · 서비스 키 발급. 실제 MariaDB 가 필요하다 (TEST_DB_HOST 가 있을 때만 돈다).
//   v0.1.1 tests/integration/us9_admin.test.ts 중 이 범위만 옮겼다(계정 · 키 목록 · 설정 · 모델 등은 #100 나머지에서).
//   모든 JSON 응답은 serve() 가 계약(web-api.yaml)과 맞춰 본다 — 로그인 200 · 401 · 403 · 423, me 200 · 401, 서비스 키 201 · 401 · 403 이 지나간다.
//   실행: 시험용 DB 프로젝트(-p klassic-api-test)를 띄우고 그 네트워크에 붙은 컨테이너에서 — README 「시험」
import { HAS_DB } from '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import argon2 from 'argon2';
import type { Server } from 'node:http';

let app: Server;
let db: typeof import('../../src/db/pool.js');
let ids: typeof import('../../src/lib/ids.js');
let keys: typeof import('../../src/lib/keys.js');
let serve: typeof import('../helpers/serve.js').serve;
let waitFor: typeof import('../helpers/db.js').waitFor;
let guard: typeof import('../../src/admin/networkGuard.js');
let cidr: typeof import('../../src/lib/cidr.js');
let adminAuth: typeof import('../../src/admin/auth.js');
let adminApp: typeof import('../../src/app.js').createAdminApp;
let maxFailures = 5;
let HASH = '';

const PASSWORD = 'operator-password-1234';
const COOKIE = 'gugak_admin';

beforeAll(async () => {
  if (!HAS_DB) return;
  ({ serve } = await import('../helpers/serve.js'));
  ({ waitFor } = await import('../helpers/db.js'));
  ({ createAdminApp: adminApp } = await import('../../src/app.js'));
  db = await import('../../src/db/pool.js');
  ids = await import('../../src/lib/ids.js');
  keys = await import('../../src/lib/keys.js');
  guard = await import('../../src/admin/networkGuard.js');
  cidr = await import('../../src/lib/cidr.js');
  adminAuth = await import('../../src/admin/auth.js');
  maxFailures = (await (await import('../../src/config/settings.js')).currentSettings()).login_max_failures;
  HASH = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  app = serve(adminApp());
});
afterAll(async () => { if (HAS_DB) await db.closePool(); });

interface Acct { loginId: string; accountId: number; operatorId: number | null }
let n = 0;
/** 시험용 계정 — 기본은 operator 역할 + 운영자 표 행이 있는 정상 운영자 */
async function makeAccount(o: { operator?: boolean; operatorRow?: boolean; accountDisabled?: boolean; operatorDisabled?: boolean } = {}): Promise<Acct> {
  const { operator = true, operatorRow = true } = o;
  const loginId = `adm-${process.pid}-${Date.now()}-${n++}@test.kr`;
  const a = await db.exec('INSERT INTO account (login_id, password_hash, display_name, disabled_at) VALUES (?, ?, ?, ?)',
    [loginId, HASH, `시험 운영자 ${n}`, o.accountDisabled ? new Date() : null]);
  const accountId = Number(a.insertId);
  await db.exec("INSERT INTO account_role (account_id, role_code) VALUES (?, 'user')", [accountId]);
  if (operator) await db.exec("INSERT INTO account_role (account_id, role_code) VALUES (?, 'operator')", [accountId]);
  let operatorId: number | null = null;
  if (operatorRow) {
    const r = await db.exec('INSERT INTO operator_account (login_id, password_hash, display_name, account_id, disabled_at) VALUES (?, ?, ?, ?, ?)',
      [loginId, HASH, `시험 운영자 ${n}`, accountId, o.operatorDisabled ? new Date() : null]);
    operatorId = Number(r.insertId);
  }
  return { loginId, accountId, operatorId };
}

const post = (path: string, body?: object, ip?: string) => {
  const r = request(app).post(path);
  if (ip) r.set('X-Forwarded-For', ip);
  return body ? r.send(body) : r;
};
const login = (a: Acct, password = PASSWORD, ip?: string) => post('/admin/login', { login_id: a.loginId, password }, ip);
const cookieHeader = (res: request.Response): string => String(res.headers['set-cookie'] ?? '');
/** 로그인해서 쿠키가 유지되는 에이전트 */
async function operatorAgent(a?: Acct) {
  const acct = a ?? (await makeAccount());
  const agent = request.agent(app);
  const r = await agent.post('/admin/login').send({ login_id: acct.loginId, password: PASSWORD });
  if (r.status !== 200) throw new Error(`운영자 로그인 실패 ${r.status} ${JSON.stringify(r.body)}`);
  return Object.assign(agent, { acct, cookie: cookieHeader(r) });
}
/** 서명이 맞는 쿠키 값을 직접 만든다 (변조 · 만료 시험용) */
const craft = (value: string) => `${COOKIE}=${encodeURIComponent(`${value}.${ids.sign(value)}`)}`;
const valid = (operatorId: number, expiresAt = Date.now() + 3600_000, boot = adminAuth.bootIdForTest()) => `${operatorId}:${expiresAt}:${boot}:nonce12345`;

const OUTSIDE = ['203.0.113.9', '192.168.0.19', '10.0.0.5', '2001:db8::1', '172.15.255.255', '172.32.0.1'];
const INSIDE = ['127.0.0.1', '::1', '172.16.0.1', '172.30.0.1', '172.31.255.254'];

describe.skipIf(!HAS_DB)('접속 허용 범위 (G5)', () => {
  it.each(INSIDE)('허용 범위 안(%s)은 지나가서 로그인 검사를 만난다', async (ip) => {
    const r = await request(app).get('/admin/me').set('X-Forwarded-For', ip);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('ADMIN_LOGIN_REQUIRED');
  });

  it.each(OUTSIDE)('범위 밖(%s)은 모든 관리자 경로가 403 ADMIN_NETWORK_DENIED', async (ip) => {
    const a = await makeAccount();
    const calls = [
      post('/admin/login', { login_id: a.loginId, password: PASSWORD }, ip),
      request(app).get('/admin/me').set('X-Forwarded-For', ip),
      post('/admin/logout', undefined, ip),
      post('/admin/service-key', undefined, ip),
      request(app).get('/admin/accounts').set('X-Forwarded-For', ip),
      request(app).get('/admin/없는-경로').set('X-Forwarded-For', ip),
    ];
    for (const r of await Promise.all(calls)) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('ADMIN_NETWORK_DENIED');
      expect(r.body.error.gate).toBe('G5');
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    // 올바른 비밀번호여도 밖에서는 로그인 시도 자체가 닿지 않는다 — 실패 횟수도 늘지 않았다
    const row = await db.one<{ failed_logins: number; last_login_at: Date | null }>('SELECT failed_logins, last_login_at FROM account WHERE account_id = ?', [a.accountId]);
    expect(row).toMatchObject({ failed_logins: 0, last_login_at: null });
  });

  it('주소를 꾸며 보내도 바뀌지 않는다 — 가장 오른쪽의 믿을 수 없는 주소가 접속 주소다', async () => {
    for (const forwarded of ['127.0.0.1, 203.0.113.9', '203.0.113.9, 127.0.0.1', '203.0.113.9']) {
      const r = await request(app).get('/admin/me').set('X-Forwarded-For', forwarded).set('X-Real-IP', '127.0.0.1').set('Forwarded', 'for=127.0.0.1');
      expect(r.status, forwarded).toBe(403);
    }
  });

  // PR #167 리뷰(예은) 회귀 — 다른 컨테이너가 Nginx 를 거치지 않고 직접 붙어 X-Forwarded-For 로 허용 주소를 꾸며도 통과하면 안 된다.
  //   시험 서버에 붙는 쪽(supertest)의 연결 주소는 127.0.0.1 이다. 이 주소를 "믿을 프록시"에서 빼면 직접 붙은 다른 컨테이너와 같은 처지가 된다.
  it('믿을 프록시가 아닌 연결이 X-Forwarded-For 로 허용 주소를 꾸며도 403 이다 (직접 붙은 컨테이너)', async () => {
    const direct = serve(adminApp({ trustedProxies: '10.9.9.9', allowedCidrs: '10.0.0.0/8' }));
    for (const forwarded of ['10.1.1.1', '10.1.1.1, 10.2.2.2']) {
      const r = await request(direct).get('/admin/me').set('X-Forwarded-For', forwarded).set('X-Real-IP', '10.1.1.1');
      expect(r.status, forwarded).toBe(403);
      expect(r.body.error.code).toBe('ADMIN_NETWORK_DENIED');
    }
    expect((await request(direct).post('/admin/login').set('X-Forwarded-For', '10.1.1.1').send({ login_id: 'x@test.kr', password: 'y' })).status).toBe(403);
  });

  it('믿을 프록시(Nginx)가 넘긴 X-Forwarded-For 는 읽는다 — 같은 요청이 범위 안이면 로그인 검사까지 간다', async () => {
    const viaProxy = serve(adminApp({ trustedProxies: '127.0.0.1', allowedCidrs: '10.0.0.0/8' }));
    expect((await request(viaProxy).get('/admin/me').set('X-Forwarded-For', '10.1.1.1')).status).toBe(401); // 범위 통과 → 로그인 전
    expect((await request(viaProxy).get('/admin/me').set('X-Forwarded-For', '203.0.113.9')).status).toBe(403); // 범위 밖
  });

  it('로그인한 쿠키가 있어도 범위 밖이면 403 이고 아무것도 바뀌지 않는다', async () => {
    const agent = await operatorAgent();
    const before = await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM access_key WHERE key_kind = 'service'");
    const r = await agent.post('/admin/service-key').set('X-Forwarded-For', '203.0.113.9');
    expect(r.status).toBe(403);
    const after = await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM access_key WHERE key_kind = 'service'");
    expect(Number(after!.n)).toBe(Number(before!.n));
  });

  it('막힌 사건은 gate_event(G5)에 주소 해시만 남기고 주소 원문은 남기지 않는다', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    await request(app).get('/admin/me').set('X-Forwarded-For', ip);
    const subject = ids.hashAddr(ip);
    const row = await waitFor(
      () => db.one<{ gate_code: string; channel: string; subject_type: string; subject_ref: string }>(
        "SELECT gate_code, channel, subject_type, subject_ref FROM gate_event WHERE reason_code = 'ADMIN_NETWORK_DENIED' AND subject_ref = ?", [subject]),
      (v) => v !== null);
    expect(row).toMatchObject({ gate_code: 'G5', channel: 'admin', subject_type: 'client', subject_ref: subject });
    expect(row!.subject_ref).not.toContain(ip);
    const leaked = await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM gate_event WHERE subject_ref = ?", [ip]);
    expect(Number(leaked!.n)).toBe(0);
  });

  it('/admin/health 는 범위 앞에서 답한다 — 컨테이너 안 healthcheck 용이고 준비 여부만 알린다', async () => {
    const r = await request(app).get('/admin/health').set('X-Forwarded-For', '203.0.113.9');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', role: 'admin' });
  });

  it('범위를 바꾸면 따른다 — 지정한 범위만 허용하고, 목록이 비면 아무도 들이지 않는다', async () => {
    const make = (list: ReturnType<typeof cidr.parseCidrList>) => {
      const x = express();
      x.set('trust proxy', 'loopback');
      x.use(guard.networkGuard(list ?? []));
      x.get('/x', (_req, res) => { res.json({ ok: true }); });
      return serve(x);
    };
    const only10 = make(cidr.parseCidrList('10.0.0.0/8'));
    expect((await request(only10).get('/x').set('X-Forwarded-For', '10.1.2.3')).status).toBe(200);
    expect((await request(only10).get('/x').set('X-Forwarded-For', '127.0.0.1')).status).toBe(403);
    const none = make(null);
    expect((await request(none).get('/x').set('X-Forwarded-For', '127.0.0.1')).status).toBe(403);
  });
});

describe.skipIf(!HAS_DB)('운영자 로그인 (POST /admin/login)', () => {
  it('성공 — 200, 운영자 정보, 안전한 쿠키, 캐시 금지. 비밀번호 해시는 나가지 않는다', async () => {
    const a = await makeAccount();
    const r = await login(a);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['display_name', 'login_id_masked', 'operator_id']);
    expect(r.body.operator_id).toBe(a.operatorId);
    expect(r.body.login_id_masked).toBe(`${a.loginId.slice(0, 3)}**`);
    expect(JSON.stringify(r.body)).not.toContain('argon2');
    expect(r.headers['cache-control']).toBe('no-store');
    const c = cookieHeader(r);
    expect(c).toContain(`${COOKIE}=`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=28800');
    expect(c).not.toContain('Secure'); // http 로컬 접속에서는 쿠키가 막히지 않는다
    const row = await db.one<{ failed_logins: number; last_login_at: Date | null }>('SELECT failed_logins, last_login_at FROM account WHERE account_id = ?', [a.accountId]);
    expect(row!.last_login_at).not.toBeNull();
  });

  it('https 로 들어온 접속(Nginx 가 X-Forwarded-Proto 를 넘김)은 Secure 쿠키', async () => {
    const a = await makeAccount();
    const r = await post('/admin/login', { login_id: a.loginId, password: PASSWORD }).set('X-Forwarded-Proto', 'https');
    expect(r.status).toBe(200);
    expect(cookieHeader(r)).toContain('Secure');
  });

  it('틀린 비밀번호 · 없는 계정은 같은 401 ADMIN_LOGIN_FAILED 로 답한다 (계정이 있는지 드러내지 않음)', async () => {
    const a = await makeAccount();
    const wrong = await login(a, 'wrong-password-1234');
    const missing = await post('/admin/login', { login_id: `nobody-${Date.now()}@test.kr`, password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('ADMIN_LOGIN_FAILED');
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual(wrong.body);
  });

  it('비밀번호를 설정값(login_max_failures)번 틀리면 423 ADMIN_LOCKED — 잠긴 동안은 맞는 비밀번호도 거부하고, 풀리면 실패 횟수가 0 으로 돌아온다', async () => {
    const a = await makeAccount();
    for (let i = 1; i < maxFailures; i++) {
      const r = await login(a, 'wrong-password-1234');
      expect(r.status, `${i}번째`).toBe(401);
    }
    const locked = await login(a, 'wrong-password-1234');
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ADMIN_LOCKED');
    expect(locked.body.error.retry_after).not.toBeNull();
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    const during = await login(a);
    expect(during.status).toBe(423);
    expect(during.headers['set-cookie']).toBeUndefined();
    await db.exec('UPDATE account SET locked_until = NULL WHERE account_id = ?', [a.accountId]);
    expect((await login(a)).status).toBe(200);
    const row = await db.one<{ failed_logins: number }>('SELECT failed_logins FROM account WHERE account_id = ?', [a.accountId]);
    expect(Number(row!.failed_logins)).toBe(0);
  });

  it('동시에 여러 번 틀려도 횟수가 빠지지 않아 잠긴다', async () => {
    const a = await makeAccount();
    const results = await Promise.all(Array.from({ length: maxFailures + 3 }, () => login(a, 'wrong-password-1234')));
    expect(results.map((r) => r.status).every((s) => s === 401 || s === 423)).toBe(true);
    expect(results.some((r) => r.status === 423)).toBe(true);
    const row = await db.one<{ locked_until: Date | null }>('SELECT locked_until FROM account WHERE account_id = ?', [a.accountId]);
    expect(row!.locked_until && new Date(row!.locked_until).getTime()).toBeGreaterThan(Date.now());
  });

  it('operator 역할이 없는 계정은 비밀번호가 맞아도 403 ADMIN_FORBIDDEN (G13) — 틀리면 역할을 드러내지 않고 401', async () => {
    const a = await makeAccount({ operator: false, operatorRow: false });
    const r = await login(a);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ADMIN_FORBIDDEN');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect((await login(a, 'wrong-password-1234')).status).toBe(401);
    const g = await waitFor(
      () => db.one<{ gate_code: string }>("SELECT gate_code FROM gate_event WHERE reason_code = 'ADMIN_FORBIDDEN' AND subject_ref = ?", [String(a.accountId)]),
      (v) => v !== null);
    expect(g!.gate_code).toBe('G13');
  });

  it('사용 중지된 계정은 401, 사용 중지된 운영자는 403', async () => {
    const off = await makeAccount({ accountDisabled: true });
    const r1 = await login(off);
    expect(r1.status).toBe(401);
    expect(r1.body.error.code).toBe('ADMIN_LOGIN_FAILED');
    const offOp = await makeAccount({ operatorDisabled: true });
    const r2 = await login(offOp);
    expect(r2.status).toBe(403);
    expect(r2.body.error.code).toBe('ADMIN_FORBIDDEN');
  });

  it('operator 역할만 받은 계정(운영자 표에 행이 없음)은 처음 로그인에서 행이 만들어진다 — 동시에 처음 들어와도 한 행', async () => {
    const a = await makeAccount({ operatorRow: false });
    const rs = await Promise.all([login(a), login(a), login(a)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    const rows = await db.query<{ operator_id: number }>('SELECT operator_id FROM operator_account WHERE account_id = ?', [a.accountId]);
    expect(rows).toHaveLength(1);
    expect(rs.every((r) => r.body.operator_id === Number(rows[0].operator_id))).toBe(true);
  });

  it('입력이 이상하면 500 이 아니라 401 이고, 터무니없이 긴 입력은 해시 계산 없이 실패 횟수도 올리지 않는다', async () => {
    const a = await makeAccount();
    const bad: object[] = [{}, { login_id: 123, password: 'x' }, { login_id: a.loginId, password: { $ne: '' } }, { login_id: [a.loginId], password: [PASSWORD] },
      { login_id: '', password: PASSWORD }, { login_id: a.loginId, password: '' },
      { login_id: a.loginId, password: 'p'.repeat(1025) }, { login_id: 'l'.repeat(255), password: PASSWORD }];
    for (const b of bad) {
      const r = await post('/admin/login', b);
      expect(r.status, JSON.stringify(b).slice(0, 60)).toBe(401);
      expect(r.body.error.code).toBe('ADMIN_LOGIN_FAILED');
    }
    expect((await post('/admin/login')).status).toBe(401); // 본문 없음
    const row = await db.one<{ failed_logins: number }>('SELECT failed_logins FROM account WHERE account_id = ?', [a.accountId]);
    expect(Number(row!.failed_logins)).toBe(0); // 이 아이디의 실패로 세지 않았다 (계정을 찾지 않고 끝)
  });

  it('로그인할 때마다 새 쿠키 값이 나온다', async () => {
    const a = await makeAccount();
    const c1 = cookieHeader(await login(a));
    const c2 = cookieHeader(await login(a));
    expect(c1).not.toBe(c2);
  });
});

describe.skipIf(!HAS_DB)('세션 (GET /admin/me · POST /admin/logout)', () => {
  it('로그인한 쿠키로 내 정보를 본다', async () => {
    const agent = await operatorAgent();
    const r = await agent.get('/admin/me');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ operator_id: agent.acct.operatorId, display_name: expect.any(String), login_id_masked: expect.stringMatching(/\*\*$/) });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('쿠키가 없으면 401 ADMIN_LOGIN_REQUIRED', async () => {
    const r = await request(app).get('/admin/me');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('ADMIN_LOGIN_REQUIRED');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('직접 만든 쿠키 — 서명이 맞고 올바른 값이면 통과하고(시험 도구가 맞는지 확인), 변조 · 만료 · 모양이 틀린 것은 모두 401', async () => {
    const a = await makeAccount();
    const other = await makeAccount();
    const ok = await request(app).get('/admin/me').set('Cookie', craft(valid(a.operatorId!)));
    expect(ok.status).toBe(200);
    expect(ok.body.operator_id).toBe(a.operatorId);

    const signed = `${valid(a.operatorId!)}.${ids.sign(valid(a.operatorId!))}`;
    const cookies: Record<string, string> = {
      '만료': craft(valid(a.operatorId!, Date.now() - 1000)),
      '서명 없음': `${COOKIE}=${encodeURIComponent(valid(a.operatorId!))}`,
      '다른 운영자 번호로 바꿈(서명 그대로)': `${COOKIE}=${encodeURIComponent(signed.replace(`${a.operatorId}:`, `${other.operatorId}:`))}`,
      '서명 한 글자 바꿈': `${COOKIE}=${encodeURIComponent(signed.slice(0, -1) + (signed.endsWith('A') ? 'B' : 'A'))}`,
      '조각이 더 많음': craft(`${valid(a.operatorId!)}:extra`),
      '무작위 값 없음': craft(`${a.operatorId}:${Date.now() + 3600_000}:${adminAuth.bootIdForTest()}:`),
      '프로세스 표식 없음(옛 형식)': craft(`${a.operatorId}:${Date.now() + 3600_000}:nonce12345`),
      '운영자 번호 0': craft(valid(0)),
      '운영자 번호 음수': craft(valid(-5)),
      '운영자 번호 글자': craft(`abc:${Date.now() + 3600_000}:${adminAuth.bootIdForTest()}:nonce12345`),
      '만료 시각 글자': craft(`${a.operatorId}:soon:${adminAuth.bootIdForTest()}:nonce12345`),
      '없는 운영자 번호': craft(valid(2_000_000_000)),
      '아무 글자': `${COOKIE}=garbage`,
    };
    for (const [name, cookie] of Object.entries(cookies)) {
      const r = await request(app).get('/admin/me').set('Cookie', cookie);
      expect(r.status, name).toBe(401);
      expect(r.body.error.code, name).toBe('ADMIN_LOGIN_REQUIRED');
    }
  });

  it('admin 을 다시 띄운 뒤에는 그 전에 낸 쿠키가 모두 무효다 — 서명이 맞아도 다른 프로세스가 낸 쿠키는 거부 (로그아웃했던 쿠키가 되살아나지 않게)', async () => {
    const a = await makeAccount();
    const fromPreviousProcess = craft(valid(a.operatorId!, Date.now() + 3600_000, 'previous-boot'));
    const r = await request(app).get('/admin/me').set('Cookie', fromPreviousProcess);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('ADMIN_LOGIN_REQUIRED');
  });

  it('사용자 세션 쿠키(gugak_sid)나 다른 서명 쿠키로는 들어올 수 없다', async () => {
    const r = await request(app).get('/admin/me').set('Cookie', 'gugak_sid=abc.def; other=1');
    expect(r.status).toBe(401);
  });

  it('로그아웃 — 204 + 쿠키 비움. 같은 쿠키를 다시 보내면 401, 새로 로그인하면 다시 들어온다', async () => {
    const a = await makeAccount();
    const first = await login(a);
    const oldCookie = String(first.headers['set-cookie']).split(';')[0];
    expect((await request(app).get('/admin/me').set('Cookie', oldCookie)).status).toBe(200);

    const out = await request(app).post('/admin/logout').set('Cookie', oldCookie);
    expect(out.status).toBe(204);
    expect(cookieHeader(out)).toMatch(new RegExp(`${COOKIE}=;`));
    const replay = await request(app).get('/admin/me').set('Cookie', oldCookie);
    expect(replay.status).toBe(401);

    const second = await login(a);
    const newCookie = String(second.headers['set-cookie']).split(';')[0];
    expect(newCookie).not.toBe(oldCookie);
    expect((await request(app).get('/admin/me').set('Cookie', newCookie)).status).toBe(200);
  });

  it('로그아웃은 로그인하지 않았거나 쿠키가 이상해도 204 (쿠키만 비운다)', async () => {
    expect((await request(app).post('/admin/logout')).status).toBe(204);
    expect((await request(app).post('/admin/logout').set('Cookie', `${COOKIE}=garbage`)).status).toBe(204);
  });

  it('요청마다 DB 를 다시 본다 — 역할을 빼면 다음 요청부터 401, 돌려놓으면 같은 쿠키로 다시 들어온다', async () => {
    const agent = await operatorAgent();
    expect((await agent.get('/admin/me')).status).toBe(200);
    await db.exec("DELETE FROM account_role WHERE account_id = ? AND role_code = 'operator'", [agent.acct.accountId]);
    expect((await agent.get('/admin/me')).status).toBe(401);
    await db.exec("INSERT INTO account_role (account_id, role_code) VALUES (?, 'operator')", [agent.acct.accountId]);
    expect((await agent.get('/admin/me')).status).toBe(200);
  });

  it('계정을 사용 중지하거나 운영자를 사용 중지하면 다음 요청부터 401', async () => {
    const byAccount = await operatorAgent();
    await db.exec('UPDATE account SET disabled_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?', [byAccount.acct.accountId]);
    expect((await byAccount.get('/admin/me')).status).toBe(401);

    const byOperator = await operatorAgent();
    await db.exec('UPDATE operator_account SET disabled_at = CURRENT_TIMESTAMP(3) WHERE operator_id = ?', [byOperator.acct.operatorId]);
    expect((await byOperator.get('/admin/me')).status).toBe(401);
  });
});

describe.skipIf(!HAS_DB)('로그인 전 기본 거부 (공통 틀)', () => {
  it('아직 만들지 않은 경로도 로그인 전에는 404 가 아니라 401 이다 — 로그인 검사를 빼먹은 라우터가 생길 수 없다', async () => {
    for (const [method, path] of [['get', '/admin/accounts'], ['get', '/admin/keys'], ['put', '/admin/settings'], ['post', '/admin/service-key'], ['get', '/admin/없는-경로']] as const) {
      const r = await request(app)[method](path);
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.body.error.code).toBe('ADMIN_LOGIN_REQUIRED');
    }
  });

  it('로그인한 뒤에는 아직 없는 경로가 404 REQUEST_NOT_FOUND 다', async () => {
    const agent = await operatorAgent();
    for (const path of ['/admin/accounts', '/admin/keys', '/admin/없는-경로']) {
      const r = await agent.get(path);
      expect(r.status, path).toBe(404);
      expect(r.body.error.code).toBe('REQUEST_NOT_FOUND');
    }
  });
});

describe.skipIf(!HAS_DB)('서비스 키 발급 (POST /admin/service-key)', () => {
  const activeServiceKeys = async () => Number((await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM access_key WHERE key_kind = 'service' AND status = 'active'"))!.n);

  it('로그인하지 않으면 401 이고 키는 만들어지지 않는다', async () => {
    const before = Number((await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM access_key WHERE key_kind = 'service'"))!.n);
    const r = await post('/admin/service-key');
    expect(r.status).toBe(401);
    const after = Number((await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM access_key WHERE key_kind = 'service'"))!.n);
    expect(after).toBe(before);
  });

  it('발급 — 201, 원문은 응답에만 있고 DB 에는 해시와 앞자리만, 누가 했는지 변경 이력에 남는다', async () => {
    const agent = await operatorAgent();
    const r = await agent.post('/admin/service-key');
    expect(r.status).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toMatchObject({ key_id: expect.any(Number), api_key: expect.stringMatching(/^gk_[A-Za-z0-9]{43}$/), revoked_key_ids: expect.any(Array), notice: expect.stringContaining('SERVICE_API_KEY') });
    expect(r.body.key_prefix).toBe(r.body.api_key.slice(0, 8));

    const row = await db.one<{ key_kind: string; status: string; key_hash: string; key_prefix: string; issued_by: number }>(
      'SELECT key_kind, status, key_hash, key_prefix, issued_by FROM access_key WHERE key_id = ?', [r.body.key_id]);
    expect(row).toMatchObject({ key_kind: 'service', status: 'active', key_hash: keys.sha256(r.body.api_key), key_prefix: r.body.key_prefix });
    expect(Number(row!.issued_by)).toBe(agent.acct.operatorId);
    const hist = await db.one<{ operator_id: number; after_value: string }>(
      "SELECT operator_id, after_value FROM change_history WHERE target_type = 'access_key' AND target_ref = ? AND field_name = 'issued'", [String(r.body.key_id)]);
    expect(Number(hist!.operator_id)).toBe(agent.acct.operatorId);
    expect(hist!.after_value).toBe(r.body.key_prefix);
    // 원문이 어떤 표에도 그대로 남지 않았다
    const raw = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM change_history WHERE before_value = ? OR after_value = ?', [r.body.api_key, r.body.api_key]);
    expect(Number(raw!.n)).toBe(0);
  });

  it('새로 발급하면 이전 서비스 키는 폐기되고 살아 있는 서비스 키는 하나뿐이다', async () => {
    const agent = await operatorAgent();
    const first = await agent.post('/admin/service-key');
    const second = await agent.post('/admin/service-key');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.revoked_key_ids).toContain(first.body.key_id);
    expect(second.body.api_key).not.toBe(first.body.api_key);
    const old = await db.one<{ status: string; revoked_by: number }>('SELECT status, revoked_by FROM access_key WHERE key_id = ?', [first.body.key_id]);
    expect(old!.status).toBe('revoked');
    expect(Number(old!.revoked_by)).toBe(agent.acct.operatorId);
    expect(await activeServiceKeys()).toBe(1);
  });
});
