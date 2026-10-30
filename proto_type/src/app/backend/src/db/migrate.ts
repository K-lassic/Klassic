// 마이그레이션 실행기 (tasks T018): app/db/migrations/*.sql 을 순서대로 한 번씩 적용하고 schema_migration 에 남긴다.
// DELIMITER 블록(트리거)을 처리한다. `--seed` 면 app/db/seeds/*.sql 도 적용한다(멱등).
// 팀 DB 에 적용할 때는 .env 의 DB_* 가 팀 DB 를 가리키는지 먼저 확인한다.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { APP_ROOT, env } from '../config/env.js';

/** DELIMITER 지시어를 풀어 문장 목록으로 나눈다 */
export function splitSql(text: string): string[] {
  const out: string[] = [];
  let delimiter = ';';
  let buf = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const m = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (m) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      delimiter = m[1];
      continue;
    }
    buf += line + '\n';
    let idx: number;
    while ((idx = findDelimiter(buf, delimiter)) >= 0) {
      const stmt = buf.slice(0, idx).trim();
      if (hasSql(stmt)) out.push(stmt);
      buf = buf.slice(idx + delimiter.length);
    }
  }
  if (hasSql(buf)) out.push(buf.trim());
  return out;
}

// 주석 줄만 있는 조각은 문장이 아니다
function hasSql(s: string): boolean {
  return s.split('\n').some((l) => { const t = l.trim(); return t !== '' && !t.startsWith('--'); });
}

// 따옴표·주석 밖의 구분자 위치
function findDelimiter(s: string, d: string): number {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '-' && s[i + 1] === '-') { const nl = s.indexOf('\n', i); if (nl < 0) return -1; i = nl; continue; }
    if (s.startsWith(d, i)) return i;
  }
  return -1;
}

export interface MigrateOptions { database?: string; seed?: boolean; markApplied?: string[]; log?: (m: string) => void }

export async function migrate(opts: MigrateOptions = {}): Promise<string[]> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD,
    database: opts.database ?? env.DB_NAME, charset: 'utf8mb4', multipleStatements: false,
  });
  const applied: string[] = [];
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      file_name VARCHAR(200) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) DEFAULT CHARSET=utf8mb4`);
    const [rows] = await conn.query('SELECT file_name FROM schema_migration');
    const done = new Set((rows as { file_name: string }[]).map((r) => r.file_name));
    // 적용 기록 없이 손으로 스키마를 만든 DB 는 001 을 다시 돌리면 뒤 마이그레이션이 바꾼 컬럼과 부딪힌다 — 멈추고 알린다
    if (done.size === 0) {
      const [t] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'score_request'");
      if (Number((t as { n: number }[])[0].n) > 0 && !opts.markApplied?.length) {
        throw new Error('이 DB 에는 이미 스키마가 있는데 적용 기록(schema_migration)이 없습니다. 어디까지 적용했는지 확인한 뒤 '
          + '`npm run db:migrate -- --mark-applied 001_sd03_baseline.sql,002_sd03_amendments.sql` 처럼 기록만 남기세요.');
      }
    }
    for (const f of opts.markApplied ?? []) {
      await conn.query('INSERT IGNORE INTO schema_migration (file_name) VALUES (?)', [`migrations/${f}`]);
      done.add(`migrations/${f}`);
      log(`marked migrations/${f} as applied`);
    }
    const dirs: [string, boolean][] = [[resolve(APP_ROOT, 'db', 'migrations'), true]];
    if (opts.seed) dirs.push([resolve(APP_ROOT, 'db', 'seeds'), false]);
    for (const [dir, once] of dirs) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
        const key = `${once ? 'migrations' : 'seeds'}/${file}`;
        if (once && done.has(key)) continue;
        for (const stmt of splitSql(readFileSync(resolve(dir, file), 'utf8'))) {
          await conn.query(stmt);
        }
        if (once) await conn.query('INSERT INTO schema_migration (file_name) VALUES (?)', [key]);
        applied.push(key);
        log(`applied ${key}`);
      }
    }
  } finally {
    await conn.end();
  }
  return applied;
}

const isMain = process.argv[1] && resolve(process.argv[1]).includes('migrate');
if (isMain) {
  const i = process.argv.indexOf('--mark-applied');
  const markApplied = i >= 0 ? (process.argv[i + 1] ?? '').split(',').filter(Boolean) : undefined;
  migrate({ seed: process.argv.includes('--seed'), markApplied })
    .then((a) => { console.log(a.length ? `done (${a.length})` : 'nothing to apply'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
