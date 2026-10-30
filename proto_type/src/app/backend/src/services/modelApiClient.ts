// 모델 API 서버 클라이언트 (tasks T060): 서비스 전용 키, 호출마다 남은 시간만큼만 기다린다.
import { env } from '../config/env.js';

export class ModelApiDown extends Error {
  constructor(readonly reason: 'unreachable' | 'timeout' | 'http', readonly status?: number, readonly body?: unknown) {
    super(`model api ${reason}${status ? ` ${status}` : ''}`);
  }
}

interface CallOpts { timeoutMs?: number; deadline?: Date; headers?: Record<string, string> }

async function call(method: string, path: string, body?: FormData | object, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'X-API-Key': env.SERVICE_API_KEY, ...(opts.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (opts.deadline) headers['X-Deadline'] = opts.deadline.toISOString();
  const timeoutMs = opts.deadline ? Math.max(1, opts.deadline.getTime() - Date.now()) : (opts.timeoutMs ?? 15000);
  try {
    return await fetch(`${env.MODEL_API_URL}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
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

export async function modelBinary(path: string, body: FormData, opts: CallOpts = {}): Promise<{ data: Buffer; headers: Headers; json?: unknown }> {
  const res = await call('POST', path, body, opts);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const json = type.includes('json') ? await res.json() : null;
    throw new ModelApiDown('http', res.status, json);
  }
  if (type.includes('json')) return { data: Buffer.alloc(0), headers: res.headers, json: await res.json() };
  return { data: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

export function blobOf(data: Uint8Array | string, type = 'application/octet-stream'): Blob {
  return new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
}
