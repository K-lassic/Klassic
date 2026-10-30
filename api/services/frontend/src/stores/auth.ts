// 로그인 상태 (2026-09-29 RBAC, FR-066·067, design/UC_16 · SD_02 §9B) — GET /api/auth/me 로 확인한다.
import { defineStore } from 'pinia';
import { api } from '@/api/client';

export interface Account { account_id: number; login_id: string; display_name: string }
interface Me { account: Account | null; roles: string[] }

export const useAuthStore = defineStore('auth', {
  // notice: 머리 아래 잠깐 보이는 알림(2026-10-01 황송해 209번 — "이미 로그인되어 있습니다.")
  state: () => ({ account: null as Account | null, roles: [] as string[], loaded: false, notice: null as string | null }),
  getters: {
    loggedIn: (s) => s.account !== null,
    isUser: (s) => s.roles.includes('user'),
  },
  actions: {
    set(me: Me) { this.account = me.account; this.roles = me.roles; this.loaded = true; },
    async fetchMe(force = false) {
      if (this.loaded && !force) return;
      try { this.set(await api.get<Me>('/api/auth/me')); } catch { this.set({ account: null, roles: [] }); }
    },
    /** 실패하면 GateError(LOGIN_FAILED·LOGIN_LOCKED)를 그대로 던진다 */
    async login(email: string, password: string) { this.set(await api.post<Me>('/api/auth/login', { email, password })); },
    async signup(email: string, password: string, name: string) { this.set(await api.post<Me>('/api/auth/signup', { email, password, name })); },
    async logout() {
      try { await api.post('/api/auth/logout'); } finally { this.set({ account: null, roles: [] }); }
    },
  },
});
