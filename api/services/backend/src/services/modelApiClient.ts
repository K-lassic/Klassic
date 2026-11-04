// #34 model-api 클라이언트 — 서비스 키를 붙여 서비스 이름으로 부른다. PDF 검사 · 모델 상태 · 인식(#35) · 렌더링(#36)이 쓴다.
//
//   구조에서의 위치: web → (Docker 내부망) → model-api:9543. 외부 공개 경로(Nginx)를 지나지 않아 /v1/internal/* 도 부를 수 있다.
//     키가 비어 있으면 model-api 가 401 을 준다 — backend README 「장애 조치」.
//   v0.1.1 services/modelApiClient.ts 와 같은 동작.
//   #174 Node 내장 fetch 는 응답 머리글을 300초(headersTimeout)까지만 기다려, 4쪽 넘는 인식이 마감 전에 끊기고
//     'engine_stopped' 로 끝났다. 대기 한도를 끈 undici Agent 로 부르고, 끊는 시점은 마감(AbortSignal)만 정한다.
//     undici 는 Node 22.21.1 내장과 같은 6.22.0 으로 고정하고 fetch · Agent 를 둘 다 거기서 가져와 짝을 맞춘다.
import { Agent, fetch, type RequestInit } from 'undici';
import { env } from '../config/env.js';

// 전역 dispatcher 는 바꾸지 않는다 — model-api 호출에만 쓴다
const modelAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
// undici 가 머리글 · 본문을 기다리다 끊은 오류 — 연결 실패가 아니라 시간 초과다
const UNDICI_TIMEOUTS = new Set(['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

export class ModelApiDown extends Error {
  constructor(readonly reason: 'unreachable' | 'timeout' | 'http', readonly status?: number, readonly body?: unknown) {
    super(`model api ${reason}${status ? ` ${status}` : ''}`);
  }
}

interface CallOpts { timeoutMs?: number; deadline?: Date; headers?: Record<string, string> }

async function call(method: string, path: string, body?: FormData | object, opts: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'X-API-Key': env().SERVICE_API_KEY, ...(opts.headers ?? {}) };
  let payload: RequestInit['body'];
  // 내장 FormData 와 undici FormData 는 같은 판(6.22.0)이지만 타입 선언이 달라 맞춰 준다
  if (body instanceof FormData) payload = body as unknown as RequestInit['body'];
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  if (opts.deadline) headers['X-Deadline'] = opts.deadline.toISOString();
  const timeoutMs = opts.deadline ? Math.max(1, opts.deadline.getTime() - Date.now()) : (opts.timeoutMs ?? 15000);
  try {
    return await fetch(`${env().MODEL_API_URL}${path}`,
      { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs), dispatcher: modelAgent }) as unknown as Response;
  } catch (e) {
    const name = (e as Error)?.name;
    const cause = ((e as Error)?.cause as { code?: string } | undefined)?.code;
    const timedOut = name === 'TimeoutError' || name === 'AbortError' || UNDICI_TIMEOUTS.has(cause ?? '');
    throw new ModelApiDown(timedOut ? 'timeout' : 'unreachable');
  }
}

export async function modelJson<T>(method: string, path: string, body?: FormData | object, opts: CallOpts = {}): Promise<T> {
  const res = await call(method, path, body, opts);
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
  if (!res.ok) throw new ModelApiDown('http', res.status, data);
  return data as T;
}

/** 렌더링 — 파일(MP3 · PDF)을 받는다. 200 인데 JSON 이면 파일이 아니라 판정 응답 */
export async function modelBinary(path: string, body: FormData, opts: CallOpts = {}): Promise<{ data: Buffer; headers: Headers; json?: unknown }> {
  const res = await call('POST', path, body, opts);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) throw new ModelApiDown('http', res.status, type.includes('json') ? await res.json() : null);
  if (type.includes('json')) return { data: Buffer.alloc(0), headers: res.headers, json: await res.json() };
  return { data: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

export function blobOf(data: Uint8Array | string, type = 'application/octet-stream'): Blob {
  return new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
}
