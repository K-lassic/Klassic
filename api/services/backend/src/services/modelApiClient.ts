// #34 model-api 클라이언트 — 서비스 키를 붙여 서비스 이름으로 부른다. 지금은 PDF 검사 · 모델 상태에서 쓰고, 인식 호출은 #35 가 쓴다.
//
//   구조에서의 위치: web → (Docker 내부망) → model-api:9543. 외부 공개 경로(Nginx)를 지나지 않아 /v1/internal/* 도 부를 수 있다.
//     키가 비어 있으면 model-api 가 401 을 준다 — backend README 「장애 조치」.
//   v0.1.1 services/modelApiClient.ts 와 같은 동작.
import { env } from '../config/env.js';

export class ModelApiDown extends Error {
  constructor(readonly reason: 'unreachable' | 'timeout' | 'http', readonly status?: number, readonly body?: unknown) {
    super(`model api ${reason}${status ? ` ${status}` : ''}`);
  }
}

interface CallOpts { timeoutMs?: number; deadline?: Date; headers?: Record<string, string> }

async function call(method: string, path: string, body?: FormData | object, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'X-API-Key': env().SERVICE_API_KEY, ...(opts.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (opts.deadline) headers['X-Deadline'] = opts.deadline.toISOString();
  const timeoutMs = opts.deadline ? Math.max(1, opts.deadline.getTime() - Date.now()) : (opts.timeoutMs ?? 15000);
  try {
    return await fetch(`${env().MODEL_API_URL}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new ModelApiDown(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable');
  }
}

export async function modelJson<T>(method: string, path: string, body?: FormData | object, opts: CallOpts = {}): Promise<T> {
  const res = await call(method, path, body, opts);
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new ModelApiDown('http', res.status, data);
  return data as T;
}

export function blobOf(data: Uint8Array | string, type = 'application/octet-stream'): Blob {
  return new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
}
