// #34 모델 상태 캐시 — model-api GET /v1/models 를 몇 초 단위로 읽어 "모델 준비 중" 안내(RequestStatus.model_wait)에 쓴다.
//
//   구조에서의 위치: requestStatus.ts → 이 파일 → model-api. 상태 확인이 1초마다 와도 model-api 는 3초에 한 번만 부른다.
//   v0.1.1 services/modelStatus.ts 와 같은 동작.
import { modelJson, ModelApiDown } from './modelApiClient.js';

export interface ModelState {
  name: string; display_name: string; kind: 'omr_staff' | 'omr_jeongganbo' | 'recommend';
  provider: 'venv' | 'ollama' | 'builtin'; enabled: boolean; installed: boolean; version: string | null;
  state: 'ready' | 'cold' | 'loading' | 'failed' | 'unavailable'; loaded_at: string | null;
  last_load_ms: number | null; expected_seconds: number | null; error: string | null; provider_ref?: string | null;
}

let cache: { at: number; models: ModelState[] | null } = { at: 0, models: null };
const TTL_MS = 3000;

/** model-api 가 멈췄으면 null */
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
