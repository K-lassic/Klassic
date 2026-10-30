// #27 세션 — 서명된 HttpOnly · SameSite=Lax 쿠키 gugak_sid (기능 목록 H4 · H5 · v0.1.1 web/session.ts).
//
//   구조에서의 위치: /api/health 를 뺀 모든 /api 요청이 이 미들웨어 → authz → 라우터 순서로 지나간다.
//     세션은 DB anon_session 에 두고(쿠키에는 세션 ID + 서명만), 로그인하면 계정(account_id)을 묶는다.
//     세션 종료 = [나가기] · [로그아웃] · 2시간 무활동(v_session_state, 주기 정리는 주기 작업 이슈).
//   Secure 속성은 #37(HTTPS · Funnel 뒤)에서 정한다 — 지금은 v0.1.1 과 같은 secure:false.
//   세션을 끝낼 때 ended_at = GREATEST(현재, started_at): DB 제약 chk_session_time(ended_at >= started_at) 때문.
//     만들고 바로 끝내는 경우(가입 · 로그인 시 재발급) 서버 PC(WSL2) 시계가 ms 단위로 뒤로 보정되면 제약에 걸려 500 이 났다 (#27 시험에서 발견).
import { Router, type Request, type Response, type NextFunction, type CookieOptions } from 'express';
import { randomUUID } from 'node:crypto';
import { exec, one } from '../db/pool.js';
import { sign, verifySigned, hashAddr } from '../lib/ids.js';
import { wrap } from './errors.js';

export const SESSION_COOKIE = 'gugak_sid';
const COOKIE: CookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', secure: false };

declare module 'express-serve-static-core' {
  interface Request {
    sessionId?: string;
    clientAddrHash?: string;
    /** 로그인한 계정(없으면 방문자) */
    accountId?: number;
    /** 계정의 역할들 (authz 가 채운다) */
    roles?: string[];
  }
}

async function isEnded(sessionId: string): Promise<boolean> {
  const row = await one<{ is_ended: number }>('SELECT is_ended FROM v_session_state WHERE session_id = ?', [sessionId]);
  return !row || Number(row.is_ended) === 1;
}

function setCookie(res: Response, id: string): void {
  res.cookie(SESSION_COOKIE, `${id}.${sign(id)}`, COOKIE);
}

async function startSession(res: Response): Promise<string> {
  const id = randomUUID();
  await exec('INSERT INTO anon_session (session_id) VALUES (?)', [id]);
  setCookie(res, id);
  return id;
}

export async function sessionMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    req.clientAddrHash = hashAddr(req.ip);
    let id = verifySigned(req.cookies?.[SESSION_COOKIE]);
    if (id && (await isEnded(id))) {
      // 무활동으로 끝난 세션이면 끝난 사실을 적고 새 세션을 준다
      await exec(
        "UPDATE anon_session SET ended_at = GREATEST(CURRENT_TIMESTAMP(3), started_at), end_reason = 'idle' WHERE session_id = ? AND ended_at IS NULL",
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

/** 로그인 · 가입 성공 — 세션 고정 공격 방지: 옛 세션을 끝내고 계정에 묶은 새 세션을 발급한다 (H5) */
export async function rotateSession(req: Request, res: Response, accountId: number): Promise<string> {
  if (req.sessionId) {
    await exec(
      "UPDATE anon_session SET ended_at = GREATEST(CURRENT_TIMESTAMP(3), started_at), end_reason = 'exit' WHERE session_id = ? AND ended_at IS NULL",
      [req.sessionId],
    );
  }
  const id = randomUUID();
  await exec('INSERT INTO anon_session (session_id, account_id) VALUES (?, ?)', [id, accountId]);
  setCookie(res, id);
  req.sessionId = id;
  req.accountId = accountId;
  return id;
}

/** [나가기] · [로그아웃] — 세션을 끝내고 쿠키를 지운다 */
export async function endSession(sessionId: string, res: Response): Promise<void> {
  await exec(
    "UPDATE anon_session SET ended_at = GREATEST(CURRENT_TIMESTAMP(3), started_at), end_reason = 'exit' WHERE session_id = ? AND ended_at IS NULL",
    [sessionId],
  );
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const sessionRouter = Router();

// POST /api/session/end — [나가기]: 세션만 끝낸다 (계약 web-api.yaml UC16)
sessionRouter.post('/session/end', wrap(async (req, res) => {
  if (req.sessionId) await endSession(req.sessionId, res);
  res.status(204).end();
}));
