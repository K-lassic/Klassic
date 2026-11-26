// #210 미리보기 조회 간격 시험 — 처음 30초는 3초마다, 그 뒤에는 10초마다 묻는다.
// 구조에서의 위치: src/lib/previewPoll.ts → services/requestWorker.ts watchPreview() 가 다음 조회까지 기다릴 시간으로 쓴다.
import { describe, expect, it } from 'vitest';
import { PREVIEW_FAST_ASKS, PREVIEW_POLL_MS, PREVIEW_SLOW_POLL_MS, previewPollDelay } from '../../src/lib/previewPoll.js';

describe('미리보기 조회 간격 (#210)', () => {
  it('처음 10번(30초)은 3초 간격', () => {
    for (let asked = 0; asked < PREVIEW_FAST_ASKS; asked += 1) expect(previewPollDelay(asked)).toBe(3000);
    expect(PREVIEW_FAST_ASKS * PREVIEW_POLL_MS).toBe(30_000);
  });

  it('그 뒤에도 미리보기가 없으면 10초 간격으로 늦춘다', () => {
    expect(previewPollDelay(PREVIEW_FAST_ASKS)).toBe(10_000);
    expect(previewPollDelay(500)).toBe(PREVIEW_SLOW_POLL_MS);
  });

  it('5분 동안 미리보기가 없을 때 묻는 횟수가 3초 고정(100번)의 절반 아래다', () => {
    let t = 0;
    let asked = 0;
    while (t + previewPollDelay(asked) <= 300_000) { t += previewPollDelay(asked); asked += 1; }
    expect(asked).toBe(37); // 30초까지 10번 + 남은 270초에 27번
  });
});
