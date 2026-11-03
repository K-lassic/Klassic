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
import { one, signalMessage, tx } from '../db/pool.js';
import { newApplicationNo } from '../lib/ids.js';
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

export interface KeyApplicationInput {
  name: string; organization: string; contactEmail: string; purpose: string;
  /** 시간당 호출 한도 — DB 제약 chk_key_limit_required 로 외부 키에는 필수 */
  callLimitPerHour: number;
  clientAddrHash: string;
  accountId: number | null;
}
export interface IssuedExternalKey { keyId: number; raw: string; prefix: string; applicationNo: string; callLimitPerHour: number }

/** G11 신청 빈도 초과 (DB 트리거가 거절) — 부른 쪽이 다시 시도할 시각을 안내한다 */
export class ApplicationRateLimited extends Error {}

/**
 * #91 외부 키 발급 — access_key 와 key_application 을 한 트랜잭션으로 넣는다. 화면 신청과 명령줄 도구가 같이 쓴다.
 * DB 제약 chk_key_origin: 외부 키는 신청 번호가 필수이고 issued_by 는 비어 있어야 한다.
 * 원문은 돌려주기만 하고 저장하지 않는다.
 */
export async function issueExternalKey(a: KeyApplicationInput): Promise<IssuedExternalKey> {
  const key = newAccessKey();
  const applicationNo = newApplicationNo();
  try {
    return await tx(async (conn) => {
      const [k] = await conn.query(
        "INSERT INTO access_key (key_kind, key_hash, key_prefix, application_no, call_limit_per_hour) VALUES ('external', ?, ?, ?, ?)",
        [key.hash, key.prefix, applicationNo, a.callLimitPerHour]);
      const keyId = Number((k as { insertId: number }).insertId);
      await conn.query(
        `INSERT INTO key_application (key_id, applicant_name, affiliation, contact_email, purpose, consent_given, client_addr_hash, account_id)
         VALUES (?, ?, ?, ?, ?, TRUE, ?, ?)`,
        [keyId, a.name.slice(0, 100), a.organization.slice(0, 200), a.contactEmail.slice(0, 254), a.purpose.slice(0, 1000),
         a.clientAddrHash, a.accountId]);
      return { keyId, raw: key.raw, prefix: key.prefix, applicationNo, callLimitPerHour: a.callLimitPerHour };
    });
  } catch (e) {
    if (signalMessage(e)?.startsWith('G11')) throw new ApplicationRateLimited();
    throw e;
  }
}
