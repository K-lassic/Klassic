// #44 계약 ↔ 권한표 — DB 없이 돈다. 계약의 P1 경로가 대응표(permissions.ts)에 같은 UC 로 있어야 열린다. 표에서 빠지면 만든 경로도 404 다.
import '../helpers/env.js';
import { describe, expect, it } from 'vitest';
import { ucOf } from '../../src/auth/permissions.js';
import { checkResponse, contract } from '../helpers/contract.js';

const SAMPLE = { '{no}': 'R-1101-ABCDEFGH', '{id}': 'minuet-staff', '{fileId}': '1', '{format}': 'midi' };
const concrete = (template: string) => Object.entries(SAMPLE).reduce((p, [k, v]) => p.replace(k, v), template);
const session = new Set(['/api/health']); // 세션 · 권한 앞에서 답하는 경로

const p1 = Object.entries(contract.paths)
  .filter(([path]) => path.startsWith('/api/') && !session.has(path))
  .flatMap(([path, ops]) => Object.entries(ops)
    .filter(([, op]) => op['x-priority'] === 'P1')
    .map(([method, op]) => ({ path, method: method.toUpperCase(), uc: op['x-uc'] })));

describe('계약의 P1 경로', () => {
  it('시험할 경로가 있다', () => { expect(p1.length).toBeGreaterThanOrEqual(18); });

  it.each(p1)('$method $path → $uc', ({ path, method, uc }) => {
    expect(ucOf(method, concrete(path))).toBe(uc);
  });
});

describe('계약 대조 도우미', () => {
  it('맞는 응답은 통과, 틀린 응답 · 없는 상태는 잡는다 — 도우미가 조용히 통과시키지 않는지 확인', () => {
    const ok = { error: { code: 'REQUEST_NOT_FOUND', message: 'x', fix: 'y', gate: null, retry_after: null, details: {} }, api_version: 'v1' };
    expect(checkResponse('GET', '/api/requests/{no}', 404, ok)).toBeNull();
    expect(checkResponse('GET', '/api/requests/{no}', 404, { nope: true })).toContain('required');
    expect(checkResponse('GET', '/api/requests/{no}', 418, ok)).toContain('계약에 없는 상태');
    expect(checkResponse('GET', '/api/requests/{no}', 200, { id: 'R' })).toContain('required');
  });
});
