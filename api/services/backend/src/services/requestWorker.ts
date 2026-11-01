// #34 요청 수명 — 접수한 요청을 대기 상태로 두고, 마감 계산 · 종류 확인 답을 처리한다. 대기열을 실제로 돌리는 작업자는 #35 가 이 파일에 더한다.
//
//   구조에서의 위치: requests.ts → 이 파일 → DB score_request · stage_timing · processing_job.
//     #35 전까지 접수한 요청은 queued 에 머문다 — 인식을 부르는 쪽이 아직 없다.
//   종류 확인: model-api 가 "다른 종류 같다"고 하면 작업자가 결과를 받아 둔 채 awaiting_type_answer 로 두고, 사용자 답을 여기서 받는다.
//   v0.1.1 services/requestWorker.ts 의 앞부분과 같은 동작.
import { exec, one } from '../db/pool.js';
import { completeWithFallback } from './fallback.js';

/** 처리를 시작한 뒤 model-api 가 마감에 맞춰 대체를 돌려줄 여유 */
export const DEADLINE_GRACE_MS = 15_000;

/** 요청의 쪽 수(PDF 쪽수 또는 사진 장수) — 처리 시간 제한은 쪽마다라 전체 마감 = 쪽 수 × 제한 */
export const PAGE_COUNT_SQL = `(SELECT GREATEST(1, COALESCE(MAX(u.pdf_page_count), COUNT(*))) FROM upload_file u WHERE u.request_id = r.request_id)`;

/**
 * 요청의 마감(밀리초) — 감시(#35)와 화면(deadline_at)이 같이 쓴다.
 * 처리를 시작했으면 그때 + 제한 × 쪽 수 (+ 여유), 아니면 대기 상한(접수 + 제한 × 쪽 수). 줄에서 기다린 시간은 처리 시간에서 깎지 않는다.
 */
export function requestDeadlineMs(receivedAt: Date, startedAt: Date | null, timeoutSeconds: number | null,
  pageCount: number, grace = true): number {
  const limitMs = (timeoutSeconds ?? 180) * 1000 * Math.max(1, Number(pageCount) || 1);
  if (startedAt) return new Date(startedAt).getTime() + limitMs + (grace ? DEADLINE_GRACE_MS : 0);
  return new Date(receivedAt).getTime() + limitMs;
}

/** 접수한 요청을 대기 상태로 — 대기 시간을 재기 시작한다 */
export async function enqueueRecognition(requestId: number): Promise<void> {
  await exec("UPDATE score_request SET status = 'queued' WHERE request_id = ? AND status = 'received'", [requestId]);
  await exec(
    `INSERT INTO stage_timing (request_id, stage_code, started_at) VALUES (?, 'queue', CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE started_at = started_at`, [requestId]);
}

/** 받아 둔 인식 결과로 끝낸다. 결과가 없으면 대체 */
async function finishWithRecognized(requestId: number): Promise<void> {
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
  if (!changed) { await finishWithRecognized(requestId); return; }
  await exec("DELETE FROM score_result WHERE request_id = ? AND origin = 'recognized'", [requestId]);
  // 고른 종류도 바꾼다 — 재시작 뒤 다시 인식하거나 대체 악보를 고를 때 새 종류를 쓰도록. 다시 인식하는 일은 #35 가 이어 받는다
  await exec("UPDATE score_request SET chosen_score_type = ?, status = 'converting' WHERE request_id = ?", [changeTo, requestId]);
}
