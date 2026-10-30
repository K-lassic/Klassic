// FR-063 식별값 삭제 (tasks T134): 접수 24시간이 지난 웹 요청의 세션 ID·접속 주소 해시를 지운다. 기록 행은 남는다.
import { exec, query } from '../../db/pool.js';

export async function purgeIdentity(): Promise<number> {
  const due = await query<{ request_id: number }>('SELECT request_id FROM v_identity_purge_due LIMIT 500');
  for (const r of due) {
    await exec(
      'UPDATE score_request SET session_id = NULL, client_addr_hash = NULL, identity_purged_at = CURRENT_TIMESTAMP(3) WHERE request_id = ?',
      [r.request_id]);
  }
  // 게이트 기록 중 세션·주소를 가리키는 값도 24시간 뒤 지운다
  await exec(
    `UPDATE gate_event SET subject_ref = NULL
      WHERE subject_type IN ('session','client') AND subject_ref IS NOT NULL
        AND occurred_at <= CURRENT_TIMESTAMP(3) - INTERVAL 24 HOUR`);
  // 끝난 지 24시간이 넘고 음원도 남지 않은 세션 행은 지운다(요청은 이미 식별값을 지웠다)
  await exec(
    `DELETE s FROM anon_session s
      WHERE s.ended_at IS NOT NULL AND s.ended_at <= CURRENT_TIMESTAMP(3) - INTERVAL 24 HOUR
        AND NOT EXISTS (SELECT 1 FROM score_request r WHERE r.session_id = s.session_id)
        AND NOT EXISTS (SELECT 1 FROM user_soundfont f WHERE f.session_id = s.session_id)`);
  return due.length;
}
