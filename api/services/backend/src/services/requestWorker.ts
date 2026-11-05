// #34 · #35 인식 작업자 — 대기 → 변환 중 → model-api 인식 → 결과 저장 → 완료. 멈추거나 시간을 넘기면 대체 결과로 끝낸다.
//
//   구조에서의 위치: requests.ts(접수 · 종류 확인 답) → 이 파일 → model-api /v1/omr/{종류}(서비스 키 · X-Deadline) → 볼륨 storage · DB score_result.
//     web 컨테이너 안에서만 돈다(server.ts). 대기열은 메모리에 있고 기준은 DB 다 — web 이 다시 켜지면 startWorker 가 끝나지 않은 요청을 DB 에서 다시 줄 세운다.
//   마감 두 개: 대기 상한(접수 + 제한 × 쪽 수) · 처리 마감(처리 시작 + 제한 × 쪽 수). 1초 감시가 넘긴 요청을 끝낸다.
//   종류 불일치: 인식을 멈추지 않고 결과를 받아 둔 채 awaiting_type_answer 로 묻는다. 답이 없으면 마감에 고른 종류 결과로 끝낸다.
//   끝 시각은 GREATEST(현재, started_at) 로 적는다 — 서버 PC(WSL2) 시계가 ms 단위로 뒤로 보정되면 DB 제약 chk_stage_time 에 걸려
//     정상 요청이 오류 없이 대체 악보로 끝나기 때문이다 (#105 · session.ts 와 같은 방법).
//   v0.1.1 services/requestWorker.ts 에서 달라진 점:
//     처리 중 예외(파일 없음 등)는 마감까지 기다리지 않고 바로 대체 · 종류를 바꾼 재인식도 재시작 복구와 같은 대기열 경로
//     · 재인식 때 처리 시작 시각을 다시 찍어 감시 · 화면 마감이 새 마감을 따른다 · 고른 종류를 DB 에 남긴다.
import { exec, one, query } from '../db/pool.js';
import { currentSettings, timeoutForVersion } from '../config/settings.js';
import { shared } from '../config/shared.js';
import { completeWithFallback, type DbFallbackReason } from './fallback.js';
import { monotonicNowMs } from '../lib/clock.js';
import { blobOf, ModelApiDown, modelJson } from './modelApiClient.js';
import { readStored, saveFile } from './storage.js';
import { logger } from '../lib/logger.js';

interface RecognitionResult {
  fallback: boolean;
  fallback_reason: string | null;
  type_mismatch: boolean;
  musicxml: string | null;
  midi_base64: string | null;
  /** PDF 면 전체 쪽수 */
  pdf_page_count?: number | null;
  short_edge_px?: number | null;
}

/**
 * 시각은 모두 단조 시계(monotonicNowMs) 값이다 (#105).
 * waitUntil = 줄에서 이때까지 차례가 오지 않으면 시간 초과, startedMono = 이미 처리를 시작했던 요청(재시작 · 재인식)의 시작, deadline = 처리 마감(처리를 시작하면 다시 잰다)
 */
interface Job { requestId: number; requestNo: string; scoreType: 'staff' | 'jeongganbo'; waitUntil: number; limitMs: number; startedMono: number | null; deadline: number }

/** 처리를 시작한 뒤 model-api 가 마감에 맞춰 대체를 돌려줄 여유 */
export const DEADLINE_GRACE_MS = 15_000;

/** 요청의 쪽 수(PDF 쪽수 또는 사진 장수) — 처리 시간 제한은 쪽마다라 전체 마감 = 쪽 수 × 제한 */
export const PAGE_COUNT_SQL = `(SELECT GREATEST(1, COALESCE(MAX(u.pdf_page_count), COUNT(*))) FROM upload_file u WHERE u.request_id = r.request_id)`;

/** 여러 쪽 요청에서 먼저 변환된 쪽 — 화면이 전체 결과 전에 보인다(2026-11-04, #181). 인식이 끝나면 지운다. 메모리라 다시 켜지면 사라진다 */
export interface PagePreview { pageNo: number; pageCount: number; musicxml: string }
/** 미리보기를 묻는 간격. 묻는 때마다 model-api 호출 기록이 한 줄 남으므로 화면 폴링(1초)보다 길게 */
export const PREVIEW_POLL_MS = 3000;
const previews = new Map<number, PagePreview>();
export function pagePreview(requestId: number): PagePreview | null { return previews.get(requestId) ?? null; }

const queue: Job[] = [];
const running = new Set<number>();
/** 종류를 묻는 동안 받아 둔 대체 이유(인식 성공이면 null). 재시작으로 잃으면 저장된 결과가 있는지로 판단한다 */
const pendingAnswer = new Map<number, DbFallbackReason | null>();
let started = false;
let watchdog: NodeJS.Timeout | null = null;

/** 요청의 제한 시간(ms) = 설정 제한 × 쪽 수 */
function limitMsOf(timeoutSeconds: number | null, pageCount: number): number {
  return (timeoutSeconds ?? 180) * 1000 * Math.max(1, Number(pageCount) || 1);
}

/** 요청 단계('wait' 접수 뒤 · 'run' 처리 시작 뒤)가 시작된 때(단조 시계). 키 = `번호:단계` */
const phaseStarts = new Map<string, number>();

/**
 * 단계의 시작을 단조 시계로 돌려준다. 이 프로세스가 처음 보는 단계면 DB 가 잰 경과 시간(elapsedMs)을 한 번만 읽어
 * 그만큼 거슬러 올라간 값으로 기록하고, 그 뒤로는 벽시계를 다시 읽지 않는다 (#105).
 * DB 시각이 미래라 경과가 음수면 0 으로 본다.
 */
function phaseStart(requestId: number, phase: 'wait' | 'run', elapsedMs: number | null, refresh = false): number {
  const key = `${requestId}:${phase}`;
  let t = phaseStarts.get(key);
  if (refresh || t === undefined) {
    t = monotonicNowMs() - Math.max(0, Math.round(Number(elapsedMs) || 0));
    phaseStarts.set(key, t);
  }
  return t;
}

/** DB 가 같은 시각 기준으로 잰 경과 시간(ms) — 두 시각의 차이만 쓰고, 지금 시각 자체는 가져오지 않는다 */
const ELAPSED_MS_SQL = (from: string) => `TIMESTAMPDIFF(MICROSECOND, ${from}, CURRENT_TIMESTAMP(3)) / 1000`;
const QUEUE_ENDED_SQL = `(SELECT t.ended_at FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'queue')`;

/**
 * 요청의 마감(밀리초, 벽시계) — 화면(deadline_at) 표시 전용이다. 감시 · 대기 상한 판단에는 쓰지 않는다 (#105).
 * 처리를 시작했으면 그때 + 제한 × 쪽 수 (+ 여유), 아니면 대기 상한(접수 + 제한 × 쪽 수). 줄에서 기다린 시간은 처리 시간에서 깎지 않는다.
 */
export function requestDeadlineMs(receivedAt: Date, startedAt: Date | null, timeoutSeconds: number | null,
  pageCount: number, grace = true): number {
  const limitMs = limitMsOf(timeoutSeconds, pageCount);
  if (startedAt) return new Date(startedAt).getTime() + limitMs + (grace ? DEADLINE_GRACE_MS : 0);
  return new Date(receivedAt).getTime() + limitMs;
}

async function limitsOf(requestId: number): Promise<{ waitUntil: number; limitMs: number; startedMono: number | null }> {
  const r = await one<{ setting_version_id: number; page_count: number; waited_ms: number; run_ms: number | null }>(
    `SELECT r.setting_version_id, ${PAGE_COUNT_SQL} AS page_count,
            ${ELAPSED_MS_SQL('r.received_at')} AS waited_ms,
            (SELECT ${ELAPSED_MS_SQL('t.ended_at')} FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'queue' AND t.ended_at IS NOT NULL) AS run_ms
       FROM score_request r WHERE r.request_id = ?`, [requestId]);
  if (!r) throw new Error(`요청 없음: ${requestId}`);
  const limitMs = limitMsOf(await timeoutForVersion(r.setting_version_id), r.page_count);
  // 다시 대기열에 넣을 때는 감시가 남긴 이전 단계 값 대신 현재 DB 기록을 기준으로 삼는다 (#105).
  const startedMono = r.run_ms === null ? null : phaseStart(requestId, 'run', r.run_ms, true);
  return { waitUntil: (startedMono ?? phaseStart(requestId, 'wait', r.waited_ms, true)) + limitMs, limitMs, startedMono };
}

/** 요청을 대기열에 넣는다. 대기 시간을 재기 시작한다 */
export async function enqueueRecognition(requestId: number): Promise<void> {
  const r = await one<{ request_no: string; chosen_score_type: 'staff' | 'jeongganbo' }>(
    'SELECT request_no, chosen_score_type FROM score_request WHERE request_id = ?', [requestId]);
  if (!r) return;
  const { waitUntil, limitMs, startedMono } = await limitsOf(requestId);
  await exec("UPDATE score_request SET status = 'queued' WHERE request_id = ? AND status = 'received'", [requestId]);
  await exec(
    `INSERT INTO stage_timing (request_id, stage_code, started_at) VALUES (?, 'queue', CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE started_at = started_at`, [requestId]);
  queue.push({ requestId, requestNo: r.request_no, scoreType: r.chosen_score_type, waitUntil, limitMs, startedMono, deadline: waitUntil });
  pump();
}

/** 동시 처리 상한(설정 판본)까지 대기열에서 꺼낸다. 작업자가 시작하기 전에는 줄만 선다 */
function pump(): void {
  if (!started) return;
  void (async () => {
    const s = await currentSettings();
    while (running.size < Math.max(1, s.web_concurrency_share) && queue.length > 0) {
      const job = queue.shift()!;
      if (running.has(job.requestId)) continue;
      running.add(job.requestId);
      runJob(job)
        .catch(async (e) => {
          // 결과를 만들 수 없는 오류 — 마감까지 사용자를 기다리게 하지 않는다
          logger.error({ err: e, requestNo: job.requestNo }, '인식 처리 오류 — 대체 결과로 끝낸다');
          await completeWithFallback(job.requestId, 'recognition_failed');
        })
        .catch((e) => logger.error({ err: e, requestNo: job.requestNo }, '대체 결과도 실패'))
        .finally(() => { running.delete(job.requestId); pump(); });
    }
  })().catch((e) => logger.error({ err: e }, '대기열 처리 실패'));
}

/** 아직 끝나지 않은 요청의 상태. 끝났으면 null */
async function stillOpen(requestId: number): Promise<string | null> {
  const r = await one<{ status: string }>('SELECT status FROM score_request WHERE request_id = ?', [requestId]);
  return r && !['completed', 'service_down'].includes(r.status) ? r.status : null;
}

async function runJob(job: Job): Promise<void> {
  if (!(await stillOpen(job.requestId))) return;
  if (monotonicNowMs() >= job.waitUntil) { // 대기 상한 안에 차례가 오지 않음
    await completeWithFallback(job.requestId, 'timeout');
    return;
  }
  await exec("UPDATE score_request SET status = 'converting' WHERE request_id = ? AND status IN ('received','queued')", [job.requestId]);
  await exec("UPDATE stage_timing SET ended_at = GREATEST(CURRENT_TIMESTAMP(3), started_at) WHERE request_id = ? AND stage_code = 'queue' AND ended_at IS NULL", [job.requestId]);
  // 처리 마감은 처리를 시작한 때(대기열 끝)부터 — 감시 · 화면과 같은 기준. 이미 시작했던 요청은 그때부터, 아니면 지금부터 (단조 시계)
  const startMono = job.startedMono ?? monotonicNowMs();
  phaseStarts.set(`${job.requestId}:run`, startMono);
  job.deadline = startMono + job.limitMs;
  await recognize(job);
}

/** model-api 인식 한 번. 바쁘면(429) 제한 시간 안에서 다시 시도한다 */
async function recognize(job: Job): Promise<void> {
  // 사진은 file_no(올린 순서)대로 image 를 여러 번 보낸다 — model-api 가 그 순서로 쪽을 이어 붙인다. PDF 는 파일 하나
  const ups = await query<{ original_name: string; storage_uri: string | null }>(
    'SELECT original_name, storage_uri FROM upload_file WHERE request_id = ? ORDER BY file_no', [job.requestId]);
  if (ups.length === 0 || ups.some((u) => !u.storage_uri)) { await completeWithFallback(job.requestId, 'recognition_failed'); return; }
  const images = await Promise.all(ups.map(async (u) => ({ name: u.original_name, data: await readStored(u.storage_uri!) })));
  const pc = await one<{ page_count: number }>(`SELECT ${PAGE_COUNT_SQL} AS page_count FROM score_request r WHERE r.request_id = ?`, [job.requestId]);
  const stopPreview = watchPreview(job, Number(pc?.page_count) || 1);
  try {
    await recognizeOnce(job, images);
  } finally {
    stopPreview();
  }
}

/**
 * 4코어에서는 쪽을 동시에 읽으면 오히려 느려서(deploy README 「homr 작업자 2개 시험」) 쪽은 차례로 읽고,
 * 그동안 model-api 가 먼저 변환한 쪽을 받아 둔다. 한 번 받으면 묻지 않는다. 실패해도 인식에는 영향이 없다
 */
function watchPreview(job: Job, pageCount: number): () => void {
  if (pageCount < 2) return () => {};
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    try {
      const r = await modelJson<{ preview: { page_no: number; page_count: number; musicxml: string } | null }>(
        'GET', `/v1/internal/omr/preview/${encodeURIComponent(job.requestNo)}`, undefined, { timeoutMs: 5000 });
      if (!stopped && r.preview) {
        previews.set(job.requestId, { pageNo: r.preview.page_no, pageCount: r.preview.page_count, musicxml: r.preview.musicxml });
        return;
      }
    } catch (e) {
      logger.debug({ err: e, requestNo: job.requestNo }, '첫 쪽 미리보기를 읽지 못함');
    }
    if (!stopped) { timer = setTimeout(tick, PREVIEW_POLL_MS); timer.unref(); }
  };
  timer = setTimeout(tick, PREVIEW_POLL_MS);
  timer.unref();
  return () => { stopped = true; if (timer) clearTimeout(timer); previews.delete(job.requestId); };
}

async function recognizeOnce(job: Job, images: { name: string; data: Buffer }[]): Promise<void> {
  let result: RecognitionResult;
  for (;;) {
    const form = new FormData();
    for (const img of images) form.append('image', blobOf(img.data), img.name);
    form.set('request_no', job.requestNo);
    try {
      result = await modelJson<RecognitionResult>('POST', `/v1/omr/${job.scoreType}`, form, { deadlineMono: job.deadline });
      break;
    } catch (e) {
      if (!(e instanceof ModelApiDown)) throw e;
      if (e.reason === 'timeout') { await completeWithFallback(job.requestId, 'timeout'); return; }
      if (e.reason === 'unreachable' || (e.status ?? 500) >= 500) { await completeWithFallback(job.requestId, 'engine_stopped'); return; }
      if (e.status !== 429) { await completeWithFallback(job.requestId, 'recognition_failed'); return; } // 4xx: 웹이 이미 검사한 파일이므로 인식 실패
      const retry = (e.body as { error?: { retry_after?: string } })?.error?.retry_after;
      // retry_after 는 model-api 가 벽시계로 적어 준 짧은 약속 시각이라 지금과의 차이(기간)로만 바꾼다. 마감 비교는 단조 시계
      const waitMs = retry ? Math.max(500, new Date(retry).getTime() - Date.now()) : 2000;
      if (monotonicNowMs() + waitMs >= job.deadline) { await completeWithFallback(job.requestId, 'timeout'); return; }
      await exec("UPDATE score_request SET status = 'queued' WHERE request_id = ? AND status = 'converting'", [job.requestId]);
      await new Promise((r) => setTimeout(r, waitMs));
      if (!(await stillOpen(job.requestId))) return;
      await exec("UPDATE score_request SET status = 'converting' WHERE request_id = ? AND status = 'queued'", [job.requestId]);
    }
  }
  if (!(await stillOpen(job.requestId))) return; // 제한 시간 뒤에 온 결과는 버린다
  await applyRecognition(job, result);
}

async function applyRecognition(job: Job, r: RecognitionResult): Promise<void> {
  // PDF 쪽수를 모르면 인식 응답의 쪽수로 채운다
  if (r.pdf_page_count && r.pdf_page_count >= 1) {
    await exec(
      `UPDATE upload_file SET pdf_page_count = ?, image_short_side_px = COALESCE(image_short_side_px, ?)
        WHERE request_id = ? AND pdf_page_count IS NULL`,
      [r.pdf_page_count, r.short_edge_px ?? null, job.requestId]);
  }
  let fallbackReason: DbFallbackReason | null = null;
  if (r.fallback) {
    fallbackReason = (shared().errorCodes.fallback_reasons[r.fallback_reason ?? '']?.db ?? 'recognition_failed') as DbFallbackReason;
  } else if (r.musicxml) {
    // MIDI 변환에 실패한 결과는 MusicXML 만 온다 — 재생 · 편집은 MusicXML 기준이라 그대로 쓴다
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
    pendingAnswer.set(job.requestId, fallbackReason);
    await exec("UPDATE score_request SET status = 'awaiting_type_answer' WHERE request_id = ? AND status = 'converting'", [job.requestId]);
    return;
  }
  await finalize(job.requestId, fallbackReason);
}

/** 인식 결과로 끝낸다. 대체 이유가 있거나 저장된 결과가 없으면 대체 */
async function finalize(requestId: number, fallbackReason: DbFallbackReason | null): Promise<void> {
  pendingAnswer.delete(requestId);
  if (fallbackReason) { await completeWithFallback(requestId, fallbackReason); return; }
  const has = await one("SELECT 1 AS x FROM score_result WHERE request_id = ? AND origin = 'recognized'", [requestId]);
  if (!has) { await completeWithFallback(requestId, 'recognition_failed'); return; }
  await exec(
    `UPDATE score_request SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3)
      WHERE request_id = ? AND status NOT IN ('completed','service_down')`, [requestId]);
}

/** 종류 확인 답: 그대로 → 받아 둔 결과로 끝, 바꾸기 → 결과를 버리고 다른 종류로 다시 인식. 묻는 중이 아니면 아무것도 하지 않는다 */
export async function answerTypeQuestion(requestId: number, changeTo: 'staff' | 'jeongganbo' | null): Promise<void> {
  const r = await one<{ chosen_score_type: 'staff' | 'jeongganbo'; status: string }>(
    'SELECT chosen_score_type, status FROM score_request WHERE request_id = ?', [requestId]);
  if (!r || r.status !== 'awaiting_type_answer') return;
  const changed = changeTo !== null && changeTo !== r.chosen_score_type;
  await exec('UPDATE processing_job SET type_answer = ? WHERE request_id = ? AND type_mismatch = TRUE',
    [changed ? 'changed' : 'kept', requestId]);
  if (!changed) { await finalize(requestId, pendingAnswer.get(requestId) ?? null); return; }
  pendingAnswer.delete(requestId);
  await exec("DELETE FROM score_result WHERE request_id = ? AND origin = 'recognized'", [requestId]);
  // 고른 종류를 DB 에 남겨 재시작 · 대체 악보도 새 종류를 쓰게 하고, 처리 시작을 다시 찍어 마감도 지금부터 잰다
  await exec("UPDATE score_request SET chosen_score_type = ?, status = 'converting' WHERE request_id = ?", [changeTo, requestId]);
  await exec("UPDATE stage_timing SET ended_at = GREATEST(CURRENT_TIMESTAMP(3), started_at) WHERE request_id = ? AND stage_code = 'queue'", [requestId]);
  await enqueueRecognition(requestId);
}

/** 감시: 제한 시간을 넘긴 요청을 대체로 끝내고, 답이 없는 종류 질문은 고른 종류로 끝낸다 */
export async function watchdogTick(): Promise<void> {
  const open = await query<{ request_id: number; status: string; timeout_seconds: number | null; page_count: number; waited_ms: number; run_ms: number | null }>(
    `SELECT r.request_id, r.status, s.timeout_seconds, ${PAGE_COUNT_SQL} AS page_count,
            ${ELAPSED_MS_SQL('r.received_at')} AS waited_ms,
            (SELECT ${ELAPSED_MS_SQL('t.ended_at')} FROM stage_timing t WHERE t.request_id = r.request_id AND t.stage_code = 'queue' AND t.ended_at IS NOT NULL) AS run_ms
       FROM score_request r JOIN processing_setting_version s ON s.setting_version_id = r.setting_version_id
      WHERE r.channel = 'web' AND r.status IN ('received','queued','converting','awaiting_type_answer')`);
  // 끝난 요청의 단계 기록은 비운다
  const openIds = new Set(open.map((r) => String(r.request_id)));
  for (const key of phaseStarts.keys()) if (!openIds.has(key.split(':')[0])) phaseStarts.delete(key);
  for (const r of open) {
    // 마감은 단조 시계로만 잰다 (#105): 처리를 시작했으면 시작 + 제한 + 여유, 아니면 접수 + 제한
    const limitMs = limitMsOf(r.timeout_seconds, r.page_count);
    const deadline = r.run_ms === null
      ? phaseStart(r.request_id, 'wait', r.waited_ms) + limitMs
      : phaseStart(r.request_id, 'run', r.run_ms) + limitMs + DEADLINE_GRACE_MS;
    if (monotonicNowMs() < deadline) continue;
    if (r.status === 'awaiting_type_answer') await finalize(r.request_id, pendingAnswer.get(r.request_id) ?? null);
    else await completeWithFallback(r.request_id, 'timeout');
  }
}

/** web 이 켜질 때 — 끝나지 않은 요청을 DB 에서 다시 줄 세우고 감시를 시작한다 */
export async function startWorker(): Promise<void> {
  if (started) return;
  started = true;
  const open = await query<{ request_id: number }>(
    "SELECT request_id FROM score_request WHERE channel = 'web' AND status IN ('received','queued','converting') AND route = 'recognize' ORDER BY received_at");
  for (const r of open) await enqueueRecognition(r.request_id);
  if (open.length > 0) logger.info({ count: open.length }, '끝나지 않은 요청을 다시 줄 세움');
  watchdog = setInterval(() => { watchdogTick().catch((e) => logger.error({ err: e }, '감시 실패')); }, 1000);
  watchdog.unref();
}

/** 종료 — 새 작업을 꺼내지 않는다. 처리 중이던 요청은 다음 시작 때 DB 에서 다시 줄 선다 */
export function stopWorker(): void {
  started = false;
  queue.length = 0;
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
}
