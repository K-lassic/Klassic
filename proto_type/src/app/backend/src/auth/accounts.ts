// 가입·로그인·로그아웃 (FR-066·FR-067, design/UC_16, SD_01 P7 7.1~7.4 · G14·G15).
// 가입하면 user 역할만 받고 바로 로그인된다. 로그인은 5회 실패 10분 잠금(설정값, 관리자 로그인과 같은 규칙).
import { Router, type Request } from 'express';
import argon2 from 'argon2';
import { exec, one, query, tx } from '../db/pool.js';
import { ApiError, wrap } from '../web/errors.js';
import { currentSettings } from '../config/settings.js';
import { recordGate } from '../services/gateEvents.js';
import { endSession, rotateSession } from '../web/session.js';
import { env } from '../config/env.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface AccountRow {
  account_id: number; login_id: string; display_name: string; password_hash: string;
  failed_logins: number; locked_until: Date | null; disabled_at: Date | null;
}

export async function rolesOf(accountId: number): Promise<string[]> {
  const rows = await query<{ role_code: string }>(
    `SELECT ar.role_code FROM account_role ar JOIN account a ON a.account_id = ar.account_id
      WHERE ar.account_id = ? AND a.disabled_at IS NULL ORDER BY ar.role_code`, [accountId]);
  return rows.map((r) => r.role_code);
}

async function meBody(accountId: number) {
  const a = await one<{ account_id: number; login_id: string; display_name: string }>(
    'SELECT account_id, login_id, display_name FROM account WHERE account_id = ? AND disabled_at IS NULL', [accountId]);
  if (!a) return { account: null, roles: [] as string[] };
  return { account: { account_id: Number(a.account_id), login_id: a.login_id, display_name: a.display_name }, roles: await rolesOf(accountId) };
}

function gateSubject(req: Request): string | null { return req.clientAddrHash ?? null; }

export const accountsRouter = Router();

accountsRouter.post('/auth/signup', wrap(async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const name = String(req.body?.name ?? '').trim();
  if (!EMAIL.test(email) || email.length > 254 || password.length < 8 || password.length > 200 || !name || name.length > 100) {
    await recordGate('G14', 'web', 'client', gateSubject(req), 'SIGNUP_INVALID');
    throw new ApiError('SIGNUP_INVALID', {
      email: EMAIL.test(email) && email.length <= 254, password: password.length >= 8 && password.length <= 200, name: !!name && name.length <= 100,
    });
  }
  const recent = await one<{ n: number; first_at: Date | null }>(
    `SELECT COUNT(*) AS n, MIN(created_at) AS first_at FROM account
      WHERE signup_addr_hash = ? AND created_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR`, [req.clientAddrHash ?? '']);
  if (Number(recent?.n ?? 0) >= env.SIGNUP_HOURLY_CAP) {
    await recordGate('G14', 'web', 'client', gateSubject(req), 'SIGNUP_RATE_LIMITED');
    const retry = recent?.first_at ? new Date(new Date(recent.first_at).getTime() + 3600_000) : new Date(Date.now() + 3600_000);
    throw new ApiError('SIGNUP_RATE_LIMITED', {}, retry);
  }
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  let accountId: number;
  try {
    accountId = await tx(async (conn) => {
      const [ins] = await conn.query(
        'INSERT INTO account (login_id, password_hash, display_name, signup_addr_hash, last_login_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))',
        [email, hash, name, req.clientAddrHash ?? null]);
      const id = Number((ins as { insertId: number }).insertId);
      await conn.query("INSERT INTO account_role (account_id, role_code) VALUES (?, 'user')", [id]);
      return id;
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
      await recordGate('G14', 'web', 'client', gateSubject(req), 'SIGNUP_EMAIL_TAKEN');
      throw new ApiError('SIGNUP_EMAIL_TAKEN');
    }
    throw e;
  }
  await rotateSession(req, res, accountId);
  res.status(201).json(await meBody(accountId));
}));

accountsRouter.post('/auth/login', wrap(async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const s = await currentSettings();
  const maxFails = s.login_max_failures ?? 5;
  const lockMinutes = s.login_lock_minutes ?? 10;
  const a = await one<AccountRow>(
    `SELECT account_id, login_id, display_name, password_hash, failed_logins, locked_until, disabled_at
       FROM account WHERE login_id = ?`, [email]);
  if (a?.locked_until && new Date(a.locked_until).getTime() > Date.now()) {
    await recordGate('G15', 'web', 'account', String(a.account_id), 'LOGIN_LOCKED');
    throw new ApiError('LOGIN_LOCKED', {}, new Date(a.locked_until));
  }
  let ok = false;
  if (a && !a.disabled_at && a.password_hash.startsWith('$argon2')) {
    try { ok = await argon2.verify(a.password_hash, password); } catch { ok = false; }
  }
  if (!ok) {
    if (a) {
      const fails = Number(a.failed_logins) + 1;
      if (fails >= maxFails) {
        await exec('UPDATE account SET failed_logins = 0, locked_until = CURRENT_TIMESTAMP(3) + INTERVAL ? MINUTE WHERE account_id = ?',
          [lockMinutes, a.account_id]);
        await recordGate('G15', 'web', 'account', String(a.account_id), 'LOGIN_LOCKED');
        throw new ApiError('LOGIN_LOCKED', {}, new Date(Date.now() + lockMinutes * 60_000));
      }
      await exec('UPDATE account SET failed_logins = ? WHERE account_id = ?', [fails, a.account_id]);
      await recordGate('G15', 'web', 'account', String(a.account_id), 'LOGIN_FAILED');
    } else {
      await recordGate('G15', 'web', 'client', gateSubject(req), 'LOGIN_FAILED');
    }
    throw new ApiError('LOGIN_FAILED');
  }
  // (2026-10-01 황송해 209번, UC16 E7 · BR-AUTH-02) 한 계정은 한 곳에서만 — 비밀번호가 맞은 뒤에만 본다(틀리면 로그인 상태를 드러내지 않음)
  if (req.accountId) {
    await recordGate('G15', 'web', 'account', String(a!.account_id), 'ALREADY_LOGGED_IN');
    throw new ApiError('ALREADY_LOGGED_IN');
  }
  const active = await one<{ session_id: string }>(
    `SELECT s.session_id FROM anon_session s JOIN v_session_state v ON v.session_id = s.session_id
      WHERE s.account_id = ? AND s.ended_at IS NULL AND v.is_ended = 0 AND s.session_id <> ?
        AND s.last_active_at > CURRENT_TIMESTAMP(3) - INTERVAL 10 MINUTE LIMIT 1`,   // (212번) 최근 10분 안에 활동한 곳만 '로그인 중'
    [a!.account_id, req.sessionId ?? '']);
  if (active) {
    await recordGate('G15', 'web', 'account', String(a!.account_id), 'LOGIN_ALREADY_ACTIVE');
    throw new ApiError('LOGIN_ALREADY_ACTIVE');
  }
  await exec('UPDATE account SET failed_logins = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?',
    [a!.account_id]);
  await rotateSession(req, res, Number(a!.account_id));
  res.json(await meBody(Number(a!.account_id)));
}));

accountsRouter.post('/auth/logout', wrap(async (req, res) => {
  if (req.sessionId) await endSession(req.sessionId, res);
  res.status(204).end();
}));

accountsRouter.get('/auth/me', wrap(async (req, res) => {
  if (!req.accountId) { res.json({ account: null, roles: [] }); return; }
  res.json(await meBody(req.accountId));
}));
