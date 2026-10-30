// 웹·관리자 화면 공통 fetch 래퍼 (tasks T047). 오류 모양은 app/docs/INTERFACES.md §2.
import { allowLeaveForSessionExpiry } from '@/composables/useLeaveGuard';
export interface ApiErrorBody {
  code: string;
  message: string;
  fix?: string;
  gate: string | null;
  retry_after: string | null;
  details?: Record<string, unknown>;
}

export class GateError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
  get code() { return this.body.code; }
  get gate() { return this.body.gate; }
  /** 다시 시도할 수 있는 시각(한도 초과 G3·G11·G12, 잠금 G5) */
  get retryAt(): Date | null { return this.body.retry_after ? new Date(this.body.retry_after) : null; }
}

async function parse(res: Response): Promise<unknown> {
  const type = res.headers.get('content-type') ?? '';
  if (res.status === 204) return null;
  if (type.includes('application/json')) return res.json();
  return res.blob();
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new GateError(0, { code: 'NETWORK', message: '서버에 연결할 수 없습니다.', fix: '잠시 뒤 다시 시도해 주십시오.', gate: null, retry_after: null });
  }
  const data = await parse(res);
  if (!res.ok) {
    const err = (data as { error?: ApiErrorBody } | null)?.error;
    // 2026-09-29 RBAC(G13): 로그인이 필요하면(세션이 끝났을 때 포함) 로그인 화면으로 보냈다가 돌아온다(UC16 A2·E6)
    if (res.status === 401 && err?.code === 'AUTH_LOGIN_REQUIRED' && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      allowLeaveForSessionExpiry(); // 만료로 가는 이동에는 나가기 경고를 띄우지 않는다(2026-09-30)
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
    throw new GateError(res.status, err ?? { code: 'INTERNAL_ERROR', message: '서버 안에서 문제가 생겼습니다.', gate: null, retry_after: null });
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};
