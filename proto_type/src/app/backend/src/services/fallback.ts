// 웹 대체 경로 (tasks T071, FR-011·FR-012·FR-042): 모델 API 서버를 부르지 않고 웹이 가진 템플릿으로 결과를 준다.
// 템플릿마저 못 불러오면 service_down(서비스 중단, UC2 E1).
import { exec, one, tx } from '../db/pool.js';
import { readStored } from './storage.js';
import { logger } from '../lib/logger.js';

export type DbFallbackReason = 'recognition_failed' | 'timeout' | 'engine_stopped' | 'user_request' | 'no_structure' | 'distrust';

interface Template { template_id: number; midi_uri: string; musicxml_uri: string | null }

/**
 * 요청의 악보 종류(chosen_score_type)에 맞는 켜진 템플릿 가운데 무작위 하나 — 오선보: 아리랑 세마치 · 미뉴에트, 정간보: 타령(가야금).
 * 그 종류가 없으면 켜진 것 아무거나(2026-09-30 박예은 팀장 결정, UC_02 BR-FBK-09 · SD_01 1.13).
 */
async function webTemplate(requestId: number): Promise<Template | null> {
  const t = await one<Template>(
    `SELECT t.template_id, t.midi_uri, t.musicxml_uri
       FROM fallback_template t
       LEFT JOIN score_request r ON r.request_id = ?
      WHERE t.holder = 'web' AND t.is_active = TRUE
      ORDER BY (t.score_type <=> r.chosen_score_type) DESC, RAND()
      LIMIT 1`, [requestId]);
  if (!t || !t.musicxml_uri) return null;
  try {
    // 파일이 실제로 있어야 결과로 줄 수 있다
    await readStored(t.midi_uri);
    await readStored(t.musicxml_uri);
    return t;
  } catch (e) {
    logger.error({ err: e }, 'fallback template files missing');
    return null;
  }
}

/** 처리 중인 요청을 대체 결과로 끝낸다. 이미 끝난 요청이면 아무것도 하지 않는다(늦게 온 결과 무시, UC2 E4·E5) */
export async function completeWithFallback(requestId: number, reason: DbFallbackReason): Promise<'completed' | 'service_down' | 'skipped'> {
  const tpl = await webTemplate(requestId);
  return tx(async (conn) => {
    const [rows] = await conn.query('SELECT status FROM score_request WHERE request_id = ? FOR UPDATE', [requestId]);
    const status = (rows as { status: string }[])[0]?.status;
    if (!status || status === 'completed' || status === 'service_down') return 'skipped';
    if (!tpl) {
      await conn.query(
        "UPDATE score_request SET route = 'fallback', fallback_reason = ?, status = 'service_down' WHERE request_id = ?",
        [reason, requestId]);
      logger.error({ requestId }, 'service_down: fallback template unavailable');
      return 'service_down';
    }
    // 경로를 먼저 대체로 바꾼다 → 트리거가 늦게 온 인식 결과를 막는다
    await conn.query("UPDATE score_request SET route = 'fallback', fallback_reason = ? WHERE request_id = ?", [reason, requestId]);
    await conn.query(
      `INSERT INTO score_result (request_id, origin, musicxml_uri, midi_uri, fallback_template_id)
       VALUES (?, 'fallback', ?, ?, ?)
       ON DUPLICATE KEY UPDATE musicxml_uri = VALUES(musicxml_uri), midi_uri = VALUES(midi_uri),
                               fallback_template_id = VALUES(fallback_template_id), deleted_at = NULL`,
      [requestId, tpl.musicxml_uri, tpl.midi_uri, tpl.template_id]);
    await conn.query(
      "UPDATE score_request SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3) WHERE request_id = ?", [requestId]);
    return 'completed';
  });
}

/** [대체 템플릿 받기] (FR-014, UC2 A1): 완료된 인식 결과를 대체로 바꾼다. 경로만 바뀐다(trg_request_terminal 허용) */
export async function switchToUserFallback(requestId: number): Promise<boolean> {
  const tpl = await webTemplate(requestId);
  if (!tpl) return false;
  await tx(async (conn) => {
    await conn.query(
      `INSERT INTO score_result (request_id, origin, musicxml_uri, midi_uri, fallback_template_id)
       VALUES (?, 'fallback', ?, ?, ?)
       ON DUPLICATE KEY UPDATE musicxml_uri = VALUES(musicxml_uri), midi_uri = VALUES(midi_uri), deleted_at = NULL`,
      [requestId, tpl.musicxml_uri, tpl.midi_uri, tpl.template_id]);
    await conn.query(
      "UPDATE score_request SET route = 'fallback', fallback_reason = 'user_request' WHERE request_id = ?", [requestId]);
  });
  return true;
}

export async function markServiceDown(requestId: number): Promise<void> {
  await exec("UPDATE score_request SET status = 'service_down' WHERE request_id = ? AND route = 'fallback'", [requestId]);
}
