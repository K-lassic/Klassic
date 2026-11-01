import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mapProcessingSteps, statusSentence, useRequestStore, isTerminal } from '@/stores/request';
import type { RequestStatus } from '@/types/api';

function status(p: Partial<RequestStatus> = {}): RequestStatus {
  return {
    id: 'R-0928-7KQ4M2XZ', file_kind: 'image', score_type: 'staff', status: 'received', status_label: '접수',
    queue_position: null, route: 'recognize', result_band: null, fallback: false, fallback_reason: null,
    fallback_message: null, retry_hint: null, type_mismatch: false, detected_type: null, validity_grade: null,
    engine: null, received_at: '2026-09-28T00:00:00Z', expires_at: '2026-09-29T00:00:00Z', remaining_seconds: 86400,
    deadline_at: '2026-09-28T00:01:00Z', model_wait: null, has_original_instruments: false, ...p,
  };
}
const states = (s: RequestStatus) => mapProcessingSteps(s).map((x) => x.state);

describe('mapProcessingSteps — 처리 단계(접수 > 대기 > 변환 중 > 완료/대체)', () => {
  it('접수', () => expect(states(status({ status: 'received' }))).toEqual(['current', 'todo', 'todo', 'todo']));
  it('대기 — 앞 건수 표시', () => {
    const st = mapProcessingSteps(status({ status: 'queued', queue_position: 2 }));
    expect(st.map((x) => x.state)).toEqual(['done', 'current', 'todo', 'todo']);
    expect(st[1].note).toBe('앞에 2건');
  });
  it('변환 중', () => expect(states(status({ status: 'converting' }))).toEqual(['done', 'done', 'current', 'todo']));
  it('종류 확인은 변환 단계에 머문다', () => {
    const st = mapProcessingSteps(status({ status: 'awaiting_type_answer' }));
    expect(st[2].state).toBe('current');
    expect(st[2].note).toContain('종류 확인');
  });
  it('완료', () => {
    const st = mapProcessingSteps(status({ status: 'completed', result_band: 'trust' }));
    expect(st.map((x) => x.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(st[3].name).toBe('완료');
  });
  it('대체 — 마지막 단계는 대체 표시(파란 ↺, 반려 아님)', () => {
    const st = mapProcessingSteps(status({ status: 'completed', fallback: true, route: 'fallback' }));
    expect(st[3]).toMatchObject({ name: '대체', state: 'fallback', note: '대체 결과' });
  });
  it('서비스 중단은 막힘', () => {
    const st = mapProcessingSteps(status({ status: 'service_down' }));
    expect(st[3]).toMatchObject({ name: '서비스 중단', state: 'blocked' });
  });
  it('만료는 모두 지난 단계', () => expect(states(status({ status: 'expired' }))).toEqual(['done', 'done', 'done', 'done']));
  it('문장 · 끝 상태', () => {
    expect(statusSentence(status({ status: 'queued', queue_position: 3 }))).toContain('앞에 3건');
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('converting')).toBe(false);
  });
});

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

describe('useRequestStore', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('올리기 성공 → 상태를 받고 1초 폴링, 완료되면 악보를 받고 멈춘다', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/requests' && init?.method === 'POST') return jsonResponse(status({ status: 'received' }), { status: 202 });
      if (url.endsWith('/score')) return jsonResponse({ scoredoc: { version: 1, ppq: 480, tempoBpm: 90, timeSignature: { beats: 4, beatType: 4 }, keyFifths: 0, parts: [] }, musicxml: '<score-partwise/>', has_original_instruments: false, fallback: false, fallback_reason: null, fallback_message: null, retry_hint: null });
      return jsonResponse(status({ status: 'completed', result_band: 'trust' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const store = useRequestStore();
    const ok = await store.upload(new File(['x'], 'a.png', { type: 'image/png' }), 'staff');
    expect(ok).toBe(true);
    expect(store.status?.status).toBe('received');
    expect(store.isProcessing).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.status?.status).toBe('completed');
    expect(store.score?.musicxml).toBe('<score-partwise/>');
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls.length).toBe(before); // 끝나면 폴링하지 않음
  });

  it('G1 반려 → 요청을 만들지 않고 gate 에 사유·고치는 방법', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UPLOAD_RESOLUTION_TOO_LOW', message: '더 선명한 사진이 필요합니다.', fix: '사진 크기가 650픽셀보다 작습니다. 가로·세로 모두 650픽셀 이상인 사진으로 다시 찍어 올려 주십시오.', gate: 'G1', retry_after: null } }, { status: 422 })));
    const store = useRequestStore();
    const ok = await store.upload(new File(['x'], 'a.png'), 'staff');
    expect(ok).toBe(false);
    expect(store.status).toBeNull();
    expect(store.gate).toMatchObject({ code: 'UPLOAD_RESOLUTION_TOO_LOW', gate: 'G1', railLabel: 'G1 반려', actionLabel: '더 선명한 사진으로 다시 올리기' });
  });

  it('G12 한도 → 다시 올릴 수 있는 시각', async () => {
    vi.setSystemTime(new Date('2026-09-28T10:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'WEB_HOURLY_LIMIT', message: '한 시간에 올릴 수 있는 횟수를 넘었습니다.', fix: '안내된 시각 뒤에 다시 올려 주십시오.', gate: 'G12', retry_after: '2026-09-28T10:30:00Z' } }, { status: 429, headers: { 'Retry-After': '1800' } })));
    const store = useRequestStore();
    await store.upload(new File(['x'], 'a.png'), 'staff');
    expect(store.gate?.gate).toBe('G12');
    expect(store.gate?.retryAt?.toISOString()).toBe('2026-09-28T10:30:00.000Z');
    expect(store.gate?.actionLabel).toBeNull();
  });

  it('만료 응답이면 G4 블록', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status({ status: 'expired', remaining_seconds: 0 }))));
    const store = useRequestStore();
    await store.load('R-0928-7KQ4M2XZ');
    expect(store.isExpired).toBe(true);
    expect(store.gate).toMatchObject({ gate: 'G4', chipKind: 's-expired', actionLabel: '악보 다시 올리기' });
  });

  it('이벤트는 요청마다 한 번만 보낸다', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = useRequestStore();
    store.status = status({ status: 'completed' });
    await store.sendEvent('first_played');
    await store.sendEvent('first_played');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
