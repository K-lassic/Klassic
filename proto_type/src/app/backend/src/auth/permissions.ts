// 역할 → 유스케이스 권한표 (FR-068, design/UC_00 §4-1, SD_01 P7 7.6 · G13).
// 허용 여부는 DB role_permission 만 본다. 여기에는 "경로 → 유스케이스" 대응만 둔다 — 표에 없는 경로는 막힌다.
import { query } from '../db/pool.js';

/** 방문자(로그인 안 함)도 쓰는 유스케이스 — UC11 API활용 안내 보기, UC16 가입·로그인하기 */
export const PUBLIC_UCS: ReadonlySet<string> = new Set(['UC11', 'UC16']);

// 위에서부터 처음 맞는 것. 경로는 /api 로 시작하고 쿼리는 뺀 값. '*' = 모든 메서드
const ROUTES: readonly [RegExp, string, string][] = [
  [/^\/api\/auth\/(login|signup|logout|me)$/, '*', 'UC16'],
  [/^\/api\/session\/end$/, 'POST', 'UC16'],
  [/^\/api\/api-docs$/, 'GET', 'UC11'],
  [/^\/api\/key-applications$/, 'POST', 'UC15'],
  [/^\/api\/models\/status$/, 'GET', 'UC1'],
  [/^\/api\/requests$/, 'POST', 'UC1'],
  // 예시 악보(2026-09-30 황송해 72번) — 예시로 올리기 · 목록 · 미리보기 모두 올리기(UC1) 권한
  [/^\/api\/requests\/example$/, 'POST', 'UC1'],
  [/^\/api\/examples(\/[^/]+\/thumb)?$/, 'GET', 'UC1'],
  // 내가 만든 악보(2026-09-30 황송해 160번) — 내려받기(UC7) 권한
  [/^\/api\/my-scores$/, 'GET', 'UC7'],
  // 내가 만든 악보 지우기(2026-09-30 황송해 176번) — 소유 확인은 라우터(이 계정 요청만)
  [/^\/api\/my-scores\/[^/]+$/, 'DELETE', 'UC7'],
  [/^\/api\/requests\/[^/]+\/fallback$/, 'POST', 'UC2'],
  [/^\/api\/requests\/[^/]+\/(recommendation|instrument-choice)$/, '*', 'UC5'],
  [/^\/api\/instruments$/, 'GET', 'UC5'],
  [/^\/api\/requests\/[^/]+\/edits$/, 'PUT', 'UC6'],
  [/^\/api\/requests\/[^/]+\/exports$/, 'POST', 'UC7'],
  [/^\/api\/requests\/[^/]+\/exports\/[^/]+(\/file)?$/, 'GET', 'UC7'],
  [/^\/api\/requests\/[^/]+\/original\/[^/]+$/, 'GET', 'UC7'],
  // 공유 악보 · 좋아요(2026-09-30 황송해, UC18 · SD_01 P9) — 공유 · 거두기는 요청 소유자만(ownership), 목록 · 듣기 · 좋아요는 user
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
