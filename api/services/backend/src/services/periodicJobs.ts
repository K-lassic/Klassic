// #85 주기 정리 — 보관 기간이 지난 파일 · 끝난 세션을 일괄로 지우고 DB ↔ 파일 일치를 확인한다 (이전 발표 피드백 2번)
//
//   구조에서의 위치: server.ts(web 만) → 이 파일 → DB(v_purge_due_requests · v_identity_purge_due · anon_session)
//     · 볼륨 storage(services/storage.ts). 파일마다 타이머를 두지 않고 주기마다 DB 뷰로 지울 대상을 찾는다.
//   재시작: 진행 상태를 메모리에 두지 않는다. purged_at 을 가장 마지막에 적으므로, 도중에 멈춘 요청은 다음 주기에 다시 나온다.
//   한 곳만 실행: DB GET_LOCK. 연결이 끊기면 DB 가 잠금을 풀어서, 멈춘 프로세스가 잠금을 쥔 채로 남지 않는다.
//   v0.1.1 services/jobs/* 에서 달라진 점:
//     - 웹 요청만 지운다. API 요청 파일은 model-api 가 지우며, backend 가 purged_at 을 먼저 적으면 model-api 가 건너뛴다.
//     - 한 요청이 실패해도 나머지를 계속 지우고, 실패한 요청은 다음 주기에 다시 처리한다.
//     - DB ↔ 파일 일치 확인을 더했다. 고아 파일은 보고만 하고 지우지 않는다.
//     - 공유 악보 · 키 신청 정리는 그 기능을 만들 때 더한다 (P2 · P3).
import { exec, getPool, one, query, tx } from '../db/pool.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isAssetUri, listStoredFiles, removeRequestDir, storedFileExists } from './storage.js';

const LOCK_NAME = 'klassic_periodic_jobs';
const BATCH = 200;
/** 파일을 저장한 뒤 DB 에 적기까지의 틈 — 이보다 새 파일은 고아로 보지 않는다 */
const ORPHAN_GRACE_MS = 10 * 60 * 1000;
const SAMPLE_LIMIT = 20;

export interface FileCheck { missing: string[]; orphans: string[] }

export interface PeriodicSummary {
  purged: number; purge_failed: number; sessions_ended: number; identities_cleared: number; sessions_deleted: number;
  missing_files: number; orphan_files: number; failed_steps: string[];
}

/** 요청 하나의 파일을 지우고 DB 를 비운다. 파일을 먼저 지우고 DB 는 한 번에 바꾸므로 멈춰도 다음 주기에 이어서 끝난다 */
export async function purgeRequest(requestId: number, requestNo: string): Promise<void> {
  await removeRequestDir(requestNo);
  await tx(async (c) => {
    await c.query('UPDATE upload_file SET storage_uri = NULL, deleted_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
    await c.query('UPDATE score_result SET musicxml_uri = NULL, midi_uri = NULL, deleted_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
    await c.query('UPDATE edited_score SET musicxml_uri = NULL, deleted_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
    await c.query('UPDATE edited_score SET ops_json = NULL WHERE request_id = ?', [requestId]);
    await c.query('UPDATE derived_file SET storage_uri = NULL, deleted_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
    await c.query('UPDATE score_request SET purged_at = COALESCE(purged_at, CURRENT_TIMESTAMP(3)) WHERE request_id = ?', [requestId]);
  });
}

/** 주기가 길어 한 번에 많이 쌓일 수 있으므로 대상이 없어질 때까지 묶음으로 지운다. 실패한 요청은 OFFSET 으로 건너뛴다 */
async function purgeDueRequests(): Promise<{ purged: number; failed: number }> {
  let purged = 0;
  let failed = 0;
  for (;;) {
    const due = await query<{ request_id: number; request_no: string }>(
      `SELECT p.request_id, p.request_no FROM v_purge_due_requests p
         JOIN score_request r ON r.request_id = p.request_id
        WHERE r.channel = 'web' ORDER BY p.expires_at, p.request_id LIMIT ${BATCH} OFFSET ${failed}`);
    for (const r of due) {
      try {
        await purgeRequest(r.request_id, r.request_no);
        purged++;
      } catch (e) {
        failed++;
        logger.error({ err: e, request_no: r.request_no }, '요청 정리 실패 — 다음 주기에 다시 처리');
      }
    }
    if (due.length < BATCH) return { purged, failed };
  }
}

/** 2시간 무활동 세션에 종료를 적는다 — 판정 기준은 v_session_state 와 같다 */
async function endIdleSessions(): Promise<number> {
  const r = await exec(
    `UPDATE anon_session SET ended_at = CURRENT_TIMESTAMP(3), end_reason = 'idle'
      WHERE ended_at IS NULL AND last_active_at <= CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR`);
  return r.affectedRows;
}

/** 24시간 지난 요청의 식별값을 지운다. 그래야 끝난 세션 행을 참조하는 요청이 사라져 세션 행을 지울 수 있다 */
async function purgeIdentity(): Promise<{ identities: number; sessions: number }> {
  let identities = 0;
  for (;;) {
    const due = await query<{ request_id: number }>(`SELECT request_id FROM v_identity_purge_due LIMIT ${BATCH}`);
    if (due.length > 0) {
      await exec(
        'UPDATE score_request SET session_id = NULL, client_addr_hash = NULL, identity_purged_at = CURRENT_TIMESTAMP(3) WHERE request_id IN (?)',
        [due.map((r) => r.request_id)]);
      identities += due.length;
    }
    if (due.length < BATCH) break;
  }
  await exec(
    `UPDATE gate_event SET subject_ref = NULL
      WHERE subject_type IN ('session','client') AND subject_ref IS NOT NULL
        AND occurred_at <= CURRENT_TIMESTAMP(3) - INTERVAL 24 HOUR`);
  const del = await exec(
    `DELETE s FROM anon_session s
      WHERE s.ended_at IS NOT NULL AND s.ended_at <= CURRENT_TIMESTAMP(3) - INTERVAL 24 HOUR
        AND NOT EXISTS (SELECT 1 FROM score_request r WHERE r.session_id = s.session_id)
        AND NOT EXISTS (SELECT 1 FROM user_soundfont f WHERE f.session_id = s.session_id)`);
  return { identities, sessions: del.affectedRows };
}

/** 지금 유효한 웹 요청의 파일 위치 전부. API 요청 · assets/ 는 이 볼륨에 없어서 뺀다 */
async function knownUris(): Promise<Set<string>> {
  const rows = await query<{ uri: string }>(
    `SELECT u.storage_uri AS uri FROM upload_file u JOIN score_request r ON r.request_id = u.request_id
      WHERE r.channel = 'web' AND u.deleted_at IS NULL AND u.storage_uri IS NOT NULL
     UNION ALL SELECT s.musicxml_uri FROM score_result s JOIN score_request r ON r.request_id = s.request_id
      WHERE r.channel = 'web' AND s.deleted_at IS NULL AND s.musicxml_uri IS NOT NULL
     UNION ALL SELECT s.midi_uri FROM score_result s JOIN score_request r ON r.request_id = s.request_id
      WHERE r.channel = 'web' AND s.deleted_at IS NULL AND s.midi_uri IS NOT NULL
     UNION ALL SELECT e.musicxml_uri FROM edited_score e JOIN score_request r ON r.request_id = e.request_id
      WHERE r.channel = 'web' AND e.deleted_at IS NULL AND e.musicxml_uri IS NOT NULL
     UNION ALL SELECT d.storage_uri FROM derived_file d JOIN score_request r ON r.request_id = d.request_id
      WHERE r.channel = 'web' AND d.deleted_at IS NULL AND d.storage_uri IS NOT NULL`);
  return new Set(rows.map((r) => r.uri).filter((u) => !isAssetUri(u)));
}

/** 파일 없는 DB 행과 DB 없는 파일을 찾는다 — 찾기만 하고 고치지 않는다 */
export async function checkFiles(): Promise<FileCheck> {
  const known = await knownUris();
  const missing: string[] = [];
  for (const uri of known) if (!(await storedFileExists(uri))) missing.push(uri);
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  const orphans = (await listStoredFiles()).filter((f) => !known.has(f.path) && f.mtimeMs < cutoff).map((f) => f.path);
  return { missing, orphans };
}

/** 한 단계가 실패해도 다음 단계는 돈다. 실패한 일은 다음 주기에 다시 한다 */
async function step<T>(name: string, failed: string[], fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    failed.push(name);
    logger.error({ err: e, step: name }, '주기 정리 단계 실패 — 다음 주기에 다시 처리');
    return fallback;
  }
}

/** 한 주기를 돌린다. 다른 곳이 돌고 있으면 null — 시험도 이 함수를 바로 부른다 */
export async function runPeriodicJobs(): Promise<PeriodicSummary | null> {
  const conn = await getPool().getConnection();
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME]);
    if (Number((rows as Array<{ got: number }>)[0]?.got) !== 1) {
      logger.info('주기 정리 — 다른 곳에서 실행 중이라 건너뜀');
      return null;
    }
    try {
      const started = performance.now();
      const failed: string[] = [];
      const purge = await step('purge', failed, { purged: 0, failed: 0 }, purgeDueRequests);
      const sessionsEnded = await step('sessions', failed, 0, endIdleSessions);
      const identity = await step('identity', failed, { identities: 0, sessions: 0 }, purgeIdentity);
      const files = await step<FileCheck>('file_check', failed, { missing: [], orphans: [] }, checkFiles);
      const summary: PeriodicSummary = {
        purged: purge.purged, purge_failed: purge.failed, sessions_ended: sessionsEnded,
        identities_cleared: identity.identities, sessions_deleted: identity.sessions,
        missing_files: files.missing.length, orphan_files: files.orphans.length, failed_steps: failed,
      };
      const line = { ...summary, duration_ms: Math.round(performance.now() - started),
        missing_sample: files.missing.slice(0, SAMPLE_LIMIT), orphan_sample: files.orphans.slice(0, SAMPLE_LIMIT) };
      const clean = failed.length === 0 && summary.purge_failed === 0 && files.missing.length === 0 && files.orphans.length === 0;
      if (clean) logger.info(line, '주기 정리');
      else logger.warn(line, '주기 정리 — 확인 필요');
      return summary;
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    conn.release();
  }
}

let timer: NodeJS.Timeout | null = null;

function tick(): void {
  runPeriodicJobs().catch((e) => logger.error({ err: e }, '주기 정리 실패 — 다음 주기에 다시 처리'));
}

/** web 이 켜질 때 — 멈춘 동안 밀린 일을 바로 한 번 처리하고 주기를 시작한다 */
export function startPeriodicJobs(): void {
  if (timer) return;
  tick();
  timer = setInterval(tick, env().PERIODIC_JOB_SECONDS * 1000);
  timer.unref();
}

export function stopPeriodicJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
