// (2026-10-01 황송해 209번, UC16 A5 · E7) 로그인한 브라우저는 로그인 · 가입 화면에 못 들어감 + 알림, 새 오류 문구
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { gateMessage } from '@/i18n/gateMessages';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('209 한 계정 한 곳 로그인', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('로그인 화면 이동 전에 로그인 상태를 보고, 로그인했으면 1단계로 + 알림', () => {
    const r = read('src/router.ts');
    expect(r).toMatch(/if \(to\.name === 'login'\) \{[\s\S]*await auth\.fetchMe\(\);[\s\S]*if \(auth\.loggedIn\) \{ auth\.notice = '이미 로그인되어 있습니다\.'; return \{ name: 'home' \}; \}/);
    // /signup 은 login 으로 넘어가므로 같은 검사를 받는다
    expect(r).toContain("{ path: '/signup', redirect: (to) => ({ name: 'login'");
  });
  it('알림은 머리 아래 role=status 로 보이고 [닫기] · 6초 뒤 사라짐', () => {
    const a = read('src/App.vue');
    expect(a).toContain('role="status" data-test="site-notice"');
    expect(a).toContain('setTimeout(() => { auth.notice = null; }, 6000)');
    const auth = useAuthStore();
    expect(auth.notice).toBeNull();
  });
  it('서버 거절 문구(공용 오류 코드)', () => {
    expect(gateMessage('LOGIN_ALREADY_ACTIVE').reason).toBe('이미 다른 곳에서 로그인된 상태입니다.');
    expect(gateMessage('ALREADY_LOGGED_IN').reason).toBe('이미 로그인되어 있습니다.');
    // (212번) 잠금이 아니므로 G15 틀의 "잠금이 풀린 뒤(10분)" 대신
    expect(gateMessage('LOGIN_ALREADY_ACTIVE').releaser).toBe('다른 곳에서 로그아웃하거나 10분 뒤 다시 로그인합니다');
    expect(gateMessage('LOGIN_ALREADY_ACTIVE').fix).toContain('10분 뒤');
    expect(gateMessage('LOGIN_ALREADY_ACTIVE').fix).not.toContain('2시간');
    expect(gateMessage('LOGIN_LOCKED').releaser).toContain('잠금이 풀린 뒤');
    const codes = JSON.parse(read('../shared/error-codes.json'));
    const all = JSON.stringify(codes);
    expect(all).toContain('"LOGIN_ALREADY_ACTIVE"');
    expect(all).toContain('이미 다른 곳에서 로그인된 상태입니다.');
    expect(all).toContain('"ALREADY_LOGGED_IN"');
    expect(all).toContain('이미 로그인되어 있습니다.');
  });
});
