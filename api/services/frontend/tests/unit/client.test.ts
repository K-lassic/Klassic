// API 클라이언트 오류 처리 (#38) — 계약 web-api.yaml 의 ErrorResponse({ error: { code, message, fix, gate, retry_after } })
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, GateError, request } from '@/api/client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const fetchMock = vi.fn<typeof fetch>();
const assignMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', { ...window.location, pathname: '/r/12/listen', search: '?x=1', assign: assignMock });
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  assignMock.mockReset();
});

describe('정상 응답', () => {
  it('JSON 이면 그대로 돌려준다 · 같은 출처 쿠키를 쓴다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'R-1' }));
    await expect(api.get('/api/requests/R-1')).resolves.toEqual({ id: 'R-1' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'same-origin' });
  });

  it('204 는 null', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.del('/api/my-scores/1')).resolves.toBeNull();
  });

  it('JSON 이 아니면 Blob (내려받기)', async () => {
    fetchMock.mockResolvedValue(new Response('MThd', { status: 200, headers: { 'content-type': 'audio/midi' } }));
    const out = await api.get<Blob>('/api/requests/R-1/files/midi');
    // jsdom 과 Node 의 Blob 이 서로 달라 instanceof 대신 모양으로 본다
    expect(out).toMatchObject({ size: 4, type: 'audio/midi' });
  });

  it('본문은 JSON 으로 보내고, FormData 면 Content-Type 을 브라우저에 맡긴다', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, {}));
    await api.post('/api/auth/login', { login_id: 'a@b.c' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ body: '{"login_id":"a@b.c"}', headers: { 'Content-Type': 'application/json' } });

    const fd = new FormData();
    await api.post('/api/requests', fd);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(fd);
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({});
  });
});

describe('오류 응답 → GateError', () => {
  it('ErrorResponse 의 code · gate · retry_after 를 그대로 싣는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, {
      error: { code: 'RATE_LIMITED', message: '잠시 뒤', fix: '기다리기', gate: 'G12', retry_after: '2026-10-30T10:00:00Z' },
      api_version: 'v1',
    }));
    const err = await request('POST', '/api/requests').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GateError);
    const g = err as GateError;
    expect([g.status, g.code, g.gate, g.message]).toEqual([429, 'RATE_LIMITED', 'G12', '잠시 뒤']);
    expect(g.retryAt?.toISOString()).toBe('2026-10-30T10:00:00.000Z');
  });

  it('오류 본문이 없으면 INTERNAL_ERROR', async () => {
    fetchMock.mockResolvedValue(new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/html' } }));
    const err = (await api.get('/api/me').catch((e: unknown) => e)) as GateError;
    expect([err.status, err.code]).toEqual([502, 'INTERNAL_ERROR']);
  });

  it('연결 실패는 status 0 · NETWORK', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await api.get('/api/me').catch((e: unknown) => e)) as GateError;
    expect([err.status, err.code]).toEqual([0, 'NETWORK']);
  });
});

describe('401 AUTH_LOGIN_REQUIRED → /login?next=', () => {
  const loginRequired = () => jsonResponse(401, {
    error: { code: 'AUTH_LOGIN_REQUIRED', message: '로그인이 필요합니다.', gate: 'G13', retry_after: null },
    api_version: 'v1',
  });

  it('지금 주소를 next 로 실어 로그인 화면으로 보낸다', async () => {
    fetchMock.mockResolvedValue(loginRequired());
    await expect(api.get('/api/requests/12')).rejects.toBeInstanceOf(GateError);
    expect(assignMock).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/r/12/listen?x=1')}`);
  });

  it('로그인 화면에서는 다시 보내지 않는다', async () => {
    vi.stubGlobal('location', { ...window.location, pathname: '/login', search: '', assign: assignMock });
    fetchMock.mockResolvedValue(loginRequired());
    await expect(api.post('/api/auth/login', {})).rejects.toBeInstanceOf(GateError);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('다른 401 코드(예: 관리자 로그인)는 보내지 않는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: 'ADMIN_LOGIN_REQUIRED', message: '', gate: null, retry_after: null }, api_version: 'v1' }));
    await expect(api.get('/admin/me')).rejects.toBeInstanceOf(GateError);
    expect(assignMock).not.toHaveBeenCalled();
  });
});
