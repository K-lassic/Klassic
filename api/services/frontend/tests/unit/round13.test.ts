// 화면 다듬기 13차 (2026-09-30 황송해 결정 129 · 130, SD_02 머리말 · SD_01 1.13a · UC_01 · UC_02)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { judgmentReasons, measureCount, needsJudgment } from '@/lib/judgment';
import type { RequestStatus } from '@/types/api';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const st = (x: Partial<RequestStatus>) => ({ status: 'completed', route: 'recognize', fallback: false, result_band: 'trust', pages: [], ...x }) as unknown as RequestStatus;

describe('130 결과 판별(1단계)', () => {
  it('신뢰 · 직행은 바로 2단계, 주의 · 대체는 판별', () => {
    expect(needsJudgment(st({}))).toBe(false);
    expect(needsJudgment(st({ route: 'direct', result_band: 'direct' as never }))).toBe(false);
    expect(needsJudgment(st({ result_band: 'caution' as never }))).toBe(true);
    expect(needsJudgment(st({ route: 'fallback', fallback: true, result_band: 'fallback' as never }))).toBe(true);
    expect(needsJudgment(st({ status: 'converting' as never, result_band: null as never }))).toBe(false);
  });
  it('타당성 점검 항목 값에서 합쇼체 사유 문장', () => {
    const r = judgmentReasons(st({ result_band: 'caution' as never, validity_items: { note_count: 12, beat_sum: 0.69, range_leap: 0.5, engine_confidence: 0.4 } }), 16);
    expect(r).toEqual([
      '음표가 12개뿐이라 악보를 제대로 읽었는지 믿기 어렵습니다.',
      '박자표와 길이가 맞지 않는 마디가 약 5개(31%) 있습니다.',
      '음역이 지나치게 넓거나 한 옥타브보다 큰 도약이 많습니다(음역 · 도약 점수 50%).',
      '인식 엔진의 확신도가 40%로 낮습니다.',
    ]);
  });
  it('대체 사유 · 쪽별 실패 · 사유 없음', () => {
    const r = judgmentReasons(st({ route: 'fallback', fallback: true, fallback_message: '인식 엔진이 멈췄습니다.',
      pages: [{ page_no: 1, outcome: 'converted' }, { page_no: 2, outcome: 'failed', fallback_message: '악보 구조를 찾지 못했습니다.' }] as never }));
    expect(r[0]).toBe('인식 엔진이 멈췄습니다. 그래서 인식 결과 대신 서비스가 준비한 대체 악보를 드렸습니다.');
    expect(r[1]).toBe('2쪽: 악보 구조를 찾지 못했습니다.');
    expect(judgmentReasons(st({ result_band: 'caution' as never }))).toEqual(['타당성 점검 점수가 기준보다 낮아 틀린 음이 있을 수 있습니다.']);
  });
  it('마디 수(첫 성부)', () => {
    expect(measureCount('<part id="P1"><measure number="1"></measure><measure number="2"></measure></part><part id="P2"><measure number="1"></measure><measure number="2"></measure></part>')).toBe(2);
    expect(measureCount(null)).toBeNull();
  });
  it('S1 결과: 판별 중 · 처리 중은 단계 1, 버튼 셋, [그래도 계속]은 브라우저에 기억, 2단계 띠는 짧게', () => {
    const src = read('src/pages/S1Result.vue');
    expect(src).toContain(':current="stepNow"');
    expect(src).toContain("req.isProcessing || judging.value");
    for (const t of ['judge-other', 'judge-continue', 'judge-fallback']) expect(src).toContain(`data-test="${t}"`);
    expect(src).toContain("band === 'caution' || band === 'fallback' ? 'short' : undefined");
    expect(read('src/lib/judgment.ts')).toMatch(/try \{ window\.localStorage\.setItem\(KEY\(no\), '1'\)/);
  });
});

describe('129 악보 크기', () => {
  it('[−] 배율 [+] · 50~200% · 10% 단계 · 다시 그린 뒤 음표 연결 · 브라우저 기억 · 2 · 3단계', () => {
    const src = read('src/components/ScoreView.vue');
    expect(src).toContain('aria-label="악보 작게"');
    expect(src).toContain('aria-label="악보 크게"');
    expect(src).toContain('const ZOOM_MIN = 0.5;');
    expect(src).toContain('const ZOOM_MAX = 2;');
    expect(src).toContain('const ZOOM_STEP = 0.1;');
    expect(src).toContain('osmd.Zoom = next; osmd.render(); buildNoteMap();');
    expect(src).toMatch(/try \{ window\.localStorage\.setItem\(ZOOM_KEY/);
    expect(read('src/pages/S1Result.vue')).toMatch(/<ScoreView[^>]*zoomable/);
    expect(read('src/pages/S2Edit.vue')).toMatch(/<ScoreView[\s\S]*?zoomable/);
  });
});
