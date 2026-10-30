// #26 운영자 조치 이력 — 누가 · 언제 · 무엇을 바꿨는지 change_history 에 남긴다 (v0.1.1 admin/history.ts).
//
//   구조에서의 위치: backend → DB change_history. 명령줄 도구(#26)와 관리자 API(P3)가 같이 쓴다.
//   DB 제약: operator_id 필수(누가 했는지 없이는 남기지 않는다) · target_type · field_name 은 정해진 값만.
import type { PoolConnection } from 'mysql2/promise';
import { exec } from '../db/pool.js';

export type HistoryTarget = 'access_key' | 'key_application' | 'license_policy' | 'model' | 'account' | 'shared_score';
export type HistoryField = 'issued' | 'status' | 'call_limit_per_hour' | 'retained' | 'confirmed' | 'registered' | 'enabled'
  | 'provider_ref' | 'config' | 'load' | 'unregistered' | 'role_granted' | 'role_revoked' | 'disabled' | 'unlocked'
  | 'email_revealed' | 'taken_down' | 'restored';

export async function addHistory(
  operatorId: number, target: HistoryTarget, ref: string, field: HistoryField,
  before: unknown, after: unknown, conn?: PoolConnection,
): Promise<void> {
  const sql = 'INSERT INTO change_history (operator_id, target_type, target_ref, field_name, before_value, after_value) VALUES (?, ?, ?, ?, ?, ?)';
  const params = [operatorId, target, ref.slice(0, 40), field,
    before == null ? null : String(before).slice(0, 500), after == null ? null : String(after).slice(0, 500)];
  if (conn) await conn.query(sql, params);
  else await exec(sql, params);
}
