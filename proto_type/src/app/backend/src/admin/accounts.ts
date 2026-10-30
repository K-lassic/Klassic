// 계정·권한 관리 (2026-09-29 RBAC 운영자 메뉴 — spec FR-069, design/UC_17, SD_01 §9B P8 · G16, SD_02 §10A S7).
// 관리자 화면(내부망 + operator)에서: 계정 목록·상세 · 역할 주기·빼기 · 잠금 풀기 · 사용 중지·다시 사용 · 권한표(읽기 전용) · 접근 기록.
// 사유는 받지 않는다(사유는 API 접근 키 신청의 '사용 목적'에서만). 비밀번호는 보지도 바꾸지도 않는다(BR-ADM-06).
import { Router } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { one, query, tx } from '../db/pool.js';
import { ApiError, wrap } from '../web/errors.js';
import { APP_ROOT } from '../config/env.js';
import { recordGate } from '../services/gateEvents.js';
import { clearPermissionCache } from '../auth/permissions.js';
import { addHistory } from './history.js';

const ASSIGNABLE = new Set(['user', 'operator']);   // BR-ADM-05
const PAGE = 50;

interface AdminRow {
  account_id: number; login_id_masked: string; display_name: string; roles: string | null; status: string;
  created_at: Date; last_login_at: Date | null; locked_until: Date | null; disabled_at: Date | null; failed_logins: number; requests_7d: number;
}
const shape = (r: AdminRow) => ({ ...r, account_id: Number(r.account_id), roles: r.roles ? r.roles.split(',') : [], requests_7d: Number(r.requests_7d) });

async function myAccountId(operatorId: number): Promise<number | null> {
  const r = await one<{ account_id: number | null }>('SELECT account_id FROM operator_account WHERE operator_id = ?', [operatorId]);
  return r?.account_id != null ? Number(r.account_id) : null;
}

async function loadAccount(id: number): Promise<AdminRow> {
  const r = await one<AdminRow>('SELECT * FROM v_account_admin WHERE account_id = ?', [id]);
  if (!r) throw new ApiError('ACCOUNT_NOT_FOUND');
  return r;
}

/** BR-ADM-01·02 — 이 계정에서 operator 를 없애도(역할 빼기·사용 중지) 되는가. 막히면 ApiError(G16) */
export async function assertCanDropOperator(targetId: number, selfId: number | null): Promise<void> {
  if (selfId !== null && targetId === selfId) {
    await recordGate('G16', 'admin', 'account', String(targetId), 'ADMIN_SELF_PROTECTED');
    throw new ApiError('ADMIN_SELF_PROTECTED');
  }
  const isActiveOperator = await one(
    `SELECT 1 FROM account a JOIN account_role ar ON ar.account_id = a.account_id AND ar.role_code = 'operator'
      WHERE a.account_id = ? AND a.disabled_at IS NULL`, [targetId]);
  if (!isActiveOperator) return;
  const c = await one<{ n: number }>('SELECT n FROM v_active_operator_count');
  if (Number(c?.n ?? 0) <= 1) {
    await recordGate('G16', 'admin', 'account', String(targetId), 'ADMIN_LAST_OPERATOR');
    throw new ApiError('ADMIN_LAST_OPERATOR');
  }
}

async function detail(id: number) {
  const account = shape(await loadAccount(id));
  const [requests, keys, history, events] = await Promise.all([
    query(`SELECT request_no, status, route, received_at FROM score_request
            WHERE account_id = ? AND channel = 'web' ORDER BY received_at DESC LIMIT 20`, [id]),
    query(`SELECT k.key_prefix, k.status, k.issued_at FROM key_application ka JOIN access_key k ON k.key_id = ka.key_id
            WHERE ka.account_id = ? ORDER BY k.key_id DESC LIMIT 20`, [id]),
    query(`SELECT h.changed_at, h.field_name, h.before_value, h.after_value, m.login_id_masked AS operator
             FROM change_history h LEFT JOIN v_operator_masked m ON m.operator_id = h.operator_id
            WHERE h.target_type = 'account' AND h.target_ref = ? ORDER BY h.history_id DESC LIMIT 50`, [String(id)]),
    query(`SELECT occurred_at, gate_code, reason_code FROM gate_event
            WHERE subject_type = 'account' AND subject_ref = ? AND gate_code IN ('G5','G13','G14','G15','G16')
            ORDER BY occurred_at DESC LIMIT 20`, [String(id)]),
  ]);
  return { account, requests, keys, history, events };
}

export const accountsAdminRouter = Router();

accountsAdminRouter.get('/accounts', wrap(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const role = String(req.query.role ?? '');
  const status = String(req.query.status ?? '');
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    where.push('(v.account_id IN (SELECT account_id FROM account WHERE login_id LIKE ?) OR v.display_name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  if (role === 'none') where.push('v.roles IS NULL');
  else if (role === 'user' || role === 'operator') { where.push('FIND_IN_SET(?, v.roles) > 0'); args.push(role); }
  if (['active', 'locked', 'disabled'].includes(status)) { where.push('v.status = ?'); args.push(status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM v_account_admin v ${w}`, args);
  const rows = await query<AdminRow>(`SELECT v.* FROM v_account_admin v ${w} ORDER BY v.created_at DESC, v.account_id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, args);
  res.json({ items: rows.map(shape), page, page_size: PAGE, total: Number(total?.n ?? 0) });
}));

accountsAdminRouter.get('/accounts/:id', wrap(async (req, res) => { res.json(await detail(Number(req.params.id))); }));

accountsAdminRouter.post('/accounts/:id/reveal-email', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const a = await one<{ login_id: string }>('SELECT login_id FROM account WHERE account_id = ?', [id]);
  if (!a) throw new ApiError('ACCOUNT_NOT_FOUND');
  await addHistory(req.operatorId!, 'account', String(id), 'email_revealed', null, null);
  res.json({ login_id: a.login_id });
}));

accountsAdminRouter.put('/accounts/:id/roles', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const grant: string[] = Array.isArray(req.body?.grant) ? req.body.grant.map(String) : [];
  const revoke: string[] = Array.isArray(req.body?.revoke) ? req.body.revoke.map(String) : [];
  const bad = [...grant, ...revoke].find((r) => !ASSIGNABLE.has(r));
  if (bad) {
    await recordGate('G16', 'admin', 'account', String(id), 'ROLE_NOT_ASSIGNABLE');
    throw new ApiError('ROLE_NOT_ASSIGNABLE', { role: bad });
  }
  const before = shape(await loadAccount(id)).roles;
  if (revoke.includes('operator') && before.includes('operator')) await assertCanDropOperator(id, await myAccountId(req.operatorId!));
  await tx(async (conn) => {
    for (const r of grant) {
      if (before.includes(r)) continue;
      await conn.query('INSERT INTO account_role (account_id, role_code, granted_by) VALUES (?, ?, ?)', [id, r, await myAccountId(req.operatorId!)]);
      await addHistory(req.operatorId!, 'account', String(id), 'role_granted', null, r, conn);
    }
    for (const r of revoke) {
      if (!before.includes(r)) continue;
      await conn.query('DELETE FROM account_role WHERE account_id = ? AND role_code = ?', [id, r]);
      await addHistory(req.operatorId!, 'account', String(id), 'role_revoked', r, null, conn);
    }
  });
  res.json(await detail(id));   // 역할은 요청마다 읽으므로 다음 요청부터 적용(BR-ADM-04)
}));

accountsAdminRouter.post('/accounts/:id/unlock', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const a = await loadAccount(id);
  await tx(async (conn) => {
    await conn.query('UPDATE account SET failed_logins = 0, locked_until = NULL WHERE account_id = ?', [id]);
    await addHistory(req.operatorId!, 'account', String(id), 'unlocked', a.status, 'active', conn);
  });
  res.json(await detail(id));
}));

accountsAdminRouter.post('/accounts/:id/disable', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const a = await loadAccount(id);
  if (!a.disabled_at) {
    await assertCanDropOperator(id, await myAccountId(req.operatorId!));
    await tx(async (conn) => {
      await conn.query('UPDATE account SET disabled_at = CURRENT_TIMESTAMP(3) WHERE account_id = ?', [id]);
      // BR-ADM-03: 열린 세션을 모두 끝낸다(즉시 로그아웃)
      await conn.query("UPDATE anon_session SET ended_at = CURRENT_TIMESTAMP(3), end_reason = 'exit' WHERE account_id = ? AND ended_at IS NULL", [id]);
      await addHistory(req.operatorId!, 'account', String(id), 'disabled', 'active', 'disabled', conn);
    });
  }
  res.json(await detail(id));
}));

accountsAdminRouter.post('/accounts/:id/enable', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const a = await loadAccount(id);
  if (a.disabled_at) {
    await tx(async (conn) => {
      await conn.query('UPDATE account SET disabled_at = NULL, failed_logins = 0, locked_until = NULL WHERE account_id = ?', [id]);
      await addHistory(req.operatorId!, 'account', String(id), 'enabled', 'disabled', 'active', conn);
    });
  }
  res.json(await detail(id));
}));

/** design/UC_00 §4-1 표에서 역할별 유스케이스를 읽는다(설계서와 DB 가 같은지 점검용). 설계서가 없으면 null.
 *  (2026-10-01) 원본 ../design 이 없으면(제출물처럼 app 만 있을 때) app/docs/reference 사본을 읽는다 */
function designTable(): Record<string, string[]> | null {
  const name = 'UC_00_개요_국악보변환서비스.md';
  const f = [resolve(APP_ROOT, '..', 'design', name), resolve(APP_ROOT, 'docs', 'reference', name)].find((p) => existsSync(p));
  if (!f) return null;
  const text = readFileSync(f, 'utf8');
  const start = text.indexOf('### 4-1.');
  if (start < 0) return null;
  const cols = ['guest', 'user', 'operator', 'api_caller', 'service'];
  const out: Record<string, string[]> = { user: [], operator: [], api_caller: [], service: [] };
  for (const line of text.slice(start).split('\n').slice(1)) {
    if (line.startsWith('## ')) break;
    const m = line.match(/^\| (UC\d+) /);
    if (!m) continue;
    const cells = line.split('|').slice(2, 7).map((c) => c.trim());
    cells.forEach((c, i) => { if (c.startsWith('O') && cols[i] !== 'guest') out[cols[i]].push(m[1]); });
  }
  return out;
}

accountsAdminRouter.get('/permissions', wrap(async (_req, res) => {
  clearPermissionCache();
  const rows = await query<{ role_code: string; uc_code: string }>('SELECT role_code, uc_code FROM role_permission ORDER BY role_code, uc_code');
  const table: Record<string, string[]> = {};
  for (const r of rows) (table[r.role_code] ??= []).push(r.uc_code);
  const sortUc = (a: string, b: string) => Number(a.slice(2)) - Number(b.slice(2));
  Object.values(table).forEach((l) => l.sort(sortUc));
  const design = designTable();
  const differs = design ? Object.keys(design).filter((r) => JSON.stringify([...design[r]].sort(sortUc)) !== JSON.stringify(table[r] ?? [])) : [];
  res.json({ table, public: ['UC11', 'UC16'], editable: false, design_source: 'design/UC_00_개요_국악보변환서비스.md §4-1', design_differs: differs });
}));

accountsAdminRouter.get('/auth-events', wrap(async (req, res) => {
  const gates = ['G5', 'G13', 'G14', 'G15', 'G16'];
  const gate = gates.includes(String(req.query.gate)) ? String(req.query.gate) : null;
  const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours ?? 24) || 24));
  const account = req.query.account ? String(Number(req.query.account)) : null;
  const where = ['gate_code IN (?, ?, ?, ?, ?)', 'occurred_at > CURRENT_TIMESTAMP(3) - INTERVAL ? HOUR'];
  const args: unknown[] = [...gates, hours];
  if (gate) { where.push('gate_code = ?'); args.push(gate); }
  if (account) { where.push("subject_type = 'account' AND subject_ref = ?"); args.push(account); }
  const items = await query(
    `SELECT event_id, occurred_at, gate_code, channel, subject_type, subject_ref, reason_code FROM gate_event
      WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC LIMIT 200`, args);
  const sum = await query<{ gate_code: string; n: number }>(
    `SELECT gate_code, COUNT(*) AS n FROM gate_event WHERE gate_code IN (?, ?, ?, ?, ?)
       AND occurred_at > CURRENT_TIMESTAMP(3) - INTERVAL 24 HOUR GROUP BY gate_code`, gates);
  const locked = await one<{ n: number }>("SELECT COUNT(*) AS n FROM v_account_admin WHERE status = 'locked'");
  const summary: Record<string, number> = Object.fromEntries(gates.map((g) => [g, 0]));
  for (const s of sum) summary[s.gate_code] = Number(s.n);
  res.json({ items, summary, locked_accounts: Number(locked?.n ?? 0), hours });
}));

