// mysql2 풀 (tasks T019): utf8mb4, 시각은 UTC(D-19).
import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { env } from '../config/env.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
      charset: 'utf8mb4', timezone: 'Z', dateStrings: false, connectionLimit: 10, decimalNumbers: true,
    });
    pool.on('connection', (conn) => {
      conn.query("SET time_zone = '+00:00'");
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
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

/** 한 트랜잭션으로 묶는다(예: 키 발급 = access_key + key_application, SD_03 §9-3 ⑤) */
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

/** MariaDB 트리거의 SIGNAL(45000) 메시지를 알아본다 */
export function signalMessage(e: unknown): string | null {
  const err = e as { sqlState?: string; sqlMessage?: string };
  return err?.sqlState === '45000' ? (err.sqlMessage ?? '') : null;
}
