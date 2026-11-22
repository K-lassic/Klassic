// #34 웹 사용자 요청 한도(게이트 G12) — 계정 · 접속 주소별로 ① 처리 중 · 대기 중 요청 ② 시간당 접수 상한. 넘으면 접수 전에 반려하고 다시 시도 시각을 준다.
//
//   구조에서의 위치: requests.ts → 이 파일 → DB 뷰 v_web_request_limit. 값은 처리 설정 판본에서 읽는다.
//     접속 주소는 해시로만 센다 (Nginx X-Forwarded-For → req.ip → hashAddr).
//   v0.1.1 web/webLimit.ts 와 같은 검사. 다른 점(#197): 검사와 접수 INSERT 사이가 벌어져 같은 순간에 출발한 요청이 모두 통과하던 경쟁을
//     막으려고, 계정 · 주소 키마다 MariaDB 이름 잠금(GET_LOCK)을 잡고 그 안에서 검사 → 저장 → INSERT 까지 한다 (withWebLimitLock).
import { getPool, query } from '../db/pool.js';
import type { Settings } from '../config/settings.js';
import { ApiError } from './errors.js';

interface LimitRow { limit_key: string; active_count: number; hourly_count: number; hourly_retry_at: Date | null }

export async function enforceWebLimit(accountId: number, addrHash: string, s: Settings): Promise<void> {
  const rows = await query<LimitRow>(
    'SELECT limit_key, active_count, hourly_count, hourly_retry_at FROM v_web_request_limit WHERE limit_key IN (?, ?)',
    [`account:${accountId}`, `addr:${addrHash}`],
  );
  const maxActive = s.web_max_active_per_client;
  const cap = s.web_hourly_request_cap;
  for (const r of rows) {
    if (maxActive != null && Number(r.active_count) >= maxActive) {
      // 처리 중 요청은 처리 시간 제한 안에 끝나므로 그 뒤를 다시 시도 시각으로 안내한다
      throw new ApiError('WEB_ACTIVE_REQUEST_EXISTS', { scope: r.limit_key.split(':')[0], active: Number(r.active_count) },
        new Date(Date.now() + Math.min(s.timeout_seconds, 60) * 1000));
    }
  }
  for (const r of rows) {
    if (cap != null && Number(r.hourly_count) >= cap) {
      throw new ApiError('WEB_HOURLY_LIMIT', { scope: r.limit_key.split(':')[0], cap },
        r.hourly_retry_at ? new Date(r.hourly_retry_at) : new Date(Date.now() + 3600_000));
    }
  }
}

/** 잠금을 기다리는 최대 시간(초) — 같은 계정 · 주소의 앞선 접수가 파일을 저장하는 동안만 기다린다 */
const LOCK_WAIT_SECONDS = 10;

/**
 * #197 같은 계정 · 같은 주소의 접수를 한 번에 하나씩 지나가게 한다. 검사(enforceWebLimit)와 접수 행 INSERT 를 fn 안에서 모두 끝내야 한다.
 *  - 잠금 이름: g12:account:<id> · g12:addr:<해시 앞 40자>(이름 최대 64자). 항상 이 순서로 잡아 교착을 막는다.
 *  - GET_LOCK 은 연결 단위라 전용 연결 하나로 잡고 풀어 준다. 접수 INSERT 는 다른 연결(tx)이 하고, 커밋된 뒤에 풀리므로 다음 요청이 그 행을 본다.
 *  - 기다려도 못 잡으면(앞선 접수가 오래 걸림) 처리 중 요청이 있는 것과 같으므로 WEB_ACTIVE_REQUEST_EXISTS 로 반려한다.
 */
export async function withWebLimitLock<T>(accountId: number, addrHash: string, s: Settings, fn: () => Promise<T>): Promise<T> {
  const names = [`g12:account:${accountId}`, `g12:addr:${addrHash.slice(0, 40)}`];
  const conn = await getPool().getConnection();
  const held: string[] = [];
  try {
    for (const name of names) {
      const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [name, LOCK_WAIT_SECONDS]);
      if (Number((rows as { got: number | null }[])[0]?.got) !== 1) {
        throw new ApiError('WEB_ACTIVE_REQUEST_EXISTS', { scope: name.split(':')[1], active: 1 },
          new Date(Date.now() + Math.min(s.timeout_seconds, 60) * 1000));
      }
      held.push(name);
    }
    return await fn();
  } finally {
    try { for (const name of held.reverse()) await conn.query('SELECT RELEASE_LOCK(?)', [name]); }
    finally { conn.release(); }
  }
}
