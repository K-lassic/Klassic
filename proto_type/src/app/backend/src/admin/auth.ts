// 운영자 로그인 (tasks T092, FR-051·BR-OPS-07): 개인 계정 + argon2id, 연속 실패하면 잠금(설정값).
// 2026-09-29 RBAC(FR-051·FR-068): 계정 표(account)로 로그인하고 operator 역할이 있어야 한다(없으면 ADMIN_FORBIDDEN, G13).
// 쿠키에는 계속 operator_account.operator_id 를 담는다 — 설정 이력 등이 이 번호를 FK 로 쓴다.
import { Router, type Request, type Response, type NextFunction } from 'express';
import argon2 from 'argon2';
import { exec, one, tx } from '../db/pool.js';
import { ApiError, wrap, sendError } from '../web/errors.js';
import { sign, verifySigned } from '../lib/ids.js';
import { currentSettings } from '../config/settings.js';
import { recordGate } from '../services/gateEvents.js';

export const ADMIN_COOKIE = 'gugak_admin';
const SESSION_HOURS = 8;
const revoked = new Set<string>();

declare module 'express-serve-static-core' {
  interface Request { operatorId?: number }
}

function issue(res: Response, operatorId: number): void {
  const value = `${operatorId}:${Date.now() + SESSION_HOURS * 3600_000}:${Math.random().toString(36).slice(2)}`;
  res.cookie(ADMIN_COOKIE, `${value}.${sign(value)}`, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: SESSION_HOURS * 3600_000 });
}

export async function requireOperator(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[ADMIN_COOKIE] as string | undefined;
  const value = verifySigned(token);
  if (!value || revoked.has(value)) return sendError(res, new ApiError('ADMIN_LOGIN_REQUIRED'));
  const [id, exp] = value.split(':');
  if (Number(exp) < Date.now()) return sendError(res, new ApiError('ADMIN_LOGIN_REQUIRED'));
  const op = await one<{ operator_id: number }>(
    `SELECT o.operator_id FROM operator_account o
       JOIN account a ON a.account_id = o.account_id AND a.disabled_at IS NULL
       JOIN account_role ar ON ar.account_id = a.account_id AND ar.role_code = 'operator'
      WHERE o.operator_id = ? AND o.disabled_at IS NULL`, [Number(id)]);
  if (!op) return sendError(res, new ApiError('ADMIN_LOGIN_REQUIRED'));
  req.operatorId = op.operator_id;
  next();
}

export const authRouter = Router();

/** 계정에 이어지지 않은 옛 운영자(마이그레이션 뒤 운영자 표에만 만든 경우)를 같은 아이디·비밀번호 해시로 계정에 잇고 operator 역할을 준다 */
async function linkLegacyOperator(loginId: string): Promise<void> {
  const o = await one<{ operator_id: number; password_hash: string; display_name: string; disabled_at: Date | null }>(
    'SELECT operator_id, password_hash, display_name, disabled_at FROM operator_account WHERE login_id = ? AND account_id IS NULL', [loginId]);
  if (!o) return;
  await tx(async (conn) => {
    await conn.query('INSERT IGNORE INTO account (login_id, password_hash, display_name, disabled_at) VALUES (?, ?, ?, ?)',
      [loginId, o.password_hash, o.display_name, o.disabled_at]);
    const [rows] = await conn.query('SELECT account_id FROM account WHERE login_id = ?', [loginId]);
    const accountId = (rows as { account_id: number }[])[0].account_id;
    await conn.query('UPDATE operator_account SET account_id = ? WHERE operator_id = ?', [accountId, o.operator_id]);
    await conn.query("INSERT IGNORE INTO account_role (account_id, role_code) VALUES (?, 'operator')", [accountId]);
  });
}

/** operator 역할 계정의 운영자 표 번호 — 없으면 만든다(역할만 받은 계정) */
async function operatorIdOf(accountId: number): Promise<number> {
  const o = await one<{ operator_id: number }>('SELECT operator_id FROM operator_account WHERE account_id = ?', [accountId]);
  if (o) return Number(o.operator_id);
  const a = await one<{ login_id: string; password_hash: string; display_name: string }>(
    'SELECT login_id, password_hash, display_name FROM account WHERE account_id = ?', [accountId]);
  const r = await exec('INSERT INTO operator_account (login_id, password_hash, display_name, account_id) VALUES (?, ?, ?, ?)',
    [a!.login_id, a!.password_hash, a!.display_name, accountId]);
  return Number(r.insertId);
}

authRouter.post('/login', wrap(async (req, res) => {
  const loginId = String(req.body?.login_id ?? '').trim();
  const password = String(req.body?.password ?? '');
  const s = await currentSettings();
  await linkLegacyOperator(loginId);
  const a = await one<{ account_id: number; password_hash: string; failed_logins: number; locked_until: Date | null; disabled_at: Date | null }>(
    'SELECT account_id, password_hash, failed_logins, locked_until, disabled_at FROM account WHERE login_id = ?', [loginId]);
  if (a?.locked_until && new Date(a.locked_until).getTime() > Date.now()) {
    await recordGate('G5', 'admin', 'account', String(a.account_id), 'ADMIN_LOCKED');
    throw new ApiError('ADMIN_LOCKED', {}, new Date(a.locked_until));
  }
  let ok = false;
  if (a && !a.disabled_at && a.password_hash.startsWith('$argon2')) {
    try { ok = await argon2.verify(a.password_hash, password); } catch { ok = false; }
  }
  if (!ok) {
    if (a) {
      const fails = Number(a.failed_logins) + 1;
      const lock = fails >= (s.login_max_failures ?? 5);
      await exec(
        `UPDATE account SET failed_logins = ?, locked_until = ${lock ? 'CURRENT_TIMESTAMP(3) + INTERVAL ? MINUTE' : 'NULL'} WHERE account_id = ?`,
        lock ? [0, s.login_lock_minutes ?? 10, a.account_id] : [fails, a.account_id]);
      await recordGate('G5', 'admin', 'account', String(a.account_id), lock ? 'ADMIN_LOCKED' : 'ADMIN_LOGIN_FAILED');
      if (lock) throw new ApiError('ADMIN_LOCKED', {}, new Date(Date.now() + (s.login_lock_minutes ?? 10) * 60_000));
    } else {
      await recordGate('G5', 'admin', 'client', null, 'ADMIN_LOGIN_FAILED');
    }
    throw new ApiError('ADMIN_LOGIN_FAILED');
  }
  await exec('UPDATE account SET failed_logins = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?', [a!.account_id]);
  const hasOperator = await one("SELECT 1 FROM account_role WHERE account_id = ? AND role_code = 'operator'", [a!.account_id]);
  if (!hasOperator) {
    await recordGate('G13', 'admin', 'account', String(a!.account_id), 'ADMIN_FORBIDDEN');
    throw new ApiError('ADMIN_FORBIDDEN');
  }
  const operatorId = await operatorIdOf(Number(a!.account_id));
  issue(res, operatorId);
  res.json(await me(operatorId));
}));

authRouter.post('/logout', (req, res) => {
  const value = verifySigned(req.cookies?.[ADMIN_COOKIE]);
  if (value) revoked.add(value);
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
  res.status(204).end();
});

async function me(operatorId: number) {
  const r = await one<{ operator_id: number; login_id_masked: string; display_name: string }>(
    `SELECT m.operator_id, m.login_id_masked, o.display_name FROM v_operator_masked m
       JOIN operator_account o ON o.operator_id = m.operator_id WHERE m.operator_id = ?`, [operatorId]);
  return { operator_id: r?.operator_id, login_id_masked: r?.login_id_masked, display_name: r?.display_name };
}

authRouter.get('/me', requireOperator, wrap(async (req, res) => { res.json(await me(req.operatorId!)); }));
