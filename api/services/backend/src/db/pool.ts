// #23 DB 연결 — mysql2 풀, utf8mb4, 시각은 UTC. v0.1.1 과 같은 도우미 이름(query · one · exec · tx).
//
//   구조에서의 위치: backend → MariaDB(서비스 이름 db, #20). 요청 · 결과 · 계정 · 설정 판본을 읽고 쓴다.
//     파일 본체는 저장소 볼륨에 두고 DB 에는 위치(*_uri)만 남긴다 (지난 발표 피드백 2번 — 파일 정리 · 일치 확인의 기준).
//   v0.1.1 과 다른 점: 시작할 때 연결 재시도 후 포기 (작성규칙 1-5 · #5 C3). 운영 중 끊김은 풀이 다시 연결한다.
import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const e = env();
    pool = mysql.createPool({
      host: e.DB_HOST, port: e.DB_PORT, user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME,
      charset: 'utf8mb4', timezone: 'Z', connectionLimit: 10, decimalNumbers: true,
    });
    pool.on('connection', (conn) => { conn.query("SET time_zone = '+00:00'"); });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}

/**
 * 시작할 때 DB 가 받을 준비가 될 때까지 기다린다 — 정해진 횟수만큼 다시 해 보고, 그래도 안 되면 분명히 실패한다.
 * compose 의 depends_on(service_healthy)이 시작 순서를, 이 재시도가 그 사이의 짧은 틈을 맡는다 (두 층)
 */
export async function waitForDb(tries = 5, delayMs = 2000): Promise<void> {
  for (let i = 1; i <= tries; i++) {
    try {
      await getPool().query('SELECT 1');
      if (i > 1) logger.info({ attempt: i }, 'DB 연결됨');
      return;
    } catch (e) {
      if (i === tries) throw e;
      logger.warn({ attempt: i, tries, err: e }, 'DB 연결 실패 — 다시 시도');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export type Row = RowDataPacket & Record<string, unknown>;

export async function query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function exec(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await getPool().query<ResultSetHeader>(sql, params);
  return res;
}

/** #91 DB 트리거 SIGNAL 의 문구 — 다른 오류면 null */
export function signalMessage(e: unknown): string | null {
  const err = e as { sqlState?: string; sqlMessage?: string };
  return err?.sqlState === '45000' ? (err.sqlMessage ?? '') : null;
}

/** 한 트랜잭션으로 묶는다 — 실패하면 모두 되돌린다 */
export async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
