// #100 운영자 로그인 · 로그아웃 · 내 정보 + "운영자만" 검사 (기능 목록 FR-051 · v0.1.1 admin/auth.ts · 계약 web-api.yaml /admin/login · logout · me).
//
//   구조에서의 위치: 관리자 화면 → Nginx 관리자 server → admin /admin/* ─ networkGuard(접속 허용 범위) ─ 이 파일 ─▶ DB account · account_role · operator_account · gate_event
//   규칙
//     - 로그인은 일반 계정(account)으로 한다. operator 역할이 있어야 들어온다(없으면 403 ADMIN_FORBIDDEN, G13). 운영자는 명령줄 도구로만 만든다(#26 createOperator).
//     - 비밀번호 틀림 · 없는 계정은 같은 401 ADMIN_LOGIN_FAILED(계정이 있는지 드러내지 않음). 처리 설정의 login_max_failures 번 틀리면 login_lock_minutes 분 잠금(423, 사용자 로그인과 같은 계정 표를 쓴다).
//     - 쿠키 gugak_admin 에는 운영자 번호 · 만료 시각 · 무작위 값을 담아 서명한다. 요청마다 DB 에서 계정 · 역할 · 운영자 사용 여부를 다시 본다 → 역할을 빼거나 사용 중지하면 다음 요청부터 막힌다.
//     - 로그아웃한 쿠키는 만료 시각까지 이 프로세스 메모리에 막아 둔다(revoked). 이 목록은 admin 을 다시 띄우면 사라지므로, 쿠키에 프로세스 시작 표식(BOOT_ID)을 넣어
//       **다시 띄우면 이전 쿠키가 모두 무효**가 되게 했다 → 로그아웃했던 쿠키가 되살아나지 않는다(대신 재시작하면 모든 운영자가 다시 로그인한다). 표에 저장하는 방식은 마이그레이션이 필요해 이번 범위 밖.
//   v0.1.1 과 다른 점: 비밀번호 길이 상한(해시 계산으로 서버를 붙잡는 입력 차단) · 실패 횟수를 한 번에 더함(동시 시도에도 잠금) · 운영자 사용 중지를 로그인 때도 봄 · 무작위 값은 crypto 사용 · https 접속이면 Secure 쿠키
//     · 재시작하면 로그인이 풀림(v0.1.1 은 로그아웃한 쿠키가 재시작 뒤 되살아났다)
import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import argon2 from 'argon2';
import { exec, one } from '../db/pool.js';
import { ApiError, sendError, wrap } from '../web/errors.js';
import { hashAddr, sign, verifySigned } from '../lib/ids.js';
import { currentSettings } from '../config/settings.js';
import { recordGate } from '../services/gateEvents.js';

export const ADMIN_COOKIE = 'gugak_admin';
const SESSION_HOURS = 8;
const MAX_LOGIN_ID = 254;
const MAX_PASSWORD = 1024;

declare module 'express-serve-static-core' {
  interface Request {
    /** #100 로그인한 운영자 번호(operator_account.operator_id) — requireOperator 가 채운다. 변경 이력의 "누가" */
    operatorId?: number;
  }
}

/**
 * 이 프로세스가 시작할 때 정한 무작위 표식 — 쿠키 값에 넣어 서명한다. admin 을 다시 띄우면 표식이 바뀌어 그 전에 낸 쿠키는 모두 무효가 된다.
 * 로그아웃한 쿠키를 막아 둔 목록(revoked)은 메모리에만 있어서, 이게 없으면 재시작 뒤 로그아웃했던 쿠키가 만료(8시간)까지 되살아난다(실제로 확인함).
 * 대신 재시작하면 모든 운영자가 다시 로그인한다 — 관리자 화면에서는 받아들일 수 있는 비용이다.
 */
const BOOT_ID = randomBytes(9).toString('base64url');

/** 로그아웃한 쿠키 값 → 만료 시각(ms). 만료된 것은 넣을 때마다 걷어 내 무한히 커지지 않게 한다 */
const revoked = new Map<string, number>();

function revoke(value: string, expiresAt: number): void {
  const now = Date.now();
  for (const [k, exp] of revoked) if (exp < now) revoked.delete(k);
  revoked.set(value, expiresAt);
}

/** 시험용 — 이 프로세스의 시작 표식. 시험이 "다시 띄운 뒤"의 쿠키를 흉내 낼 때 쓴다 */
export const bootIdForTest = (): string => BOOT_ID;

function issue(req: Request, res: Response, operatorId: number): void {
  // 값: 운영자 번호 : 만료 시각 : 프로세스 표식 : 무작위 (모두 ':' 를 쓰지 않는 글자)
  const value = `${operatorId}:${Date.now() + SESSION_HOURS * 3600_000}:${BOOT_ID}:${randomBytes(9).toString('base64url')}`;
  res.cookie(ADMIN_COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true, sameSite: 'strict', path: '/', maxAge: SESSION_HOURS * 3600_000,
    secure: req.secure, // Nginx 가 넘긴 X-Forwarded-Proto 가 https 일 때만 (로컬 http 접속에서는 쿠키가 막히지 않게)
  });
}

/** 쿠키에서 (서명이 맞고 · 만료 전이고 · 로그아웃하지 않은) 운영자 번호를 꺼낸다. 아니면 null */
function operatorIdFromCookie(token: string | undefined): { operatorId: number; value: string; expiresAt: number } | null {
  const value = verifySigned(token);
  if (!value || revoked.has(value)) return null;
  const [id, exp, boot, nonce, ...rest] = value.split(':');
  const operatorId = Number(id);
  const expiresAt = Number(exp);
  if (rest.length > 0 || !nonce || boot !== BOOT_ID || !Number.isInteger(operatorId) || operatorId <= 0 || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return { operatorId, value, expiresAt };
}

/** 관리자 라우터 앞에 두는 검사 — 로그인한 운영자만 지나가고 req.operatorId 가 채워진다 */
export const requireOperator = wrap(async (req: Request, res: Response, next: NextFunction) => {
  const s = operatorIdFromCookie(req.cookies?.[ADMIN_COOKIE] as string | undefined);
  if (!s) return sendError(res, new ApiError('ADMIN_LOGIN_REQUIRED'));
  const op = await one<{ operator_id: number }>(
    `SELECT o.operator_id FROM operator_account o
       JOIN account a ON a.account_id = o.account_id AND a.disabled_at IS NULL
       JOIN account_role ar ON ar.account_id = a.account_id AND ar.role_code = 'operator'
      WHERE o.operator_id = ? AND o.disabled_at IS NULL`, [s.operatorId]);
  if (!op) return sendError(res, new ApiError('ADMIN_LOGIN_REQUIRED'));
  req.operatorId = Number(op.operator_id);
  next();
});

/** operator 역할 계정의 운영자 번호. 역할이 없거나 운영자가 사용 중지면 null. 운영자 표에 아직 행이 없으면(역할만 받은 계정) 만든다 */
async function operatorOf(accountId: number): Promise<number | null> {
  if (!(await one("SELECT 1 FROM account_role WHERE account_id = ? AND role_code = 'operator'", [accountId]))) return null;
  const find = () => one<{ operator_id: number; disabled_at: Date | null }>(
    'SELECT operator_id, disabled_at FROM operator_account WHERE account_id = ?', [accountId]);
  let o = await find();
  if (!o) {
    // 같은 계정이 동시에 처음 로그인해도 한 행만 생기게 INSERT IGNORE (account_id · login_id 가 유일)
    await exec(
      `INSERT IGNORE INTO operator_account (login_id, password_hash, display_name, account_id)
       SELECT login_id, password_hash, display_name, account_id FROM account WHERE account_id = ?`, [accountId]);
    o = await find();
  }
  if (!o || o.disabled_at) return null;
  return Number(o.operator_id);
}

async function meOf(operatorId: number) {
  const r = await one<{ operator_id: number; login_id_masked: string; display_name: string }>(
    `SELECT m.operator_id, m.login_id_masked, o.display_name FROM v_operator_masked m
       JOIN operator_account o ON o.operator_id = m.operator_id WHERE m.operator_id = ?`, [operatorId]);
  return { operator_id: Number(r?.operator_id ?? operatorId), login_id_masked: r?.login_id_masked ?? null, display_name: r?.display_name ?? null };
}

export const authRouter = Router();

// POST /admin/login → 200 { operator_id, login_id_masked, display_name } + 쿠키 · 401 ADMIN_LOGIN_FAILED · 403 ADMIN_FORBIDDEN · 423 ADMIN_LOCKED
authRouter.post('/login', wrap(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const loginId = typeof body.login_id === 'string' ? body.login_id.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const client = hashAddr(req.ip);
  // 비어 있거나 터무니없이 긴 입력은 해시 계산(argon2)까지 가지 않고 실패로 처리한다
  if (!loginId || !password || loginId.length > MAX_LOGIN_ID || password.length > MAX_PASSWORD) {
    await recordGate('G5', 'admin', 'client', client, 'ADMIN_LOGIN_FAILED');
    throw new ApiError('ADMIN_LOGIN_FAILED');
  }
  const s = await currentSettings();
  const a = await one<{ account_id: number; password_hash: string; locked_until: Date | null; disabled_at: Date | null }>(
    'SELECT account_id, password_hash, locked_until, disabled_at FROM account WHERE login_id = ?', [loginId]);
  if (a?.locked_until && new Date(a.locked_until).getTime() > Date.now()) {
    await recordGate('G5', 'admin', 'account', String(a.account_id), 'ADMIN_LOCKED');
    throw new ApiError('ADMIN_LOCKED', {}, new Date(a.locked_until));
  }
  let ok = false;
  if (a && !a.disabled_at && a.password_hash.startsWith('$argon2')) {
    try { ok = await argon2.verify(a.password_hash, password); } catch { ok = false; }
  }
  if (!ok) {
    if (!a) {
      await recordGate('G5', 'admin', 'client', client, 'ADMIN_LOGIN_FAILED');
      throw new ApiError('ADMIN_LOGIN_FAILED');
    }
    // 읽고 더하지 않고 한 번에 더한다 — 동시에 여러 번 틀려도 횟수가 빠지지 않는다
    await exec('UPDATE account SET failed_logins = failed_logins + 1 WHERE account_id = ?', [a.account_id]);
    const now = await one<{ failed_logins: number }>('SELECT failed_logins FROM account WHERE account_id = ?', [a.account_id]);
    if (Number(now?.failed_logins ?? 0) >= s.login_max_failures) {
      await exec('UPDATE account SET failed_logins = 0, locked_until = CURRENT_TIMESTAMP(3) + INTERVAL ? MINUTE WHERE account_id = ?',
        [s.login_lock_minutes, a.account_id]);
      await recordGate('G5', 'admin', 'account', String(a.account_id), 'ADMIN_LOCKED');
      throw new ApiError('ADMIN_LOCKED', {}, new Date(Date.now() + s.login_lock_minutes * 60_000));
    }
    await recordGate('G5', 'admin', 'account', String(a.account_id), 'ADMIN_LOGIN_FAILED');
    throw new ApiError('ADMIN_LOGIN_FAILED');
  }
  await exec('UPDATE account SET failed_logins = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?', [a!.account_id]);
  const operatorId = await operatorOf(Number(a!.account_id));
  if (operatorId === null) {
    await recordGate('G13', 'admin', 'account', String(a!.account_id), 'ADMIN_FORBIDDEN');
    throw new ApiError('ADMIN_FORBIDDEN');
  }
  issue(req, res, operatorId);
  res.json(await meOf(operatorId));
}));

// POST /admin/logout → 204 (로그인하지 않았어도 204 — 쿠키만 비운다)
authRouter.post('/logout', (req, res) => {
  const s = operatorIdFromCookie(req.cookies?.[ADMIN_COOKIE] as string | undefined);
  if (s) revoke(s.value, s.expiresAt);
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
  res.status(204).end();
});

// GET /admin/me → 200 { operator_id, login_id_masked, display_name } · 401 ADMIN_LOGIN_REQUIRED
authRouter.get('/me', requireOperator, wrap(async (req, res) => { res.json(await meOf(req.operatorId!)); }));
