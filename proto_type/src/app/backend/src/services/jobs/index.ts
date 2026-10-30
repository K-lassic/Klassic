// 주기 작업 등록 (tasks T136): 보관 정리(P0)와 SD_03 §15-4 점검 쿼리. 점검 결과가 0행이 아니면 경고로 남긴다.
import cron from 'node-cron';
import { query } from '../../db/pool.js';
import { logger } from '../../lib/logger.js';
import { purgeResults } from './purgeResults.js';
import { purgeIdentity } from './purgeIdentity.js';
import { purgeEndedSessions } from './purgeSessions.js';
import { purgeApplications } from './purgeApplications.js';
import { purgeSharedScores } from './purgeSharedScores.js';

// §15-4 — P1 은 FR-063 으로 지운 식별값(NULL)을 빼고 본다
export const CHECK_QUERIES: Record<string, string> = {
  P1: `SELECT g.event_id FROM gate_event g WHERE g.subject_ref IS NOT NULL AND (
         (g.subject_type = 'request' AND NOT EXISTS (SELECT 1 FROM score_request r WHERE CAST(r.request_id AS CHAR) = g.subject_ref))
      OR (g.subject_type = 'access_key' AND NOT EXISTS (SELECT 1 FROM access_key k WHERE CAST(k.key_id AS CHAR) = g.subject_ref))
      OR (g.subject_type = 'api_call' AND NOT EXISTS (SELECT 1 FROM api_call_log c WHERE CAST(c.call_id AS CHAR) = g.subject_ref))
      OR (g.subject_type = 'operator' AND NOT EXISTS (SELECT 1 FROM operator_account o WHERE CAST(o.operator_id AS CHAR) = g.subject_ref))
      OR (g.subject_type = 'setting_version' AND NOT EXISTS (SELECT 1 FROM processing_setting_version v WHERE CAST(v.setting_version_id AS CHAR) = g.subject_ref)))`,
  P2: `SELECT h.history_id FROM change_history h WHERE h.target_type IN ('access_key','key_application')
         AND NOT EXISTS (SELECT 1 FROM access_key k WHERE CAST(k.key_id AS CHAR) = h.target_ref)`,
  Q1: `SELECT r.request_no FROM score_request r JOIN upload_file u ON u.request_id = r.request_id
        WHERE u.deleted_at IS NULL AND (r.file_kind IN ('image','pdf')) <> (u.image_short_side_px IS NOT NULL)`, // PDF 는 변환한 첫 쪽(2026-09-29)
  Q2: `SELECT r.request_no FROM score_request r JOIN processing_job j ON j.request_id = r.request_id
        WHERE r.status = 'completed' AND NOT (r.fallback_reason <=> 'user_request') AND (
              (j.structure_verdict = 'fail' AND NOT (r.route = 'fallback' AND r.fallback_reason = 'no_structure'))
           OR (j.validity_grade = 'distrust' AND NOT (r.route = 'fallback' AND r.fallback_reason = 'distrust')))`,
  Q3: `SELECT r.request_no FROM score_request r JOIN processing_job j ON j.request_id = r.request_id
        WHERE r.channel = 'api' AND j.type_answer IS NOT NULL`,
  Q4: `SELECT o.recommendation_id FROM recommendation_option o JOIN ensemble e ON e.ensemble_id = o.ensemble_id WHERE e.ensemble_kind <> 'recommended'
       UNION ALL SELECT s.result_id FROM score_result s JOIN ensemble e ON e.ensemble_id = s.original_ensemble_id WHERE e.ensemble_kind <> 'original'`,
  Q5: `SELECT k.key_id FROM access_key k WHERE k.key_kind = 'external' AND k.issued_at > CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY
         AND NOT EXISTS (SELECT 1 FROM key_application a WHERE a.key_id = k.key_id)`,
  Q6: `SELECT k.key_id FROM access_key k WHERE k.status = 'revoked' AND NOT EXISTS (SELECT 1 FROM change_history h
         WHERE h.target_type = 'access_key' AND h.target_ref = CAST(k.key_id AS CHAR) AND h.field_name = 'status')`,
  Q7: `SELECT r.request_no FROM score_request r WHERE r.status = 'completed' AND r.purged_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM v_current_result c WHERE c.request_id = r.request_id)`,
  Q8: `SELECT t.edit_id FROM edited_track t JOIN edited_score es ON es.edit_id = t.edit_id JOIN score_request r ON r.request_id = es.request_id
         JOIN user_soundfont f ON f.soundfont_id = t.soundfont_id WHERE f.session_id <> r.session_id`,
  Q9: `SELECT v.request_id FROM validity_check_item v JOIN processing_job j ON j.request_id = v.request_id
        WHERE v.item_code = 'yulmyeong_ratio' AND j.confirmed_score_type <> 'jeongganbo'`,
};

export async function runChecks(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, sql] of Object.entries(CHECK_QUERIES)) {
    const rows = await query(sql);
    out[name] = rows.length;
    if (rows.length > 0) logger.warn({ check: name, rows: rows.length }, 'SD_03 §15-4 check found rows');
  }
  return out;
}

async function safe(name: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (e) { logger.error({ err: e, job: name }, 'periodic job failed'); }
}

export function startJobs(): void {
  cron.schedule('*/10 * * * *', () => {
    void (async () => {
      await safe('purgeResults', purgeResults);
      await safe('purgeSharedScores', purgeSharedScores);   // 공유 악보 3일(2026-09-30)
      await safe('purgeIdentity', purgeIdentity);
      await safe('purgeSessions', purgeEndedSessions);
      await safe('checks', runChecks);
    })();
  });
  cron.schedule('7 * * * *', () => { void safe('purgeApplications', purgeApplications); });
}
