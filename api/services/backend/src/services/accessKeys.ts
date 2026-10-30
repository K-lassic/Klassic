// #26 접근 키 발급 · 폐기 — 명령줄 도구(#26)와 나중의 관리자 API(P3) · 외부 키 신청(P2)이 같이 쓰는 한 곳.
//
//   구조에서의 위치
//     backend ─(만들기 · 폐기)─▶ DB access_key · change_history
//     model-api ─(대조)─▶ DB access_key (X-API-Key 의 SHA-256 = key_hash, status = 'active')
//   키 종류
//     service  — backend → model-api 호출용. 동시에 하나만 살아 있다 (새로 만들면 이전 것은 폐기)
//     external — 외부 사용자용 (시간당 호출 한도 필수 · 키 신청 번호와 연결). 예시 홈페이지(P2)도 이것을 쓴다
//   v0.1.1 참고: backend/src/admin/keys.ts (POST /admin/service-key) · web/keyApplications.ts
import type { PoolConnection } from 'mysql2/promise';
import { one, tx } from '../db/pool.js';
import { newAccessKey } from '../lib/keys.js';
import { addHistory } from './history.js';

export interface IssuedKey { keyId: number; raw: string; prefix: string; revokedKeyIds: number[] }

/** 운영자 로그인 아이디 → 운영자 번호. 없거나 사용 중지면 오류 (이력에 누가 했는지 남겨야 한다) */
export async function operatorIdOf(loginId: string): Promise<number> {
  const o = await one<{ operator_id: number; disabled_at: Date | null }>(
    'SELECT operator_id, disabled_at FROM operator_account WHERE login_id = ?', [loginId]);
  if (!o) throw new Error(`운영자 아이디가 없습니다: ${loginId} — 먼저 createOperator 도구로 만드세요`);
  if (o.disabled_at) throw new Error(`사용 중지된 운영자입니다: ${loginId}`);
  return Number(o.operator_id);
}

async function revokeActiveServiceKeys(conn: PoolConnection, operatorId: number): Promise<number[]> {
  const [rows] = await conn.query("SELECT key_id FROM access_key WHERE key_kind = 'service' AND status = 'active' FOR UPDATE");
  const ids = (rows as { key_id: number }[]).map((r) => Number(r.key_id));
  for (const id of ids) {
    await conn.query("UPDATE access_key SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(3), revoked_by = ? WHERE key_id = ?", [operatorId, id]);
    await addHistory(operatorId, 'access_key', String(id), 'status', 'active', 'revoked', conn);
  }
  return ids;
}

/**
 * 서비스 전용 키 발급 — 이전 서비스 키를 모두 폐기하고 새 키 하나를 만든다 (한 트랜잭션: 중간에 실패하면 이전 키가 그대로 남는다).
 * 원문은 돌려주기만 하고 저장하지 않는다. 호출한 쪽이 한 번만 보여 준다.
 */
export async function issueServiceKey(operatorId: number): Promise<IssuedKey> {
  const key = newAccessKey();
  return tx(async (conn) => {
    const revokedKeyIds = await revokeActiveServiceKeys(conn, operatorId);
    const [ins] = await conn.query(
      "INSERT INTO access_key (key_kind, key_hash, key_prefix, issued_by) VALUES ('service', ?, ?, ?)",
      [key.hash, key.prefix, operatorId]);
    const keyId = Number((ins as { insertId: number }).insertId);
    await addHistory(operatorId, 'access_key', String(keyId), 'issued', null, key.prefix, conn);
    return { keyId, raw: key.raw, prefix: key.prefix, revokedKeyIds };
  });
}

// 외부 키 발급(예시 홈페이지 · 키 신청 P2)은 여기에 issueExternalKey(operatorId, { callLimitPerHour, applicationNo }) 로 더한다.
//   DB 제약: key_kind = 'external' 이면 call_limit_per_hour 필수 (chk_key_limit_required)
