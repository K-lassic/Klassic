// P0 공유 악보 정리 (2026-09-30 황송해 결정 — design/UC_18 BR-SHR-02 · SD_01 9.7 · SD_03 §11B)
// 공유한 때부터 3일(expires_at)이 지난 공유 악보의 복사본 파일과 좋아요를 지운다. 행은 기록으로 남긴다(purged_at).
// 보임 · 내림 · 거둠 상태와 상관없이 같은 3일 기준이다.
import { exec, query } from '../../db/pool.js';
import { removeStored } from '../storage.js';

export async function purgeSharedScores(): Promise<number> {
  const due = await query<{ share_id: number; share_no: string }>('SELECT share_id, share_no FROM v_shared_purge_due LIMIT 200');
  for (const s of due) {
    await removeStored(`shared/${s.share_no}`);
    await exec('DELETE FROM score_like WHERE share_id = ?', [s.share_id]);
    await exec('UPDATE shared_score SET musicxml_uri = NULL, purged_at = CURRENT_TIMESTAMP(3) WHERE share_id = ?', [s.share_id]);
  }
  return due.length;
}
