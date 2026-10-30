// P0 0.6 신청 내용 7일 삭제 (tasks T116, FR-060): 보관 처리하지 않은 신청 행만 지운다. 키 행은 남는다.
import { exec } from '../../db/pool.js';

export async function purgeApplications(): Promise<number> {
  const res = await exec(
    `DELETE a FROM key_application a JOIN v_application_retention v ON v.key_id = a.key_id WHERE v.is_purge_due = 1`);
  return res.affectedRows;
}
