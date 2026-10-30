// 세션 (tasks T023): 서명된 HttpOnly·SameSite=Lax 쿠키. 세션 종료 = [나가기]/[로그아웃] 또는 2시간 무활동(spec Clarifications).
// 2026-09-29 RBAC(FR-067): 로그인하면 세션에 계정을 묶는다(anon_session.account_id). 로그인 때는 세션을 새로 발급한다(rotateSession).
import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { exec, one } from '../db/pool.js';
import { sign, verifySigned, hashAddr } from '../lib/ids.js';
import { wrap } from './errors.js';

export const SESSION_COOKIE = 'gugak_sid';

declare module 'express-serve-static-core' {
  interface Request {
    sessionId?: string;
    clientAddrHash?: string;
    /** 로그인한 계정(없으면 방문자) — RBAC */
    accountId?: number;
    /** 계정의 역할들(authz 가 채운다) */
    roles?: string[];
  }
}

async function isEnded(sessionId: string): Promise<boolean> {
  const row = await one<{ is_ended: number }>('SELECT is_ended FROM v_session_state WHERE session_id = ?', [sessionId]);
  return !row || row.is_ended === 1;
}

async function startSession(res: Response): Promise<string> {
  const id = randomUUID();
  await exec('INSERT INTO anon_session (session_id) VALUES (?)', [id]);
  res.cookie(SESSION_COOKIE, `${id}.${sign(id)}`, { httpOnly: true, sameSite: 'lax', path: '/', secure: false });
  return id;
}

export async function sessionMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    req.clientAddrHash = hashAddr(req.ip);
    let id = verifySigned(req.cookies?.[SESSION_COOKIE]);
    if (id && (await isEnded(id))) {
      // 무활동으로 끝난 세션이면 끝난 사실을 적고 새 세션을 준다(음원 삭제는 P0 가 한다)
      await exec(
        "UPDATE anon_session SET ended_at = CURRENT_TIMESTAMP(3), end_reason = 'idle' WHERE session_id = ? AND ended_at IS NULL",
        [id],
      );
      id = null;
    }
    if (!id) {
      id = await startSession(res);
    } else {
      await exec('UPDATE anon_session SET last_active_at = CURRENT_TIMESTAMP(3) WHERE session_id = ?', [id]);
      const row = await one<{ account_id: number | null }>('SELECT account_id FROM anon_session WHERE session_id = ?', [id]);
      if (row?.account_id != null) req.accountId = Number(row.account_id);
    }
    req.sessionId = id;
    next();
  } catch (e) {
    next(e);
  }
}

/** 로그인·가입 성공 — 세션 고정 방지: 옛 세션을 끝내고 계정에 묶은 새 세션을 발급한다(BR-AUTH-02) */
export async function rotateSession(req: Request, res: Response, accountId: number): Promise<string> {
  if (req.sessionId) {
    await exec(
      "UPDATE anon_session SET ended_at = CURRENT_TIMESTAMP(3), end_reason = 'exit' WHERE session_id = ? AND ended_at IS NULL",
      [req.sessionId],
    );
  }
  const id = randomUUID();
  await exec('INSERT INTO anon_session (session_id, account_id) VALUES (?, ?)', [id, accountId]);
  res.cookie(SESSION_COOKIE, `${id}.${sign(id)}`, { httpOnly: true, sameSite: 'lax', path: '/', secure: false });
  req.sessionId = id;
  req.accountId = accountId;
  return id;
}

/** [나가기] — 세션을 끝낸다 */
export async function endSession(sessionId: string, res: Response): Promise<void> {
  await exec(
    "UPDATE anon_session SET ended_at = CURRENT_TIMESTAMP(3), end_reason = 'exit' WHERE session_id = ? AND ended_at IS NULL",
    [sessionId],
  );
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const sessionRouter = Router();

// [나가기] — 세션을 끝낸다. (사용자 음원 .sf2 기능은 2026-09-29 삭제 — 지울 음원이 없다)
sessionRouter.post('/session/end', wrap(async (req, res) => {
  if (req.sessionId) await endSession(req.sessionId, res);
  res.status(204).end();
}));
