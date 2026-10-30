// 처리 마감은 처리 시작부터, 대기 상한은 접수부터 (2026-09-30 조성기 B — UC1 A1 · BR-ENG-08 · SD_02 ⑫)
import { describe, expect, it } from 'vitest';
import { DEADLINE_GRACE_MS, requestDeadlineMs } from '../../src/services/requestWorker.js';

const received = new Date('2026-09-30T06:00:00Z');

describe('요청 마감', () => {
  it('대기 중이면 대기 상한 = 접수 + 제한 × 쪽 수', () => {
    expect(requestDeadlineMs(received, null, 180, 2)).toBe(received.getTime() + 360_000);
  });

  it('처리를 시작했으면 시작 시각부터 — 줄에서 기다린 시간은 깎지 않는다', () => {
    const started = new Date(received.getTime() + 300_000); // 5분 기다린 뒤 시작
    expect(requestDeadlineMs(received, started, 180, 1)).toBe(started.getTime() + 180_000 + DEADLINE_GRACE_MS);
    expect(requestDeadlineMs(received, started, 180, 1, false)).toBe(started.getTime() + 180_000);
    // 예전 규칙(접수 + 180초)이었다면 이미 지났을 시각이다
    expect(requestDeadlineMs(received, started, 180, 1)).toBeGreaterThan(received.getTime() + 180_000);
  });

  it('제한이 없으면 180초, 쪽 수는 최소 1', () => {
    expect(requestDeadlineMs(received, null, null, 0)).toBe(received.getTime() + 180_000);
  });
});
