// 편집 자동 저장 보관소 — 기본은 브라우저 IndexedDB(idb). 시험에서는 메모리 보관소로 바꾼다.
import { openDB, type IDBPDatabase } from 'idb';
import type { EditOp } from '@/types/score';

export interface AutosaveRecord {
  request_no: string;
  ops: EditOp[];
  /** 원래 악기로 듣기처럼 편집 연산이 아닌 연주 선택 */
  listen_mode: 'edit' | 'original';
  saved_at: string;
}

export interface AutosaveBackend {
  get(requestNo: string): Promise<AutosaveRecord | undefined>;
  put(rec: AutosaveRecord): Promise<void>;
  delete(requestNo: string): Promise<void>;
}

const DB_NAME = 'gugak-editor';
const STORE = 'autosave';

export function idbBackend(): AutosaveBackend {
  let dbp: Promise<IDBPDatabase> | null = null;
  const db = () => {
    dbp ??= openDB(DB_NAME, 1, {
      upgrade(d) { if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'request_no' }); },
    });
    return dbp;
  };
  return {
    async get(no) { return (await db()).get(STORE, no) as Promise<AutosaveRecord | undefined>; },
    async put(rec) { await (await db()).put(STORE, rec); },
    async delete(no) { await (await db()).delete(STORE, no); },
  };
}

export function memoryBackend(): AutosaveBackend & { data: Map<string, AutosaveRecord> } {
  const data = new Map<string, AutosaveRecord>();
  return {
    data,
    async get(no) { const r = data.get(no); return r ? structuredClone(r) : undefined; },
    async put(rec) { data.set(rec.request_no, structuredClone(rec)); },
    async delete(no) { data.delete(no); },
  };
}
