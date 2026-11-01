// 현재 요청 상태 — 올리기, 1초 폴링(research R7), 처리 단계 매핑(C1), 결과 악보 (T069)
import { defineStore } from 'pinia';
import { api } from '@/api/client';
import type { RequestStatus, ScoreResponse, ScoreType, RequestState } from '@/types/api';
import { gateFromError, gateMessage, type GateView } from '@/i18n/gateMessages';

export type StepState = 'done' | 'current' | 'todo' | 'fallback' | 'blocked';
export interface RailStep { key: string; name: string; state: StepState; note: string }

const TERMINAL: RequestState[] = ['completed', 'service_down', 'expired'];
export const isTerminal = (s: RequestState | undefined | null): boolean => !!s && TERMINAL.includes(s);

/**
 * 처리 단계(C1 아랫줄): 접수 > 대기 > 변환 중 > 완료/대체 (FR-016, SD_02 §2-3)
 * 상태 이름은 INTERFACES §4 RequestStatus.status.
 */
export function mapProcessingSteps(s: Pick<RequestStatus, 'status' | 'queue_position' | 'fallback' | 'route'>): RailStep[] {
  const idx: Record<RequestState, number> = {
    received: 0, queued: 1, converting: 2, awaiting_type_answer: 2, completed: 3, service_down: 3, expired: 3,
  };
  const at = idx[s.status];
  const last = s.status === 'service_down' ? '서비스 중단' : s.fallback || s.route === 'fallback' ? '대체' : '완료';
  const names = ['접수', '대기', '변환 중', s.status === 'completed' || s.status === 'service_down' ? last : '완료 / 대체'];
  return names.map((name, i) => {
    let state: StepState = i < at ? 'done' : i === at ? 'current' : 'todo';
    let note = state === 'done' ? '끝남' : state === 'current' ? '진행 중' : '아직';
    if (i === 1 && s.status === 'received') note = '아직';
    if (i === 1 && s.status === 'queued') note = s.queue_position ? `앞에 ${s.queue_position}건` : '차례를 기다립니다';
    if (i === 1 && at > 1 && s.queue_position == null) note = '끝남';
    if (i === 2 && s.status === 'awaiting_type_answer') note = '종류 확인을 기다립니다';
    if (i === 3 && s.status === 'completed') { state = s.fallback || s.route === 'fallback' ? 'fallback' : 'done'; note = state === 'fallback' ? '대체 결과' : '끝남'; }
    if (i === 3 && s.status === 'service_down') { state = 'blocked'; note = '결과를 드리지 못했습니다'; }
    if (s.status === 'expired') { state = 'done'; note = '끝남'; }
    return { key: `p${i}`, name, state, note };
  });
}

/** 스크린 리더용 한 줄 요약 — aria-live 로 알린다 */
export function statusSentence(s: Pick<RequestStatus, 'status' | 'queue_position' | 'fallback' | 'route'>): string {
  switch (s.status) {
    case 'received': return '접수했습니다.';
    case 'queued': return s.queue_position ? `대기 중입니다. 앞에 ${s.queue_position}건이 있습니다.` : '대기 중입니다.';
    case 'converting': return '변환 중입니다.';
    case 'awaiting_type_answer': return '악보 종류를 확인해 주십시오.';
    case 'completed': return s.fallback || s.route === 'fallback' ? '대체 결과가 나왔습니다.' : '결과가 나왔습니다.';
    case 'service_down': return '지금은 결과를 드릴 수 없습니다.';
    case 'expired': return '보관 기간이 지났습니다.';
  }
}

export type JourneyStep = 1 | 2 | 3 | 4;

interface State {
  status: RequestStatus | null;
  score: ScoreResponse | null;
  uploading: boolean;
  gate: GateView | null;          // 올리기 반려(G1·G12) 또는 G4
  loadError: GateView | null;     // 요청을 못 찾음 등
  pollMs: number;
  lastEventSent: Record<string, boolean>;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useRequestStore = defineStore('request', {
  state: (): State => ({ status: null, score: null, uploading: false, gate: null, loadError: null, pollMs: 1000, lastEventSent: {} }),
  getters: {
    requestNo: (s) => s.status?.id ?? null,
    processingSteps: (s): RailStep[] => (s.status ? mapProcessingSteps(s.status) : []),
    isProcessing: (s) => !!s.status && !isTerminal(s.status.status),
    isExpired: (s) => s.status?.status === 'expired',
    isDone: (s) => s.status?.status === 'completed',
    isFallback: (s) => !!s.status && (s.status.fallback || s.status.route === 'fallback'),
  },
  actions: {
    reset() {
      this.stopPolling();
      this.status = null; this.score = null; this.gate = null; this.loadError = null; this.lastEventSent = {};
    },
    /** 올리기 — 파일 한 개(사진·PDF) 또는 사진 여러 장(올린 순서대로 'file' 을 여러 번, 2026-09-30 T188 여러 쪽) */
    async upload(file: File | File[], scoreType: ScoreType | null): Promise<boolean> {
      this.stopPolling();
      this.gate = null; this.score = null; this.status = null; this.lastEventSent = {};
      this.uploading = true;
      const files = Array.isArray(file) ? file : [file];
      try {
        const fd = new FormData();
        for (const f of files) fd.append('file', f);
        if (scoreType) fd.append('score_type', scoreType);
        this.status = await api.post<RequestStatus>('/api/requests', fd);
        this.startPolling();
        return true;
      } catch (e) {
        this.gate = gateFromError(e, files.length > 1 ? files.map((f) => f.name) : []);
        return false;
      } finally {
        this.uploading = false;
      }
    },
    /** 예시 악보로 올리기(2026-09-30 황송해 72번) — 예시 id 만 보내고 서버가 서버 전용 폴더의 파일로 접수한다 */
    async uploadExample(exampleId: string, scoreType: ScoreType | null): Promise<boolean> {
      this.stopPolling();
      this.gate = null; this.score = null; this.status = null; this.lastEventSent = {};
      this.uploading = true;
      try {
        this.status = await api.post<RequestStatus>('/api/requests/example', { example_id: exampleId, score_type: scoreType });
        this.startPolling();
        return true;
      } catch (e) {
        this.gate = gateFromError(e);
        return false;
      } finally {
        this.uploading = false;
      }
    },
    /** 이 악보로 작업하기(2026-09-30 황송해 109번, UC18 기본흐름 5) — 공유 복사본으로 내 새 요청(인식 없이 바로 완료) */
    async workOnShared(shareNo: string): Promise<GateView | null> {
      this.stopPolling();
      this.gate = null; this.score = null; this.status = null; this.loadError = null; this.lastEventSent = {};
      try {
        this.status = await api.post<RequestStatus>(`/api/shared-scores/${encodeURIComponent(shareNo)}/use`);
        await this.fetchScore();
        return null;
      } catch (e) {
        return gateFromError(e);
      }
    },
    /** 다른 화면(S2·S3)이나 새로 고침에서 요청 번호로 이어 보기 */
    async load(no: string): Promise<void> {
      if (this.status?.id !== no) { this.reset(); }
      await this.refresh(no);
      if (this.status && !isTerminal(this.status.status)) this.startPolling();
    },
    async refresh(no?: string): Promise<void> {
      const id = no ?? this.status?.id;
      if (!id) return;
      try {
        const next = await api.get<RequestStatus>(`/api/requests/${encodeURIComponent(id)}`);
        const wasDone = this.status?.status === 'completed' && this.status.route === next.route && this.score;
        this.status = next;
        this.loadError = null;
        if (next.status === 'expired') { this.gate = gateMessage('RESULT_EXPIRED'); this.stopPolling(); }
        if (next.status === 'completed' && !wasDone) await this.fetchScore();
        if (isTerminal(next.status)) this.stopPolling();
      } catch (e) {
        const g = gateFromError(e);
        if (g.code === 'RESULT_EXPIRED') { this.gate = g; if (this.status) this.status = { ...this.status, status: 'expired' }; }
        else if (g.code !== 'NETWORK') this.loadError = g;
        if (g.code !== 'NETWORK') this.stopPolling();
      }
    },
    async fetchScore(): Promise<void> {
      if (!this.status) return;
      try {
        this.score = await api.get<ScoreResponse>(`/api/requests/${encodeURIComponent(this.status.id)}/score`);
      } catch (e) {
        const g = gateFromError(e);
        if (g.code === 'RESULT_EXPIRED') this.gate = g; else this.loadError = g;
      }
    },
    startPolling() {
      this.stopPolling();
      const tick = async () => {
        await this.refresh();
        if (this.status && !isTerminal(this.status.status)) timer = setTimeout(tick, this.pollMs);
        else timer = null;
      };
      timer = setTimeout(tick, this.pollMs);
    },
    stopPolling() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    async confirmType(changeTo: ScoreType | null) {
      if (!this.status) return;
      this.status = await api.post<RequestStatus>(`/api/requests/${encodeURIComponent(this.status.id)}/type-confirmation`, { change_to: changeTo });
      this.startPolling();
    },
    /** [대체 템플릿 받기] — 확인 없이 바로(UC2 A1·A7) */
    async requestFallback() {
      if (!this.status) return;
      this.status = await api.post<RequestStatus>(`/api/requests/${encodeURIComponent(this.status.id)}/fallback`);
      this.score = null;
      if (this.status.status === 'completed') await this.fetchScore();
      else this.startPolling();
    },
    /** result_shown / first_played — 요청마다 한 번 */
    async sendEvent(event: 'result_shown' | 'first_played') {
      const id = this.status?.id;
      if (!id) return;
      const key = `${id}:${event}`;
      if (this.lastEventSent[key]) return;
      this.lastEventSent[key] = true;
      try { await api.post(`/api/requests/${encodeURIComponent(id)}/events`, { event }); } catch { /* 기록 실패는 화면을 막지 않는다 */ }
    },
  },
});
