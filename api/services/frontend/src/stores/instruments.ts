// 악기 목록(GET /api/instruments) — 국악기 · 다른 악기 (사용자 음원 .sf2 는 2026-09-29 US8 삭제)
import { defineStore } from 'pinia';
import { api } from '@/api/client';
import type { InstrumentCatalog } from '@/types/api';
import { sharedCatalog } from '@/lib/instruments';

export const useInstrumentStore = defineStore('instruments', {
  state: () => ({ catalog: sharedCatalog() as InstrumentCatalog, loaded: false }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return;
      try {
        const c = await api.get<InstrumentCatalog>('/api/instruments');
        this.catalog = { ...sharedCatalog(), ...c };
        this.loaded = true;
      } catch { /* 공유 파일 목록으로 계속 — 연주는 막지 않는다(U2) */ }
    },
  },
});
