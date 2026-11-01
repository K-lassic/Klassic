// #34 대체 결과 — model-api 를 부르지 않고 이미지에 구운 템플릿(assets/templates)으로 결과를 준다. 템플릿마저 못 읽으면 service_down.
//
//   구조에서의 위치: requests.ts(사용자가 [대체 받기], UC2) · 종류 확인 답 → 이 파일 → DB score_result.
//     인식 실패 · 시간 초과 때 부르는 쪽은 작업자(#35)다. 파일은 복사하지 않고 DB uri 가 템플릿을 가리킨다 → 주기 정리가 지울 파일이 없다.
//   DB 트리거: 끝난 요청의 경로는 user_request 일 때만 바꿀 수 있다 (trg_request_terminal).
//   v0.1.1 services/fallback.ts 와 같은 동작.
import { one, tx } from '../db/pool.js';
import { readStored } from './storage.js';
import { logger } from '../lib/logger.js';

export type DbFallbackReason = 'recognition_failed' | 'timeout' | 'engine_stopped' | 'user_request' | 'no_structure' | 'distrust';

interface Template { template_id: number; midi_uri: string; musicxml_uri: string | null }

/** 요청의 악보 종류에 맞는 켜진 템플릿 가운데 무작위 하나. 그 종류가 없으면 켜진 것 아무거나 */
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
    logger.error({ err: e }, '대체 악보 파일 없음');
    return null;
  }
}

const SAVE_RESULT = `INSERT INTO score_result (request_id, origin, musicxml_uri, midi_uri, fallback_template_id)
  VALUES (?, 'fallback', ?, ?, ?)
  ON DUPLICATE KEY UPDATE musicxml_uri = VALUES(musicxml_uri), midi_uri = VALUES(midi_uri),
                          fallback_template_id = VALUES(fallback_template_id), deleted_at = NULL`;

/** 처리 중인 요청을 대체 결과로 끝낸다. 이미 끝난 요청이면 아무것도 하지 않는다 (늦게 온 결과 무시) */
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
      logger.error({ requestId }, 'service_down: 대체 악보를 쓸 수 없음');
      return 'service_down';
    }
    // 경로를 먼저 대체로 바꾼다 → 트리거가 늦게 온 인식 결과를 막는다
    await conn.query("UPDATE score_request SET route = 'fallback', fallback_reason = ? WHERE request_id = ?", [reason, requestId]);
    await conn.query(SAVE_RESULT, [requestId, tpl.musicxml_uri, tpl.midi_uri, tpl.template_id]);
    await conn.query("UPDATE score_request SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3) WHERE request_id = ?", [requestId]);
    return 'completed';
  });
}

/** [대체 악보 받기] (UC2): 완료된 인식 결과를 대체로 바꾼다. 인식 결과는 지우지 않고 경로만 바뀐다 */
export async function switchToUserFallback(requestId: number): Promise<boolean> {
  const tpl = await webTemplate(requestId);
  if (!tpl) return false;
  await tx(async (conn) => {
    await conn.query(SAVE_RESULT, [requestId, tpl.musicxml_uri, tpl.midi_uri, tpl.template_id]);
    await conn.query("UPDATE score_request SET route = 'fallback', fallback_reason = 'user_request' WHERE request_id = ?", [requestId]);
  });
  return true;
}
