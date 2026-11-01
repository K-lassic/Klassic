// #44 DB 기준 파일 시험 — 객체 수 · 한글 · 대표 위반 거부 (v0.1.1 tests/integration/migrate.test.ts). 실제 MariaDB 필요.
//   실행기(api/db/migrate.sh)가 다시 돌려도 안전한지는 compose 로 두 번 실행해 확인한다 — 백엔드 README 「시험」.
import { HAS_DB } from '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let db: typeof import('../../src/db/pool.js');

beforeAll(async () => { if (HAS_DB) db = await import('../../src/db/pool.js'); });
afterAll(async () => { if (HAS_DB) await db.closePool(); });

const rejects = (sql: string, params: unknown[] = []) => expect(db.exec(sql, params)).rejects.toThrow();

describe.skipIf(!HAS_DB)('DB 기준 파일', () => {
  it('v0.1.1 의 표 · 뷰 · 트리거가 모두 있다', async () => {
    const schema = process.env.DB_NAME!;
    const counts = await db.query<{ table_type: string; n: number }>(
      'SELECT table_type, COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? GROUP BY table_type', [schema]);
    const by = Object.fromEntries(counts.map((c) => [c.table_type, Number(c.n)]));
    expect(by['BASE TABLE']).toBeGreaterThanOrEqual(37);
    expect(by.VIEW).toBeGreaterThanOrEqual(32);
    const triggers = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = ?', [schema]);
    expect(Number(triggers!.n)).toBeGreaterThanOrEqual(6);
  });

  it('적용 기록이 남아 다음 실행에서 건너뛴다', async () => {
    const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM schema_migration');
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(2);
  });

  it('한글이 깨지지 않는다', async () => {
    expect((await db.one<{ name: string }>("SELECT name FROM instrument WHERE code = 'gayageum'"))!.name).toBe('가야금');
  });

  it('대표 규칙 위반을 DB 가 막는다', async () => {
    await rejects('INSERT INTO processing_setting_version (created_by, timeout_seconds) VALUES (1, 0)'); // 시간 제한 0
    await rejects("INSERT INTO score_request (request_no, channel, session_id, file_kind, route, setting_version_id) VALUES ('R-T-1','web',NULL,'midi','recognize',1)");
    await rejects("INSERT INTO access_key (key_kind, key_hash, key_prefix, application_no, call_limit_per_hour) VALUES ('external', REPEAT('a',64), 'gk_abcde', 'A-X', 0)"); // 한도 0
    await rejects("INSERT INTO access_key (key_kind, key_hash, key_prefix, issued_by) VALUES ('service', REPEAT('b',64), 'short', 1)"); // 앞자리 8글자
  });

  it('폐기한 키는 되살릴 수 없다', async () => {
    const ins = await db.exec("INSERT INTO access_key (key_kind, key_hash, key_prefix, issued_by) VALUES ('service', SHA2(UUID(), 256), 'gk_ccccc', 1)"); // 시험 DB 를 다시 써도 겹치지 않게
    await db.exec("UPDATE access_key SET status='revoked', revoked_at=CURRENT_TIMESTAMP(3), revoked_by=1 WHERE key_id=?", [ins.insertId]);
    await rejects("UPDATE access_key SET status='active', revoked_at=NULL, revoked_by=NULL WHERE key_id=?", [ins.insertId]);
  });
});
