// T020: 마이그레이션 멱등·객체 수·한글·대표 위반 거부
import { describe, it, expect, afterAll } from 'vitest';
import { query, exec, one } from '../helpers/db.js';
import { migrate } from '../../src/db/migrate.js';
import { closePool } from '../../src/db/pool.js';

afterAll(async () => { await closePool(); });

describe('migrations', () => {
  it('runs again without error (idempotent)', async () => {
    const applied = await migrate({ database: 'gugak_test_web', seed: true, log: () => {} });
    expect(applied.filter((a) => a.startsWith('migrations/'))).toEqual([]);
  });

  it('creates the expected objects', async () => {
    const counts = await query<{ table_type: string; n: number }>(
      "SELECT table_type, COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'gugak_test_web' GROUP BY table_type");
    const by = Object.fromEntries(counts.map((c) => [c.table_type, Number(c.n)]));
    expect(by['BASE TABLE']).toBeGreaterThanOrEqual(35 + 2); // SD_03 35 + 모델 등록부 2 (+ schema_migration)
    expect(by.VIEW).toBeGreaterThanOrEqual(32);
    const trg = await one<{ n: number }>("SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = 'gugak_test_web'");
    expect(Number(trg!.n)).toBeGreaterThanOrEqual(6);
  });

  it('round-trips Korean text', async () => {
    const r = await one<{ name: string }>("SELECT name FROM instrument WHERE code = 'gayageum'");
    expect(r!.name).toBe('가야금');
  });

  const rejects = async (sql: string, params: unknown[] = []) => {
    await expect(exec(sql, params)).rejects.toThrow();
  };

  it('rejects representative violations (SD_03 §15-6)', async () => {
    await rejects('INSERT INTO processing_setting_version (created_by, timeout_seconds) VALUES (1, 0)'); // #1 시간 제한 0
    await rejects("INSERT INTO score_request (request_no, channel, session_id, file_kind, route, setting_version_id) VALUES ('R-T-1','web',NULL,'midi','recognize',1)"); // MIDI 를 인식 경로로
    await rejects("INSERT INTO access_key (key_kind, key_hash, key_prefix, application_no, call_limit_per_hour) VALUES ('external', REPEAT('a',64), 'gk_abcde', 'A-X', 0)"); // 한도 0
    await rejects("INSERT INTO access_key (key_kind, key_hash, key_prefix, issued_by) VALUES ('service', REPEAT('b',64), 'short', 1)"); // 앞자리 8글자
  });

  it('blocks reviving a revoked key (Q3)', async () => {
    const ins = await exec("INSERT INTO access_key (key_kind, key_hash, key_prefix, issued_by) VALUES ('service', REPEAT('c',64), 'gk_ccccc', 1)");
    await exec("UPDATE access_key SET status='revoked', revoked_at=CURRENT_TIMESTAMP(3), revoked_by=1 WHERE key_id=?", [ins.insertId]);
    await rejects("UPDATE access_key SET status='active', revoked_at=NULL, revoked_by=NULL WHERE key_id=?", [ins.insertId]);
  });
});
