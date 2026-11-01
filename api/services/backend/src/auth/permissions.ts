// #27 경로 → 유스케이스(UC) 대응표 · 역할 권한표 (기능 목록 H9 · v0.1.1 auth/permissions.ts).
//
//   구조에서의 위치: 모든 /api 요청이 authz(이 표) → 라우터 순서로 지나간다.
//     허용 여부는 DB role_permission(역할 → UC)만 본다. 여기에는 "경로 → UC" 만 둔다 — 표에 없는 경로는 막힌다(404).
//   경로를 새로 만들면 이 표에도 한 줄 더해야 열린다 (계약 web-api.yaml 의 x-uc 와 같은 값).
import { query } from '../db/pool.js';

/** 방문자(로그인 안 함)도 쓰는 UC — UC11 API 활용 안내 · UC16 가입 · 로그인 */
export const PUBLIC_UCS: ReadonlySet<string> = new Set(['UC11', 'UC16']);

// 위에서부터 처음 맞는 것. 경로는 /api 로 시작하고 쿼리는 뺀 값. '*' = 모든 메서드
const ROUTES: readonly [RegExp, string, string][] = [
  [/^\/api\/auth\/(login|signup|logout|me)$/, '*', 'UC16'],
  [/^\/api\/session\/end$/, 'POST', 'UC16'],
  [/^\/api\/api-docs$/, 'GET', 'UC11'],
  [/^\/api\/key-applications$/, 'POST', 'UC15'],
  [/^\/api\/models\/status$/, 'GET', 'UC1'],
  [/^\/api\/requests$/, 'POST', 'UC1'],
  [/^\/api\/requests\/example$/, 'POST', 'UC1'],
  [/^\/api\/examples(\/[^/]+\/thumb)?$/, 'GET', 'UC1'],
  [/^\/api\/my-scores$/, 'GET', 'UC7'],
  [/^\/api\/my-scores\/[^/]+$/, 'DELETE', 'UC7'],
  [/^\/api\/requests\/[^/]+\/fallback$/, 'POST', 'UC2'],
  [/^\/api\/requests\/[^/]+\/(recommendation|instrument-choice)$/, '*', 'UC5'],
  [/^\/api\/instruments$/, 'GET', 'UC5'],
  [/^\/api\/requests\/[^/]+\/edits$/, 'PUT', 'UC6'],
  [/^\/api\/requests\/[^/]+\/exports$/, 'POST', 'UC7'],
  [/^\/api\/requests\/[^/]+\/exports\/[^/]+(\/file)?$/, 'GET', 'UC7'],
  [/^\/api\/requests\/[^/]+\/original\/[^/]+$/, 'GET', 'UC7'],
  [/^\/api\/requests\/[^/]+\/share$/, '*', 'UC18'],
  [/^\/api\/shared-scores$/, 'GET', 'UC18'],
  [/^\/api\/shared-scores\/[^/]+\/(score|like|use)$/, '*', 'UC18'],
  [/^\/api\/requests\/[^/]+\/(type-confirmation|events)$/, 'POST', 'UC1'],
  [/^\/api\/requests\/[^/]+(\/score)?$/, 'GET', 'UC1'],
];

export function ucOf(method: string, path: string): string | null {
  for (const [re, m, uc] of ROUTES) if ((m === '*' || m === method) && re.test(path)) return uc;
  return null;
}

let cache: { at: number; table: Map<string, Set<string>> } | null = null;

/** role_permission 전체(60초 캐시) — 권한표를 바꾸면 늦어도 1분 뒤 반영된다 */
export async function permissionTable(): Promise<Map<string, Set<string>>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.table;
  const rows = await query<{ role_code: string; uc_code: string }>('SELECT role_code, uc_code FROM role_permission');
  const table = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!table.has(r.role_code)) table.set(r.role_code, new Set());
    table.get(r.role_code)!.add(r.uc_code);
  }
  cache = { at: Date.now(), table };
  return table;
}

export function clearPermissionCache(): void { cache = null; }

export function isAllowed(roles: readonly string[], uc: string, table: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  if (PUBLIC_UCS.has(uc)) return true;
  return roles.some((r) => table.get(r)?.has(uc) ?? false);
}
