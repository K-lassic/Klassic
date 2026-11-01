// (2026-10-01 황송해 206번) [작업 저장하기] 뒤 더 고친 것이 없으면 2 · 3 · 4단계 나가기 경고 없음, 저장 안 했거나 더 고쳤으면 그대로
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearWorkSaved, isWorkSaved, markWorkSaved } from '@/lib/workSaved';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('206 저장한 작업은 나가기 경고 없음', () => {
  beforeEach(() => { clearWorkSaved(); sessionStorage.clear(); });

  it('저장하지 않았으면 경고(저장 표시 없음)', () => {
    expect(isWorkSaved('R-1', [])).toBe(false);
    expect(isWorkSaved(null, [])).toBe(false);
  });
  it('저장한 뒤 그대로면 경고 없음 · 더 고치면 다시 경고', () => {
    const ops = [{ op: 'transpose', semitones: 1 }];
    markWorkSaved('R-1', ops);
    expect(isWorkSaved('R-1', [{ op: 'transpose', semitones: 1 }])).toBe(true);
    expect(isWorkSaved('R-1', [...ops, { op: 'transpose', semitones: 1 }])).toBe(false);
    expect(isWorkSaved('R-2', ops)).toBe(false);   // 다른 악보는 따로
  });
  it('편집 기록을 아직 열지 않은 4단계(null)는 저장한 적만 본다 · 새로 고쳐도(sessionStorage) 남는다', () => {
    markWorkSaved('R-3', []);
    clearWorkSaved();   // 메모리를 비워도 탭 저장소에 남음
    expect(isWorkSaved('R-3', null)).toBe(true);
    expect(isWorkSaved('R-3', [])).toBe(true);
  });
  it('나가기 경고(화면 이동 · 브라우저 경고)와 [작업 저장하기]에 연결', () => {
    const g = read('src/composables/useLeaveGuard.ts');
    expect(g).toContain('isSameFlow(to, requestNo.value) || saved()');
    expect(g).toContain('sessionExpiredLeave || saved()) return;');
    expect(read('src/components/SaveWorkButton.vue')).toContain('markWorkSaved(props.requestNo, ops)');
  });
});
