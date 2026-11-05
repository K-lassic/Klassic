// #105 단조 시계 시험 — 벽시계가 튀어도 마감 계산에 쓰는 현재 시각이 그만큼 당겨지지 않는지 확인한다.
// 구조에서의 위치: src/lib/clock.ts 의 monotonicNowMs → requestWorker · modelApiClient 의 마감 비교.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { monotonicNowMs } from '../../src/lib/clock.js';

describe('단조 시계 (#105)', () => {
  it('벽시계와 무관한 값이다 — 프로세스 시작 뒤 흐른 시간', () => {
    expect(monotonicNowMs()).toBeLessThan(Date.now() / 10);
    expect(Number.isInteger(monotonicNowMs())).toBe(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it('벽시계가 12초 앞으로 튀어도 현재 시각은 실제 경과 시간만큼만 흐른다', () => {
    const before = monotonicNowMs();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 12_000);
    const after = monotonicNowMs();
    expect(after - before).toBeLessThan(1_000);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('벽시계가 뒤로 가도 현재 시각은 거꾸로 가지 않는다', () => {
    const before = monotonicNowMs();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 12_000);
    expect(monotonicNowMs()).toBeGreaterThanOrEqual(before);
  });
});
