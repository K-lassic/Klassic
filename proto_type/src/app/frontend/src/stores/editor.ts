// 편집 연산 목록 + 기기 자동 저장(FR-028, UC6 A2) — 요청 번호마다 IndexedDB 한 줄 (T119)
// 원본(ScoreDoc)은 서버 것을 그대로 두고, 화면은 applyOps(원본, ops) 로 편집본을 만든다(U6).
import { defineStore } from 'pinia';
import type { EditOp } from '@/types/score';
import { idbBackend, type AutosaveBackend, type AutosaveRecord } from './autosaveBackend';

let backend: AutosaveBackend | null = null;
export function setAutosaveBackend(b: AutosaveBackend | null) { backend = b; }
function store(): AutosaveBackend { backend ??= idbBackend(); return backend; }

type SaveState = 'idle' | 'saved' | 'failed';

interface State {
  requestNo: string | null;
  ops: EditOp[];
  listenMode: 'edit' | 'original';
  /** 열 때 찾은 이전 자동 저장본 — 복원 질문에 쓴다 */
  pendingRestore: AutosaveRecord | null;
  saveState: SaveState;
  savedAt: Date | null;
}

export const useEditorStore = defineStore('editor', {
  state: (): State => ({ requestNo: null, ops: [], listenMode: 'edit', pendingRestore: null, saveState: 'idle', savedAt: null }),
  getters: {
    isEdited: (s) => s.ops.length > 0,
    transposeTotal: (s) => s.ops.reduce((a, o) => (o.op === 'transpose' ? a + o.semitones : a), 0),
    /** 곡 전체 빠르기 연산의 BPM(없으면 null = 1.0배 · 100 BPM) — 2026-09-30 황송해 161번 */
    tempoBpm: (s): number | null => { const t = [...s.ops].reverse().find((o) => o.op === 'set_tempo'); return t && t.op === 'set_tempo' ? t.bpm : null; },
  },
  actions: {
    /** 편집 화면 열기 — 이전 자동 저장본이 있으면 복원을 묻도록 남겨 둔다(한 번만) */
    async open(requestNo: string): Promise<AutosaveRecord | null> {
      if (this.requestNo === requestNo && (this.ops.length || this.pendingRestore)) return this.pendingRestore;
      this.requestNo = requestNo; this.ops = []; this.listenMode = 'edit'; this.saveState = 'idle'; this.savedAt = null;
      this.pendingRestore = null;
      try {
        const rec = await store().get(requestNo);
        if (rec && (rec.ops.length > 0 || rec.listen_mode === 'original')) this.pendingRestore = rec;
      } catch { this.saveState = 'failed'; }
      return this.pendingRestore;
    },
    /**
     * "내가 만든 악보" [편집하기](2026-09-30 황송해 177번 — UC6 A8): 이어 편집하려고 누른 것이라 복원 질문 없이 연다.
     * 이 기기 자동 저장본이 있으면 그것(더 최근), 없으면 서버 편집 기록(ops_json)으로 시작해 기기에도 남긴다.
     * 다음에 편집 화면이 open() 을 불러도 같은 요청이면 그대로 둔다.
     */
    async resume(requestNo: string, serverOps: EditOp[] | null) {
      let rec: AutosaveRecord | undefined;
      try { rec = await store().get(requestNo); } catch { rec = undefined; }
      this.requestNo = requestNo; this.pendingRestore = null; this.saveState = 'idle'; this.savedAt = null;
      if (rec && rec.ops.length) {
        this.ops = rec.ops; this.listenMode = rec.listen_mode ?? 'edit';
        this.savedAt = new Date(rec.saved_at); this.saveState = 'saved';
        return;
      }
      this.ops = serverOps ? JSON.parse(JSON.stringify(serverOps)) : []; this.listenMode = 'edit';
      if (this.ops.length) await this.save();
    },
    /** 지운 악보의 기기 자동 저장본도 지운다(2026-09-30 황송해 176번) */
    async forget(requestNo: string) {
      if (this.requestNo === requestNo) { this.requestNo = null; this.ops = []; this.pendingRestore = null; }
      try { await store().delete(requestNo); } catch { /* 무시 */ }
    },
    /** 다른 화면(S3)에서 편집본을 조용히 읽기 — 묻지 않는다 */
    async peek(requestNo: string): Promise<EditOp[]> {
      if (this.requestNo === requestNo && !this.pendingRestore) return this.ops;
      try { return (await store().get(requestNo))?.ops ?? []; } catch { return []; }
    },
    /** [이어서] */
    restore() {
      if (!this.pendingRestore) return;
      this.ops = this.pendingRestore.ops;
      this.listenMode = this.pendingRestore.listen_mode ?? 'edit';
      this.savedAt = new Date(this.pendingRestore.saved_at);
      this.saveState = 'saved';
      this.pendingRestore = null;
    },
    /** [처음부터] — 저장본을 지우고 원본에서 시작 */
    async discard() {
      this.pendingRestore = null;
      this.ops = []; this.listenMode = 'edit';
      if (this.requestNo) { try { await store().delete(this.requestNo); } catch { /* 무시 */ } }
    },
    async push(op: EditOp) {
      this.ops = [...this.ops, op];
      await this.save();
    },
    async pushMany(ops: EditOp[]) {
      if (!ops.length) return;
      this.ops = [...this.ops, ...ops];
      await this.save();
    },
    /** 재생 빠르기 → 곡 전체 빠르기 연산(161번). 하나만 두고 바꾼다. null(1.0배)이면 연산을 뺀다 */
    async setTempo(bpm: number | null) {
      const rest = this.ops.filter((o) => o.op !== 'set_tempo');
      const next = bpm == null ? rest : [...rest, { op: 'set_tempo' as const, bpm }];
      if (JSON.stringify(next) === JSON.stringify(this.ops)) return;
      this.ops = next;
      await this.save();
    },
    async setListenMode(mode: 'edit' | 'original') {
      this.listenMode = mode;
      await this.save();
    },
    /** [원본으로 되돌리기] (FR-029) */
    async revertAll() {
      this.ops = []; this.listenMode = 'edit';
      if (!this.requestNo) return;
      try { await store().delete(this.requestNo); this.saveState = 'idle'; this.savedAt = null; }
      catch { this.saveState = 'failed'; }
    },
    async save() {
      if (!this.requestNo) return;
      const rec: AutosaveRecord = {
        request_no: this.requestNo, ops: JSON.parse(JSON.stringify(this.ops)), listen_mode: this.listenMode,
        saved_at: new Date().toISOString(),
      };
      try {
        await store().put(rec);
        this.saveState = 'saved'; this.savedAt = new Date(rec.saved_at);
      } catch {
        this.saveState = 'failed';
      }
    },
  },
});
