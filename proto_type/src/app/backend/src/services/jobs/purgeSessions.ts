// 무활동 세션 종료 (tasks T131, FR-031): 2시간 무활동이면 세션에 종료를 적는다.
// 사용자 음원(.sf2) 기능은 2026-09-29 삭제(황송해 결정) — 세션이 끝날 때 지울 음원·모델 API 사본이 더는 없다.
import { exec } from '../../db/pool.js';

/** 무활동으로 끝난 세션 수를 돌려준다 */
export async function purgeEndedSessions(): Promise<number> {
  const r = await exec(
    `UPDATE anon_session SET ended_at = CURRENT_TIMESTAMP(3), end_reason = 'idle'
      WHERE ended_at IS NULL AND last_active_at <= CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR`);
  return r.affectedRows;
}
