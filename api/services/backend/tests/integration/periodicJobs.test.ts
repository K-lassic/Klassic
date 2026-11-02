// #85 주기 정리 통합 시험 — 실제 MariaDB 필요 (TEST_DB_HOST 가 있을 때만 돈다). model-api 는 가짜.
//   v0.1.1 us7_us8 세션 부분과, 재시작 · 고아 파일 · 실패 격리 · 잠금을 시험한다.
//   시험 파일들이 DB 를 같이 쓰므로 정리 건수는 "이 요청이 어떻게 됐는가"로 확인한다.
import { HAS_DB } from '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import request from 'supertest';
import type { Server } from 'node:http';
import { SAMPLE_MUSICXML, makePng } from '../helpers/files.js';
import type { FakeModelApi } from '../helpers/fakeModelApi.js';

let app: Server;
let fake: FakeModelApi;
let db: typeof import('../../src/db/pool.js');
let h: typeof import('../helpers/db.js');
let jobs: typeof import('../../src/services/periodicJobs.js');
let loggedInAgent: typeof import('../helpers/auth.js').loggedInAgent;

const storage = (...p: string[]) => join(process.env.STORAGE_DIR!, ...p);

beforeAll(async () => {
  if (!HAS_DB) return;
  const { serve } = await import('../helpers/serve.js');
  const { createWebApp } = await import('../../src/app.js');
  const { startFakeModelApi } = await import('../helpers/fakeModelApi.js');
  db = await import('../../src/db/pool.js');
  h = await import('../helpers/db.js');
  jobs = await import('../../src/services/periodicJobs.js');
  ({ loggedInAgent } = await import('../helpers/auth.js'));
  app = serve(createWebApp());
  fake = await startFakeModelApi();
  await h.setSettings({ web_max_active_per_client: 100000, web_hourly_request_cap: 100000 });
});
afterAll(async () => { if (HAS_DB) { await fake.close(); await db.closePool(); } });

/** 업로드 · 결과까지 만든 요청. expire 면 보관 기간을 지나게 한다 */
async function makeRequest(name: string, expire = true): Promise<{ no: string; id: number }> {
  const u = await loggedInAgent(app, name);
  const up = await u.post('/api/requests').field('score_type', 'staff').attach('file', makePng(1000, 900), 'a.png');
  expect(up.status).toBe(202);
  const id = await h.completeRecognized(up.body.id, SAMPLE_MUSICXML);
  if (expire) {
    await db.exec(`UPDATE score_request SET received_at = CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY,
                   completed_at = CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY WHERE request_id = ?`, [id]);
  }
  return { no: up.body.id, id };
}

const purgedAt = async (id: number) => (await db.one<{ purged_at: Date | null }>(
  'SELECT purged_at FROM score_request WHERE request_id = ?', [id]))!.purged_at;

describe.skipIf(!HAS_DB)('보관 기간 정리', () => {
  it('지난 요청의 파일을 지우고 DB 위치를 비우되, 기록 행은 남긴다', async () => {
    const r = await makeRequest('due');
    expect(existsSync(storage(r.no))).toBe(true);

    const out = await jobs.runPeriodicJobs();
    expect(out!.purged).toBeGreaterThan(0);

    expect(existsSync(storage(r.no))).toBe(false);
    expect(await purgedAt(r.id)).not.toBeNull();
    const up = await db.one<{ storage_uri: string | null; deleted_at: Date | null }>('SELECT storage_uri, deleted_at FROM upload_file WHERE request_id = ?', [r.id]);
    expect(up).toMatchObject({ storage_uri: null });
    expect(up!.deleted_at).not.toBeNull();
    const res = await db.one<{ musicxml_uri: string | null }>('SELECT musicxml_uri FROM score_result WHERE request_id = ?', [r.id]);
    expect(res!.musicxml_uri).toBeNull();
  });

  it('보관 기간 안의 요청은 건드리지 않는다', async () => {
    const r = await makeRequest('fresh', false);
    await jobs.runPeriodicJobs();
    expect(existsSync(storage(r.no, 'result.musicxml'))).toBe(true);
    expect(await purgedAt(r.id)).toBeNull();
  });

  it('API 요청은 model-api 몫이라 purged_at 을 적지 않는다', async () => {
    const r = await makeRequest('api-channel');
    const login = `job-${Date.now()}`;
    const op = await db.exec('INSERT INTO operator_account (login_id, password_hash, display_name) VALUES (?, ?, ?)', [login, 'x', login]);
    const { issueServiceKey } = await import('../../src/services/accessKeys.js');
    const key = await issueServiceKey(op.insertId);
    await db.exec("UPDATE score_request SET channel = 'api', session_id = NULL, account_id = NULL, access_key_id = ? WHERE request_id = ?", [key.keyId, r.id]);
    await jobs.runPeriodicJobs();
    expect(await purgedAt(r.id)).toBeNull();
  });

  it('한 묶음(200건)보다 많이 밀려도 한 주기에 모두 지운다', async () => {
    const prefix = `R-M${Date.now() % 100000000}-`; // 같은 DB 에서 다시 돌려도 겹치지 않게
    await db.exec(`INSERT INTO score_request (request_no, channel, file_kind, chosen_score_type, route, setting_version_id, received_at, identity_purged_at)
                   SELECT CONCAT(?, seq), 'web', 'image', 'staff', 'recognize', v.setting_version_id, CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY, CURRENT_TIMESTAMP(3)
                     FROM seq_1_to_205 JOIN v_current_setting v`, [prefix]);
    const out = await jobs.runPeriodicJobs();
    expect(out!.purged).toBeGreaterThanOrEqual(205);
    const left = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM score_request WHERE request_no LIKE ? AND purged_at IS NULL', [`${prefix}%`]);
    expect(Number(left!.n)).toBe(0);
  });

  it('파일만 지워지고 멈춘 요청은 다음 주기에 끝난다 (재시작)', async () => {
    const r = await makeRequest('resume');
    rmSync(storage(r.no), { recursive: true }); // removeRequestDir 뒤 DB 를 바꾸기 전에 멈춘 상태
    expect(await purgedAt(r.id)).toBeNull();

    await jobs.runPeriodicJobs();
    expect(await purgedAt(r.id)).not.toBeNull();
  });

  it('한 요청이 실패해도 나머지는 지우고, 저장소 밖 경로는 지우지 않는다', async () => {
    const bad = await makeRequest('bad');
    const good = await makeRequest('good');
    const outside = join(dirname(process.env.STORAGE_DIR!), `k${bad.id}`); // request_no 는 20자까지
    mkdirSync(outside);
    await db.exec('UPDATE score_request SET request_no = ? WHERE request_id = ?', [`../k${bad.id}`, bad.id]);

    const out = await jobs.runPeriodicJobs();
    expect(out!.purge_failed).toBeGreaterThanOrEqual(1);
    expect(await purgedAt(bad.id)).toBeNull();
    expect(await purgedAt(good.id)).not.toBeNull();
    expect(existsSync(outside)).toBe(true);

    rmSync(outside, { recursive: true });
    await db.exec('UPDATE score_request SET request_no = ? WHERE request_id = ?', [bad.no, bad.id]);
    await jobs.runPeriodicJobs();
    expect(await purgedAt(bad.id)).not.toBeNull();
  });
});

describe.skipIf(!HAS_DB)('세션 정리', () => {
  it('2시간 무활동 세션에 종료를 적고, 활동 중인 세션은 그대로 둔다', async () => {
    const idle = 'aaaaaaaa-0000-4000-8000-000000000001';
    const live = 'aaaaaaaa-0000-4000-8000-000000000002';
    await db.exec(`INSERT INTO anon_session (session_id, started_at, last_active_at)
                   VALUES (?, CURRENT_TIMESTAMP(3) - INTERVAL 3 HOUR, CURRENT_TIMESTAMP(3) - INTERVAL 3 HOUR), (?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`, [idle, live]);
    await jobs.runPeriodicJobs();
    const a = await db.one<{ ended_at: Date | null; end_reason: string | null }>('SELECT ended_at, end_reason FROM anon_session WHERE session_id = ?', [idle]);
    const b = await db.one<{ ended_at: Date | null }>('SELECT ended_at FROM anon_session WHERE session_id = ?', [live]);
    expect(a).toMatchObject({ end_reason: 'idle' });
    expect(b!.ended_at).toBeNull();
    await db.exec('DELETE FROM anon_session WHERE session_id IN (?, ?)', [idle, live]);
  });

  it('끝난 지 24시간이 지난 세션 행을 지운다 — 식별값을 먼저 지워 요청 기록은 남는다', async () => {
    const r = await makeRequest('old-session');
    const sid = (await db.one<{ session_id: string }>('SELECT session_id FROM score_request WHERE request_id = ?', [r.id]))!.session_id;
    await db.exec(`UPDATE anon_session SET started_at = CURRENT_TIMESTAMP(3) - INTERVAL 3 DAY, last_active_at = CURRENT_TIMESTAMP(3) - INTERVAL 3 DAY,
                   ended_at = CURRENT_TIMESTAMP(3) - INTERVAL 2 DAY, end_reason = 'idle' WHERE session_id = ?`, [sid]);
    await jobs.runPeriodicJobs();
    expect(await db.one('SELECT session_id FROM anon_session WHERE session_id = ?', [sid])).toBeNull();
    const row = await db.one<{ session_id: string | null; identity_purged_at: Date | null }>('SELECT session_id, identity_purged_at FROM score_request WHERE request_id = ?', [r.id]);
    expect(row!.session_id).toBeNull();
    expect(row!.identity_purged_at).not.toBeNull();
  });
});

describe.skipIf(!HAS_DB)('DB ↔ 파일 일치 확인', () => {
  it('없는 파일과 오래된 고아 파일을 보고하고, 어느 쪽도 고치지 않는다', async () => {
    const r = await makeRequest('check', false);
    rmSync(storage(r.no, 'result.musicxml'));
    const orphan = storage('R-ORPHAN', 'left.bin');
    mkdirSync(dirname(orphan));
    writeFileSync(orphan, 'x');
    const old = new Date(Date.now() - 3600 * 1000);
    utimesSync(orphan, old, old);

    const out = await jobs.checkFiles();
    expect(out.missing).toContain(`${r.no}/result.musicxml`);
    expect(out.orphans).toContain('R-ORPHAN/left.bin');
    expect(existsSync(orphan)).toBe(true);
    expect(await purgedAt(r.id)).toBeNull();
    rmSync(dirname(orphan), { recursive: true });
  });

  it('방금 저장한 파일은 DB 에 적히기 전일 수 있어 고아로 보지 않는다', async () => {
    const fresh = storage('R-FRESH', 'new.bin');
    mkdirSync(dirname(fresh));
    writeFileSync(fresh, 'x');
    expect((await jobs.checkFiles()).orphans).not.toContain('R-FRESH/new.bin');
    rmSync(dirname(fresh), { recursive: true });
  });
});

describe.skipIf(!HAS_DB)('한 곳만 실행', () => {
  it('다른 곳이 돌고 있으면 건너뛰고, 끝나면 다시 돈다', async () => {
    const conn = await db.getPool().getConnection();
    await conn.query("SELECT GET_LOCK('klassic_periodic_jobs', 0)");
    expect(await jobs.runPeriodicJobs()).toBeNull();
    await conn.query("SELECT RELEASE_LOCK('klassic_periodic_jobs')");
    conn.release();
    expect(await jobs.runPeriodicJobs()).not.toBeNull();
  });
});
