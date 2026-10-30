import { query, exec, one } from '../../src/db/pool.js';
export { query, exec, one };

/** 새 설정 판본(이전 값 복사 + 덮어쓰기)을 시험용으로 만든다 */
export async function setSettings(values: Record<string, unknown>): Promise<void> {
  const cur = await one<Record<string, unknown>>('SELECT * FROM v_current_setting');
  const cols = Object.keys(cur!).filter((k) => !['setting_version_id', 'created_at', 'api_apply_status', 'api_applied_at'].includes(k));
  const row = { ...cur, ...values } as Record<string, unknown>;
  const ins = await exec(`INSERT INTO processing_setting_version (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c]));
  await exec(`INSERT INTO setting_engine_order (setting_version_id, score_type, seq, engine_name)
              SELECT ?, score_type, seq, engine_name FROM setting_engine_order WHERE setting_version_id = ?`, [ins.insertId, cur!.setting_version_id]);
  const { invalidateSettings } = await import('../../src/config/settings.js');
  invalidateSettings();
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 15000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!ok(last)) {
    if (Date.now() > end) throw new Error(`waitFor timed out; last=${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 150));
    last = await fn();
  }
  return last;
}
