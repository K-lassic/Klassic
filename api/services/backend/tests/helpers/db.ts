// #34 시험 도우미 — 설정 판본 바꾸기 · 작업자(#35)가 할 일을 DB 에 직접 만들기.
import { exec, one } from '../../src/db/pool.js';
import { invalidateSettings } from '../../src/config/settings.js';
import { saveFile } from '../../src/services/storage.js';

/** 새 설정 판본(이전 값 복사 + 덮어쓰기)을 시험용으로 만든다 */
export async function setSettings(values: Record<string, unknown>): Promise<void> {
  const cur = await one<Record<string, unknown>>('SELECT * FROM v_current_setting');
  const cols = Object.keys(cur!).filter((k) => !['setting_version_id', 'created_at', 'api_apply_status', 'api_applied_at'].includes(k));
  const row = { ...cur, ...values } as Record<string, unknown>;
  const ins = await exec(`INSERT INTO processing_setting_version (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c]));
  await exec(`INSERT INTO setting_engine_order (setting_version_id, score_type, seq, engine_name)
              SELECT ?, score_type, seq, engine_name FROM setting_engine_order WHERE setting_version_id = ?`, [ins.insertId, cur!.setting_version_id]);
  invalidateSettings();
}

export async function requestIdOf(requestNo: string): Promise<number> {
  return (await one<{ request_id: number }>('SELECT request_id FROM score_request WHERE request_no = ?', [requestNo]))!.request_id;
}

/** 작업자가 인식을 끝낸 상태를 만든다 — 결과 파일 저장 + score_result + 요청 상태 */
export async function completeRecognized(requestNo: string, musicxml: string, status: 'completed' | 'awaiting_type_answer' = 'completed'): Promise<number> {
  const id = await requestIdOf(requestNo);
  const uri = await saveFile(`${requestNo}/result.musicxml`, musicxml);
  await exec("UPDATE score_request SET status = 'converting' WHERE request_id = ?", [id]);
  await exec("INSERT INTO score_result (request_id, origin, musicxml_uri) VALUES (?, 'recognized', ?)", [id, uri]);
  await exec('UPDATE score_request SET status = ?, completed_at = IF(? = \'completed\', CURRENT_TIMESTAMP(3), NULL) WHERE request_id = ?', [status, status, id]);
  return id;
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 15000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last)) {
    if (Date.now() > end) throw new Error(`기다리다 시간 초과: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 100));
    last = await fn();
  }
  return last;
}
