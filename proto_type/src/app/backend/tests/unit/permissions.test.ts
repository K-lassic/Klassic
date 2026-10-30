// 경로 → 유스케이스 대응과 권한 판정(FR-068, design/UC_00 §4-1)
import { describe, expect, it } from 'vitest';
import { ucOf, isAllowed, PUBLIC_UCS } from '../../src/auth/permissions.js';

const table = new Map<string, Set<string>>([
  ['user', new Set(['UC1', 'UC2', 'UC3', 'UC5', 'UC6', 'UC7', 'UC11', 'UC15', 'UC16'])],
  ['operator', new Set(['UC9', 'UC10', 'UC14', 'UC11', 'UC16'])],
]);

describe('경로 → 유스케이스', () => {
  it('웹 경로를 모두 유스케이스로 바꾼다', () => {
    expect(ucOf('POST', '/api/requests')).toBe('UC1');
    expect(ucOf('GET', '/api/requests/R-0929-AAAA1111')).toBe('UC1');
    expect(ucOf('GET', '/api/requests/R-0929-AAAA1111/score')).toBe('UC1');
    expect(ucOf('POST', '/api/requests/R-0929-AAAA1111/type-confirmation')).toBe('UC1');
    expect(ucOf('POST', '/api/requests/R-0929-AAAA1111/events')).toBe('UC1');
    expect(ucOf('GET', '/api/models/status')).toBe('UC1');
    expect(ucOf('POST', '/api/requests/R-0929-AAAA1111/fallback')).toBe('UC2');
    expect(ucOf('GET', '/api/requests/R-0929-AAAA1111/recommendation')).toBe('UC5');
    expect(ucOf('PUT', '/api/requests/R-0929-AAAA1111/instrument-choice')).toBe('UC5');
    expect(ucOf('GET', '/api/instruments')).toBe('UC5');
    expect(ucOf('PUT', '/api/requests/R-0929-AAAA1111/edits')).toBe('UC6');
    expect(ucOf('POST', '/api/requests/R-0929-AAAA1111/exports')).toBe('UC7');
    expect(ucOf('GET', '/api/requests/R-0929-AAAA1111/exports/12')).toBe('UC7');
    expect(ucOf('GET', '/api/requests/R-0929-AAAA1111/exports/12/file')).toBe('UC7');
    expect(ucOf('GET', '/api/requests/R-0929-AAAA1111/original/midi')).toBe('UC7');
    expect(ucOf('GET', '/api/api-docs')).toBe('UC11');
    expect(ucOf('POST', '/api/key-applications')).toBe('UC15');
    expect(ucOf('POST', '/api/auth/login')).toBe('UC16');
    expect(ucOf('POST', '/api/auth/signup')).toBe('UC16');
    expect(ucOf('GET', '/api/auth/me')).toBe('UC16');
    expect(ucOf('POST', '/api/session/end')).toBe('UC16');
  });
  it('모르는 경로·메서드는 null(= 막는다)', () => {
    expect(ucOf('GET', '/api/nope')).toBeNull();
    expect(ucOf('DELETE', '/api/requests')).toBeNull();
  });
});

describe('판정', () => {
  it('UC11·UC16 은 로그인 없이도', () => {
    expect(PUBLIC_UCS.has('UC11')).toBe(true);
    expect(isAllowed([], 'UC16', table)).toBe(true);
    expect(isAllowed([], 'UC11', table)).toBe(true);
  });
  it('역할에 있으면 허용, 없으면 거절', () => {
    expect(isAllowed(['user'], 'UC1', table)).toBe(true);
    expect(isAllowed(['operator'], 'UC1', table)).toBe(false);
    expect(isAllowed(['operator', 'user'], 'UC1', table)).toBe(true);
    expect(isAllowed([], 'UC1', table)).toBe(false);
    expect(isAllowed(['user'], 'UC9', table)).toBe(false);
  });
});
