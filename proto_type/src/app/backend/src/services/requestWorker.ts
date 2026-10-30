// 인식 요청 작업자 (tasks T061·T073): 대기 → 변환 중 → 모델 API 인식 → 결과 저장 → 완료.
// 처리 시간 제한은 접수 시각부터 센다(대기 포함, SC-003). 제한을 넘기거나 모델 API 가 멈추면 대체 결과로 끝낸다(UC2 E4·E5).
// 종류 불일치(FR-058)는 인식을 멈추지 않고(결정 대기 Q2 임시안) 결과를 받아 둔 채 사용자에게 묻는다.
import { query, one, exec } from '../db/pool.js';
import { currentSettings, timeoutForVersion } from '../config/settings.js';
import { completeWithFallback, type DbFallbackReason } from './fallback.js';
import { modelJson, ModelApiDown, blobOf } from './modelApiClient.js';
import { readStored, saveFile } from './storage.js';
import { logger } from '../lib/logger.js';

interface RecognitionResult {
  request_no?: string;
  fallback: boolean;
  fallback_reason: string | null;
  type_mismatch: boolean;
  detected_type: 'staff' | 'jeongganbo' | null;
  validity_grade: string | null;
  musicxml: string | null;
  midi_base64: string | null;
  engine?: { name: string; version: string };
  /** PDF 면 전체 쪽수(2026-09-29 사진·PDF 입력) */
  pdf_page_count?: number | null;
  short_edge_px?: number | null;
}

/**
 * 마감 두 개(2026-09-30 조성기 B — UC1 A1 · BR-ENG-08): waitUntil = 대기 상한(접수 + 제한 × 쪽 수, 줄에서 이때까지 차례가
 * 오지 않으면 시간 초과), deadline = 처리 마감(처리를 시작한 시각 + 제한 × 쪽 수, 줄에서 기다린 시간은 깎지 않는다)
 */
interface Job { requestId: number; requestNo: string; scoreType: 'staff' | 'jeongganbo'; waitUntil: Date; limitMs: number; deadline: Date }

/** 처리를 시작하고 모델 API·감시가 이 정도 뒤까지 기다려 준다(모델 API 가 마감에 맞춰 대체를 돌려줄 여유) */
export const DEADLINE_GRACE_MS = 15_000

/** 종류를 묻는 동안 받아 둔 결과(인식 성공이면 null, 대체였다면 이유) */
const pendingAnswer = new Map<number, { fallbackReason: DbFallbackReason | null }>();
const queue: Job[] = [];
const running = new Set<number>();
let started = false;

const UPPER_TO_DB: Record<string, DbFallbackReason> = {
  RECOGNITION_FAILED: 'recognition_failed', NO_NOTES: 'recognition_failed', TIMEOUT: 'timeout',
  ENGINE_DOWN: 'engine_stopped', NO_SCORE_STRUCTURE: 'no_structure', UNTRUSTED_RESULT: 'distrust',
};

/** 요청의 쪽 수(PDF 쪽수 또는 사진 장수) — 처리 시간 제한은 쪽마다라 전체 마감 = 쪽 수 × 제한(2026-09-29 여러 쪽, BR-ENG-08) */
export const PAGE_COUNT_SQL = `(SELECT GREATEST(1, COALESCE(MAX(u.pdf_page_count), COUNT(*))) FROM upload_file u WHERE u.request_id = r.request_id)`;

async function limitsOf(requestId: number): Promise<{ waitUntil: Date; limitMs: number; started: boolean }> {
  const r = await one<{ received_at: Date; setting_version_id: number; page_count: number; started_at: Date | null }>(
    `SELECT r.received_at, r.setting_version_id, ${PAGE_COUNT_SQL} AS page_count,
            (SELECT t.ended_at FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'queue') AS started_at
       FROM score_request r WHERE r.request_id = ?`, [requestId]);
  if (!r) throw new Error(`request ${requestId} not found`);
  const timeout = await timeoutForVersion(r.setting_version_id);
  const limitMs = timeout * 1000 * Math.max(1, Number(r.page_count) || 1);
  // 이미 처리를 시작했던 요청(서버 재시작 뒤 다시 줄 섬)은 그 시작 시각부터 — 감시(requestDeadlineMs)와 같은 기준
  const waitUntil = new Date((r.started_at ? new Date(r.started_at) : new Date(r.received_at)).getTime() + limitMs);
  return { waitUntil, limitMs, started: Boolean(r.started_at) };
}

/** 접수된 이미지 요청을 인식 대기열에 넣는다 */
export async function enqueueRecognition(requestId: number): Promise<void> {
  const r = await one<{ request_no: string; chosen_score_type: 'staff' | 'jeongganbo' }>(
    'SELECT request_no, chosen_score_type FROM score_request WHERE request_id = ?', [requestId]);
  if (!r) return;
  const { waitUntil, limitMs } = await limitsOf(requestId);
  await exec("UPDATE score_request SET status = 'queued' WHERE request_id = ? AND status = 'received'", [requestId]);
  await exec(
    `INSERT INTO stage_timing (request_id, stage_code, started_at) VALUES (?, 'queue', CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE started_at = started_at`, [requestId]);
  queue.push({ requestId, requestNo: r.request_no, scoreType: r.chosen_score_type, waitUntil, limitMs, deadline: waitUntil });
  pump();
}

function pump(): void {
  void (async () => {
    const s = await currentSettings();
    while (running.size < Math.max(1, s.web_concurrency_share) && queue.length > 0) {
      const job = queue.shift()!;
      if (running.has(job.requestId)) continue;
      running.add(job.requestId);
      runJob(job)
        .catch((e) => logger.error({ err: e, requestId: job.requestId }, 'recognition job crashed'))
        .finally(() => { running.delete(job.requestId); pump(); });
    }
  })().catch((e) => logger.error({ err: e }, 'pump failed'));
}

async function stillOpen(requestId: number): Promise<string | null> {
  const r = await one<{ status: string }>('SELECT status FROM score_request WHERE request_id = ?', [requestId]);
  return r && !['completed', 'service_down'].includes(r.status) ? r.status : null;
}

async function runJob(job: Job): Promise<void> {
  if (!(await stillOpen(job.requestId))) return;
  if (Date.now() >= job.waitUntil.getTime()) { // 대기 상한 안에 차례가 오지 않음
    await completeWithFallback(job.requestId, 'timeout');
    return;
  }
  await exec("UPDATE score_request SET status = 'converting' WHERE request_id = ? AND status IN ('received','queued')", [job.requestId]);
  await exec("UPDATE stage_timing SET ended_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND stage_code = 'queue' AND ended_at IS NULL", [job.requestId]);
  // 처리 마감은 처리를 시작한 시각(대기열 끝 = stage_timing queue.ended_at)부터 — 감시·화면과 같은 기준(2026-09-30 B)
  const st = await one<{ ended_at: Date | null }>("SELECT ended_at FROM stage_timing WHERE request_id = ? AND stage_code = 'queue'", [job.requestId]);
  job.deadline = new Date((st?.ended_at ? new Date(st.ended_at).getTime() : Date.now()) + job.limitMs);
  await recognize(job);
}

/** 모델 API 인식 한 번. 모델 API 가 바쁘면(429) 제한 시간 안에서 다시 시도한다 */
async function recognize(job: Job): Promise<void> {
  // 한 요청 = 악보 한 곡(2026-09-29 여러 쪽): PDF 한 개(모델 API 가 모든 쪽을 인식해 이어 붙임) 또는 사진 여러 장.
  // (2026-09-30 T187) 사진은 file_no(올린 순서)대로 `image` 를 여러 번 보낸다 — 모델 API 가 그 순서로 쪽을 이어 붙인다
  const ups = await query<{ original_name: string; storage_uri: string | null }>(
    'SELECT original_name, storage_uri FROM upload_file WHERE request_id = ? ORDER BY file_no', [job.requestId]);
  if (ups.length === 0 || ups.some((u) => !u.storage_uri)) { await completeWithFallback(job.requestId, 'recognition_failed'); return; }
  const images = await Promise.all(ups.map(async (u) => ({ name: u.original_name, data: await readStored(u.storage_uri!) })));
  let result: RecognitionResult | null = null;
  for (;;) {
    const form = new FormData();
    for (const img of images) form.append('image', blobOf(img.data), img.name);
    form.set('request_no', job.requestNo);
    try {
      result = await modelJson<RecognitionResult>('POST', `/v1/omr/${job.scoreType}`, form, { deadline: job.deadline });
      break;
    } catch (e) {
      if (!(e instanceof ModelApiDown)) throw e;
      if (e.reason === 'timeout') { await completeWithFallback(job.requestId, 'timeout'); return; }
      if (e.reason === 'unreachable' || (e.status ?? 500) >= 500) {
        await completeWithFallback(job.requestId, 'engine_stopped'); return;
      }
      if (e.status === 429) {
        const retry = (e.body as { error?: { retry_after?: string } })?.error?.retry_after;
        const waitMs = retry ? Math.max(500, new Date(retry).getTime() - Date.now()) : 2000;
        if (Date.now() + waitMs >= job.deadline.getTime()) { await completeWithFallback(job.requestId, 'timeout'); return; }
        await exec("UPDATE score_request SET status = 'queued' WHERE request_id = ? AND status = 'converting'", [job.requestId]);
        await new Promise((r) => setTimeout(r, waitMs));
        if (!(await stillOpen(job.requestId))) return;
        await exec("UPDATE score_request SET status = 'converting' WHERE request_id = ? AND status = 'queued'", [job.requestId]);
        continue;
      }
      // 4xx: 웹이 이미 검사한 파일이므로 인식 실패로 본다
      await completeWithFallback(job.requestId, 'recognition_failed');
      return;
    }
  }
  if (!(await stillOpen(job.requestId))) return; // 제한 시간 뒤에 온 결과는 버린다(UC2 E4)
  await applyRecognition(job, result);
}

async function applyRecognition(job: Job, r: RecognitionResult): Promise<void> {
  // PDF 쪽수를 모르면(예전에 모델 API 검사 없이 접수한 요청) 인식 응답의 쪽수로 채운다. pdf_converted_page 는 더 쓰지 않는다
  if (r.pdf_page_count && r.pdf_page_count >= 1) {
    await exec(
      `UPDATE upload_file SET pdf_page_count = ?,
              image_short_side_px = COALESCE(image_short_side_px, ?) WHERE request_id = ? AND pdf_page_count IS NULL`,
      [r.pdf_page_count, r.short_edge_px ?? null, job.requestId]);
  }
  let fallbackReason: DbFallbackReason | null = null;
  if (r.fallback) {
    fallbackReason = UPPER_TO_DB[r.fallback_reason ?? ''] ?? 'recognition_failed';
  } else if (r.musicxml) {
    // MIDI 변환에 실패한 결과는 MusicXML 만 온다(midi_available=false, 2026-09-30 SD_04 §8-1) — MIDI 없이 저장한다.
    // 재생·편집·MP3 는 MusicXML 을 기준으로 하므로 그대로 쓸 수 있다
    const xmlUri = await saveFile(`${job.requestNo}/result.musicxml`, r.musicxml);
    const midUri = r.midi_base64 ? await saveFile(`${job.requestNo}/result.mid`, Buffer.from(r.midi_base64, 'base64')) : null;
    await exec(
      `INSERT INTO score_result (request_id, origin, musicxml_uri, midi_uri) VALUES (?, 'recognized', ?, ?)
       ON DUPLICATE KEY UPDATE musicxml_uri = VALUES(musicxml_uri), midi_uri = VALUES(midi_uri), deleted_at = NULL`,
      [job.requestId, xmlUri, midUri]);
  } else {
    fallbackReason = 'recognition_failed';
  }

  const answered = await one<{ type_answer: string | null }>('SELECT type_answer FROM processing_job WHERE request_id = ?', [job.requestId]);
  if (r.type_mismatch && !answered?.type_answer) {
    // 결과를 받아 둔 채 종류를 묻는다. 답이 없으면 제한 시간에 고른 종류 결과로 끝낸다
    pendingAnswer.set(job.requestId, { fallbackReason });
    await exec("UPDATE score_request SET status = 'awaiting_type_answer' WHERE request_id = ? AND status = 'converting'", [job.requestId]);
    return;
  }
  await finalize(job.requestId, fallbackReason);
}

async function finalize(requestId: number, fallbackReason: DbFallbackReason | null): Promise<void> {
  pendingAnswer.delete(requestId);
  if (fallbackReason) { await completeWithFallback(requestId, fallbackReason); return; }
  const has = await one('SELECT 1 AS x FROM score_result WHERE request_id = ? AND origin = ?', [requestId, 'recognized']);
  if (!has) { await completeWithFallback(requestId, 'recognition_failed'); return; }
  await exec(
    `UPDATE score_request SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3)
      WHERE request_id = ? AND status NOT IN ('completed','service_down')`, [requestId]);
}

/** 종류 확인 답 (UC1 A7): 그대로 → 받아 둔 결과로 끝, 바꾸기 → 다른 종류로 다시 인식(같은 제한 시간) */
export async function answerTypeQuestion(requestId: number, changeTo: 'staff' | 'jeongganbo' | null): Promise<void> {
  const r = await one<{ request_no: string; chosen_score_type: 'staff' | 'jeongganbo'; status: string }>(
    'SELECT request_no, chosen_score_type, status FROM score_request WHERE request_id = ?', [requestId]);
  if (!r || r.status !== 'awaiting_type_answer') return;
  const changed = changeTo !== null && changeTo !== r.chosen_score_type;
  await exec('UPDATE processing_job SET type_answer = ? WHERE request_id = ? AND type_mismatch = TRUE',
    [changed ? 'changed' : 'kept', requestId]);
  if (!changed) {
    await finalize(requestId, pendingAnswer.get(requestId)?.fallbackReason ?? null);
    return;
  }
  pendingAnswer.delete(requestId);
  await exec("DELETE FROM score_result WHERE request_id = ? AND origin = 'recognized'", [requestId]);
  await exec("UPDATE score_request SET status = 'converting' WHERE request_id = ?", [requestId]);
  const { limitMs } = await limitsOf(requestId);
  // 종류를 바꿔 다시 인식 — 처리 마감은 지금부터(2026-09-30 B)
  const now = Date.now();
  const job: Job = { requestId, requestNo: r.request_no, scoreType: changeTo!, waitUntil: new Date(now + limitMs), limitMs,
    deadline: new Date(now + limitMs) };
  running.add(requestId);
  recognize(job)
    .catch((e) => logger.error({ err: e, requestId }, 'rerun failed'))
    .finally(() => running.delete(requestId));
}

/**
 * 요청의 마감(밀리초) — 감시와 화면(deadline_at)이 같이 쓴다(2026-09-30 B).
 * 처리를 시작했으면(대기열 끝 시각 started_at) 그때 + 제한 × 쪽 수 (+ 여유), 아니면 대기 상한(접수 + 제한 × 쪽 수)
 */
export function requestDeadlineMs(receivedAt: Date, startedAt: Date | null, timeoutSeconds: number | null,
  pageCount: number, grace = true): number {
  const limitMs = (timeoutSeconds ?? 180) * 1000 * Math.max(1, Number(pageCount) || 1);
  if (startedAt) return new Date(startedAt).getTime() + limitMs + (grace ? DEADLINE_GRACE_MS : 0);
  return new Date(receivedAt).getTime() + limitMs;
}

/** 감시: 제한 시간을 넘긴 요청을 대체로 끝내고, 답이 없는 종류 질문은 고른 종류로 끝낸다 */
export async function watchdogTick(): Promise<void> {
  const overdue = await query<{ request_id: number; status: string; received_at: Date; timeout_seconds: number | null; page_count: number;
    started_at: Date | null }>(
    `SELECT r.request_id, r.status, r.received_at, s.timeout_seconds, ${PAGE_COUNT_SQL} AS page_count,
            (SELECT t.ended_at FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'queue') AS started_at
       FROM score_request r JOIN processing_setting_version s ON s.setting_version_id = r.setting_version_id
      WHERE r.channel = 'web' AND r.status IN ('received','queued','converting','awaiting_type_answer')`);
  for (const r of overdue) {
    const deadline = requestDeadlineMs(r.received_at, r.started_at, r.timeout_seconds, r.page_count);
    if (Date.now() < deadline) continue;
    if (r.status === 'awaiting_type_answer') {
      await finalize(r.request_id, pendingAnswer.get(r.request_id)?.fallbackReason ?? null);
    } else {
      await completeWithFallback(r.request_id, 'timeout');
    }
  }
}

/** 서버가 다시 켜졌을 때 끝나지 않은 웹 요청을 다시 대기열에 넣는다 */
export async function startWorker(): Promise<void> {
  if (started) return;
  started = true;
  const open = await query<{ request_id: number; route: string }>(
    "SELECT request_id, route FROM score_request WHERE channel = 'web' AND status IN ('received','queued','converting') AND route = 'recognize'");
  for (const r of open) await enqueueRecognition(r.request_id);
  const timer = setInterval(() => { watchdogTick().catch((e) => logger.error({ err: e }, 'watchdog failed')); }, 1000);
  timer.unref();
}

export function workerSnapshot() {
  return { queued: queue.length, running: running.size, awaiting: pendingAnswer.size };
}
