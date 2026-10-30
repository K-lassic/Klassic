// 2026-09-29 RBAC 운영자 메뉴 "계정·권한"(S7) — FR-069 · design/UC_17 · SD_01 P8 · G16
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { serve } from '../helpers/serve.js';
import { loggedInAgent } from '../helpers/auth.js';
import { exec, one } from '../helpers/db.js';
import { createWebApp, createAdminApp } from '../../src/server.js';
import { closePool } from '../../src/db/pool.js';

const web = serve(createWebApp());
const admin = serve(createAdminApp());
const PW = 'admin-accounts-pw-123';
let opAgent: ReturnType<typeof request.agent>;
let opAccountId: number;
let paused: number[] = [];

async function makeOperator(login: string): Promise<number> {
  const hash = await argon2.hash(PW, { type: argon2.argon2id });
  const a = await exec('INSERT INTO account (login_id, password_hash, display_name) VALUES (?, ?, ?)', [login, hash, `운영 ${login}`]);
  await exec("INSERT INTO account_role (account_id, role_code) VALUES (?, 'operator'), (?, 'user')", [a.insertId, a.insertId]);
  await exec('INSERT INTO operator_account (login_id, password_hash, display_name, account_id) VALUES (?, ?, ?, ?)', [login, hash, login, a.insertId]);
  return a.insertId;
}

beforeAll(async () => {
  // 다른 시험이 만든 운영자를 끄고 이 시험의 운영자 한 명만 쓴다(마지막 operator 규칙을 재기 위해)
  const { query } = await import('../helpers/db.js');
  paused = (await query<{ account_id: number }>(
    "SELECT a.account_id FROM account a JOIN account_role ar ON ar.account_id = a.account_id AND ar.role_code = 'operator' WHERE a.disabled_at IS NULL")).map((r) => r.account_id);
  if (paused.length) await exec(`UPDATE account SET disabled_at = CURRENT_TIMESTAMP(3) WHERE account_id IN (${paused.map(() => '?').join(',')})`, paused);
  opAccountId = await makeOperator(`acc-op-${Date.now()}`);
  opAgent = request.agent(admin);
  const login = await one<{ login_id: string }>('SELECT login_id FROM account WHERE account_id = ?', [opAccountId]);
  const r = await opAgent.post('/admin/login').send({ login_id: login!.login_id, password: PW });
  expect(r.status).toBe(200);
});
afterAll(async () => {
  if (paused.length) await exec(`UPDATE account SET disabled_at = NULL WHERE account_id IN (${paused.map(() => '?').join(',')})`, paused);
  await closePool();
});

describe('계정 목록·상세', () => {
  it('목록은 가린 이메일, 역할·상태로 거른다', async () => {
    const u = await loggedInAgent(web, 'listme');
    const r = await opAgent.get('/admin/accounts').query({ q: 'listme', role: 'user' });
    expect(r.status).toBe(200);
    const row = r.body.items.find((x: { account_id: number }) => x.account_id === u.accountId);
    expect(row.login_id_masked).toMatch(/^lis\*\*@test\.kr$/);
    expect(row.roles).toEqual(['user']);
    expect(row.status).toBe('active');
    expect(JSON.stringify(r.body)).not.toContain(u.email);
  });

  it('상세와 이메일 전체 보기(조회 기록 남음)', async () => {
    const u = await loggedInAgent(web, 'detail');
    const d = await opAgent.get(`/admin/accounts/${u.accountId}`);
    expect(d.status).toBe(200);
    expect(d.body.account.roles).toEqual(['user']);
    const e = await opAgent.post(`/admin/accounts/${u.accountId}/reveal-email`);
    expect(e.body.login_id).toBe(u.email);
    const h = await one<{ n: number }>("SELECT COUNT(*) AS n FROM change_history WHERE target_type = 'account' AND target_ref = ? AND field_name = 'email_revealed'", [String(u.accountId)]);
    expect(Number(h!.n)).toBe(1);
    expect((await opAgent.get('/admin/accounts/999999999')).body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('역할·잠금·사용 중지 (G16)', () => {
  it('역할 주기·빼기, 이력이 남고 사유는 받지 않는다', async () => {
    const u = await loggedInAgent(web, 'role');
    const g = await opAgent.put(`/admin/accounts/${u.accountId}/roles`).send({ grant: ['operator'] });
    expect(g.status).toBe(200);
    expect(g.body.account.roles).toEqual(['operator', 'user']);
    const rv = await opAgent.put(`/admin/accounts/${u.accountId}/roles`).send({ revoke: ['operator'] });
    expect(rv.body.account.roles).toEqual(['user']);
    const h = await one<{ n: number }>("SELECT COUNT(*) AS n FROM change_history WHERE target_type = 'account' AND target_ref = ? AND field_name IN ('role_granted','role_revoked')", [String(u.accountId)]);
    expect(Number(h!.n)).toBe(2);
    const bad = await opAgent.put(`/admin/accounts/${u.accountId}/roles`).send({ grant: ['api_caller'] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('자기 operator 역할 빼기·자기 사용 중지는 막는다', async () => {
    const r = await opAgent.put(`/admin/accounts/${opAccountId}/roles`).send({ revoke: ['operator'] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ADMIN_SELF_PROTECTED');
    expect((await opAgent.post(`/admin/accounts/${opAccountId}/disable`)).body.error.code).toBe('ADMIN_SELF_PROTECTED');
  });

  it('마지막 operator 는 빼거나 사용 중지할 수 없다', async () => {
    const other = await makeOperator(`acc-op2-${Date.now()}`);
    // 운영자가 둘이면 다른 운영자를 사용 중지할 수 있다
    expect((await opAgent.post(`/admin/accounts/${other}/disable`)).status).toBe(200);
    // 이제 사용 중인 운영자는 나 하나 — 남의 계정으로 시험하려고 나를 끄는 대신, 다른 운영자를 다시 켜고 둘 중 하나를 빼 본다
    expect((await opAgent.post(`/admin/accounts/${other}/enable`)).status).toBe(200);
    await exec('UPDATE account SET disabled_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?', [opAccountId]);
    // 운영자 하나(other)만 남은 상태를 흉내 — 나(opAccountId)는 쿠키가 살아 있어도 requireOperator 가 막으므로 직접 판정 함수를 시험한다
    const { assertCanDropOperator } = await import('../../src/admin/accounts.js');
    await expect(assertCanDropOperator(other, -1)).rejects.toMatchObject({ code: 'ADMIN_LAST_OPERATOR' });
    await exec('UPDATE account SET disabled_at = NULL WHERE account_id = ?', [opAccountId]);
  });

  it('사용 중지하면 그 계정은 바로 로그아웃되고, 다시 사용하면 새로 로그인한다', async () => {
    const u = await loggedInAgent(web, 'disable');
    expect((await u.get('/api/auth/me')).body.account).not.toBeNull();
    expect((await opAgent.post(`/admin/accounts/${u.accountId}/disable`)).status).toBe(200);
    expect((await u.get('/api/auth/me')).body.account).toBeNull();
    const again = await request(web).post('/api/auth/login').send({ email: u.email, password: 'password-1234' });
    expect(again.body.error.code).toBe('LOGIN_FAILED');
    expect((await opAgent.post(`/admin/accounts/${u.accountId}/enable`)).status).toBe(200);
    expect((await request(web).post('/api/auth/login').send({ email: u.email, password: 'password-1234' })).status).toBe(200);
  });

  it('잠금 풀기', async () => {
    const u = await loggedInAgent(web, 'unlock');
    await exec('UPDATE account SET failed_logins = 3, locked_until = CURRENT_TIMESTAMP(3) + INTERVAL 10 MINUTE WHERE account_id = ?', [u.accountId]);
    const r = await opAgent.post(`/admin/accounts/${u.accountId}/unlock`);
    expect(r.status).toBe(200);
    expect(r.body.account.status).toBe('active');
  });
});

describe('권한표·접근 기록', () => {
  it('권한표는 읽기 전용으로 보인다', async () => {
    const r = await opAgent.get('/admin/permissions');
    expect(r.status).toBe(200);
    expect(r.body.table.user).toContain('UC1');
    expect(r.body.table.operator).toContain('UC17');
    expect(r.body.editable).toBe(false);
  });

  it('접근 기록은 G13~G15·G5 와 24시간 요약', async () => {
    await request(web).post('/api/auth/login').send({ email: 'nobody@test.kr', password: 'x' });
    const r = await opAgent.get('/admin/auth-events').query({ gate: 'G15' });
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items.every((x: { gate_code: string }) => x.gate_code === 'G15')).toBe(true);
    expect(r.body.summary.G15).toBeGreaterThan(0);
  });

  it('사용자(역할 user 만)는 관리자 화면 API 를 못 쓴다', async () => {
    const u = await loggedInAgent(web, 'nouser');
    const r = await request(admin).post('/admin/login').send({ login_id: u.email, password: 'password-1234' });
    expect(r.body.error.code).toBe('ADMIN_FORBIDDEN');
  });
});
