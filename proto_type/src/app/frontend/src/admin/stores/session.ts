// 운영자 세션 (G5). 상태: unknown → blocked(내부망 밖) | anonymous | authed
import { defineStore } from 'pinia';
import { GateError } from '@/api/client';
import { adminApi } from '../api';
import type { AdminMe } from '../types';

export type SessionState = 'unknown' | 'blocked' | 'anonymous' | 'authed' | 'offline';

export const useSessionStore = defineStore('admin-session', {
  state: () => ({
    state: 'unknown' as SessionState,
    me: null as AdminMe | null,
    /** 로그인 풀림 안내(다시 로그인해 주세요) */
    expired: false,
    /** 설정 탭에 G6 값 오류가 있으면 C7 탭에 "G6 값 확인"을 붙인다 */
    settingsBlocked: false,
  }),
  actions: {
    async check(): Promise<SessionState> {
      try {
        this.me = await adminApi.me();
        this.state = 'authed';
      } catch (e) {
        this.me = null;
        if (e instanceof GateError && e.status === 403) this.state = 'blocked';
        else if (e instanceof GateError && e.status === 0) this.state = 'offline';
        else this.state = 'anonymous';
      }
      return this.state;
    },
    async ensure(): Promise<SessionState> {
      if (this.state === 'unknown' || this.state === 'offline') return this.check();
      return this.state;
    },
    /** POST /admin/login 뒤 /admin/me 로 가린 이름을 받는다. 실패는 GateError 로 던진다 */
    async login(loginId: string, password: string) {
      const res = await adminApi.login(loginId, password);
      this.expired = false;
      try {
        this.me = await adminApi.me();
      } catch {
        this.me = res && typeof res === 'object' ? res : { login_id: loginId };
      }
      this.state = 'authed';
    },
    async logout() {
      try { await adminApi.logout(); } catch { /* 이미 풀린 세션이어도 화면은 로그인으로 */ }
      this.me = null;
      this.state = 'anonymous';
    },
    markExpired() {
      this.me = null;
      this.state = 'anonymous';
      this.expired = true;
    },
  },
});
