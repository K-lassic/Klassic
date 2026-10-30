// 모델 상태 캐시 — 모델 API 서버 GET /v1/models 를 몇 초 단위로 읽어 사용자 "모델 준비 중" 안내에 쓴다(INTERFACES §7).
import { modelJson, ModelApiDown } from './modelApiClient.js';

export interface ModelState {
  name: string; display_name: string; kind: 'omr_staff' | 'omr_jeongganbo' | 'recommend';
  provider: 'venv' | 'ollama' | 'builtin'; enabled: boolean; installed: boolean; version: string | null;
  state: 'ready' | 'cold' | 'loading' | 'failed' | 'unavailable'; loaded_at: string | null;
  last_load_ms: number | null; expected_seconds: number | null; error: string | null; provider_ref?: string | null;
}

let cache: { at: number; models: ModelState[] | null } = { at: 0, models: null };
const TTL_MS = 3000;

/** 모델 API 서버가 멈췄으면 null */
export async function modelStates(force = false): Promise<ModelState[] | null> {
  if (!force && Date.now() - cache.at < TTL_MS) return cache.models;
  try {
    const models = await modelJson<ModelState[]>('GET', '/v1/models', undefined, { timeoutMs: 2000 });
    cache = { at: Date.now(), models };
  } catch (e) {
    if (!(e instanceof ModelApiDown)) throw e;
    cache = { at: Date.now(), models: null };
  }
  return cache.models;
}

/** 이 종류의 인식에서 가장 먼저 부를 모델(설정 순서 중 켜져 있고 설치된 것) */
export function firstUsable(models: ModelState[], order: string[]): ModelState | null {
  for (const name of order) {
    const m = models.find((x) => x.name === name);
    if (m && m.enabled && m.installed && m.state !== 'unavailable') return m;
  }
  return null;
}
