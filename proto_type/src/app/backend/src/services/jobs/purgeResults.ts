// P0 0.1 결과물 만료 (tasks T134, FR-037): 24시간 지난 요청의 파일을 지운다. 기록 행은 지표용으로 남긴다(FR-063).
// (2026-09-30 황송해 176번, SD_01 3.9) 한 요청 지우기(purgeRequest)를 "내가 만든 악보" [제거]도 같이 쓴다. 편집 기록(ops_json)도 비운다.
import { exec, query } from '../../db/pool.js';
import { removeRequestDir } from '../storage.js';

/** 요청 하나의 올린 파일 · 결과 · 편집본 · 만든 파일을 지우고 purged_at 을 적는다. 공유 복사본(storage/shared)은 건드리지 않는다 */
export async function purgeRequest(requestId: number, requestNo: string): Promise<void> {
  await removeRequestDir(requestNo);
  await exec('UPDATE upload_file SET storage_uri = NULL, deleted_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
  await exec('UPDATE score_result SET musicxml_uri = NULL, midi_uri = NULL, deleted_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
  await exec('UPDATE edited_score SET musicxml_uri = NULL, deleted_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
  await exec('UPDATE edited_score SET ops_json = NULL WHERE request_id = ?', [requestId]);
  await exec('UPDATE derived_file SET storage_uri = NULL, deleted_at = CURRENT_TIMESTAMP(3) WHERE request_id = ? AND deleted_at IS NULL', [requestId]);
  await exec('UPDATE score_request SET purged_at = COALESCE(purged_at, CURRENT_TIMESTAMP(3)) WHERE request_id = ?', [requestId]);
}

export async function purgeResults(): Promise<number> {
  const due = await query<{ request_id: number; request_no: string }>('SELECT request_id, request_no FROM v_purge_due_requests LIMIT 200');
  for (const r of due) await purgeRequest(r.request_id, r.request_no);
  return due.length;
}
