// 관리자 API (/admin, 같은 출처 · 쿠키 gugak_admin). app/docs/INTERFACES.md §5.
import { api, GateError } from '@/api/client';
import type {
  AdminMe, AdminModel, ApplicationRow, AuditRow, EngineOrder, EvaluationMetrics, IssuedServiceKey, JobDetail,
  JobList, JobRow, KeyRow, LicenseState, Metrics, ModelApiStatus, NewModel, OllamaAvailable, SettingsPatch,
  SettingsSnapshot, AccountList, AccountDetail, PermissionTable, AuthEvents, SharedScoreAdminRow,
} from './types';

let onSessionLost: (() => void) | null = null;
/** 로그인이 풀렸을 때(401 ADMIN_LOGIN_REQUIRED) 부를 함수 — AdminApp 이 등록한다 */
export function setSessionLostHandler(fn: (() => void) | null) {
  onSessionLost = fn;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof GateError && e.status === 401 && e.code === 'ADMIN_LOGIN_REQUIRED' && onSessionLost) onSessionLost();
    throw e;
  }
}

/** 배열 · {items} · {rows} · {models} 어느 모양이든 배열로 */
export function asList<T>(data: unknown, key?: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const k of [key, 'items', 'rows', 'models', 'data'].filter(Boolean) as string[]) {
      if (Array.isArray(o[k])) return o[k] as T[];
    }
  }
  return [];
}

function qs(params: Record<string, string | number | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

const EMPTY_ORDER: EngineOrder = { staff: [], jeongganbo: [], recommend: [] };

export function normalizeSettings(raw: unknown): SettingsSnapshot {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // {settings:{…}, engine_order:{…}} 모양도 받는다
  const base = (o.settings && typeof o.settings === 'object' ? { ...(o.settings as object), ...o } : o) as Record<string, unknown>;
  const order = (base.engine_order ?? base.engine_orders ?? {}) as Partial<EngineOrder>;
  return {
    ...(base as object),
    setting_version_id: (base.setting_version_id as number | null) ?? null,
    fallback_enabled: base.fallback_enabled === undefined ? true : Boolean(base.fallback_enabled),
    engine_order: {
      staff: [...(order.staff ?? EMPTY_ORDER.staff)],
      jeongganbo: [...(order.jeongganbo ?? EMPTY_ORDER.jeongganbo)],
      recommend: [...(order.recommend ?? EMPTY_ORDER.recommend)],
    },
  } as SettingsSnapshot;
}

export const adminApi = {
  // G5
  me: () => call(api.get<AdminMe>('/admin/me')),
  login: (login_id: string, password: string) => api.post<AdminMe | null>('/admin/login', { login_id, password }),
  logout: () => api.post<null>('/admin/logout'),

  // S6
  metrics: () => call(api.get<Metrics>('/admin/metrics')),
  jobs: async (f: { limit: number; offset: number; channel?: string; route?: string; reason?: string; missing?: string }): Promise<JobList> => {
    const data = await call(api.get<unknown>(`/admin/jobs${qs(f)}`));
    const total = data && typeof data === 'object' && !Array.isArray(data) ? ((data as { total?: number }).total ?? null) : null;
    return { items: asList<JobRow>(data), total };
  },
  job: (no: string) => call(api.get<JobDetail>(`/admin/jobs/${encodeURIComponent(no)}`)),
  evaluation: () => call(api.get<EvaluationMetrics>('/admin/evaluation')),
  runEvaluation: () => call(api.post<unknown>('/admin/evaluation/run')),
  modelApiStatus: () => call(api.get<ModelApiStatus>('/admin/model-api-status')),
  settings: async () => normalizeSettings(await call(api.get<unknown>('/admin/settings'))),
  saveSettings: async (patch: SettingsPatch) => normalizeSettings(await call(api.put<unknown>('/admin/settings', patch))),
  audit: async (f: { target_type?: string; limit?: number } = {}) => asList<AuditRow>(await call(api.get<unknown>(`/admin/audit${qs(f)}`))),

  // 모델 (§5 · §7)
  models: async () => asList<AdminModel>(await call(api.get<unknown>('/admin/models'))),
  addModel: (m: NewModel) => call(api.post<AdminModel>('/admin/models', m)),
  updateModel: (name: string, patch: { enabled?: boolean; display_name?: string; provider_ref?: string; config?: unknown }) =>
    call(api.put<AdminModel>(`/admin/models/${encodeURIComponent(name)}`, patch)),
  removeModel: (name: string) => call(api.del<null>(`/admin/models/${encodeURIComponent(name)}`)),
  loadModel: (name: string) => call(api.post<{ load_id: number | string; expected_seconds: number | null }>(`/admin/models/${encodeURIComponent(name)}/load`)),
  ollamaAvailable: async (): Promise<OllamaAvailable> => {
    const data = await call(api.get<unknown>('/admin/models/ollama-available'));
    const o = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Partial<OllamaAvailable>;
    return { ollama: o.ollama ?? 'ok', version: o.version ?? null, models: asList(data, 'models') };
  },

  // S4-B
  keys: async () => asList<KeyRow>(await call(api.get<unknown>('/admin/keys'))),
  revokeKey: (id: KeyRow['key_id']) => call(api.post<unknown>(`/admin/keys/${encodeURIComponent(String(id))}/revoke`)),
  setKeyLimit: (id: KeyRow['key_id'], call_limit_per_hour: number) =>
    call(api.put<unknown>(`/admin/keys/${encodeURIComponent(String(id))}/limit`, { call_limit_per_hour })),
  issueServiceKey: () => call(api.post<IssuedServiceKey>('/admin/service-key')),
  applications: async () => asList<ApplicationRow>(await call(api.get<unknown>('/admin/applications'))),
  archiveApplication: (no: string) => call(api.post<unknown>(`/admin/applications/${encodeURIComponent(no)}/archive`)),
  license: () => call(api.get<LicenseState>('/admin/license')),
  setLicense: (confirmed: boolean) => call(api.put<LicenseState | null>('/admin/license', { confirmed })),

  // S7 계정·권한 (2026-09-29 RBAC 운영자 메뉴 — FR-069 · UC17). 사유는 받지 않는다(사유는 API 키 신청 때만)
  accounts: (f: { q?: string; role?: string; status?: string; page?: number } = {}) => call(api.get<AccountList>(`/admin/accounts${qs(f)}`)),
  account: (id: number) => call(api.get<AccountDetail>(`/admin/accounts/${id}`)),
  revealEmail: (id: number) => call(api.post<{ login_id: string }>(`/admin/accounts/${id}/reveal-email`)),
  setRoles: (id: number, change: { grant?: string[]; revoke?: string[] }) => call(api.put<AccountDetail>(`/admin/accounts/${id}/roles`, change)),
  unlockAccount: (id: number) => call(api.post<AccountDetail>(`/admin/accounts/${id}/unlock`)),
  disableAccount: (id: number) => call(api.post<AccountDetail>(`/admin/accounts/${id}/disable`)),
  enableAccount: (id: number) => call(api.post<AccountDetail>(`/admin/accounts/${id}/enable`)),
  permissions: () => call(api.get<PermissionTable>('/admin/permissions')),
  authEvents: (f: { gate?: string; hours?: number; account?: number } = {}) => call(api.get<AuthEvents>(`/admin/auth-events${qs(f)}`)),

  // S8 공유 악보 관리(2026-09-30 황송해, UC19)
  sharedScores: (status = 'all') => call(api.get<{ items: SharedScoreAdminRow[] }>(`/admin/shared-scores?status=${encodeURIComponent(status)}`)),
  takeDownShared: (shareNo: string, reason: string) => call(api.post<{ share_no: string; status: string }>(`/admin/shared-scores/${encodeURIComponent(shareNo)}/take-down`, { reason })),
  restoreShared: (shareNo: string) => call(api.post<{ share_no: string; status: string }>(`/admin/shared-scores/${encodeURIComponent(shareNo)}/restore`)),
};
