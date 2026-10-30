// 운영자 조치 이력 (FR-052): 누가·언제·무엇을
import type { PoolConnection } from 'mysql2/promise';
import { exec } from '../db/pool.js';

export type Target = 'access_key' | 'key_application' | 'license_policy' | 'model' | 'account' | 'shared_score';  // shared_score: 2026-09-30 UC19
export type Field = 'issued' | 'status' | 'call_limit_per_hour' | 'retained' | 'confirmed' | 'registered' | 'enabled' | 'provider_ref' | 'config' | 'load' | 'unregistered'
  | 'role_granted' | 'role_revoked' | 'disabled' | 'unlocked' | 'email_revealed'  // 계정(2026-09-29 RBAC 운영자 메뉴, 009)
  | 'taken_down' | 'restored';  // 공유 악보 내리기 · 다시 올리기(2026-09-30 UC19, 012)

export async function addHistory(operatorId: number, target: Target, ref: string, field: Field, before: unknown, after: unknown, conn?: PoolConnection): Promise<void> {
  const sql = 'INSERT INTO change_history (operator_id, target_type, target_ref, field_name, before_value, after_value) VALUES (?, ?, ?, ?, ?, ?)';
  const params = [operatorId, target, ref.slice(0, 40), field, before == null ? null : String(before).slice(0, 500), after == null ? null : String(after).slice(0, 500)];
  if (conn) await conn.query(sql, params);
  else await exec(sql, params);
}
